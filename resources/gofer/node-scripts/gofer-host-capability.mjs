#!/usr/bin/env node
/**
 * Read-only host discovery for the verified execution protocol. It never
 * selects a model or launches an agent because those controls are host-owned.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID, sign, verify } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyLocalIsolationReport } from './gofer-local-isolation.mjs';

export const HOSTS = Object.freeze({
  antigravity: { program: 'agy', args: ['--version'] },
  claude: { program: 'claude', args: ['--version'] },
  codex: { program: 'codex', args: ['--version'] },
  copilot: { program: 'copilot', args: ['--version'] },
  grok: { program: 'grok', args: ['--version'] },
  vscode: { program: 'code', args: ['--version'] },
});

// Only commands observed in the host's own help or command output appear here.
// A host without a model-discovery command remains unqualified; it is never
// given a static fallback model list.
export const HOST_MODEL_DISCOVERY = Object.freeze({
  antigravity: { program: 'agy', args: ['models'] },
  grok: { program: 'grok', args: ['models'] },
});

// Generated and legacy surfaces use these names. Keep alias resolution here so
// a command surface cannot silently select a different host.
export const HOST_ALIASES = Object.freeze({
  'claude-code': 'claude',
  'openai-codex': 'codex',
  'github-copilot': 'copilot',
  'visual-studio-code': 'vscode',
  gemini: 'antigravity',
  xai: 'grok',
});

function fail(message) { throw new Error(`Host capability: ${message}`); }

function hostName(value) {
  if (value === 'auto') return null;
  const canonical = HOST_ALIASES[value] ?? value;
  if (!Object.hasOwn(HOSTS, canonical)) fail(`unsupported host: ${value}`);
  return canonical;
}

const safeModel = value => value && typeof value.id === 'string' && value.id.trim() &&
  (value.reasoningEfforts === undefined || (Array.isArray(value.reasoningEfforts) &&
    value.reasoningEfforts.every(item => typeof item === 'string' && item.trim())));
const parseTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const text = value => typeof value === 'string' && value.trim().length > 0;

function modelsFromAntigravity(output) {
  return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
    const [id] = line.split(/\t+/);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id ?? '')) return [];
    const effort = id.match(/-(low|medium|high)$/i)?.[1]?.toLowerCase();
    return [{ id, reasoningEfforts: effort ? [effort] : [] }];
  });
}

function modelsFromGrok(output) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(?:\*|-)?\s*([a-z0-9][a-z0-9._-]*)\b/i);
    return match && /^grok-/i.test(match[1]) ? [{ id: match[1], reasoningEfforts: [] }] : [];
  });
}

const MODEL_PARSERS = Object.freeze({ antigravity: modelsFromAntigravity, grok: modelsFromGrok });

function codexModels(catalog) {
  if (!Array.isArray(catalog?.data)) return [];
  return catalog.data.flatMap(model => text(model?.id) && Array.isArray(model.supportedReasoningEfforts) &&
    model.supportedReasoningEfforts.every(option => text(option?.reasoningEffort))
    ? [{ id: model.id, reasoningEfforts: model.supportedReasoningEfforts.map(option => option.reasoningEffort) }]
    : []);
}

/**
 * Read the local Codex app-server catalog. This is a native-session read, not
 * a policy fallback: failure to receive a complete catalog leaves Codex
 * unqualified. Workspace-write is reported only when the separately verified
 * local-isolation report requires Codex's workspace-write OS sandbox.
 */
export function createCodexAppServerRuntime({ workspaceRoot, localIsolation, request } = {}) {
  if (!verifyLocalIsolationReport(localIsolation, { host: 'codex', workspaceRoot })) {
    throw new Error('LOCAL_SANDBOX_REQUIRED');
  }
  if (!request && (!text(localIsolation.nativeExecutable) ||
      !path.isAbsolute(localIsolation.nativeExecutable))) throw new Error('NATIVE_CODEX_CATALOG_REQUIRED');
  const activeRequest = request ?? ((method, params) => codexAppServerRequest(
    method, params, localIsolation.nativeExecutable));
  return Object.freeze({
    async inspect() {
      const [catalog, provider] = await Promise.all([
        activeRequest('model/list', { limit: 100, includeHidden: false }),
        activeRequest('modelProvider/capabilities/read', {}),
      ]);
      const models = codexModels(catalog);
      if (!models.length || !provider || ['namespaceTools', 'imageGeneration', 'webSearch'].some(key => typeof provider[key] !== 'boolean')) {
        throw new Error('NATIVE_CODEX_CATALOG_REQUIRED');
      }
      const reasoningCapabilities = [...new Set(models.flatMap(model => model.reasoningEfforts))];
      const toolCapabilities = Object.entries(provider).filter(([, enabled]) => enabled).map(([name]) => name);
      return Object.freeze({ models, reasoningCapabilities, toolCapabilities, grantedPermissions: ['workspace-write'],
        isolationClass: 'git-worktree+local-os-sandbox', source: 'codex app-server model/list and modelProvider/capabilities/read' });
    },
  });
}

function codexAppServerRequest(method, params, executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['app-server', '--stdio'], { shell: false, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let buffer = '';
    let initialized = false;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      error ? reject(error) : resolve(result);
    };
    const send = (id, requestMethod, requestParams) => child.stdin.write(`${JSON.stringify({ id, method: requestMethod, params: requestParams })}\n`);
    child.once('error', error => finish(new Error(`NATIVE_CODEX_CATALOG_REQUIRED:${error.message}`)));
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index < 0) return;
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) return finish(new Error('NATIVE_CODEX_CATALOG_REQUIRED'));
          initialized = true;
          send(2, method, params);
        } else if (initialized && message.id === 2) {
          return message.error ? finish(new Error('NATIVE_CODEX_CATALOG_REQUIRED')) : finish(null, message.result);
        }
      }
    });
    const timer = setTimeout(() => finish(new Error('NATIVE_CODEX_CATALOG_REQUIRED')), 5000);
    send(1, 'initialize', { clientInfo: { name: 'gofer-native-capability', version: '2.0.0' }, capabilities: {} });
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function unsignedReceipt(receipt) {
  const { signature, ...payload } = receipt;
  return payload;
}

export function capabilityReceiptHash(receipt) {
  return createHash('sha256').update(canonicalJson(unsignedReceipt(receipt))).digest('hex');
}

export function verifyCapabilityReceipt(receipt, { publicKey, now = Date.now(), host, requiredCapabilities = {} } = {}) {
  let canonical;
  try { canonical = hostName(host === undefined ? receipt?.host : host); }
  catch { return false; }
  const required = requiredCapabilities ?? {};
  if (!receipt || receipt.schemaVersion !== 2 || receipt.host !== canonical ||
      !text(receipt.evaluatorVersion) || !text(receipt.evaluationId) || !text(receipt.hostVersion) ||
      parseTime(receipt.evaluatedAt) === null || parseTime(receipt.expiresAt) === null ||
      parseTime(receipt.evaluatedAt) > now || parseTime(receipt.expiresAt) <= parseTime(receipt.evaluatedAt) ||
      parseTime(receipt.expiresAt) <= now || !Array.isArray(receipt.models) || !receipt.models.every(safeModel) ||
      new Set(receipt.models.map(model => model.id)).size !== receipt.models.length ||
      !Array.isArray(receipt.reasoningCapabilities) || !receipt.reasoningCapabilities.every(text) ||
      !Array.isArray(receipt.toolCapabilities) || !receipt.toolCapabilities.every(text) ||
      !Array.isArray(receipt.grantedPermissions) || !receipt.grantedPermissions.every(text) ||
      !text(receipt.isolationClass) || !receipt.provenance || !text(receipt.provenance.evaluator) ||
      !text(receipt.provenance.source) || !text(receipt.provenance.keyId) ||
      receipt.signature?.algorithm !== 'ed25519' || receipt.signature.keyId !== receipt.provenance.keyId ||
      !text(receipt.signature.value) || !publicKey) return false;
  if (!verify(null, Buffer.from(canonicalJson(unsignedReceipt(receipt))), publicKey,
    Buffer.from(receipt.signature.value, 'base64url'))) return false;
  for (const [field, expected] of Object.entries(required)) {
    const values = receipt[field === 'reasoningEfforts' ? 'reasoningCapabilities' : field];
    if (Array.isArray(expected) && (!Array.isArray(values) || expected.some(value => !values.includes(value)))) return false;
    if (typeof expected === 'string' && values !== expected) return false;
  }
  return true;
}

/**
 * A capability receipt is created by a host-specific evaluator after it reads
 * the active host runtime. It is model availability evidence only: it does not
 * claim execution, isolation, permission, or a selected model.
 */
export function createCapabilityReceipt({ host, evaluatorVersion, evaluatedAt, expiresAt, models, evaluationId,
  hostVersion, reasoningCapabilities = [], toolCapabilities = [], grantedPermissions = [], isolationClass,
  provenance, signingKey }) {
  const canonical = hostName(host);
  if (!canonical || typeof evaluatorVersion !== 'string' || !evaluatorVersion.trim() ||
      !Array.isArray(models) || !models.every(safeModel) ||
      new Set(models.map(model => model.id)).size !== models.length ||
      typeof evaluationId !== 'string' || !evaluationId.trim() ||
      !text(hostVersion) || !Array.isArray(reasoningCapabilities) || !reasoningCapabilities.every(text) ||
      !Array.isArray(toolCapabilities) || !toolCapabilities.every(text) || !Array.isArray(grantedPermissions) ||
      !grantedPermissions.every(text) || !text(isolationClass) || !provenance || !text(provenance.evaluator) ||
      !text(provenance.source) || !text(provenance.keyId) || !signingKey ||
      parseTime(evaluatedAt) === null || parseTime(expiresAt) === null || parseTime(expiresAt) <= parseTime(evaluatedAt)) {
    fail('invalid capability receipt');
  }
  const receipt = { schemaVersion: 2, host: canonical, evaluatorVersion, evaluationId, evaluatedAt, expiresAt,
    hostVersion, models: models.map(model => ({ ...model })), reasoningCapabilities: [...reasoningCapabilities],
    toolCapabilities: [...toolCapabilities], grantedPermissions: [...grantedPermissions], isolationClass,
    provenance: { ...provenance } };
  const signature = sign(null, Buffer.from(canonicalJson(receipt)), signingKey).toString('base64url');
  return Object.freeze({ ...receipt, signature: { algorithm: 'ed25519', keyId: provenance.keyId, value: signature } });
}

export function selectLiveModel(receipt, { host, modelId, now = Date.now(), publicKey, requiredCapabilities } = {}) {
  const canonical = hostName(host);
  if (!verifyCapabilityReceipt(receipt, { publicKey, now, host: canonical, requiredCapabilities }) ||
      typeof modelId !== 'string' || !modelId.trim()) fail('live model capability is unavailable');
  const model = receipt.models.find(item => item.id === modelId);
  if (!model) fail('model is not present in the current host receipt');
  return Object.freeze({ host: canonical, model: { ...model }, evaluationId: receipt.evaluationId,
    receiptVersion: receipt.schemaVersion, receiptHash: capabilityReceiptHash(receipt), expiresAt: receipt.expiresAt });
}

/**
 * Issue a receipt from native host output plus a trusted host integration's
 * session inspection. The worker cannot supply this inspection or signature.
 * Where a CLI has no model-list command, its native host integration must
 * supply the session model list; there is no static fallback.
 */
export async function evaluateNativeHost(host, { signingKey, keyId, runtime, run = runProgram,
  now = () => new Date(), ttlMs = 5 * 60 * 1000, evaluatorVersion = '2.0.0' } = {}) {
  const canonical = hostName(host);
  const discovery = HOST_MODEL_DISCOVERY[canonical];
  if (!canonical || !signingKey || !text(keyId) || !Number.isFinite(ttlMs) || ttlMs <= 0 ||
      typeof runtime?.inspect !== 'function') fail('native capability evaluator is unavailable');
  const [versionProbe, modelProbe, session] = await Promise.all([
    run(HOSTS[canonical]), discovery ? run(discovery) : Promise.resolve(null), runtime.inspect({ host: canonical }),
  ]);
  const models = discovery && modelProbe?.ok === true ? MODEL_PARSERS[canonical](modelProbe.version ?? '') : session?.models;
  if (versionProbe?.ok !== true || !text(versionProbe.version) || !session || !Array.isArray(models) || !models.length ||
      !models.every(safeModel) ||
      !Array.isArray(session.reasoningCapabilities) || !Array.isArray(session.toolCapabilities) ||
      !Array.isArray(session.grantedPermissions) || !text(session.isolationClass) || !text(session.source)) {
    fail('native capability evidence is incomplete');
  }
  const evaluatedAt = now();
  if (!(evaluatedAt instanceof Date) || !Number.isFinite(evaluatedAt.getTime())) fail('native evaluator clock is invalid');
  const sourceHash = createHash('sha256').update(`${versionProbe.version}\n${modelProbe?.version ?? canonicalJson(models)}\n${session.source}`).digest('hex');
  return createCapabilityReceipt({ host: canonical, evaluatorVersion, evaluationId: randomUUID(),
    evaluatedAt: evaluatedAt.toISOString(), expiresAt: new Date(evaluatedAt.getTime() + ttlMs).toISOString(),
    hostVersion: versionProbe.version, models, reasoningCapabilities: session.reasoningCapabilities,
    toolCapabilities: session.toolCapabilities, grantedPermissions: session.grantedPermissions,
    isolationClass: session.isolationClass, provenance: { evaluator: 'gofer-native-host-evaluator',
      source: `${discovery ? `${discovery.program} ${discovery.args.join(' ')}` : 'native-host-session'} sha256:${sourceHash}`, keyId }, signingKey });
}

async function runProgram({ program, args }) {
  return new Promise(resolve => {
    let output = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(program, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const collect = chunk => { output = `${output}${chunk}`.slice(0, 8192); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => finish({ ok: false, version: null }));
    child.on('close', code => finish({ ok: code === 0, version: code === 0 ? output.trim() || null : null }));
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, version: null });
    }, 3000);
  });
}

/**
 * Inspect one installed host. A version probe only proves that the executable
 * is reachable. Model availability and isolation remain runtime evidence.
 */
export async function inspectHost(host, { run = runProgram } = {}) {
  const id = hostName(host);
  if (!id) {
    return {
      schemaVersion: 1,
      host: null,
      aliases: HOST_ALIASES,
      status: 'host-name-required',
      models: [],
      modelDiscovery: 'host-runtime-required',
      independentExecution: 'unqualified',
      nextAction: 'Use the current coding app name. Do not guess model IDs.',
    };
  }
  const probe = await run(HOSTS[id]);
  return {
    schemaVersion: 1,
    host: id,
    aliases: Object.fromEntries(Object.entries(HOST_ALIASES).filter(([, canonical]) => canonical === id)),
    status: probe?.ok === true ? 'available' : 'unavailable',
    executable: HOSTS[id].program,
    version: typeof probe?.version === 'string' ? probe.version : null,
    models: [],
    modelDiscovery: 'host-runtime-required',
    independentExecution: 'unqualified',
    nextAction: probe?.ok === true
      ? 'Use the host runtime to disclose available models and permissions before delegation.'
      : 'Install or open the selected host. Do not substitute another host.',
  };
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node gofer-host-capability.mjs --host <host|auto> --json\n');
    return;
  }
  if (args.length !== 3 || args[0] !== '--host' || args[2] !== '--json') fail('use --host <host|auto> --json');
  process.stdout.write(`${JSON.stringify(await inspectHost(args[1]))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
