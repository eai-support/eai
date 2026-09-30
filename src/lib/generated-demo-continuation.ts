import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ARTIFACT_PATH = 'src/eai.config/generated-demo.json';
const MANIFEST_PATH = '.eai-manifest.json';
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SOURCE_PATH_PATTERN = /^src\/generated\/[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(?:ts|tsx|css)$/;
const MAX_MANIFEST_BYTES = 2_000_000;
const MAX_ARTIFACT_BYTES = 2_000_000;
const execOptions = { timeout: 10_000, maxBuffer: 128_000 };

interface ManagedFile {
  path: string;
  checksum: string;
  encoding: 'utf8' | 'base64';
  owner: 'admin-portal-generated';
}

export interface GeneratedDemoContinuation {
  readonly appKey: string;
  readonly appName: string;
  readonly repository: string;
  readonly commitSha: string;
  readonly sourceMode: 'admin-portal-generated';
  readonly templateRepository: string | null;
  readonly runtimeBindingRecorded: boolean;
  readonly artifactDigests: Readonly<Record<'appDefinition' | 'sourceBundle' | 'previewFixtures' | 'objectTypeDefinitions', string>>;
  readonly objectTypeDefinitionCount: number;
  readonly sampleCollectionCount: number;
  readonly simulatedActionCount: number;
  readonly adapterStatus: 'demo-only';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Generated demo artifact contains a non-JSON value.');
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(`${canonicalJson(value)}\n`, 'utf8').digest('hex')}`;
}

function fileDigest(contents: Buffer): string {
  return `sha256:${createHash('sha256').update(contents).digest('hex')}`;
}

function canonicalPath(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !path.includes('\\') &&
    path.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..');
}

async function readBoundedFile(root: string, path: string, limit: number): Promise<Buffer> {
  if (!canonicalPath(path)) throw new Error(`Generated demo path is invalid: ${path}`);
  let current = root;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error(`Generated demo path contains a symbolic link: ${path}`);
  }
  const metadata = await lstat(current);
  if (!metadata.isFile() || metadata.size > limit) throw new Error(`Generated demo file is missing or too large: ${path}`);
  return readFile(current);
}

function parseJson(contents: Buffer, path: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(contents.toString('utf8')); } catch { throw new Error(`${path} is not valid JSON.`); }
  if (!isRecord(value)) throw new Error(`${path} must contain a JSON object.`);
  return value;
}

function managedFile(value: unknown): ManagedFile {
  if (!isRecord(value) || typeof value.path !== 'string' || !canonicalPath(value.path) ||
    typeof value.checksum !== 'string' || !SHA256_PATTERN.test(value.checksum) ||
    (value.encoding !== 'utf8' && value.encoding !== 'base64') || value.owner !== 'admin-portal-generated') {
    throw new Error('Generated app manifest has an invalid managed file entry.');
  }
  return value as unknown as ManagedFile;
}

function repositorySlug(remote: string): string {
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error('The clone must have a GitHub origin remote.');
  return match[1];
}

/** Inspect a cloned NCB demo without changing its source, manifest, Object Types or deployment. */
export async function inspectGeneratedDemoContinuation(projectPath: string): Promise<GeneratedDemoContinuation> {
  const root = await realpath(resolve(projectPath));
  const { stdout: gitRoot } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: root, ...execOptions });
  if (await realpath(gitRoot.trim()) !== root) throw new Error('Run continuation at the generated repository root.');
  const [{ stdout: remote }, { stdout: commit }] = await Promise.all([
    execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: root, ...execOptions }),
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, ...execOptions }),
  ]);
  const repository = repositorySlug(remote.trim());
  const commitSha = commit.trim();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error('Repository HEAD is not a Git commit.');

  const manifest = parseJson(await readBoundedFile(root, MANIFEST_PATH, MAX_MANIFEST_BYTES), MANIFEST_PATH);
  if (manifest.schemaVersion !== 'eai.generated_app_manifest.v1' || manifest.sourceMode !== 'admin-portal-generated' ||
    typeof manifest.appKey !== 'string' || !manifest.appKey || !Array.isArray(manifest.managedFiles)) {
    throw new Error('This repository has no supported NCB generated-source manifest.');
  }
  const binding = manifest.runtimeBinding;
  const workflowTemplate = isRecord(binding) ? binding.workflowTemplate : undefined;
  if (!isRecord(binding) || binding.schemaVersion !== 'eai.generated_app_runtime_binding.v1' ||
    !isRecord(workflowTemplate) || typeof workflowTemplate.id !== 'string' || !workflowTemplate.id ||
    !Number.isInteger(workflowTemplate.version) || (workflowTemplate.version as number) < 1 ||
    typeof workflowTemplate.digest !== 'string' || !SHA256_PATTERN.test(workflowTemplate.digest)) {
    throw new Error('The generated-source manifest lacks a valid hosted-app runtime binding.');
  }
  const managed = manifest.managedFiles.map(managedFile);
  const byPath = new Map(managed.map((item) => [item.path, item]));
  if (byPath.size !== managed.length || !Array.isArray(manifest.generatedFileScope) ||
    manifest.generatedFileScope.length !== managed.length ||
    new Set(manifest.generatedFileScope).size !== managed.length ||
    manifest.generatedFileScope.some((path) => typeof path !== 'string' || !byPath.has(path))) {
    throw new Error('Generated-source managed file scope is inconsistent.');
  }
  const artifactEntry = byPath.get(ARTIFACT_PATH);
  if (!artifactEntry) throw new Error('Generated-source manifest does not anchor the v2 demo artifact.');
  const artifactBytes = await readBoundedFile(root, ARTIFACT_PATH, MAX_ARTIFACT_BYTES);
  if (fileDigest(artifactBytes) !== artifactEntry.checksum) throw new Error('Generated demo artifact differs from the managed source manifest.');
  const artifact = parseJson(artifactBytes, ARTIFACT_PATH);
  const definition = artifact.appDefinition;
  const source = artifact.sourceBundle;
  const fixtures = artifact.previewFixtures;
  const definitions = artifact.objectTypeDefinitions;
  const digests = artifact.digests;
  if (artifact.schemaVersion !== 'eai.generated_app_artifact.v2' || !isRecord(definition) ||
    definition.schemaVersion !== 'eai.generated_app_definition.v2' || definition.appKey !== manifest.appKey ||
    typeof definition.appName !== 'string' || !definition.appName || definition.entryPath !== 'src/generated/app.tsx' ||
    !isRecord(source) || source.schemaVersion !== 'eai.generated_app_source.v1' || !Array.isArray(source.files) ||
    source.files.length < 1 || source.files.length > 64 ||
    !isRecord(fixtures) || fixtures.schemaVersion !== 'eai.generated_app_fixtures.v1' ||
    !isRecord(fixtures.collections) || !isRecord(fixtures.actions) || !Array.isArray(definitions) ||
    definitions.length > 100 || !definitions.every(isRecord) || !isRecord(digests)) {
    throw new Error('Generated demo artifact has an unsupported or incomplete v2 contract.');
  }
  if (definitions.some((item) => ['sampleRows', 'fixtureRows', 'seedData', 'records'].some((key) => key in item))) {
    throw new Error('Object Type definitions must not contain sample records.');
  }
  const digestNames = ['appDefinition', 'sourceBundle', 'previewFixtures', 'objectTypeDefinitions'] as const;
  for (const name of digestNames) {
    if (typeof digests[name] !== 'string' || !SHA256_PATTERN.test(digests[name]) || digests[name] !== digest(artifact[name])) {
      throw new Error(`Generated demo ${name} digest does not match the accepted artifact.`);
    }
  }
  const sourcePaths = new Set<string>();
  for (const file of source.files) {
    if (!isRecord(file) || typeof file.path !== 'string' || !SOURCE_PATH_PATTERN.test(file.path) ||
      !canonicalPath(file.path) || sourcePaths.has(file.path) || typeof file.content !== 'string') {
      throw new Error('Generated demo source bundle contains an invalid or duplicate path.');
    }
    sourcePaths.add(file.path);
    const entry = byPath.get(file.path);
    if (!entry || entry.encoding !== 'utf8') throw new Error(`Generated demo source is not anchored by the manifest: ${file.path}`);
    const bytes = await readBoundedFile(root, file.path, 128_000);
    if (bytes.toString('utf8') !== file.content || fileDigest(bytes) !== entry.checksum) {
      throw new Error(`Generated demo source differs from the accepted artifact: ${file.path}`);
    }
  }
  if (!sourcePaths.has('src/generated/app.tsx')) throw new Error('Generated demo entry source is missing.');
  if (Object.values(fixtures.actions).some((value) => !isRecord(value) || !['session-local', 'none'].includes(String(value.effect)))) {
    throw new Error('Generated demo action is not explicitly simulated.');
  }
  const { stdout: changes } = await execFileAsync('git', [
    'status', '--porcelain', '--untracked-files=all', '--', MANIFEST_PATH, ARTIFACT_PATH, ...sourcePaths,
  ], { cwd: root, ...execOptions });
  if (changes.trim()) throw new Error('Generated demo source has uncommitted changes; review and commit them before continuation.');
  return {
    appKey: manifest.appKey,
    appName: definition.appName,
    repository,
    commitSha,
    sourceMode: 'admin-portal-generated',
    templateRepository: typeof manifest.templateRepository === 'string' ? manifest.templateRepository : null,
    runtimeBindingRecorded: true,
    artifactDigests: Object.fromEntries(digestNames.map((name) => [name, digests[name]])) as GeneratedDemoContinuation['artifactDigests'],
    objectTypeDefinitionCount: definitions.length,
    sampleCollectionCount: Object.keys(fixtures.collections).length,
    simulatedActionCount: Object.keys(fixtures.actions).length,
    adapterStatus: 'demo-only',
  };
}
