import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ARTIFACT_PATH = 'src/eai.config/generated-demo.json';
const MANIFEST_PATH = '.eai-manifest.json';
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
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
  readonly workflowViewIds: readonly string[];
  readonly acceptedViewBindings: ReadonlyArray<{
    readonly viewId: string;
    readonly componentId: string;
    readonly fixtureCollection: string;
    readonly objectTypeSlug: string;
  }>;
  readonly acceptedTrustedSlots: ReadonlyArray<{
    readonly viewId: string;
    readonly componentId: string;
    readonly kind: 'read-table' | 'static-copy';
  }>;
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

function exactKeys(value: Record<string, unknown>, allowed: string[], required: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
}

function boundedText(value: unknown, maximum = 500): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum;
}

/** The CLI only accepts the host-rendered preview IR; generated TSX remains source provenance. */
function validateSafeUi(
  value: unknown,
  componentIds: string[],
  fixtures: Record<string, unknown>,
  targetViews: Set<string>,
): number {
  if (!isRecord(value) || !exactKeys(value, ['version', 'root'], ['version', 'root']) ||
    value.version !== 'eai.safe_ui.v1') {
    throw new Error('Generated demo safe UI is missing or invalid.');
  }
  const collections = fixtures.collections as Record<string, unknown>;
  const actions = fixtures.actions as Record<string, unknown>;
  const usedComponents = new Set<string>();
  const usedInputs = new Set<string>();
  let nodes = 0;
  const hasScalarField = (collection: unknown, field: unknown, rowIndex?: unknown): boolean => {
    if (typeof collection !== 'string' || !SAFE_ID_PATTERN.test(collection) ||
      typeof field !== 'string' || !SAFE_FIELD_PATTERN.test(field) ||
      ['__proto__', 'prototype', 'constructor'].includes(field.toLowerCase()) ||
      !Object.hasOwn(collections, collection) || !Array.isArray(collections[collection])) return false;
    const rows = collections[collection] as unknown[];
    const scalar = (row: unknown): boolean => isRecord(row) && Object.hasOwn(row, field) &&
      (row[field] === null || ['string', 'number', 'boolean'].includes(typeof row[field]));
    if (rowIndex === undefined) {
      const visibleRows = rows.slice(0, 50);
      return visibleRows.some(row => isRecord(row) && Object.hasOwn(row, field)) &&
        visibleRows.every(row => isRecord(row) && (!Object.hasOwn(row, field) || scalar(row)));
    }
    return Number.isInteger(rowIndex) && (rowIndex as number) >= 0 && (rowIndex as number) < 50 &&
      (rowIndex as number) < rows.length && scalar(rows[rowIndex as number]);
  };
  const walk = (node: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 32 || depth > 6 || !isRecord(node) || typeof node.kind !== 'string') {
      throw new Error('Generated demo safe UI node count, depth or shape is invalid.');
    }
    if (node.componentId !== undefined) {
      if (typeof node.componentId !== 'string' || !SAFE_ID_PATTERN.test(node.componentId) ||
        !componentIds.includes(node.componentId) || usedComponents.has(node.componentId)) {
        throw new Error('Generated demo safe UI component identity is invalid.');
      }
      usedComponents.add(node.componentId);
    }
    const keys = (allowed: string[], required: string[]): boolean =>
      exactKeys(node, [...allowed, 'componentId'], required);
    switch (node.kind) {
      case 'stack':
        if (!keys(['kind', 'direction', 'gap', 'children'], ['kind', 'direction', 'gap', 'children']) ||
          !['row', 'column'].includes(String(node.direction)) || !['sm', 'md', 'lg'].includes(String(node.gap)) ||
          !Array.isArray(node.children) || node.children.length < 1 || node.children.length > 16) {
          throw new Error('Generated demo safe UI stack is invalid.');
        }
        node.children.forEach(child => walk(child, depth + 1));
        break;
      case 'heading':
        if (!keys(['kind', 'level', 'text'], ['kind', 'level', 'text']) ||
          ![1, 2, 3].includes(node.level as number) || !boundedText(node.text)) {
          throw new Error('Generated demo safe UI heading is invalid.');
        }
        break;
      case 'text':
        if (!keys(['kind', 'text'], ['kind', 'text']) || !boundedText(node.text)) {
          throw new Error('Generated demo safe UI text is invalid.');
        }
        break;
      case 'stat': {
        const value = node.value;
        if (!keys(['kind', 'label', 'value'], ['kind', 'label', 'value']) ||
          !boundedText(node.label, 120) || !isRecord(value)) {
          throw new Error('Generated demo safe UI stat is invalid.');
        }
        if (value.kind === 'literal') {
          if (!exactKeys(value, ['kind', 'text'], ['kind', 'text']) || !boundedText(value.text)) {
            throw new Error('Generated demo safe UI literal is invalid.');
          }
        } else if (value.kind === 'fixture') {
          if (!exactKeys(value, ['kind', 'collection', 'field', 'rowIndex'],
            ['kind', 'collection', 'field', 'rowIndex']) ||
            !hasScalarField(value.collection, value.field, value.rowIndex)) {
            throw new Error('Generated demo safe UI fixture reference is invalid.');
          }
        } else throw new Error('Generated demo safe UI stat value is invalid.');
        break;
      }
      case 'table': {
        if (!keys(['kind', 'fixtureCollection', 'columns'], ['kind', 'fixtureCollection', 'columns']) ||
          typeof node.fixtureCollection !== 'string' || !Object.hasOwn(collections, node.fixtureCollection) ||
          !Array.isArray(node.columns) || node.columns.length < 1 || node.columns.length > 12) {
          throw new Error('Generated demo safe UI table is invalid.');
        }
        const fields = new Set<string>();
        for (const column of node.columns) {
          if (!isRecord(column) || !exactKeys(column, ['field', 'label'], ['field', 'label']) ||
            !boundedText(column.label, 120) || typeof column.field !== 'string' || fields.has(column.field) ||
            !hasScalarField(node.fixtureCollection, column.field)) {
            throw new Error('Generated demo safe UI table column is invalid.');
          }
          fields.add(column.field);
        }
        break;
      }
      case 'button':
        if (!keys(['kind', 'label', 'actionId'], ['kind', 'label', 'actionId']) ||
          !boundedText(node.label, 120) || typeof node.actionId !== 'string' ||
          !SAFE_ID_PATTERN.test(node.actionId) || !Object.hasOwn(actions, node.actionId)) {
          throw new Error('Generated demo safe UI action is invalid.');
        }
        break;
      case 'input':
        if (!keys(['kind', 'id', 'label', 'inputType'], ['kind', 'id', 'label', 'inputType']) ||
          typeof node.id !== 'string' || !SAFE_ID_PATTERN.test(node.id) || usedInputs.has(node.id) ||
          !boundedText(node.label, 120) || !['text', 'number'].includes(String(node.inputType))) {
          throw new Error('Generated demo safe UI input is invalid.');
        }
        usedInputs.add(node.id);
        break;
      case 'view-link':
        if (!keys(['kind', 'label', 'targetViewId'], ['kind', 'label', 'targetViewId']) ||
          !boundedText(node.label, 120) || typeof node.targetViewId !== 'string' ||
          !targetViews.has(node.targetViewId)) {
          throw new Error('Generated demo safe UI view link is invalid.');
        }
        break;
      default:
        throw new Error('Generated demo safe UI node kind is unsupported.');
    }
  };
  walk(value.root, 1);
  return nodes;
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
  const acceptedViewBindings: GeneratedDemoContinuation['acceptedViewBindings'][number][] = [];
  const acceptedTrustedSlots: GeneratedDemoContinuation['acceptedTrustedSlots'][number][] = [];
  const views = definition.views;
  const workflow = definition.workflow;
  const steps = isRecord(workflow) ? workflow.steps : null;
  if (!Array.isArray(views) || !Array.isArray(steps) ||
    !steps.every(step => isRecord(step) && typeof step.viewId === 'string')) {
    throw new Error('Generated demo has no accepted workflow views.');
  }
  const viewIds = new Set(views.filter(isRecord).map(view => view.id).filter((id): id is string =>
    typeof id === 'string' && SAFE_ID_PATTERN.test(id)));
  let safeUiNodeCount = 0;
  for (const view of views) {
    if (!isRecord(view) || typeof view.id !== 'string' || !Array.isArray(view.componentIds)) {
      throw new Error('Generated demo has an invalid accepted workflow view.');
    }
    safeUiNodeCount += validateSafeUi(view.safeUi, view.componentIds as string[], fixtures, viewIds);
    const mappings = view.dataBindings ?? [];
    if (!Array.isArray(mappings) || mappings.length > 16) {
      throw new Error('Generated demo view data mappings exceed the accepted contract.');
    }
    const components = new Set<string>();
    for (const mapping of mappings) {
      if (!isRecord(mapping) || Object.keys(mapping).sort().join('|') !==
        'componentId|fixtureCollection|objectTypeSlug' ||
        typeof mapping.componentId !== 'string' || !view.componentIds.includes(mapping.componentId) ||
        components.has(mapping.componentId) ||
        typeof mapping.fixtureCollection !== 'string' || !Object.hasOwn(fixtures.collections, mapping.fixtureCollection) ||
        typeof mapping.objectTypeSlug !== 'string' ||
        !proposedObjectTypes.some(item => item.slug === mapping.objectTypeSlug)) {
        throw new Error('Generated demo view data mapping is not in the accepted artifact.');
      }
      components.add(mapping.componentId);
      acceptedViewBindings.push({
        viewId: view.id, componentId: mapping.componentId,
        fixtureCollection: mapping.fixtureCollection, objectTypeSlug: mapping.objectTypeSlug,
      });
    }
    if (view.trustedLayout !== undefined) {
      const layout = view.trustedLayout;
      if (!isRecord(layout) || Object.keys(layout).sort().join('|') !== 'columns|slots' ||
        ![1, 2, 3].includes(layout.columns as number) ||
        !Array.isArray(layout.slots) || layout.slots.length > 16) {
        throw new Error('Generated demo trusted layout exceeds the accepted contract.');
      }
      const ids = new Set<string>();
      for (const slot of layout.slots) {
        if (!isRecord(slot) ||
          Object.keys(slot).some(key => !['componentId', 'kind', 'title', 'columnSpan', 'text'].includes(key)) ||
          typeof slot.componentId !== 'string' || !view.componentIds.includes(slot.componentId) ||
          ids.has(slot.componentId) ||
          (slot.kind !== 'read-table' && slot.kind !== 'static-copy') ||
          typeof slot.title !== 'string' || !slot.title.trim() || slot.title.length > 120 ||
          (slot.columnSpan !== undefined && (![1, 2, 3].includes(slot.columnSpan as number) ||
            (slot.columnSpan as number) > (layout.columns as number))) ||
          (slot.kind === 'static-copy' && (typeof slot.text !== 'string' ||
            !slot.text.trim() || slot.text.length > 2000)) ||
          (slot.kind === 'read-table' && (slot.text !== undefined ||
            !mappings.some(mapping => isRecord(mapping) && mapping.componentId === slot.componentId)))) {
          throw new Error('Generated demo trusted layout slot is not accepted.');
        }
        ids.add(slot.componentId);
        acceptedTrustedSlots.push({viewId: view.id, componentId: slot.componentId,
          kind: slot.kind as 'read-table' | 'static-copy'});
      }
    }
  }
  if (acceptedViewBindings.length > 128) {
    throw new Error('Generated demo view data mappings exceed the artifact limit.');
  }
  if (acceptedTrustedSlots.length > 128) {
    throw new Error('Generated demo trusted layout exceeds the artifact limit.');
  }
  if (safeUiNodeCount > 128) {
    throw new Error('Generated demo safe UI exceeds the artifact limit.');
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
    workflowViewIds: steps.map(step => (step as Record<string, string>).viewId),
    acceptedViewBindings,
    acceptedTrustedSlots,
    sampleCollectionCount: Object.keys(fixtures.collections).length,
    simulatedActionCount: Object.keys(fixtures.actions).length,
    adapterStatus: 'demo-only',
  };
}
