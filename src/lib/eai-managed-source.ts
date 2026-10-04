import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import { buildManagedDeployConfigHash } from './eai-managed-deploy.js';
import { isContained, managedFileOpenFlags, writePrivateFileNoFollow } from './eai-managed-deploy-filesystem.js';
import {
  bindManagedProjectRoot,
  type ManagedProjectRootBinding,
} from './eai-managed-root-binding.js';

const exec = promisify(execFile);
export const CLI_MANAGED_SOURCE_SCHEMA = 'eai.cli_managed_source_bundle.v1';
export const CLI_MANAGED_SOURCE_RECEIPT_PATH = '.eai/cli-managed-source-receipt.json';
export const CLI_MANAGED_SOURCE_LIMITS = { maxFiles: 500, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024 } as const;
/** Repository ownership is separate from the EAI Azure hosting choice. */
export type ManagedDeploySource = 'eai-managed' | 'customer-owned';

const ROOT_FILES = new Set([
  'package.json', 'package-lock.json', 'eai.config.ts', 'eai.runtime.json', 'next.config.js', 'next.config.mjs', 'next.config.ts',
  'postcss.config.js', 'postcss.config.mjs', 'postcss.config.ts', 'tailwind.config.js', 'tailwind.config.ts', 'tsconfig.json',
]);
const RESERVED_PREFIXES = [
  'src/app/api/auth/', 'src/app/api/eai/', 'src/app/api/platform/', 'src/app/auth/', 'src/app/health/',
  'src/components/generated-workflow/', 'src/lib/generated-workflow/', 'src/lib/platform/',
];
const RESERVED_FILES = new Set(['Dockerfile', 'src/auth.ts', 'src/middleware.ts', 'src/lib/api-helpers.ts', 'src/eai.config/register.ts', 'src/eai.config/deployment-contract.ts']);
const NON_SOURCE_ROOTS = new Set(['.git', '.next', 'node_modules', '.specify', '.claude', '.agents', '.gemini', '.grok', '.system', '.eai', '.vscode', '.cursor', '.codex', 'coverage', 'test-results', 'playwright-report']);
const NON_SOURCE_FILES = new Set(['.eai-manifest.json', '.DS_Store', '.last_package_hash', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'GROK.md', 'codex-config.toml', 'next-env.d.ts', 'tsconfig.tsbuildinfo', '.github/copilot-instructions.md']);
const NON_SOURCE_PREFIXES = ['.husky/_/', '.github/prompts/', '.github/skills/', '.github/instructions/', '.github/agents/'];

/** Checksums and size describe the decoded bytes, not the base64 text. */
export interface CliManagedSourceFile {
  path: string;
  type: 'file';
  mode?: '100644' | '100755';
  size: number;
  sha256: string;
  contentBase64: string;
}

/** Authored-file snapshot; the server derives repository authority and platform-owned files. */
export interface CliManagedSourceBundle {
  schemaVersion: typeof CLI_MANAGED_SOURCE_SCHEMA;
  templateCommitSha: string;
  bundleSha256: string;
  configHash: string;
  files: CliManagedSourceFile[];
}

/** Stable failure codes keep unsupported local source separate from server deployment failure. */
export class ManagedSourceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function bindSourceProjectRoot(
  projectRoot: string,
  code: 'SOURCE_PATH_INVALID' | 'SOURCE_RECEIPT_PATH_INVALID',
): Promise<ManagedProjectRootBinding> {
  try {
    return await bindManagedProjectRoot(projectRoot);
  } catch (error) {
    throw new ManagedSourceError(
      code,
      `The application root changed or is untrusted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function assertSourceProjectRoot(
  binding: ManagedProjectRootBinding,
  code: 'SOURCE_CHANGED_DURING_READ' | 'SOURCE_RECEIPT_PATH_INVALID' = 'SOURCE_CHANGED_DURING_READ',
): Promise<void> {
  try {
    await binding.assert();
  } catch (error) {
    throw new ManagedSourceError(
      code,
      `The application root changed during the operation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function digest(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** Mirrors the server boundary: complete authored source cannot replace deployment-owned controls. */
export function isManagedAppSourcePath(path: string): boolean {
  const parts = path.split('/');
  return path === path.trim() && path.length > 0 && path.length <= 240
    && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && !Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && parts.every(part => part && part !== '..' && part !== '.')
    && !RESERVED_FILES.has(path) && !RESERVED_PREFIXES.some(prefix => path.startsWith(prefix))
    && parts[0] !== '.github' && !isCredentialPath(path) && !isNonSourcePath(path);
}

function isCredentialPath(path: string): boolean {
  return path.split('/').some(part => /^\.env/i.test(part) || ['.npmrc', '.netrc', '.pypirc'].includes(part.toLowerCase()))
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

async function readBoundedSourceFile(
  root: string,
  path: string,
  rootBinding: ManagedProjectRootBinding,
): Promise<{ bytes: Buffer; mode: '100644' | '100755' }> {
  await assertSourceProjectRoot(rootBinding);
  const directoryIdentities: Array<{ path: string; dev: number; ino: number }> = [];
  let parent = dirname(join(root, path));
  while (parent !== root) {
    const status = await lstat(parent);
    if (!status.isDirectory() || status.isSymbolicLink()) throw new ManagedSourceError('SOURCE_SYMLINK_UNSUPPORTED', `Source cannot pass through a symlink: ${path}`);
    directoryIdentities.push({ path: parent, dev: status.dev, ino: status.ino });
    const next = dirname(parent);
    if (next === parent || relative(root, next).startsWith('..')) throw new ManagedSourceError('SOURCE_PATH_INVALID', `Source escaped the project: ${path}`);
    parent = next;
  }
  const rootStatus = await lstat(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new ManagedSourceError('SOURCE_PATH_INVALID', 'Use the real generated-app directory, not a symlink.');
  directoryIdentities.push({ path: root, dev: rootStatus.dev, ino: rootStatus.ino });
  const target = join(root, path);
  const status = await lstat(target);
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) throw new ManagedSourceError('SOURCE_SYMLINK_UNSUPPORTED', `Only regular source files can be published: ${path}`);
  const handle = await open(target, constants.O_RDONLY | managedFileOpenFlags());
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== status.dev || actual.ino !== status.ino
      || actual.size !== status.size || actual.mode !== status.mode || actual.mtimeMs !== status.mtimeMs || actual.ctimeMs !== status.ctimeMs) {
      throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', `Source changed before packaging: ${path}. Retry after editing has stopped.`);
    }
    for (const identity of directoryIdentities) {
      const current = await lstat(identity.path);
      if (!current.isDirectory() || current.isSymbolicLink()
        || current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', `Source path changed before packaging: ${path}. Retry after editing has stopped.`);
      }
    }
    const [canonicalRoot, canonicalTarget, rebound] = await Promise.all([
      realpath(root),
      realpath(target),
      lstat(target),
    ]);
    await assertSourceProjectRoot(rootBinding);
    if (!isContained(canonicalRoot, canonicalTarget) || rebound.isSymbolicLink() || rebound.nlink !== 1
      || rebound.dev !== actual.dev || rebound.ino !== actual.ino) {
      throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', `Source path changed before packaging: ${path}. Retry after editing has stopped.`);
    }
    if (actual.size > CLI_MANAGED_SOURCE_LIMITS.maxFileBytes) throw new ManagedSourceError('SOURCE_FILE_LIMIT', `Source file exceeds the 2 MiB limit: ${path}`);
    const buffer = Buffer.alloc(actual.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await handle.stat();
    for (const identity of directoryIdentities) {
      const current = await lstat(identity.path);
      if (!current.isDirectory() || current.isSymbolicLink()
        || current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', `Source path changed while packaging: ${path}. Retry after editing has stopped.`);
      }
    }
    const [finalRoot, finalTarget, finalPath] = await Promise.all([
      realpath(root),
      realpath(target),
      lstat(target),
    ]);
    await assertSourceProjectRoot(rootBinding);
    if (count !== actual.size || after.nlink !== 1 || after.dev !== actual.dev || after.ino !== actual.ino
      || after.size !== actual.size || after.mode !== actual.mode || after.mtimeMs !== actual.mtimeMs || after.ctimeMs !== actual.ctimeMs
      || finalPath.isSymbolicLink() || !finalPath.isFile() || finalPath.nlink !== 1
      || finalPath.dev !== actual.dev || finalPath.ino !== actual.ino || finalPath.size !== actual.size
      || !isContained(finalRoot, finalTarget)) {
      throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', `Source changed while packaging: ${path}. Retry after editing has stopped.`);
    }
    const bytes = buffer.subarray(0, count);
    assertNoEmbeddedCredential(bytes, path);
    return { bytes, mode: actual.mode & 0o111 ? '100755' : '100644' };
  } finally {
    await handle.close();
  }
}

/** Enumerate the current snapshot, including ignored app files, without following local links. */
async function sourceInventory(
  root: string,
  rootBinding: ManagedProjectRootBinding,
): Promise<string[]> {
  const files: string[] = [];
  let entriesSeen = 0;
  async function visit(directory: string): Promise<void> {
    await assertSourceProjectRoot(rootBinding);
    const path = join(root, directory);
    const before = await lstat(path);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new ManagedSourceError('SOURCE_SYMLINK_UNSUPPORTED', `Source directory is not a regular directory: ${directory}`);
    const assertDirectory = async (): Promise<void> => {
      const current = await lstat(path);
      if (!current.isDirectory() || current.isSymbolicLink()
        || current.dev !== before.dev || current.ino !== before.ino
        || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) {
        throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', `Source directory changed during inventory: ${directory}`);
      }
    };
    const entries = await readdir(path, { withFileTypes: true });
    await assertDirectory();
    for (const entry of entries) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (path.includes('/') && !NON_SOURCE_ROOTS.has(path.split('/')[0]) && isCredentialPath(path)) {
        throw new ManagedSourceError('SOURCE_CREDENTIAL_DETECTED', `Remove the credential path ${path} from app source before publishing.`);
      }
      if (isNonSourcePath(path)) continue;
      if (++entriesSeen > 10_000) throw new ManagedSourceError('SOURCE_INVENTORY_LIMIT', 'The local source inventory exceeds 10,000 entries. Remove generated artifacts from the app source.');
      if (entry.isSymbolicLink()) throw new ManagedSourceError('SOURCE_SYMLINK_UNSUPPORTED', `Only regular source files can be published: ${path}`);
      await assertDirectory();
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
    await assertDirectory();
  }
  await visit('');
  return files.sort();
}

/** Local history binds the init pin and manifest-only migrations; the server independently authorizes each reviewed template. */
export async function buildCliManagedSourceBundle(projectRoot: string): Promise<{ bundle: CliManagedSourceBundle; totalBytes: number }> {
  const rootBinding = await bindSourceProjectRoot(resolve(projectRoot), 'SOURCE_PATH_INVALID');
  const root = rootBinding.path;
  const manifestPath = join(root, '.eai-manifest.json');
  const manifestStatus = await lstat(manifestPath);
  if (!manifestStatus.isFile() || manifestStatus.isSymbolicLink() || manifestStatus.size > 1024 * 1024) throw new ManagedSourceError('TEMPLATE_PIN_REQUIRED', 'The project needs a valid eai init template manifest.');
  const manifest = JSON.parse((await readBoundedSourceFile(root, '.eai-manifest.json', rootBinding)).bytes.toString('utf8')) as { template?: { commit?: unknown; repo?: unknown } };
  const templateCommitSha = manifest.template?.commit;
  if (typeof templateCommitSha !== 'string' || !/^[a-f0-9]{40}$/.test(templateCommitSha)) throw new ManagedSourceError('TEMPLATE_PIN_REQUIRED', 'EAI-maintained source requires an exact reviewed template pin from eai init; enroll a custom template before using this source option.');
  const git = async (args: string[]): Promise<string> => {
    await assertSourceProjectRoot(rootBinding);
    const output = (await exec('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 })).stdout;
    await assertSourceProjectRoot(rootBinding);
    return output;
  };
  const initialCommits = (await git(['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n');
  if (initialCommits.length !== 1 || !/^[a-f0-9]{40}$/.test(initialCommits[0])) throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'Restore the original eai init scaffold history before publishing EAI-maintained source.');
  const initialCommit = initialCommits[0];
  const message = await git(['show', '-s', '--format=%B', initialCommit]);
  if (!/Initial scaffold from template/.test(message) || !/Created by:\s*eai init/.test(message)) throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'EAI-maintained source requires the original eai init scaffold baseline; use an approved source enrollment for imported projects.');
  let initialTemplateCommitSha: unknown;
  let initialTemplateRepository: unknown;
  try {
    const initialManifest = JSON.parse(await git(['show', `${initialCommit}:.eai-manifest.json`])) as { template?: { commit?: unknown; repo?: unknown } };
    initialTemplateCommitSha = initialManifest.template?.commit;
    initialTemplateRepository = initialManifest.template?.repo;
  } catch {
    throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'The original eai init scaffold must contain its reviewed template manifest.');
  }
  if (typeof initialTemplateCommitSha !== 'string' || !/^[a-f0-9]{40}$/.test(initialTemplateCommitSha)) {
    throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'The original eai init scaffold must contain an exact reviewed template pin.');
  }
  const currentTemplateRepository = manifest.template?.repo;
  const templateChanged = templateCommitSha !== initialTemplateCommitSha || currentTemplateRepository !== initialTemplateRepository;
  if (templateChanged) {
    const rejectMigration = (): never => {
      throw new ManagedSourceError('TEMPLATE_PIN_CHANGED', 'The template pin differs from the verified eai init or committed template migration lineage. Restore the manifest or commit an explicit single-file migration before publishing.');
    };
    const githubRepository = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
    if (typeof initialTemplateRepository !== 'string' || !githubRepository.test(initialTemplateRepository) || typeof currentTemplateRepository !== 'string' || !githubRepository.test(currentTemplateRepository)) rejectMigration();
    const committedManifest = JSON.parse(await git(['show', 'HEAD:.eai-manifest.json'])) as { template?: { commit?: unknown; repo?: unknown } };
    if (committedManifest.template?.commit !== templateCommitSha || committedManifest.template?.repo !== currentTemplateRepository) rejectMigration();
    const manifestCommits = (await git(['log', '--reverse', '--format=%H', '--', '.eai-manifest.json'])).trim().split('\n');
    if (manifestCommits.length < 2 || manifestCommits.length > 64 || manifestCommits[0] !== initialCommit || manifestCommits.some(sha => !/^[a-f0-9]{40}$/.test(sha))) rejectMigration();
    let verifiedCommit: string = initialTemplateCommitSha;
    let verifiedRepository: string = initialTemplateRepository as string;
    let migrations = 0;
    for (const commit of manifestCommits.slice(1)) {
      const version = JSON.parse(await git(['show', `${commit}:.eai-manifest.json`])) as { template?: { commit?: unknown; repo?: unknown } };
      const nextCommit = version.template?.commit;
      const nextRepository = version.template?.repo;
      if (nextCommit === verifiedCommit && nextRepository === verifiedRepository) continue;
      if (typeof nextCommit !== 'string' || !/^[a-f0-9]{40}$/.test(nextCommit) || typeof nextRepository !== 'string' || !githubRepository.test(nextRepository) || ++migrations > 8) rejectMigration();
      const [parents, message, changedPaths] = await Promise.all([
        git(['show', '-s', '--format=%P', commit]),
        git(['show', '-s', '--format=%B', commit]),
        git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]),
      ]);
      const parent = parents.trim().split(/\s+/);
      if (parent.length !== 1 || !/^[a-f0-9]{40}$/.test(parent[0]) || changedPaths.trim() !== '.eai-manifest.json') rejectMigration();
      const before = JSON.parse(await git(['show', `${parent[0]}:.eai-manifest.json`])) as { template?: { commit?: unknown; repo?: unknown } };
      if (before.template?.commit !== verifiedCommit || before.template?.repo !== verifiedRepository) rejectMigration();
      const trailers = [
        ['EAI-Template-Migration-From', verifiedCommit],
        ['EAI-Template-Migration-To', nextCommit],
        ['EAI-Template-Migration-Repository', nextRepository],
      ] as const;
      if (trailers.some(([key, value]) => {
        const lines = message.split('\n').filter(line => line.startsWith(`${key}: `));
        return lines.length !== 1 || lines[0] !== `${key}: ${value}`;
      })) rejectMigration();
      verifiedCommit = nextCommit as string;
      verifiedRepository = nextRepository as string;
    }
    if (migrations === 0 || verifiedCommit !== templateCommitSha || verifiedRepository !== currentTemplateRepository) rejectMigration();
  }
  const [inventory, changed, baselineFiles] = await Promise.all([
    sourceInventory(root, rootBinding),
    git(['diff', '--name-only', '-z', initialCommit, '--']),
    git(['ls-tree', '-r', '--name-only', '-z', initialCommit]),
  ]);
  const baseline = new Set(baselineFiles.split('\0'));
  const current = new Set(inventory);
  const changes = new Set([...changed.split('\0'), ...inventory.filter(path => !baseline.has(path))]);
  // Missing root configs retain platform defaults; treating their deletion as source would silently change intent.
  const excludedChanges = [...changes].filter(path => path && !isNonSourcePath(path)
    && (!isManagedAppSourcePath(path) || (ROOT_FILES.has(path) && !current.has(path)))).sort();
  if (excludedChanges.length) throw new ManagedSourceError('SOURCE_SCOPE_UNSUPPORTED', `These changes affect deployment-owned controls and cannot be omitted from the app: ${excludedChanges.join(', ')}. Use the supported runtime contract or enroll the custom runtime before publishing; authored app files are uploaded in full.`);
  const paths = inventory.filter(path => isManagedAppSourcePath(path));
  if (paths.length < 1 || paths.length > CLI_MANAGED_SOURCE_LIMITS.maxFiles) throw new ManagedSourceError('SOURCE_FILE_COUNT_LIMIT', 'EAI-maintained source requires 1 to 500 app-owned files.');
  // Windows has no executable file bit; retain the Git index's reviewed mode for tracked files.
  const indexedModes = new Map<string, '100644' | '100755'>();
  const indexedFiles = process.platform === 'win32' ? await git(['ls-files', '--stage', '-z']) : undefined;
  for (const entry of indexedFiles?.split('\0') ?? []) {
    if (!entry) continue;
    const match = /^(\d{6}) [a-f0-9]{40} (\d)\t(.+)$/.exec(entry);
    if (!match) throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'Resolve the source index before publishing; its file modes are invalid.');
    if (!isManagedAppSourcePath(match[3])) continue;
    if (match[2] !== '0' || !['100644', '100755'].includes(match[1])) {
      throw new ManagedSourceError('SOURCE_BASELINE_REQUIRED', 'Resolve the source index before publishing; only regular, unconflicted app files are supported.');
    }
    indexedModes.set(match[3], match[1] as '100644' | '100755');
  }
  const files: CliManagedSourceFile[] = [];
  let totalBytes = 0;
  for (let offset = 0; offset < paths.length; offset += 8) {
    const batch = paths.slice(offset, offset + 8);
    const loaded = await Promise.all(batch.map(async path => {
      if (isCredentialPath(path)) throw new ManagedSourceError('SOURCE_CREDENTIAL_DETECTED', `Remove the credential file ${path} from app source before publishing.`);
      const { bytes, mode } = await readBoundedSourceFile(root, path, rootBinding);
      return { path, type: 'file' as const, mode: indexedModes.get(path) ?? mode, size: bytes.length, sha256: digest(bytes), contentBase64: bytes.toString('base64') };
    }));
    for (const file of loaded) {
      totalBytes += file.size;
      if (totalBytes > CLI_MANAGED_SOURCE_LIMITS.maxTotalBytes) throw new ManagedSourceError('SOURCE_TOTAL_LIMIT', 'App source exceeds the 20 MiB managed publication limit.');
      files.push(file);
    }
  }
  await assertSourceProjectRoot(rootBinding);
  const finalInventory = await sourceInventory(root, rootBinding);
  if (inventory.length !== finalInventory.length || inventory.some((path, index) => path !== finalInventory[index])) {
    throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', 'Source inventory changed during packaging. Retry after editing has stopped.');
  }
  const configHash = await buildManagedDeployConfigHash(root, rootBinding);
  await assertSourceProjectRoot(rootBinding);
  if (indexedFiles !== undefined && indexedFiles !== await git(['ls-files', '--stage', '-z'])) {
    throw new ManagedSourceError('SOURCE_CHANGED_DURING_READ', 'Source file permissions changed in the index during packaging. Retry after editing has stopped.');
  }
  const bundleSha256 = digest(JSON.stringify([templateCommitSha, configHash, files.map(file => [file.path, file.size, file.sha256, file.mode])]));
  return { bundle: { schemaVersion: CLI_MANAGED_SOURCE_SCHEMA, templateCommitSha, bundleSha256, configHash, files }, totalBytes };
}

/** Local evidence is recomputable from source bytes; it grants no GitHub or deployment authority. */
export async function writeCliManagedSourceReceipt(projectRoot: string, bundle: CliManagedSourceBundle): Promise<string> {
  const rootBinding = await bindSourceProjectRoot(resolve(projectRoot), 'SOURCE_RECEIPT_PATH_INVALID');
  const root = rootBinding.path;
  const directory = join(root, '.eai');
  await assertSourceProjectRoot(rootBinding, 'SOURCE_RECEIPT_PATH_INVALID');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertSourceProjectRoot(rootBinding, 'SOURCE_RECEIPT_PATH_INVALID');
  const directoryStatus = await lstat(directory);
  if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) throw new ManagedSourceError('SOURCE_RECEIPT_PATH_INVALID', 'The local source receipt directory cannot be a symlink.');
  const target = join(root, CLI_MANAGED_SOURCE_RECEIPT_PATH);
  const existing = await lstat(target).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new ManagedSourceError('SOURCE_RECEIPT_PATH_INVALID', 'The local source receipt must be a regular file.');
  try {
    await assertSourceProjectRoot(rootBinding, 'SOURCE_RECEIPT_PATH_INVALID');
    await writePrivateFileNoFollow(target, `${JSON.stringify({
      schemaVersion: 'eai.cli_managed_source_local_receipt.v1',
      sourceMode: 'eai-cli-generated',
      templateCommitSha: bundle.templateCommitSha,
      bundleSha256: bundle.bundleSha256,
      configHash: bundle.configHash,
      totalBytes: bundle.files.reduce((total, file) => total + file.size, 0),
      files: bundle.files.map(({ path, size, sha256, mode }) => ({ path, size, sha256, mode })),
    }, null, 2)}\n`, rootBinding);
    await assertSourceProjectRoot(rootBinding, 'SOURCE_RECEIPT_PATH_INVALID');
  } catch (error) {
    if (error instanceof ManagedSourceError) throw error;
    throw new ManagedSourceError('SOURCE_RECEIPT_PATH_INVALID', `The local source receipt path changed before it could be written: ${error instanceof Error ? error.message : String(error)}`);
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
