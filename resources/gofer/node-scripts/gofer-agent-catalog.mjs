#!/usr/bin/env node
/** Shared, read-only specialist assignments. No provider SDKs or model execution. */
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REFERENCE = '.specify/references/agent-catalog.json';
const SURFACES = ['claude', 'codex', 'copilot', 'vscode', 'grok', 'antigravity', 'gemini'];
const CAPABILITIES = ['independentReadIsolation', 'independentExecution'];
const BODY_NOTICE = `## Assignment Authority

Provider-specific examples within the role body, including Task(...) calls,
model names, tool names and launch syntax, are advisory and non-authoritative.
They do not select a model, grant tool access, authorize execution, or establish
independence. Follow the caller-bound assignment fields, dispatchAllowed gate,
and host-enforced permissions while preserving the role's responsibilities.
Baseline work must never be described as independent. This assignment is not
evidence that execution occurred.

## Canonical Role Body

`;
const HELP = `Usage: node gofer-agent-catalog.mjs --list [--json]
       node gofer-agent-catalog.mjs --help

Read-only specialist catalogue. --list prints role IDs; --json includes neutral
role bodies and surface declarations. Paths are relative to the installed helper,
not the current directory. No models are selected or launched.
API: readCatalogue({ root? }); resolveAssignment(request, { root?, verifyNativeProof? }).
`;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Agent catalogue: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, field, max = 4000) {
  requireValue(typeof value === 'string' && value.trim().length > 0 &&
    value === value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value),
  `${field} must be non-empty text without surrounding whitespace or control characters`);
  return value;
}

function stringList(value, field, allowEmpty = false) {
  requireValue(Array.isArray(value) && (allowEmpty || value.length > 0), `${field} must be an array${allowEmpty ? '' : ' with at least one entry'}`);
  for (const item of value) text(item, field);
  requireValue(new Set(value).size === value.length, `${field} must not contain duplicates`);
  return value;
}

function validateCatalogue(catalogue) {
  requireValue(isRecord(catalogue) && catalogue.schemaVersion === 1, 'unsupported schemaVersion');
  stringList(catalogue.stages, 'stages');
  requireValue(catalogue.stages.every(stage => /^(?:\d+[a-z]?_[a-z0-9_]+|gofer_[a-z0-9_]+|gofer:[a-z0-9-]+)$/.test(stage)), 'invalid stage ID');
  requireValue(Array.isArray(catalogue.roles) && catalogue.roles.length > 0, 'roles must be a non-empty array');
  const ids = [];
  for (const role of catalogue.roles) {
    requireValue(isRecord(role) && typeof role.id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(role.id), 'invalid role ID');
    requireValue(role.body === `agents/${role.id}.md`, `invalid body reference for ${role.id}`);
    requireValue(Object.keys(role).every(key => ['id', 'body'].includes(key)), `role ${role.id} must reference its body, not duplicate it`);
    ids.push(role.id);
  }
  stringList(ids, 'role IDs');
  requireValue(Array.isArray(catalogue.surfaces) && catalogue.surfaces.length === SURFACES.length, 'missing or duplicate surface records');
  const seen = new Set();
  for (const surface of catalogue.surfaces) {
    requireValue(isRecord(surface) && SURFACES.includes(surface.id) && !seen.has(surface.id), 'invalid or duplicate surface');
    seen.add(surface.id);
    requireValue(surface.legacy === (surface.id === 'gemini') && surface.evidenceKind === 'self-declaration' &&
      CAPABILITIES.every(key => surface[key] === 'unqualified'), `surface ${surface.id} must not claim native proof`);
    requireValue(Object.keys(surface).every(key => ['id', 'legacy', 'evidenceKind', ...CAPABILITIES].includes(key)), `unexpected surface metadata for ${surface.id}`);
  }
}

function contained(base, target) {
  const relative = path.relative(base, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function safePath(base, target) {
  const resolved = await realpath(target);
  requireValue(contained(base, resolved), `path escapes outside canonical directory: ${target}`);
  return resolved;
}

async function roleDirectory(root) {
  // Choose one layout for the whole catalogue. Never hide a broken bundle by
  // mixing packaged roles with repository copies or searching a parent checkout.
  for (const directory of ['agents', '.claude/agents']) {
    const candidate = path.join(root, directory);
    let info;
    try { info = await stat(candidate); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    requireValue(info.isDirectory(), `role source is not a directory: ${candidate}`);
    return { directory, resolved: await safePath(root, candidate) };
  }
  throw new Error(`Agent catalogue: no canonical agents/ or .claude/agents/ directory in ${root}`);
}

function neutralBody(raw, source) {
  const content = raw.replace(/^\uFEFF/, '');
  if (!/^---[ \t]*(?:\r?\n|$)/.test(content)) {
    requireValue(content.trim().length > 0, `empty role body: ${source}`);
    return content;
  }
  // Remove the entire provider header, without interpreting YAML or carrying
  // model/tool settings into another host. Preserve everything after the fence.
  const match = content.match(/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/);
  requireValue(match, `unclosed frontmatter: ${source}`);
  const body = content.slice(match[0].length);
  requireValue(body.trim().length > 0, `empty role body: ${source}`);
  return body;
}

/**
 * Load and validate the catalogue and every canonical role body.
 * @param {{root?: string}} [options] Installation/repository root; defaults to
 * the helper's own root, including in relocated bundles. Never defaults to cwd.
 * @returns {Promise<{schemaVersion: number, stages: string[], surfaces: object[],
 * roles: Array<{id: string, body: string, source: string, content: string, contentSha256: string}>}>}
 */
export async function readCatalogue(options = {}) {
  requireValue(isRecord(options), 'options must be an object');
  const root = await realpath(path.resolve(text(options.root ?? MODULE_ROOT, 'root')));
  const catalogueFile = await safePath(root, path.join(root, REFERENCE));
  const catalogue = JSON.parse(await readFile(catalogueFile, 'utf8'));
  validateCatalogue(catalogue);
  const { directory, resolved } = await roleDirectory(root);
  const roles = [];
  for (const role of catalogue.roles) {
    const source = `${directory}/${role.id}.md`;
    const file = await safePath(resolved, path.join(resolved, `${role.id}.md`));
    const content = neutralBody(await readFile(file, 'utf8'), source);
    roles.push({ ...role, source, content, contentSha256: createHash('sha256').update(content).digest('hex') });
  }
  return { schemaVersion: catalogue.schemaVersion, stages: catalogue.stages, surfaces: catalogue.surfaces, roles };
}

function validateScope(scope) {
  stringList(scope, 'scope');
  for (const entry of scope) {
    requireValue(entry === '.' || (!/^[\/]/.test(entry) && !/[\\:*?"<>|]/.test(entry) &&
      entry.split('/').every(part => part !== '' && part !== '.' && part !== '..')),
    `scope must contain normalized repository-relative literal paths: ${entry}`);
  }
  return [...scope];
}

function proofMatches(proof, binding) {
  return isRecord(proof) && proof.kind === 'native-proof' && isRecord(proof.binding) &&
    Object.keys(proof.binding).length === Object.keys(binding).length &&
    Object.keys(binding).every(key => Object.hasOwn(proof.binding, key) &&
      JSON.stringify(proof.binding[key]) === JSON.stringify(binding[key])) &&
    CAPABILITIES.every(key => typeof proof[key] === 'boolean') &&
    Array.isArray(proof.evidence) && proof.evidence.length > 0 &&
    proof.evidence.every(ref => typeof ref === 'string' && ref.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(ref));
}

/**
 * Prepare an assignment, never execute it or enforce its filesystem scope.
 * Stage is a catalogue command ID, task is a non-empty ID/description, revision
 * is a caller-owned revision token (not resolved through Git), and scope is a
 * non-empty array of normalized repo-relative literal paths ('.' means all).
 * No role/stage routing policy is imposed here; the controller owns that policy.
 *
 * Native proof is untrusted input until verifyNativeProof returns exactly true.
 * The controller must supply that trusted verifier, check original host evidence,
 * freshness and actual isolation/execution, and reject self-reported assertions.
 * This helper checks assignment binding only; it cannot authenticate host logs.
 *
 * @param {{role: string, stage: string, task: string, revision: string,
 * scope: string[], requiredChecks: string[], surface: string, availableModels: string[], model?: string,
 * mode?: 'baseline'|'independent', capabilities?: {independentReadIsolation?: boolean,
 * independentExecution?: boolean}, nativeProof?: object}} request
 * @param {{root?: string, verifyNativeProof?: (proof: object, binding: object) => boolean|Promise<boolean>}} [options]
 * @returns {Promise<object>} Neutral roleContent with an authority notice, exact
 * binding, requested/effective mode, status, dispatchAllowed, qualification,
 * structured limitations, and executed:false. An unqualified independent request
 * is blocked, never silently downgraded to baseline. Missing models block dispatch.
 */
export async function resolveAssignment(request, options = {}) {
  requireValue(isRecord(request), 'request must be an object');
  requireValue(isRecord(options), 'options must be an object');
  requireValue(options.verifyNativeProof === undefined || typeof options.verifyNativeProof === 'function', 'verifyNativeProof must be a trusted host function');
  const input = structuredClone(request);
  const roleId = text(input.role, 'role', 100);
  const stage = text(input.stage, 'stage', 100);
  const task = text(input.task, 'task');
  const revision = text(input.revision, 'revision', 200);
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(revision) && !revision.includes('..'), 'invalid revision token');
  const scope = validateScope(input.scope);
  requireValue(Array.isArray(input.requiredChecks) && input.requiredChecks.length <= 256,
    'requiredChecks must contain at most 256 entries');
  const requiredChecks = [...stringList(input.requiredChecks, 'requiredChecks')];
  for (const check of requiredChecks) text(check, 'requiredChecks', 1024);
  const surfaceId = text(input.surface, 'surface', 100);
  stringList(input.availableModels, 'availableModels', true);
  const model = input.model === undefined ? null : text(input.model, 'model', 200);
  requireValue(model === null || input.availableModels.includes(model), 'model is not in caller-provided availableModels');
  const requestedMode = input.mode === undefined ? 'baseline' : input.mode;
  requireValue(['baseline', 'independent'].includes(requestedMode), 'mode must be baseline or independent');
  const declarations = input.capabilities === undefined ? {} : input.capabilities;
  requireValue(isRecord(declarations) && Object.entries(declarations).every(([key, value]) => CAPABILITIES.includes(key) && typeof value === 'boolean'), 'capabilities must contain only boolean self-declarations');

  const catalogue = await readCatalogue({ root: options.root });
  const role = catalogue.roles.find(entry => entry.id === roleId);
  requireValue(role, `unknown role: ${roleId}`);
  requireValue(catalogue.stages.includes(stage), `unknown stage: ${stage}`);
  const surface = catalogue.surfaces.find(entry => entry.id === surfaceId);
  requireValue(surface, `unknown surface: ${surfaceId}`);
  const binding = { role: roleId, stage, task, revision, scope, requiredChecks, surface: surfaceId, model, contentSha256: role.contentSha256 };
  const limitations = [];
  let verified = false;
  if (input.nativeProof !== undefined) {
    if (proofMatches(input.nativeProof, binding) && options.verifyNativeProof) {
      try {
        verified = (await options.verifyNativeProof(structuredClone(input.nativeProof), structuredClone(binding))) === true;
      } catch {
        verified = false;
      }
    }
    if (!verified) limitations.push({ code: 'NATIVE_PROOF_UNVERIFIED', message: 'Native proof is missing, stale, mismatched or not approved by a trusted host verifier; self-declarations are not native proof.' });
  }
  const qualification = {
    evidenceKind: verified ? 'native-proof' : 'unqualified',
    declarations,
    independentReadIsolation: verified && input.nativeProof.independentReadIsolation === true,
    independentExecution: verified && input.nativeProof.independentExecution === true,
    evidence: verified ? [...input.nativeProof.evidence] : [],
  };
  if (!qualification.independentReadIsolation) limitations.push({ code: 'INDEPENDENT_READ_ISOLATION_UNQUALIFIED', message: 'Independent read isolation is unqualified. Baseline role work must not be described as an independent read.' });
  if (!qualification.independentExecution) limitations.push({ code: 'INDEPENDENT_EXECUTION_UNQUALIFIED', message: 'Independent execution is unqualified. A role assignment or capability declaration does not prove a separate execution.' });
  if (model === null) limitations.push({ code: 'MODEL_NOT_SELECTED', message: 'No model was selected by the caller. Role frontmatter and model-list order are not model selection authority.' });
  const independent = requestedMode === 'independent' && model !== null &&
    qualification.independentReadIsolation && qualification.independentExecution;
  const dispatchAllowed = model !== null && (requestedMode === 'baseline' || independent);
  const mode = requestedMode === 'independent' ? (independent ? 'independent' : 'blocked') : 'baseline';
  return {
    ...binding, binding: structuredClone(binding), schemaVersion: 1,
    roleContent: `${BODY_NOTICE}${role.content}`, source: role.source, surfaceRecord: surface,
    contentPolicy: { providerExamples: 'non-authoritative', modelSelection: 'caller-provided-only' },
    requestedMode, mode, independent, status: dispatchAllowed ? 'ready' : 'blocked', dispatchAllowed,
    qualification, limitations, executed: false, scopeEnforced: false,
  };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(HELP);
    return;
  }
  requireValue(args.includes('--list') && new Set(args).size === args.length &&
    args.every(arg => ['--list', '--json'].includes(arg)), `unsupported arguments.\n${HELP}`);
  const catalogue = await readCatalogue();
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(catalogue, null, 2)}\n` : `${catalogue.roles.map(role => role.id).join('\n')}\n`);
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
