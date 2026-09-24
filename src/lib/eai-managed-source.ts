import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import inquirer from 'inquirer';

const exec = promisify(execFile);
export const CLI_MANAGED_SOURCE_SCHEMA = 'eai.cli_managed_source_bundle.v1';
export const CLI_MANAGED_SOURCE_RECEIPT_PATH = '.eai/cli-managed-source-receipt.json';
export const CLI_MANAGED_SOURCE_LIMITS = { maxFiles: 500, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024 } as const;
/** Repository ownership is separate from the EAI Azure hosting choice. */
export type ManagedDeploySource = 'eai-managed' | 'customer-owned';

const ROOT_FILES = new Set([
  'package.json', 'package-lock.json', 'next.config.js', 'next.config.mjs', 'next.config.ts',
  'postcss.config.js', 'postcss.config.mjs', 'postcss.config.ts', 'tailwind.config.js', 'tailwind.config.ts', 'tsconfig.json',
]);
const RESERVED_PREFIXES = [
  'src/app/api/auth/', 'src/app/api/eai/', 'src/app/api/platform/', 'src/app/auth/', 'src/app/health/',
  'src/components/generated-workflow/', 'src/lib/generated-workflow/', 'src/lib/platform/',
];
const RESERVED_FILES = new Set(['src/auth.ts', 'src/middleware.ts', 'src/lib/api-helpers.ts', 'src/eai.config/register.ts', 'src/eai.config/deployment-contract.ts']);
const NON_SOURCE_ROOTS = new Set(['.git', '.next', 'node_modules', '.specify', '.claude', '.agents', '.gemini', '.grok', '.system', '.eai', '.vscode', '.cursor', '.codex', 'coverage', 'test-results', 'playwright-report']);
const NON_SOURCE_FILES = new Set(['.eai-manifest.json', '.DS_Store', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'GROK.md', 'codex-config.toml', 'next-env.d.ts', 'tsconfig.tsbuildinfo', '.github/copilot-instructions.md']);
const NON_SOURCE_PREFIXES = ['.github/prompts/', '.github/skills/', '.github/instructions/', '.github/agents/'];

/** Checksums and size describe the decoded bytes, not the base64 text. */
export interface CliManagedSourceFile {
  path: string;
  type: 'file';
  size: number;
  sha256: string;
  contentBase64: string;
}

/** Authored-file snapshot; the server derives repository authority and platform-owned files. */
export interface CliManagedSourceBundle {
  schemaVersion: typeof CLI_MANAGED_SOURCE_SCHEMA;
  templateCommitSha: string;
  bundleSha256: string;
  files: CliManagedSourceFile[];
}

/** Stable failure codes keep unsupported local source separate from server deployment failure. */
export class ManagedSourceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function digest(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** Mirrors the server publication allowlist; changing it requires a coordinated contract update. */
export function isManagedAppSourcePath(path: string): boolean {
  const parts = path.split('/');
  return path === path.trim() && path.length > 0 && path.length <= 240
    && !path.startsWith('/') && !path.includes('\\') && !Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && parts.every(part => part && part !== '..' && !part.startsWith('.'))
    && !RESERVED_FILES.has(path) && !RESERVED_PREFIXES.some(prefix => path.startsWith(prefix))
    && (ROOT_FILES.has(path) || path.startsWith('src/') || path.startsWith('public/'));
}

function isCredentialPath(path: string): boolean {
  return path.split('/').some(part => /^\.env(?:\.|$)/i.test(part) || ['.npmrc', '.netrc', '.pypirc'].includes(part))
    || /\.(?:pem|key|p12|pfx)$/i.test(path);
}

function isNonSourcePath(path: string): boolean {
  return NON_SOURCE_ROOTS.has(path.split('/')[0]) || NON_SOURCE_FILES.has(path) || NON_SOURCE_PREFIXES.some(prefix => path.startsWith(prefix))
    || (!path.startsWith('src/') && !path.startsWith('public/') && isCredentialPath(path));
}

/** Credentials never enter a managed GitHub publication, even when embedded in an app-owned file. */
function assertNoEmbeddedCredential(bytes: Buffer, path: string): void {
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/.test(bytes.toString('utf8'))) {
    throw new ManagedSourceError('SOURCE_CREDENTIAL_DETECTED', `Remove the credential from ${path} before publishing source. Use platform-managed configuration for secrets.`);
  }
}

async function readBoundedSourceFile(root: string, path: string): Promise<Buffer> {
  let parent = dirname(join(root, path));
  while (parent !== root) {
    const status = await lstat(parent);
    if (!status.isDirectory() || status.isSymbolicLink()) throw new ManagedSourceError('SOURCE_SYMLINK_UNSUPPORTED', `Source cannot pass through a symlink: ${path}`);
    const next = dirname(parent);
    if (next === parent || relative(root, next).startsWith('..')) throw new ManagedSourceError('SOURCE_PATH_INVALID', `Source escaped the project: ${path}`);
    parent = next;
  }
  const target = join(root, path);
  const status = await lstat(target);
  if (!status.isFile() || status.isSymbolicLink()) throw new ManagedSourceError('SOURCE_SYMLINK_UNSUPPORTED', `Only regular source files can be published: ${path}`);
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.size > CLI_MANAGED_SOURCE_LIMITS.maxFileBytes) throw new ManagedSourceError('SOURCE_FILE_LIMIT', `Source file exceeds the 2 MiB limit: ${path}`);
    const buffer = Buffer.alloc(actual.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== actual.size) throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', `Source changed while packaging: ${path}. Retry after editing has stopped.`);
    const bytes = buffer.subarray(0, count);
    assertNoEmbeddedCredential(bytes, path);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Enumerate the current snapshot, including ignored app files, without following local links. */
async function sourceInventory(root: string): Promise<string[]> {
  const files: string[] = [];
  let entriesSeen = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (isNonSourcePath(path)) continue;
      if (++entriesSeen > 10_000) throw new ManagedSourceError('SOURCE_INVENTORY_LIMIT', 'The local source inventory exceeds 10,000 entries. Remove generated artifacts from the app source.');
      if (entry.isSymbolicLink()) throw new ManagedSourceError('SOURCE_SYMLINK_UNSUPPORTED', `Only regular source files can be published: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
  }
  await visit('');
  return files.sort();
}

/** Local scaffold history detects unsupported edits; the server independently authorizes the reviewed template. */
export async function buildCliManagedSourceBundle(projectRoot: string): Promise<{ bundle: CliManagedSourceBundle; totalBytes: number }> {
  const root = resolve(projectRoot);
  const rootStatus = await lstat(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new ManagedSourceError('SOURCE_PATH_INVALID', 'Use the real generated-app directory, not a symlink.');
  const manifestPath = join(root, '.eai-manifest.json');
  const manifestStatus = await lstat(manifestPath);
  if (!manifestStatus.isFile() || manifestStatus.isSymbolicLink() || manifestStatus.size > 1024 * 1024) throw new ManagedSourceError('TEMPLATE_PIN_REQUIRED', 'The project needs a valid eai init template manifest.');
  const manifest = JSON.parse((await readBoundedSourceFile(root, '.eai-manifest.json')).toString('utf8')) as { template?: { commit?: unknown } };
  const templateCommitSha = manifest.template?.commit;
  if (typeof templateCommitSha !== 'string' || !/^[a-f0-9]{40}$/.test(templateCommitSha)) throw new ManagedSourceError('TEMPLATE_PIN_REQUIRED', 'EAI-maintained source requires an exact reviewed template pin from eai init; enroll a custom template before using this source option.');
  const git = async (args: string[]): Promise<string> => (await exec('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 })).stdout;
  const initialCommits = (await git(['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n');
  if (initialCommits.length !== 1 || !/^[a-f0-9]{40}$/.test(initialCommits[0])) throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'Restore the original eai init scaffold history before publishing EAI-maintained source.');
  const initialCommit = initialCommits[0];
  const message = await git(['show', '-s', '--format=%B', initialCommit]);
  if (!/Initial scaffold from template/.test(message) || !/Created by:\s*eai init/.test(message)) throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'EAI-maintained source requires the original eai init scaffold baseline; use an approved source enrollment for imported projects.');
  const [inventory, changed, baselineFiles] = await Promise.all([
    sourceInventory(root),
    git(['diff', '--name-only', '-z', initialCommit, '--']),
    git(['ls-tree', '-r', '--name-only', '-z', initialCommit]),
  ]);
  const baseline = new Set(baselineFiles.split('\0'));
  const current = new Set(inventory);
  const changes = new Set([...changed.split('\0'), ...inventory.filter(path => !baseline.has(path))]);
  // Missing root configs retain platform defaults; treating their deletion as source would silently change intent.
  const excludedChanges = [...changes].filter(path => path && !isNonSourcePath(path)
    && (!isManagedAppSourcePath(path) || (ROOT_FILES.has(path) && !current.has(path)))).sort();
  if (excludedChanges.length) throw new ManagedSourceError('SOURCE_SCOPE_UNSUPPORTED', `These changed files cannot be omitted from the app: ${excludedChanges.join(', ')}. Restore platform-owned files or use supported app extension points before publishing.`);
  const paths = inventory.filter(path => isManagedAppSourcePath(path));
  if (paths.length < 1 || paths.length > CLI_MANAGED_SOURCE_LIMITS.maxFiles) throw new ManagedSourceError('SOURCE_FILE_COUNT_LIMIT', 'EAI-maintained source requires 1 to 500 app-owned files.');
  const files: CliManagedSourceFile[] = [];
  let totalBytes = 0;
  for (const path of paths) {
    if (isCredentialPath(path)) throw new ManagedSourceError('SOURCE_CREDENTIAL_DETECTED', `Remove the credential file ${path} from app source before publishing.`);
    const bytes = await readBoundedSourceFile(root, path);
    totalBytes += bytes.length;
    if (totalBytes > CLI_MANAGED_SOURCE_LIMITS.maxTotalBytes) throw new ManagedSourceError('SOURCE_TOTAL_LIMIT', 'App source exceeds the 20 MiB managed publication limit.');
    files.push({ path, type: 'file', size: bytes.length, sha256: digest(bytes), contentBase64: bytes.toString('base64') });
  }
  const bundleSha256 = digest(JSON.stringify([templateCommitSha, files.map(file => [file.path, file.size, file.sha256])]));
  return { bundle: { schemaVersion: CLI_MANAGED_SOURCE_SCHEMA, templateCommitSha, bundleSha256, files }, totalBytes };
}

/** Local evidence is recomputable from source bytes; it grants no GitHub or deployment authority. */
export async function writeCliManagedSourceReceipt(projectRoot: string, bundle: CliManagedSourceBundle): Promise<string> {
  const root = resolve(projectRoot);
  const rootStatus = await lstat(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new ManagedSourceError('SOURCE_PATH_INVALID', 'Use the real generated-app directory, not a symlink.');
  const directory = join(root, '.eai');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStatus = await lstat(directory);
  if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) throw new ManagedSourceError('SOURCE_RECEIPT_PATH_INVALID', 'The local source receipt directory cannot be a symlink.');
  const target = join(root, CLI_MANAGED_SOURCE_RECEIPT_PATH);
  const existing = await lstat(target).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new ManagedSourceError('SOURCE_RECEIPT_PATH_INVALID', 'The local source receipt must be a regular file.');
  const temporary = join(directory, `.cli-managed-source-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify({
      schemaVersion: 'eai.cli_managed_source_local_receipt.v1',
      sourceMode: 'eai-cli-generated',
      templateCommitSha: bundle.templateCommitSha,
      bundleSha256: bundle.bundleSha256,
      totalBytes: bundle.files.reduce((total, file) => total + file.size, 0),
      files: bundle.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
}

/** Invoke only after the platform verifies GitHub identity for the signed-in EAI actor. */
export async function chooseManagedDeploySource(options: { source?: string; repo?: string; format: string }, interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)): Promise<ManagedDeploySource> {
  if (options.source && !['eai-managed', 'customer-owned'].includes(options.source)) throw new ManagedSourceError('SOURCE_CHOICE_INVALID', 'Choose --source eai-managed or --source customer-owned.');
  if (options.source === 'eai-managed' && options.repo) throw new ManagedSourceError('SOURCE_CHOICE_CONFLICT', 'EAI selects the maintained repository; omit --repo when choosing --source eai-managed.');
  if (options.source) return options.source as ManagedDeploySource;
  if (!interactive || options.format === 'json') throw new ManagedSourceError('SOURCE_CHOICE_REQUIRED', 'Choose --source eai-managed for EAI to maintain the repository, or --source customer-owned for your GitHub repository.');
  const answer = await inquirer.prompt<{ source: ManagedDeploySource }>([{
    type: 'list', name: 'source', message: 'Who should maintain the app source?',
    choices: [
      { name: 'EAI-maintained GitHub repository — EAI publishes and deploys my app', value: 'eai-managed' },
      { name: 'My GitHub repository — I manage source access and changes', value: 'customer-owned' },
    ],
  }]);
  return answer.source;
}
