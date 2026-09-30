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
const MAX_MANAGED_FILES = 511;
const MAX_MANAGED_TOTAL_BYTES = 32_000_000;
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
  readonly appArtifactMode: 'app-v2-demo' | null;
  readonly acceptedArtifactDigest: string | null;
  readonly artifactDigests: Readonly<Record<'appDefinition' | 'sourceBundle' | 'previewFixtures' | 'objectTypeDefinitions', string>>;
  readonly objectTypeDefinitionCount: number;
  readonly proposedObjectTypes: ReadonlyArray<{
    readonly name: string;
    readonly slug: string;
    readonly status: 'published';
  }>;
  readonly fixtureCollections: readonly string[];
  readonly sampleCollectionCount: number;
  readonly simulatedActionCount: number;
  readonly adapterStatus: 'demo-only';
}

/** Read the exact accepted definition again before preparing a live binding. */
export async function readAcceptedObjectTypeDefinition(
  projectPath: string,
  inspection: GeneratedDemoContinuation,
  slug: string,
): Promise<Record<string, unknown>> {
  const root = await realpath(resolve(projectPath));
  const artifact = JSON.parse((await readBoundedFile(root, ARTIFACT_PATH, MAX_ARTIFACT_BYTES)).toString('utf8')) as unknown;
  if (!isRecord(artifact) || digest(artifact) !== inspection.acceptedArtifactDigest ||
    !Array.isArray(artifact.objectTypeDefinitions) ||
    digest(artifact.objectTypeDefinitions) !== inspection.artifactDigests.objectTypeDefinitions) {
    throw new Error('The accepted Object Type definition changed after source inspection.');
  }
  const matching = artifact.objectTypeDefinitions.filter(
    (value: unknown) => isRecord(value) && value.slug === slug,
  );
  if (matching.length !== 1) throw new Error('The accepted Object Type selection is ambiguous.');
  return matching[0] as Record<string, unknown>;
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
  const generatedDemo = manifest.generatedDemo;
  const hasGeneratedDemo = generatedDemo !== undefined;
  if (hasGeneratedDemo) {
    if (binding !== undefined || !isRecord(generatedDemo) ||
      generatedDemo.schemaVersion !== 'eai.generated_app_artifact.v2' ||
      typeof generatedDemo.artifactDigest !== 'string' || !SHA256_PATTERN.test(generatedDemo.artifactDigest)) {
      throw new Error('The generated-source manifest has invalid or mixed demo authority.');
    }
  } else {
    const workflowTemplate = isRecord(binding) ? binding.workflowTemplate : undefined;
    if (!isRecord(binding) || binding.schemaVersion !== 'eai.generated_app_runtime_binding.v1' ||
      !isRecord(workflowTemplate) || typeof workflowTemplate.id !== 'string' || !workflowTemplate.id ||
      !Number.isInteger(workflowTemplate.version) || (workflowTemplate.version as number) < 1 ||
      typeof workflowTemplate.digest !== 'string' || !SHA256_PATTERN.test(workflowTemplate.digest)) {
      throw new Error('The generated-source manifest lacks a valid hosted-app runtime binding.');
    }
  }
  const managed = manifest.managedFiles.map(managedFile);
  const byPath = new Map(managed.map((item) => [item.path, item]));
  if (managed.length > MAX_MANAGED_FILES || byPath.size !== managed.length || !Array.isArray(manifest.generatedFileScope) ||
    manifest.generatedFileScope.length !== managed.length ||
    new Set(manifest.generatedFileScope).size !== managed.length ||
    manifest.generatedFileScope.some((path) => typeof path !== 'string' || !byPath.has(path))) {
    throw new Error('Generated-source managed file scope is inconsistent.');
  }
  const managedBytes = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const item of managed) {
    const bytes = await readBoundedFile(root, item.path, MAX_ARTIFACT_BYTES);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_MANAGED_TOTAL_BYTES || fileDigest(bytes) !== item.checksum) {
      throw new Error(`Generated demo managed file differs from the manifest: ${item.path}`);
    }
    managedBytes.set(item.path, bytes);
  }
  const artifactEntry = byPath.get(ARTIFACT_PATH);
  if (!artifactEntry) throw new Error('Generated-source manifest does not anchor the v2 demo artifact.');
  const artifactBytes = managedBytes.get(ARTIFACT_PATH)!;
  const artifact = parseJson(artifactBytes, ARTIFACT_PATH);
  if (hasGeneratedDemo && digest(artifact) !== (generatedDemo as Record<string, unknown>).artifactDigest) {
    throw new Error('Generated demo artifact digest differs from the accepted manifest.');
  }
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
  const proposedObjectTypes = definitions.map((item) => {
    if (typeof item.name !== 'string' || !item.name ||
      typeof item.slug !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(item.slug) ||
      item.status !== 'published') {
      throw new Error('Generated demo Object Type proposal has an invalid identifier or status.');
    }
    return { name: item.name, slug: item.slug, status: 'published' as const };
  });
  if (new Set(proposedObjectTypes.map((item) => item.slug)).size !== proposedObjectTypes.length) {
    throw new Error('Generated demo Object Type proposals contain duplicate slugs.');
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
    const bytes = managedBytes.get(file.path)!;
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
    runtimeBindingRecorded: !hasGeneratedDemo,
    appArtifactMode: hasGeneratedDemo ? 'app-v2-demo' : null,
    acceptedArtifactDigest: hasGeneratedDemo ? (generatedDemo as Record<string, string>).artifactDigest : null,
    artifactDigests: Object.fromEntries(digestNames.map((name) => [name, digests[name]])) as GeneratedDemoContinuation['artifactDigests'],
    objectTypeDefinitionCount: definitions.length,
    proposedObjectTypes,
    fixtureCollections: Object.keys(fixtures.collections).sort(),
    sampleCollectionCount: Object.keys(fixtures.collections).length,
    simulatedActionCount: Object.keys(fixtures.actions).length,
    adapterStatus: 'demo-only',
  };
}
