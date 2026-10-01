import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformAPIClient } from './api.js';
import type { GeneratedDemoContinuation } from './generated-demo-continuation.js';
import type { GeneratedOperationalConfig } from './generated-demo-operational.js';
import { GeneratedResponseTooLargeError, readBoundedGeneratedResponse } from './generated-demo-bounded-response.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const OPERATION = /^operational-[a-f0-9-]{36}$/;
const SOURCE_OPERATION_PATH = '.eai/generated-source-operation.json';
const WORKFLOW_PATH = '.github/workflows/eai-app.yml';
const MANIFEST_PATH = '.eai-manifest.json';
const OPERATIONAL_CONFIG_PATH = 'src/eai.config/generated-operational.json';
const RESOURCE_ROOT = fileURLToPath(new URL('../../resources/generated-operational/', import.meta.url));
const TEMPLATE_COMMIT = '3d1e2d0c1334ab3df77e43d5c975906da184a5e8';
const PRIOR_TEMPLATE_COMMITS = ['defc71b050403382552cc7ba8098be100d5728c0', 'dec59594e28f26cf7878c9709d5000f81083289c', '8aa6424a5b65bb3c3a2056ef41541498d60b572a', '99ab8e11e787e49c9bc1aa6b8c5cc29d79b53ad0', 'b13767b2d4ee9a510d1596654b94e5ce7422312e', 'cd0dcdc', '5039499', 'f735346817f5d92737617d01d24953d8ab58e895', '6047548bb8ea2b100334aa43cef1683127c90841'];
const TEMPLATE_PATHS = [
  'scripts/validate-generated-demo.cjs',
  'src/lib/generated-demo/operational-contract.ts',
  'src/lib/generated-demo/contract.ts',
  'src/lib/generated-demo/runtime-contract.ts',
  'src/lib/generated-demo/operational-runtime.ts',
  'src/lib/generated-demo/operational-read.ts',
  'src/lib/generated-demo/operational-create.ts',
  'src/lib/generated-demo/operational-bridge.ts',
  'src/app/api/eai/generated-operational/route.ts',
  'src/app/api/eai/generated-operational/create/route.ts',
  'src/components/generated-demo/demo-host.tsx',
  'src/components/generated-demo/demo-app.tsx',
  'src/components/generated-demo/client-only-demo.tsx',
  'src/app/eai-demo-frame/page.tsx',
  'src/app/page.tsx',
  'src/app/home-client.tsx',
] as const;
const MAX_RESPONSE = 2_000_000;

type JsonObject = Record<string, unknown>;
type Environment = 'preview' | 'dev' | 'test' | 'prod';

export interface OperationalReviewRequest {
  readonly projectPath: string;
  readonly environment: Environment;
  readonly inspection: GeneratedDemoContinuation;
  readonly operationalBinding: GeneratedOperationalConfig;
  readonly client: PlatformAPIClient;
}

export interface OperationalReviewResult {
  readonly operationId: string;
  readonly branch: string;
  readonly headSha: string;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly status: 'draft-review-required';
}

export interface OperationalCompletionRequest {
  readonly projectPath: string;
  readonly environment: Environment;
  readonly tenantId: string;
  readonly operationId: string;
  readonly pullRequestNumber: number;
  readonly inspection: GeneratedDemoContinuation;
  readonly client: PlatformAPIClient;
}

export interface OperationalCompletionResult {
  readonly operationId: string;
  readonly status: 'completed';
  readonly activeUrl: string;
  readonly containerAppName: string;
  readonly activeDeploymentId: string;
}

/** Explicitly release an uncommitted source reservation; a committed anchor cannot be rolled back here. */
export async function abortGeneratedDemoOperationalReview(
  client: PlatformAPIClient, tenantId: string, appKey: string, operationId: string,
): Promise<{operationId: string; status: 'aborted'}> {
  if (!tenantId || !appKey || !OPERATION.test(operationId)) {
    throw new Error('Abort requires the exact tenant, app and reserved operational source operation.');
  }
  const endpoint = `/v4/platform/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(appKey)}` +
    `/source-updates/${encodeURIComponent(operationId)}/abort`;
  const response = await client.requestPublicApi(endpoint, {method: 'POST'});
  if (!response.ok) throw new Error(`Operational source abort failed (HTTP ${response.status}).`);
  const receipt = await boundedResponse(response, 'Operational source abort');
  if (receipt.status !== 'aborted' || receipt.operationId !== operationId) {
    throw new Error('Operational source abort returned a mismatched receipt.');
  }
  return {operationId, status: 'aborted'};
}

/** Only a server-confirmed pending ACTIVE transition may be polled. */
export async function isPendingOperationalSourceConflict(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  let raw: string;
  try { raw = await readBoundedGeneratedResponse(response, 16_000); }
  catch (error) {
    if (error instanceof GeneratedResponseTooLargeError) return false;
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return false; }
  const detail = record(value) ? value.detail : undefined;
  return record(detail) && detail.error === 'operational_source_pending_active' && detail.retryable === true;
}

function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error('Operational source contains a non-JSON value.');
}

function sha256(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function boundedResponse(response: Response, name: string): Promise<JsonObject> {
  if (!response.ok) {
    if (response.status === 503) throw new Error('Operational source admission is disabled; no customer PR was created.');
    throw new Error(`${name} failed (HTTP ${response.status}); no customer PR was created.`);
  }
  let raw: string;
  try { raw = await readBoundedGeneratedResponse(response, MAX_RESPONSE); }
  catch (error) {
    if (error instanceof GeneratedResponseTooLargeError) throw new Error(`${name} response is too large.`, {cause: error});
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`${name} returned invalid JSON.`); }
  if (!record(value)) throw new Error(`${name} returned an invalid contract.`);
  return value;
}

async function git(root: string, ...args: string[]): Promise<string> {
  return command('git', args, root, undefined);
}

async function command(binary: string, args: string[], cwd: string, input: string | undefined): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; if (stdout.length > MAX_RESPONSE) child.kill('SIGKILL'); });
    child.stderr.on('data', data => { stderr += data; if (stderr.length > 16_000) child.kill('SIGKILL'); });
    child.on('error', rejectPromise);
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        const status = stderr.match(/HTTP (\d{3})/);
        rejectPromise(new Error(`${binary} failed while preparing the reviewed source PR${status ? ` (HTTP ${status[1]})` : ''}.`));
      }
      else resolvePromise(stdout.trim());
    });
    child.stdin.end(input);
  });
}

async function gh(root: string, endpoint: string, method: 'GET' | 'POST' = 'GET', body?: JsonObject): Promise<JsonObject> {
  const args = ['api', '--method', method];
  if (method === 'POST') args.push('--input', '-');
  args.push(endpoint);
  const output = await command('gh', args, root, body ? JSON.stringify(body) : undefined);
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error('GitHub returned an invalid response.'); }
  if (!record(value)) throw new Error('GitHub returned an invalid response.');
  return value;
}

async function ghOptional(root: string, endpoint: string): Promise<JsonObject | null> {
  try { return await gh(root, endpoint); } catch (error) {
    if (error instanceof Error && error.message.includes('HTTP 404')) return null;
    throw error;
  }
}

async function safeRead(root: string, path: string, maxBytes = 2_000_000): Promise<Buffer> {
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Operational source path is unsafe: ${path}`);
  }
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error(`Operational source path contains a symbolic link: ${path}`);
  }
  const metadata = await lstat(current);
  if (!metadata.isFile() || metadata.size > maxBytes) throw new Error(`Operational source file is unsupported: ${path}`);
  return readFile(current);
}

async function optionalSafeRead(root: string, path: string): Promise<Buffer | null> {
  try { return await safeRead(root, path); } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function replaceOne(source: string, start: string, end: string, replacement: string): string {
  const first = source.indexOf(start);
  if (first < 0) throw new Error(`Unsupported generated workflow boundary: ${start.trim()}`);
  const last = source.indexOf(end, first + start.length);
  if (last < 0) throw new Error(`Unsupported generated workflow boundary: ${end.trim()}`);
  return source.slice(0, first) + replacement + source.slice(last);
}

/** Preserve the reviewed build and OIDC jobs while replacing only v1 handoff steps. */
export function upgradeGeneratedWorkflow(
  original: string, loader: string, evidence: string, environment: Environment,
): string {
  const validationStart = original.indexOf('  validate-generated-source:\n');
  const evidenceStart = original.indexOf('  submit-eai-evidence:\n');
  const reviewStart = original.indexOf('  complete-eai-managed-review:\n');
  const validationJob = original.slice(validationStart, evidenceStart);
  const evidenceJob = original.slice(evidenceStart, reviewStart);
  if (!original.startsWith('name: EAI Generated App\n') || !original.includes('api://enterprise-ai-publicapi/generated-app') ||
    !original.includes('id-token: write') || !original.includes('persist-credentials: false') ||
    !original.includes('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093') ||
    !original.includes('docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8') ||
    !original.includes('      - name: Verify GitHub run, source and image artifact\n') ||
    validationStart < 0 || evidenceStart <= validationStart || reviewStart <= evidenceStart ||
    !validationJob.includes('actions/checkout@11d5960a326750d5838078e36cf38b85af677262') ||
    !validationJob.includes('docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8') ||
    /id-token:\s*write|EAI_ACCESS_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN/.test(validationJob) ||
    !evidenceJob.includes('id-token: write') ||
    !evidenceJob.includes('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093') ||
    /actions\/checkout@|docker\/build-push-action@|\bnpm\s+(?:ci|install|run)\b/.test(evidenceJob)) {
    throw new Error('Generated workflow is not the vetted source-review template.');
  }
  if (original.split('      - name: Load generated source operation\n').length !== 3) {
    throw new Error('The generated workflow has an unsupported source-operation layout.');
  }
  let result = replaceOne(original, '  workflow_dispatch:\n', 'permissions:\n', '');
  result = result.replace('  EAI_DEPLOYMENT_ENVIRONMENT: preview\n', `  EAI_DEPLOYMENT_ENVIRONMENT: ${environment}\n`);
  result = result.replace('  EAI_RELEASE_CHANNEL: preview\n', `  EAI_RELEASE_CHANNEL: ${environment}\n`);
  result = result.replace('    environment: preview\n', `    environment: ${environment}\n`);
  if (!result.includes(`  EAI_DEPLOYMENT_ENVIRONMENT: ${environment}\n`) ||
    !result.includes(`    environment: ${environment}\n`)) throw new Error('Generated workflow environment is unsupported.');
  result = replaceOne(result, '      - name: Load generated source operation\n', '      - name: Prepare source evidence input\n',
    loader.replace('__EAI_SOURCE_OPERATION_PATH__', SOURCE_OPERATION_PATH));
  result = replaceOne(result, '      - name: Load generated source operation\n', '      - name: Verify GitHub run, source and image artifact\n',
    loader.replace('__EAI_SOURCE_OPERATION_PATH__', `evidence-input/${SOURCE_OPERATION_PATH}`));
  result = replaceOne(result, '      - name: Submit validated Configurator Plus handover evidence\n',
    '      - name: Submit TenantInfra workflow evidence\n', '');
  result = replaceOne(result, '      - name: Submit TenantInfra workflow evidence\n',
    '      - name: Request deployment handoff\n', evidence);
  result = result.slice(0, result.indexOf('      - name: Request deployment handoff\n'));
  if (result.includes('  complete-eai-managed-review:\n') || result.includes('source-preparations/') ||
    result.includes('source-unknown/workflow-evidence') ||
    result.includes('      - name: Load generated source operation\n') ||
    !result.includes('/source-updates/') || result.includes('__EAI_SOURCE_OPERATION_PATH__')) {
    throw new Error('The operational workflow still contains obsolete or unresolved authority.');
  }
  return result;
}

function parseReservation(
  value: JsonObject, inspection: GeneratedDemoContinuation, config: GeneratedOperationalConfig,
  anchor: JsonObject, environment: Environment,
): JsonObject {
  if (!OPERATION.test(String(value.operationId)) || value.environment !== environment ||
    value.predecessorOperationId !== anchor.operationId || value.predecessorIntegrityHash !== anchor.integrityHash ||
    value.repoOwner + '/' + value.repoName !== inspection.repository ||
    value.acceptedArtifactDigest !== inspection.acceptedArtifactDigest ||
    !Number.isSafeInteger(value.sourceRepositoryId) || Number(value.sourceRepositoryId) < 1 ||
    !str(value.installationId) || !str(value.defaultBranch) || !str(value.draftId) ||
    !record(value.operationalBinding) || canonicalJson(value.operationalBinding) !== canonicalJson(config) ||
    value.operationalBindingDigest !== sha256(canonicalJson(config)) ||
    !record(value.sourceOperation) || !record(value.activeDeployment) ||
    !str(value.expiresAt) || Date.parse(value.expiresAt) < Date.now() + 60_000) {
    throw new Error('The operational source reservation does not bind this exact app and predecessor.');
  }
  const operation = value.sourceOperation;
  const exact = {
    schemaVersion: 'eai.generated_source_operation.v2', appArtifactMode: 'app-v2-operational',
    operationId: value.operationId, environment, draftId: value.draftId,
    tenantId: config.tenantId, appKey: inspection.appKey, configHash: anchor.configHash,
    githubInstallationId: value.installationId, sourceRepositoryId: value.sourceRepositoryId,
    sourceRepositoryNodeId: operation.sourceRepositoryNodeId,
    predecessorOperationId: anchor.operationId, predecessorIntegrityHash: anchor.integrityHash,
    acceptedArtifactDigest: inspection.acceptedArtifactDigest,
    operationalBindingDigest: value.operationalBindingDigest,
    activeDeploymentId: value.activeDeployment.deploymentId,
    activeContainerAppName: value.activeDeployment.containerAppName,
    activeRevisionName: value.activeDeployment.revisionName,
    activeUrl: value.activeDeployment.activeUrl,
    runtimeSecretReferencesDigest: value.activeDeployment.runtimeSecretReferencesDigest,
  };
  if (!str(operation.sourceRepositoryNodeId) || !str(operation.runtimeSecretReferencesDigest) ||
    !DIGEST.test(operation.runtimeSecretReferencesDigest) ||
    canonicalJson(operation) !== canonicalJson(exact)) {
    throw new Error('The source operation differs from the signed server reservation.');
  }
  return value;
}

function managedEntries(manifest: JsonObject): Array<{path: string; checksum: string; encoding: string; owner: string}> {
  if (!Array.isArray(manifest.managedFiles) || !Array.isArray(manifest.generatedFileScope)) {
    throw new Error('Generated source manifest is incomplete.');
  }
  const entries = manifest.managedFiles;
  if (entries.length > 511 || entries.length !== manifest.generatedFileScope.length ||
    entries.some(item => !record(item) || !str(item.path) || !DIGEST.test(String(item.checksum)) ||
      item.owner !== 'admin-portal-generated' || !['utf8', 'base64'].includes(String(item.encoding)))) {
    throw new Error('Generated source manifest has unsupported managed entries.');
  }
  return entries as Array<{path: string; checksum: string; encoding: string; owner: string}>;
}

async function prepareFileMap(
  root: string, inspection: GeneratedDemoContinuation, reservation: JsonObject,
  anchor: JsonObject, environment: Environment,
): Promise<Map<string, string>> {
  const manifest = JSON.parse((await safeRead(root, MANIFEST_PATH)).toString('utf8')) as JsonObject;
  if (!record(manifest) || !record(manifest.generatedDemo) ||
    manifest.generatedDemo.artifactDigest !== inspection.acceptedArtifactDigest ||
    manifest.appKey !== inspection.appKey || manifest.environment !== 'eai-generated-preview') {
    throw new Error('The generated manifest is not the accepted app in this environment.');
  }
  const existing = managedEntries(manifest);
  const byPath = new Map(existing.map(item => [item.path, item]));
  const generatedFileScope = manifest.generatedFileScope as unknown[];
  if (byPath.size !== existing.length || new Set(generatedFileScope).size !== existing.length ||
    generatedFileScope.some((path: unknown) => !str(path) || !byPath.has(path))) {
    throw new Error('Generated source ownership inventory is not unique.');
  }
  const anchorChecksums = anchor.fileChecksums;
  if (!record(anchorChecksums) || anchorChecksums[MANIFEST_PATH] !== sha256(await safeRead(root, MANIFEST_PATH))) {
    throw new Error('The local manifest differs from the current signed source anchor.');
  }
  for (const item of existing) {
    if (anchorChecksums[item.path] !== item.checksum ||
      sha256(await safeRead(root, item.path)) !== item.checksum) {
      throw new Error(`Current source differs from its signed anchor: ${item.path}`);
    }
  }
  if (Object.keys(anchorChecksums).length !== existing.length + 1) {
    throw new Error('Signed source inventory differs from the local generated manifest.');
  }
  const lock = JSON.parse((await readFile(join(RESOURCE_ROOT, 'template-lock-v1.json'))).toString('utf8')) as JsonObject;
  if (!record(lock) || lock.templateCommit !== TEMPLATE_COMMIT || !record(lock.files)) {
    throw new Error('The CLI package has no reviewed operational template lock.');
  }
  const updates = new Map<string, string>();
  for (const path of TEMPLATE_PATHS) {
    const resource = (await safeRead(join(RESOURCE_ROOT, 'template'), path)).toString('utf8');
    const expected = lock.files[path];
    if (!record(expected) || expected.targetChecksum !== sha256(resource)) {
      throw new Error(`The bundled operational template is not reviewed: ${path}`);
    }
    const current = await optionalSafeRead(root, path);
    const priorChecksums = Array.isArray(expected.priorTargetChecksums)
      ? expected.priorTargetChecksums.filter((value): value is string => typeof value === 'string') : [];
    if (current && ![
      expected.baselineChecksum, expected.previousTargetChecksum, expected.targetChecksum, ...priorChecksums,
    ].includes(sha256(current))) {
      throw new Error(`Customer source is customized; refusing to replace ${path}`);
    }
    updates.set(path, resource);
  }
  const config = JSON.stringify(reservation.operationalBinding, null, 2) + '\n';
  const operation = JSON.stringify(reservation.sourceOperation, null, 2) + '\n';
  updates.set(OPERATIONAL_CONFIG_PATH, config);
  updates.set(SOURCE_OPERATION_PATH, operation);
  const currentWorkflow = (await safeRead(root, WORKFLOW_PATH)).toString('utf8');
  let reviewedWorkflow: string;
  if (anchor.appArtifactMode === 'app-v2-demo') {
    const loader = await readFile(join(RESOURCE_ROOT, 'workflow-loader-v1.yml'), 'utf8');
    const evidence = await readFile(join(RESOURCE_ROOT, 'workflow-evidence-v1.yml'), 'utf8');
    reviewedWorkflow = upgradeGeneratedWorkflow(currentWorkflow, loader, evidence, environment);
    manifest.operationalWorkflow = {
      schemaVersion: 'eai.generated_operational_workflow.v1',
      templateCommit: TEMPLATE_COMMIT,
      checksum: sha256(reviewedWorkflow),
    };
  } else {
    const workflow = manifest.operationalWorkflow;
    if (!record(workflow) || workflow.schemaVersion !== 'eai.generated_operational_workflow.v1' ||
      ![...PRIOR_TEMPLATE_COMMITS, TEMPLATE_COMMIT].includes(String(workflow.templateCommit)) ||
      workflow.checksum !== sha256(currentWorkflow) ||
      !currentWorkflow.includes('      - name: Load generated operational source operation\n') ||
      !currentWorkflow.includes('      - name: Submit reserved operational source evidence\n') ||
      currentWorkflow.includes('source-preparations/') || currentWorkflow.includes('source-unknown/workflow-evidence')) {
      throw new Error('Current operational workflow is not the versioned reviewed source template.');
    }
    reviewedWorkflow = currentWorkflow;
    manifest.operationalWorkflow = {...workflow, templateCommit: TEMPLATE_COMMIT};
  }
  updates.set(WORKFLOW_PATH, reviewedWorkflow);
  for (const [path, content] of updates) {
    const entry = byPath.get(path);
    if (entry?.encoding === 'base64') throw new Error(`Operational source cannot replace binary managed file: ${path}`);
    if (path === OPERATIONAL_CONFIG_PATH && !entry) {
      const current = await optionalSafeRead(root, path);
      if (current && sha256(current) !== lock.nullConfigChecksum) {
        throw new Error('Customer operational configuration is already customized.');
      }
    }
    byPath.set(path, {path, checksum: sha256(content), encoding: 'utf8', owner: 'admin-portal-generated'});
  }
  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (files.length > 511) throw new Error('Operational managed source exceeds the provider inventory limit.');
  manifest.managedFiles = files;
  manifest.generatedFileScope = files.map(file => file.path);
  updates.set(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  if (updates.get('src/eai.config/generated-demo.json') || [...updates.keys()].some(path => path.startsWith('src/generated/'))) {
    throw new Error('Operational review must preserve the exact accepted demo source.');
  }
  return updates;
}

async function gitHubCommitTree(root: string, repo: string, sha: string): Promise<string> {
  const commit = await gh(root, `repos/${repo}/git/commits/${sha}`);
  if (!record(commit.tree) || !str(commit.tree.sha)) throw new Error('GitHub commit has no immutable tree.');
  return commit.tree.sha;
}

async function createReviewPr(
  root: string, reservation: JsonObject, updates: Map<string, string>, expectedDefaultSha: string,
): Promise<OperationalReviewResult> {
  const repo = `${reservation.repoOwner}/${reservation.repoName}`;
  const defaultBranch = String(reservation.defaultBranch);
  const operationId = String(reservation.operationId);
  const branch = `eai/operational-${operationId}`;
  const repository = await gh(root, `repos/${repo}`);
  if (repository.id !== reservation.sourceRepositoryId || repository.node_id !== (reservation.sourceOperation as JsonObject).sourceRepositoryNodeId ||
    repository.default_branch !== defaultBranch || repository.full_name !== repo) {
    throw new Error('GitHub repository identity differs from the signed reservation.');
  }
  const defaultRef = await gh(root, `repos/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
  const remoteSha = record(defaultRef.object) ? defaultRef.object.sha : undefined;
  if (remoteSha !== expectedDefaultSha) throw new Error('Customer default branch changed after source review; restart from its current signed anchor.');
  const baseTree = await gitHubCommitTree(root, repo, expectedDefaultSha);
  const tree = await gh(root, `repos/${repo}/git/trees`, 'POST', {
    base_tree: baseTree,
    tree: [...updates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({
      path, mode: '100644', type: 'blob', content,
    })),
  });
  if (!str(tree.sha) || tree.sha === baseTree) throw new Error('Operational source tree was not created.');
  const endpoint = `repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  let ref = await ghOptional(root, endpoint);
  if (!ref) {
    const commit = await gh(root, `repos/${repo}/git/commits`, 'POST', {
      message: `Prepare reviewed operational source ${operationId}`,
      tree: tree.sha,
      parents: [expectedDefaultSha],
    });
    if (!COMMIT.test(String(commit.sha))) throw new Error('GitHub did not create an immutable review commit.');
    try {
      ref = await gh(root, `repos/${repo}/git/refs`, 'POST', {ref: `refs/heads/${branch}`, sha: commit.sha});
    } catch {
      ref = await gh(root, endpoint);
    }
  }
  const headSha = record(ref.object) ? ref.object.sha : undefined;
  if (!COMMIT.test(String(headSha)) || await gitHubCommitTree(root, repo, String(headSha)) !== tree.sha) {
    throw new Error('Existing operational review branch has different source bytes.');
  }
  const pulls = await command('gh', ['api', '--method', 'GET',
    `repos/${repo}/pulls?state=all&head=${encodeURIComponent(String(reservation.repoOwner) + ':' + branch)}&base=${encodeURIComponent(defaultBranch)}&per_page=100`,
  ], root, undefined);
  let list: unknown;
  try { list = JSON.parse(pulls); } catch { throw new Error('GitHub PR readback is invalid.'); }
  if (!Array.isArray(list) || list.length > 1) throw new Error('Operational review PR identity is ambiguous.');
  let pr: JsonObject;
  if (list.length === 1) {
    pr = list[0] as JsonObject;
    if (str(pr.merged_at)) throw new Error('This reviewed source PR is already merged; complete its signed deployment receipt.');
  } else {
    pr = await gh(root, `repos/${repo}/pulls`, 'POST', {
      title: `Continue ${String(reservation.sourceOperation && (reservation.sourceOperation as JsonObject).appKey)} with one authorized read`,
      head: branch,
      base: defaultBranch,
      draft: true,
      body: `Prepared from signed EAI source reservation ${operationId}.\n\nThis PR adds one bounded read adapter and preserves the accepted demo artifact. Review and merge it through normal customer controls. Deployment remains gated by the operational source verifier.`,
    });
  }
  if (!Number.isSafeInteger(pr.number) || !record(pr.head) || pr.head.sha !== headSha ||
    !record(pr.head.repo) || pr.head.repo.full_name !== repo ||
    !record(pr.base) || pr.base.ref !== defaultBranch ||
    !record(pr.base.repo) || pr.base.repo.full_name !== repo ||
    !str(pr.html_url) || pr.draft !== true || pr.state !== 'open') {
    throw new Error('GitHub PR does not match the exact reserved source branch.');
  }
  return { operationId, branch, headSha: String(headSha), pullRequestNumber: pr.number as number,
    pullRequestUrl: pr.html_url, status: 'draft-review-required' };
}

/** Customer-authenticated preparation only; merge, dispatch and deployment remain separate gates. */
export async function prepareGeneratedDemoOperationalReview(request: OperationalReviewRequest): Promise<OperationalReviewResult> {
  const root = await realpath(resolve(request.projectPath));
  const {inspection, operationalBinding: config, environment, client} = request;
  // The immutable accepted artifact stays demo-mode on every operational source revision.
  if (inspection.appArtifactMode !== 'app-v2-demo' || !inspection.acceptedArtifactDigest ||
    inspection.repository !== (await git(root, 'remote', 'get-url', 'origin')).trim().replace(/^https:\/\/github\.com\//, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '') ||
    config.appKey !== inspection.appKey || config.acceptedArtifactDigest !== inspection.acceptedArtifactDigest) {
    throw new Error('The local generated app does not match the requested operational binding.');
  }
  if ((await git(root, 'status', '--porcelain', '--untracked-files=all')).trim()) {
    throw new Error('The customer clone must be clean before preparing the reviewed source PR.');
  }
  const base = `/v4/platform/tenants/${encodeURIComponent(config.tenantId)}/apps/${encodeURIComponent(config.appKey)}`;
  const anchor = await boundedResponse(await client.requestPublicApi(`${base}/source-anchor`, {
    params: {targetTenantId: config.tenantId},
  }), 'Signed source anchor');
  if (anchor.status !== 'completed' || anchor.tenantId !== config.tenantId || anchor.appKey !== config.appKey ||
    anchor.repoOwner + '/' + anchor.repoName !== inspection.repository ||
    anchor.acceptedArtifactDigest !== inspection.acceptedArtifactDigest ||
    !['app-v2-demo', 'app-v2-operational'].includes(String(anchor.appArtifactMode)) ||
    !DIGEST.test(String(anchor.integrityHash)) || !str(anchor.operationId) ||
    !str(anchor.defaultBranch) || !str(anchor.configHash)) {
    throw new Error('This clone has no completed signed source anchor for the accepted app.');
  }
  const branch = (await git(root, 'branch', '--show-current')).trim();
  const localSha = (await git(root, 'rev-parse', 'HEAD')).trim();
  if (branch !== anchor.defaultBranch || localSha !== inspection.commitSha ||
    (anchor.defaultBranchCommitSha && localSha !== anchor.defaultBranchCommitSha)) {
    throw new Error('Start from the exact current customer default-branch commit.');
  }
  const reservation = parseReservation(await boundedResponse(await client.requestPublicApi(
    `${base}/source-updates`, {
      method: 'POST', params: {environment}, body: {
        expectedPredecessorOperationId: anchor.operationId,
        expectedPredecessorIntegrityHash: anchor.integrityHash,
        acceptedArtifactDigest: inspection.acceptedArtifactDigest,
        operationalBinding: config,
      },
    },
  ), 'Operational source reservation'), inspection, config, anchor, environment);
  try {
    const updates = await prepareFileMap(root, inspection, reservation, anchor, environment);
    return await createReviewPr(root, reservation, updates, localSha);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Source reservation ${reservation.operationId} remains active after PR preparation failed. ` +
      `Retry the same preparation; if abandoning an unmerged review, use --abort-operational-pr with this operation ID. ${reason}`,
    {cause: error});
  }
}

/** Poll the service's exact post-ACTIVE verifier; local PR metadata is only a hint. */
export async function completeGeneratedDemoOperationalReview(
  request: OperationalCompletionRequest,
): Promise<OperationalCompletionResult> {
  const {inspection, tenantId, environment, operationId, pullRequestNumber, client} = request;
  if (!OPERATION.test(operationId) || !Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1 ||
    !inspection.acceptedArtifactDigest || inspection.appArtifactMode !== 'app-v2-demo') {
    throw new Error('Completion requires an accepted demo and exact reserved operation and pull request.');
  }
  const root = await realpath(resolve(request.projectPath));
  const repo = inspection.repository;
  const pr = await gh(root, `repos/${repo}/pulls/${pullRequestNumber}`);
  if (!str(pr.merged_at) || !record(pr.head) || !record(pr.base) ||
    !COMMIT.test(String(pr.head.sha)) || !COMMIT.test(String(pr.merge_commit_sha)) ||
    !record(pr.head.repo) || pr.head.repo.full_name !== repo ||
    !record(pr.base.repo) || pr.base.repo.full_name !== repo ||
    pr.head.ref !== `eai/operational-${operationId}`) {
    throw new Error('The customer pull request is not the merged reserved source review.');
  }
  const source = await gh(root,
    `repos/${repo}/contents/${SOURCE_OPERATION_PATH}?ref=${encodeURIComponent(String(pr.head.sha))}`);
  if (source.encoding !== 'base64' || !str(source.content) ||
    !/^[A-Za-z0-9+/=\s]+$/.test(source.content) ||
    typeof source.size !== 'number' || source.size > 100_000) {
    throw new Error('Merged review head has no bounded source operation.');
  }
  let operation: unknown;
  try { operation = JSON.parse(Buffer.from(source.content, 'base64').toString('utf8')); }
  catch { throw new Error('Merged review source operation is invalid.'); }
  if (!record(operation) || operation.schemaVersion !== 'eai.generated_source_operation.v2' ||
    operation.appArtifactMode !== 'app-v2-operational' || operation.operationId !== operationId ||
    operation.environment !== environment || operation.tenantId !== tenantId ||
    operation.appKey !== inspection.appKey ||
    operation.acceptedArtifactDigest !== inspection.acceptedArtifactDigest) {
    throw new Error('Merged review head does not bind the accepted app and reserved operation.');
  }
  const endpoint = `/v4/platform/tenants/${encodeURIComponent(tenantId)}/apps/${encodeURIComponent(inspection.appKey)}` +
    `/source-updates/${encodeURIComponent(operationId)}/complete`;
  const body = {
    pullRequestNumber,
    expectedHeadSha: pr.head.sha,
    expectedMergeCommitSha: pr.merge_commit_sha,
  };
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await client.requestPublicApi(endpoint, {method: 'POST', body});
    if (response.ok) {
      const receipt = await boundedResponse(response, 'Operational source completion');
      if (receipt.status !== 'completed' || receipt.operationId !== operationId ||
        receipt.environment !== environment || receipt.repoOwner + '/' + receipt.repoName !== repo ||
        receipt.commitSha !== pr.merge_commit_sha || !str(receipt.activeUrl) ||
        !str(receipt.containerAppName) || !str(receipt.activeDeploymentId) ||
        !record(receipt.anchor) || receipt.anchor.appArtifactMode !== 'app-v2-operational' ||
        receipt.anchor.operationId !== operationId ||
        receipt.anchor.acceptedArtifactDigest !== inspection.acceptedArtifactDigest) {
        throw new Error('Operational completion returned a mismatched signed receipt.');
      }
      return {
        operationId, status: 'completed', activeUrl: receipt.activeUrl,
        containerAppName: receipt.containerAppName, activeDeploymentId: receipt.activeDeploymentId,
      };
    }
    if (response.status === 503) throw new Error('Operational source admission is disabled.');
    if (response.status !== 409) {
      throw new Error(`Operational source completion failed (HTTP ${response.status}).`);
    }
    if (!await isPendingOperationalSourceConflict(response)) {
      throw new Error('Operational source completion has a terminal conflict; inspect the signed source reservation and app state.');
    }
    if (attempt < 11) await new Promise(resolveDelay => setTimeout(resolveDelay, 15_000));
  }
  throw new Error('The exact operational source revision is not ACTIVE yet; retry completion later.');
}
