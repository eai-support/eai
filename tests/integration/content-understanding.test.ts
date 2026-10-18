import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

vi.mock('../../src/lib/auth.js', () => ({ getAccessToken: vi.fn(async () => '<fixture-access-token>') }));
vi.mock('../../src/lib/context.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/context.js')>(), resolveCommandContext: vi.fn(),
}));

import { contentUnderstandingCommand } from '../../src/commands/content-understanding.js';
import { docsCommand } from '../../src/commands/docs.js';
import { PlatformAPIClient } from '../../src/lib/api.js';
import { resolveCommandContext } from '../../src/lib/context.js';
import { parseContentUnderstandingManifest } from '../../src/lib/content-understanding-manifest.js';
import { requireContentUnderstandingOperationId } from '../../src/lib/content-understanding-client.js';
import * as out from '../../src/lib/output.js';
import { setActiveProfile } from '../../src/lib/profile.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const gateway = 'https://dev-api.au.myenterprise.ai/public';
const base = '/public/v4/data/documents/content-understanding';
const digest = 'a'.repeat(64);
const jwtShapedIdentifier = ['eyJaaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].join('.');
const original = JSON.parse(await readFile(new URL('../../resources/content-understanding/procurement-example.json', import.meta.url), 'utf8'));
original.tenantId = tenantId;
const manifest = parseContentUnderstandingManifest(original);
const readyCapabilities = { schemaVersion: 1, tenantId, provider: 'azure-content-understanding', apiVersion: '2025-11-01',
  mode: 'typed-document-v1', enabled: true, ready: true, modelProfile: 'default', modelBindingFingerprint: digest,
  capabilityFingerprint: digest, features: { typed_fields: true, flatClassifiers: true, segmentation: false }, limits: {}, blockers: [] };
const readyPlan = { planVersion: 1, tenantId, bundleKey: manifest.bundleKey, definitionDigest: digest, planDigest: 'b'.repeat(64),
  capabilityFingerprint: digest, modelBindingFingerprint: digest, expectedVersions: { runtimeConfiguration: null, publicationVersion: 0 },
  actions: [{ kind: 'leaf', logicalKey: manifest.documentTypes[0].code }], ready: true, blockers: [] };
function operation(status = 'pending', extra = {}) {
  return { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId, bundleKey: manifest.bundleKey, definitionDigest: digest,
    status, phase: status === 'succeeded' ? 'verified' : 'materializing', steps: [], nextAction: status === 'succeeded' ? null : 'status',
    ...(status === 'succeeded' ? { currentReady: true } : {}), ...extra };
}

describe('bounded Content Understanding and document PublicAPI commands', () => {
  let directory: string, file: string, planPath: string;
  let results: Record<string, unknown>[];
  let fetchMock: ReturnType<typeof vi.spyOn>;
  let routes: (url: URL, init: RequestInit) => Response | Promise<Response>;
  const calls: { url: URL; init: RequestInit }[] = [];
  beforeEach(async () => {
    vi.clearAllMocks(); process.exitCode = 0;
    directory = await mkdtemp(join(tmpdir(), 'eai-cu-owned-'));
    file = join(directory, 'manifest.json'); planPath = join(directory, 'plan.json');
    await writeFile(file, JSON.stringify(original), { mode: 0o600 });
    await writeFile(planPath, JSON.stringify({ ok: true, kind: 'eai.content-understanding.plan', schemaVersion: 1,
      binding: { tenantId, bundleKey: manifest.bundleKey, publicApiUrl: gateway,
        manifestSha256: createHash('sha256').update(JSON.stringify(original)).digest('hex') }, body: readyPlan }), { mode: 0o600 });
    for (const group of [contentUnderstandingCommand, docsCommand]) for (const command of group.commands) {
      for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue);
    }
    vi.mocked(resolveCommandContext).mockResolvedValue({ tenantId, publicApiUrl: gateway, client: new PlatformAPIClient(gateway, tenantId) } as never);
    results = []; calls.length = 0;
    vi.spyOn(out, 'json').mockImplementation(value => { results.push(value as Record<string, unknown>); });
    routes = url => {
      if (url.pathname === `${base}/capabilities`) return Response.json(readyCapabilities);
      if (url.pathname === `${base}/configurations/plan`) return Response.json(readyPlan);
      if (url.pathname === `${base}/configurations/apply`) return Response.json(operation('succeeded'));
      if (url.pathname === `${base}/configurations/operations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`) return Response.json(operation('succeeded'));
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Fixture route not found' } }, { status: 404 });
    };
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input)); calls.push({ url, init: init || {} }); return routes(url, init || {});
    });
  });
  afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); process.exitCode = 0; await rm(directory, { recursive: true, force: true }); });
  async function cu(args: string[]) {
    await contentUnderstandingCommand.parseAsync(['node', 'eai', ...args, '--format', 'json']);
    return results.at(-1)!;
  }
  async function docs(args: string[]) {
    await docsCommand.parseAsync(['node', 'eai', ...args, '--format', 'json']);
    return results.at(-1)!;
  }
  const scoped = ['--tenant-id', tenantId];
  function applyArgs(extra: string[] = []) { return ['apply', '--file', file, '--plan', planPath, ...scoped, ...extra]; }
  async function writeAdvancedManifest(config: Record<string, unknown>) {
    const input = structuredClone(original);
    input.documentTypes[0].contentUnderstanding.analyzerDefinition.config = { ...input.documentTypes[0].contentUnderstanding.analyzerDefinition.config, ...config };
    const bytes = JSON.stringify(input);
    await writeFile(file, bytes);
    const saved = JSON.parse(await readFile(planPath, 'utf8'));
    saved.binding.manifestSha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(planPath, JSON.stringify(saved));
  }

  test.each(['typed_fields', 'flatClassifiers'].flatMap(feature => [false, undefined, 'true'].map(value => ({ feature, value }))))(
    'ready capability without exact $feature=$value is not a typed mode proof', async ({ feature, value }) => {
      routes = () => Response.json({ ...readyCapabilities, features: { ...readyCapabilities.features, [feature]: value } });
      expect(await cu(['capabilities', ...scoped])).toMatchObject({ ok: false, error: { code: 'CU_INVALID_RESPONSE' } });
    });
  test('disabled capabilities may truthfully expose unavailable feature flags', async () => {
    routes = () => Response.json({ ...readyCapabilities, enabled: false, ready: false, features: {},
      modelBindingFingerprint: null, blockers: ['CU_MODE_DISABLED'] });
    expect(await cu(['capabilities', ...scoped])).toMatchObject({ ok: true, body: { enabled: false, ready: false, features: {} } });
  });
  test.each([['enableFormula', true], ['enableFigureAnalysis', true], ['enableFigureDescription', true],
    ['tableFormat', 'markdown'], ['chartFormat', 'markdown'], ['annotationFormat', 'none']])(
    'advanced %s is blocked before initial or explicit-resume writes without workspace approval', async (key, value) => {
      await writeAdvancedManifest({ [String(key)]: value });
      for (const args of [applyArgs(), applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])]) {
        const result = await cu(args);
        expect(result).toMatchObject({ ok: false, error: { code: 'CU_ADVANCED_CONFIGURATION_NOT_QUALIFIED' } });
        expect(calls.every(call => call.init.method === 'GET')).toBe(true);
      }
    });
  test('advanced configuration approval is checked again before acknowledged wait continuation', async () => {
    await writeAdvancedManifest({ enableFormula: true });
    let capabilityReads = 0;
    routes = url => url.pathname.endsWith('/capabilities')
      ? Response.json({ ...readyCapabilities, features: { ...readyCapabilities.features, advancedDocumentConfig: ++capabilityReads === 1 } })
      : Response.json(operation('pending', { nextAction: 'apply' }));
    expect(await cu(applyArgs(['--wait', '--timeout', '5']))).toMatchObject({ ok: false,
      error: { code: 'CU_ADVANCED_CONFIGURATION_NOT_QUALIFIED', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(1);
  });
  test('approved advanced settings are forwarded unchanged and false advanced switches need no approval', async () => {
    await writeAdvancedManifest({ enableFormula: true, enableFigureAnalysis: true, enableFigureDescription: true,
      tableFormat: 'html', chartFormat: 'chartJs', annotationFormat: 'markdown' });
    routes = url => url.pathname.endsWith('/capabilities')
      ? Response.json({ ...readyCapabilities, features: { ...readyCapabilities.features, advancedDocumentConfig: true } })
      : Response.json(operation('succeeded'));
    expect(await cu(applyArgs())).toMatchObject({ ok: true });
    expect(JSON.parse(calls.find(call => call.init.method === 'POST')!.init.body as string).manifest.documentTypes[0]
      .contentUnderstanding.analyzerDefinition.config).toMatchObject({ enableFormula: true, tableFormat: 'html', chartFormat: 'chartJs' });
    await writeAdvancedManifest({ enableFormula: false, enableFigureAnalysis: false, enableFigureDescription: false });
    routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities) : Response.json(operation('succeeded'));
    expect(await cu(applyArgs())).toMatchObject({ ok: true });
  });
  test.each(['apply', 'status'])('nested %s API errors preserve the platform code, message and original operation', async command => {
    routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities)
      : Response.json({ error: { code: 'CU_OPERATION_BUSY', message: 'The original operation has an active lease' },
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { status: 409 });
    const args = command === 'apply' ? applyArgs() : ['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped];
    expect(await cu(args)).toMatchObject({ ok: false, status: 409, error: { code: 'CU_OPERATION_BUSY',
      message: 'The original operation has an active lease', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  });
  test.each([{ code: { unsafe: true }, message: { unsafe: true } }, { code: 'unsafe code', message: 'x'.repeat(4097) }])(
    'malformed nested errors use the existing safe platform fallback: %j', async error => {
      routes = () => Response.json({ error, message: 'Safe top-level error' }, { status: 409 });
      expect(await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]))
        .toMatchObject({ ok: false, error: { code: 'CU_REQUEST_FAILED', message: 'Safe top-level error' } });
    });
  test('validation errors do not expose nested authored strings as trusted platform messages', async () => {
    routes = () => Response.json({ error: { code: 'CU_OPERATION_BUSY', message: 'synthetic-validation-secret' },
      detail: [{ loc: ['body', 'manifest'], msg: 'synthetic-validation-secret', type: 'value_error' }] }, { status: 422 });
    const result = await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]);
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('synthetic-validation-secret');
  });
  test.each(['apply', 'status'])('JWT-shaped %s operation identities are refused before profile/auth or redaction', command => {
    const invalid = jwtShapedIdentifier;
    const args = command === 'apply' ? applyArgs(['--operation-id', invalid]) : ['status', '--operation-id', invalid, ...scoped];
    const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname, '--profile', 'missing-owned-profile',
      'content-understanding', ...args, '--format', 'json'], { encoding: 'utf8', timeout: 10000, cwd: directory,
      env: { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '', EAI_PROFILE: '', EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1' } });
    const output = result.stdout.trim() || result.stderr.trim();
    expect(result.status).toBe(1); expect(JSON.parse(output)).toMatchObject({ error: { code: 'CU_OPERATION_INVALID' } });
    expect(output).not.toContain(invalid); expect(output).not.toContain('[redacted-jwt]');
  });
  test('actual JSON output retains canonical operation UUIDs while unrelated JWT data is redacted', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {json} from ${JSON.stringify(new URL('../../dist/lib/output.js', import.meta.url).href)};
      json({operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',note:${JSON.stringify(jwtShapedIdentifier)}});`], { encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note: '[redacted-jwt]' });
  });
  test('canonical UUID layouts accepted by the actual PublicAPI and Configurator contracts are preserved', () => {
    const id = '11111111-1111-0111-0111-111111111111';
    expect(parseContentUnderstandingManifest({ ...original, tenantId: id }).tenantId).toBe(id);
    expect(requireContentUnderstandingOperationId(id)).toBe(id);
  });
  test.each(['apply', 'status'].flatMap(command => ['prefix', 'equals', 'trailing', 'environment'].map(selector => ({ command, selector }))))(
    'compiled $command retains its valid UUID on malformed $selector profile before any auth', async ({ command, selector }) => {
      const observer = join(directory, 'observe-malformed-profile.mjs'), networkLog = join(directory, 'malformed-profile-network.log');
      await writeFile(observer, `import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(networkLog)},'attempt\\n');throw new Error('Unexpected malformed-profile request');};`, { mode: 0o600 });
      const invocation = ['content-understanding', ...(command === 'apply'
        ? applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
        : ['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]), '--format', 'json'];
      const args = selector === 'prefix' ? ['--profile', '../bad', ...invocation]
        : selector === 'equals' ? ['--profile=../bad', ...invocation]
          : selector === 'trailing' ? [...invocation, '--profile', '../bad'] : invocation;
      const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname, ...args],
        { encoding: 'utf8', timeout: 10000, cwd: directory, env: { ...process.env, HOME: directory, USERPROFILE: directory,
          EAI_ACCESS_TOKEN: '', EAI_PROFILE: selector === 'environment' ? '../bad' : '', EAI_NO_UPDATE_CHECK: '1',
          NO_UPDATE_NOTIFIER: '1', NODE_OPTIONS: `--import=${observer}` } });
      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout.trim() || result.stderr.trim());
      expect(payload).toMatchObject({ error: { code: 'E006', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
      expect(payload).not.toHaveProperty('body'); expect(existsSync(networkLog)).toBe(false);
    });
  test.each(['apply', 'status'])('compiled %s rejects an invalid ID before a malformed profile can echo it or resolve auth', command => {
    const id = jwtShapedIdentifier;
    const args = command === 'apply' ? applyArgs(['--operation-id', id]) : ['status', '--operation-id', id, ...scoped];
    const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname, '--profile', '../bad',
      'content-understanding', ...args, '--format', 'json'], { encoding: 'utf8', timeout: 10000, cwd: directory,
      env: { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '', EAI_PROFILE: '', EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1' } });
    const output = result.stdout.trim() || result.stderr.trim();
    expect(result.status).toBe(1); expect(JSON.parse(output)).toMatchObject({ error: { code: 'CU_OPERATION_INVALID' } });
    expect(output).not.toContain(id); expect(output).not.toContain('[redacted-jwt]');
  });
  test.each(['file-value', 'terminator'])('bootstrap retention never treats the %s text as an invoked operation selector', kind => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const options = kind === 'file-value' ? ['--file', '--operation-id', id] : ['--', '--operation-id', id];
    const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname, '--profile', '../bad',
      'content-understanding', 'apply', ...options, '--format', 'json'], { encoding: 'utf8', timeout: 10000, cwd: directory,
      env: { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '', EAI_PROFILE: '', EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1' } });
    const output = result.stdout.trim() || result.stderr.trim(), payload = JSON.parse(output);
    expect(result.status).toBe(1); expect(payload).toMatchObject({ error: { code: 'E006' } });
    expect(payload.error).not.toHaveProperty('operationId'); expect(output).not.toContain(id);
  });
  test.each(['job-alias', 'record-alias', 'nested-error', 'feature-gate'])(
    'compiled CLI enforces the observed %s contract through actual profile/context/API/output', async scenario => {
      const actualGateway = 'https://api.au.myenterprise.ai/public';
      const observer = join(directory, 'observe-compiled-contract.mjs'), networkLog = join(directory, 'compiled-contract-network.jsonl');
      const membership = { id: tenantId, slug: 'owned-fixture', displayName: 'Owned fixture', roles: ['tenant-admin'],
        isActive: true, homeRegion: 'au', hqCountryCode: 'AU', parentId: null };
      const body = scenario === 'job-alias' ? { job_id: 'job-one', tenant_id: tenantId, status: 'completed', documents: [{ document_id: 'doc-one' }] }
        : scenario === 'record-alias' ? { document_id: 'doc-one', storage_target: 'resourceapi', tenant_id: tenantId, job_id: 'job-one', processingStatus: 'complete',
          results: { field: { value: ['one', { nested: true }], confidence: null } } }
          : scenario === 'nested-error' ? { error: { code: 'CU_OPERATION_BUSY', message: 'The original operation has an active lease' } }
            : { ...readyCapabilities, features: { ...readyCapabilities.features, typed_fields: false } };
      await mkdir(join(directory, 'src', 'eai.config'), { recursive: true });
      await writeFile(join(directory, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
      await writeFile(join(directory, '.env.local'), `BASE_URL_PUBLIC_API=${actualGateway}\n`);
      await writeFile(observer, `import {appendFileSync} from 'node:fs';
        globalThis.fetch = async(input, init={}) => {
          const url = new URL(String(input));
          appendFileSync(${JSON.stringify(networkLog)},JSON.stringify({method:init.method||'GET',path:url.pathname,tenant:new Headers(init.headers).get('X-Tenant-Id')})+'\\n');
          if(url.pathname==='/public/v4/identity/tenants') return Response.json({tenants:[${JSON.stringify(membership)}]});
          if(url.pathname.startsWith('/public/v4/data/documents/')) return Response.json(${JSON.stringify(body)}, {status:${scenario === 'nested-error' ? 409 : 200}});
          throw new Error('Unexpected compiled contract dispatch');
        };`, { mode: 0o600 });
      const childEnv = { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '<compiled-contract-token>',
        EAI_PROFILE: '', BASE_URL_PUBLIC_API: actualGateway, EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1', NODE_OPTIONS: `--import=${observer}` };
      const setup = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import {storeTokens} from ${JSON.stringify(new URL('../../dist/lib/auth.js', import.meta.url).href)};
        import {DEFAULT_PROD_AUTH_TENANT_ID,DEFAULT_PROD_AUTH_TENANT_NAME,DEFAULT_PROD_AUTH_CLIENT_ID} from ${JSON.stringify(new URL('../../dist/lib/profile.js', import.meta.url).href)};
        await storeTokens({accessToken:'<compiled-contract-token>',refreshToken:'<compiled-contract-refresh>',expiresAt:Date.now()+3600000,
          tenantId:DEFAULT_PROD_AUTH_TENANT_ID,tenantName:DEFAULT_PROD_AUTH_TENANT_NAME,clientId:DEFAULT_PROD_AUTH_CLIENT_ID,
          oid:'compiled-contract-actor',upn:'owned@example.invalid',activeTenantId:${JSON.stringify(tenantId)},publicApiUrl:${JSON.stringify(actualGateway)}});`],
      { encoding: 'utf8', timeout: 5000, env: childEnv });
      expect(setup.status).toBe(0); expect(setup.stderr).toBe('');
      const args = scenario === 'job-alias' ? ['docs', 'job', 'job-one']
        : scenario === 'record-alias' ? ['docs', 'get', 'doc-one', '--job-id', 'job-one']
          : scenario === 'nested-error' ? ['content-understanding', 'status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
            : ['content-understanding', 'capabilities'];
      const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname, ...args, ...scoped, '--format', 'json'],
        { encoding: 'utf8', timeout: 10000, cwd: directory, env: childEnv });
      const output = result.stdout.trim() || result.stderr.trim(), payload = JSON.parse(output);
      expect(result.signal).toBeNull();
      if (scenario === 'job-alias' || scenario === 'record-alias') { expect(result.status, JSON.stringify(payload)).toBe(0); expect(payload).toMatchObject({ ok: true, body }); }
      else { expect(result.status).toBe(1); expect(payload, JSON.stringify(payload)).toMatchObject({ error: { code: scenario === 'nested-error' ? 'CU_OPERATION_BUSY' : 'CU_INVALID_RESPONSE' } }); }
      const observations = (await readFile(networkLog, 'utf8')).trim().split('\n').map(row => JSON.parse(row));
      expect(observations.some(row => row.path.startsWith('/public/v4/data/documents/') && row.tenant === tenantId)).toBe(true);
      expect(observations.every(row => row.method === 'GET')).toBe(true); expect(output).not.toContain('compiled-contract-token');
    });

  test.each(['snake', 'matching aliases'])('document job accepts %s identities and preserves its original body', async shape => {
    const body = { job_id: 'job-one', tenant_id: tenantId, status: 'completed', documents: [{ document_id: 'doc-one', custom: { retained: true } }],
      ...(shape === 'matching aliases' ? { jobId: 'job-one', tenantId } : {}) };
    if (shape === 'matching aliases') Object.assign(body.documents[0], { documentId: 'doc-one' });
    routes = () => Response.json(body);
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: true, body });
    expect(calls.every(call => call.init.method === 'GET')).toBe(true);
  });
  test('document job permits absent tenant metadata under the actual selected request scope', async () => {
    const body = { jobId: 'job-one', status: 'completed', documents: [{ documentId: 'doc-one' }], summary: { retained: true } };
    routes = () => Response.json(body);
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: true, body, request: { tenantId, publicApiUrl: gateway } });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init.headers).get('X-Tenant-Id')).toBe(tenantId);
    expect(calls[0].init.method).toBe('GET');
  });
  test.each([{ tenantId: null }, { tenantId: '' }, { tenantId: 42 }, { tenant_id: null }, { tenant_id: '' },
    { tenant_id: 42 }, { tenant_id: 'foreign-tenant' }, { tenantId, tenant_id: 'foreign-tenant' }])(
    'document job still rejects supplied malformed or foreign tenant metadata %j', async extra => {
      routes = () => Response.json({ jobId: 'job-one', status: 'completed', documents: [{ documentId: 'doc-one' }], ...extra });
      expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_JOB_MISMATCH' } });
    });
  test.each(['job', 'tenant', 'document'])('document job rejects conflicting %s aliases', async kind => {
    const body = { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one' }],
      ...(kind === 'job' ? { job_id: 'foreign-job' } : {}), ...(kind === 'tenant' ? { tenant_id: 'foreign-tenant' } : {}) };
    if (kind === 'document') Object.assign(body.documents[0], { document_id: 'foreign-document' });
    routes = () => Response.json(body);
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_JOB_MISMATCH' } });
  });
  test.each(['snake', 'matching aliases'])('document record accepts %s identities and preserves recursive results', async shape => {
    const body = { document_id: 'doc-one', storage_target: 'resourceapi', tenant_id: tenantId, job_id: 'job-one', processingStatus: 'complete',
      result: { field: { value: ['one', { nested: true }], confidence: null } },
      ...(shape === 'matching aliases' ? { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, jobId: 'job-one' } : {}) };
    routes = () => Response.json(body);
    expect(await docs(['get', 'doc-one', '--job-id', 'job-one', ...scoped])).toMatchObject({ ok: true, body });
  });
  test.each(['document', 'storage', 'job'])('document record rejects conflicting %s aliases even without a job selector', async kind => {
    routes = () => Response.json({ documentId: 'doc-one', storageTarget: 'resourceapi', tenantId,
      ...(kind === 'document' ? { document_id: 'foreign-document' } : {}),
      ...(kind === 'storage' ? { storage_target: 'legacy' } : {}),
      ...(kind === 'job' ? { jobId: 'job-one', job_id: 'foreign-job' } : {}) });
    expect(await docs(['get', 'doc-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_RECORD_MISMATCH' } });
  });
  test('nullable optional job identity remains untracked and cannot satisfy an explicit job selector', async () => {
    const body = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, jobId: null, job_id: null, processingStatus: 'complete' };
    routes = () => Response.json(body);
    expect(await docs(['get', 'doc-one', ...scoped])).toMatchObject({ ok: true, body });
    expect(await docs(['get', 'doc-one', '--job-id', 'job-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_RECORD_MISMATCH' } });
    routes = () => Response.json({ ...body, job_id: 'job-one' });
    expect(await docs(['get', 'doc-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_RECORD_MISMATCH' } });
  });
  test.each([{}, { jobId: null }, { job_id: null }, { jobId: '' }, { job_id: 42 }, { jobId: 'foreign-job' }])(
    'document record requires observed identity for an explicit job selector %j', async extra => {
      routes = () => Response.json({ documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, ...extra });
      expect(await docs(['get', 'doc-one', '--job-id', 'job-one', ...scoped])).toMatchObject({ ok: false,
        documentId: 'doc-one', jobId: 'job-one', error: { code: 'DOC_RECORD_MISMATCH' } });
      expect(calls[0].url.searchParams.get('job_id')).toBe('job-one');
      expect(calls[0].init.method).toBe('GET');
    });
  test('document record with absent job metadata remains valid for an unfiltered read', async () => {
    const body = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, processingStatus: 'complete', analysis: { retained: ['full', 'body'] } };
    routes = () => Response.json(body);
    expect(await docs(['get', 'doc-one', ...scoped])).toMatchObject({ ok: true, body });
    expect(calls[0].url.searchParams.has('job_id')).toBe(false);
  });

  test('schema and validate work locally without resolving auth or touching the network', async () => {
    expect(await cu(['schema'])).toMatchObject({ ok: true, body: { $schema: 'https://json-schema.org/draft/2020-12/schema', properties: { kind: { const: 'eai.content-understanding' } } } });
    expect(await cu(['validate', '--file', file])).toMatchObject({ ok: true, body: { valid: true, bundleKey: manifest.bundleKey } });
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each(['validate', 'plan', 'apply'].flatMap(command => ['missing', 'directory'].map(kind => ({ command, kind }))))(
    'local manifest input reports safe $command errors for a $kind file', async ({ command, kind }) => {
      const path = kind === 'directory' ? directory : join(directory, 'private-manifest-path.json');
      const args = command === 'apply' ? ['apply', '--file', path, '--plan', planPath, '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]
        : [command, '--file', path, ...(command === 'plan' ? scoped : [])];
      const result = await cu(args);
      expect(result).toMatchObject({ ok: false, error: { code: 'CU_INVALID_MANIFEST',
        ...(command === 'apply' ? { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } : {}) } });
      expect(JSON.stringify(result)).not.toContain(path);
      expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
  test.each(['missing', 'directory'])('local plan input reports safe errors for a %s file and retains the requested operation', async kind => {
    const path = kind === 'directory' ? directory : join(directory, 'private-plan-path.json');
    const result = await cu(['apply', '--file', file, '--plan', path, '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]);
    expect(result).toMatchObject({ ok: false, error: { code: 'CU_PLAN_MISMATCH', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect(JSON.stringify(result)).not.toContain(path);
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  const invalidUtf8 = [[0xc3], [0xc0, 0xaf], [0x80]];
  function replaceUtf8Marker(value: unknown, malformed: number[]): Buffer {
    const [before, after] = JSON.stringify(value).split('byte-fixture-marker');
    return Buffer.concat([Buffer.from(before), Buffer.from(malformed), Buffer.from(after)]);
  }
  test.each(['validate', 'plan', 'apply'].flatMap(command => invalidUtf8.map(bytes => ({ command, bytes }))))(
    'local manifest input rejects invalid UTF-8 %j', async ({ command, bytes }) => {
      const authored = structuredClone(original); authored.documentTypes[0].description = 'byte-fixture-marker';
      const raw = replaceUtf8Marker(authored, bytes); await writeFile(file, raw);
      const saved = JSON.parse(await readFile(planPath, 'utf8')); saved.binding.manifestSha256 = createHash('sha256').update(raw).digest('hex');
      await writeFile(planPath, JSON.stringify(saved));
      const result = await cu(command === 'apply' ? applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
        : [command, '--file', file, ...(command === 'plan' ? scoped : [])]);
      expect(result).toMatchObject({ ok: false, error: { code: 'CU_INVALID_MANIFEST',
        ...(command === 'apply' ? { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } : {}) } });
      expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
  test.each(['actions', 'expectedVersions'].flatMap(field => invalidUtf8.map(bytes => ({ field, bytes }))))(
    'local plan input rejects invalid UTF-8 in $field %j', async ({ field, bytes }) => {
      const saved = JSON.parse(await readFile(planPath, 'utf8'));
      if (field === 'actions') saved.body.actions[0].logicalKey = 'byte-fixture-marker';
      else saved.body.expectedVersions.runtimeConfiguration = 'byte-fixture-marker';
      await writeFile(planPath, replaceUtf8Marker(saved, bytes));
      expect(await cu(applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])))
        .toMatchObject({ ok: false, error: { code: 'CU_PLAN_MISMATCH', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
      expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    });
  test('local manifest input preserves valid Unicode bytes, normalized text and the original hash', async () => {
    const authored = structuredClone(original); authored.documentTypes[0].description = 'Résumé 🧾';
    const raw = Buffer.from(JSON.stringify(authored)); await writeFile(file, raw);
    expect(await cu(['validate', '--file', file])).toMatchObject({ ok: true, body: { manifestSha256: createHash('sha256').update(raw).digest('hex') } });
    const planned = await cu(['plan', '--file', file, ...scoped]); await writeFile(planPath, JSON.stringify(planned));
    expect(await cu(applyArgs())).toMatchObject({ ok: true });
    expect(JSON.parse(calls[0].init.body as string).manifest.documentTypes[0].description).toBe('Résumé 🧾');
    expect(JSON.parse(calls.at(-1)!.init.body as string).manifest.documentTypes[0].description).toBe('Résumé 🧾');
  });
  test.each(['manifest', 'plan'])('local %s input retains the existing JSON refusal for a UTF-8 BOM', async kind => {
    const path = kind === 'manifest' ? file : planPath;
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(path)]));
    expect(await cu(kind === 'manifest' ? ['validate', '--file', file] : applyArgs()))
      .toMatchObject({ ok: false, error: { code: kind === 'manifest' ? 'CU_INVALID_MANIFEST' : 'CU_PLAN_MISMATCH' } });
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  test('compiled local commands bypass expired or nonexistent profile loading', () => {
    for (const args of [['schema'], ['validate', '--file', file]]) {
      const result = spawnSync(process.execPath, ['dist/index.js', '--profile', 'missing-fixture', 'content-understanding', ...args, '--format', 'json'], {
        encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '', EAI_PROFILE: '', EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1' },
      });
      expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(JSON.parse(result.stdout).ok).toBe(true);
    }
  });
  test.each(['schema', 'validate'].flatMap(command => ['prefix', 'equals', 'trailing', 'environment'].map(selector => ({ command, selector }))))(
    'compiled local $command ignores malformed $selector profile syntax without any network', async ({ command, selector }) => {
      const observer = join(directory, 'local-malformed-profile-observer.mjs'), networkLog = join(directory, 'local-malformed-profile-network.log');
      await writeFile(observer, `import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(networkLog)},'attempt\\n');throw new Error('Unexpected local command network');};`, { mode: 0o600 });
      const invocation = ['content-understanding', command, ...(command === 'validate' ? ['--file', file] : []), '--format', 'json'];
      const args = selector === 'prefix' ? ['--profile', '../bad', ...invocation]
        : selector === 'equals' ? ['--profile=../bad', ...invocation]
          : selector === 'trailing' ? [...invocation, '--profile', '../bad'] : invocation;
      const result = spawnSync(process.execPath, ['dist/index.js', ...args], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '',
          EAI_PROFILE: selector === 'environment' ? '../bad' : '', EAI_NO_UPDATE_CHECK: '', NO_UPDATE_NOTIFIER: '', CI: '',
          EAI_UPDATE_NOTIFIER_FORCE: '1', NODE_OPTIONS: `--import=${observer}` } });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toBe(''); expect(JSON.parse(result.stdout).ok).toBe(true);
      expect(existsSync(networkLog)).toBe(false);
    });
  test('default-text schema and validate also suppress every forced update-notifier network attempt', async () => {
    const observer = join(directory, 'observe-fetch.mjs'), networkLog = join(directory, 'network-attempts.log');
    await writeFile(observer, `import { appendFileSync } from 'node:fs';\nglobalThis.fetch = async () => { appendFileSync(${JSON.stringify(networkLog)}, 'attempt\\n'); throw new Error('Controlled zero-network observer'); };\n`, { mode: 0o600 });
    for (const args of [['schema'], ['validate', '--file', file], ['schema', '--help']]) {
      const result = spawnSync(process.execPath, ['dist/index.js', '--profile', 'content-understanding', 'content-understanding', ...args], {
        encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: directory, USERPROFILE: directory,
          EAI_ACCESS_TOKEN: '', EAI_PROFILE: '', NO_UPDATE_NOTIFIER: '', CI: '', EAI_UPDATE_NOTIFIER_FORCE: '1', NODE_OPTIONS: `--import=${observer}` },
      });
      expect(result.status).toBe(0); expect(result.stderr).toBe('');
      expect(existsSync(networkLog)).toBe(false);
    }
  });
  test.each(['nestedClassifiers', 'segments', 'analyzers', 'azureEndpoint', 'defaultModels'])('refuses unsupported %s before any backend context or writes', async field => {
    await writeFile(file, JSON.stringify({ ...original, [field]: {} }));
    expect(await cu(['plan', '--file', file, ...scoped])).toMatchObject({ ok: false, error: { code: 'CU_CAPABILITY_UNSUPPORTED' } });
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
  });
  test('only read-only capabilities and status may run outside an app folder', async () => {
    const contextOptions = () => vi.mocked(resolveCommandContext).mock.calls.at(-1)?.[0];
    await cu(['capabilities', ...scoped]);
    expect(contextOptions()).toMatchObject({ tenantId, allowOutsideProject: true });
    await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]);
    expect(contextOptions()).toMatchObject({ tenantId, allowOutsideProject: true });
    // A saved plan binds the PublicAPI URL that apply later requires; both stay project-bound.
    await cu(['plan', '--file', file, ...scoped]);
    expect(contextOptions()).not.toHaveProperty('allowOutsideProject');
    await cu(applyArgs());
    expect(contextOptions()).not.toHaveProperty('allowOutsideProject');
  });

  test('capabilities reads the selected tenant with bounded trusted gateway forwarding', async () => {
    expect(await cu(['capabilities', ...scoped])).toMatchObject({ ok: true, body: readyCapabilities });
    expect(resolveCommandContext).toHaveBeenCalledWith(expect.objectContaining({ tenantId, interactive: false, forceRefresh: true, pinPublicApiUrl: true }));
    expect(calls).toHaveLength(1); expect(calls[0].url.href).toBe(`${gateway}/v4/data/documents/content-understanding/capabilities?tenant_id=${tenantId}`);
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error', headers: { 'X-Tenant-Id': tenantId, Authorization: 'Bearer <fixture-access-token>' } });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });
  test('reports disabled capabilities truthfully instead of asserting deployed readiness', async () => {
    routes = () => Response.json({ ...readyCapabilities, enabled: false, ready: false, modelBindingFingerprint: null, blockers: [{ code: 'CU_MODE_DISABLED' }] });
    expect(await cu(['capabilities', ...scoped])).toMatchObject({ ok: true, body: { enabled: false, ready: false, blockers: [{ code: 'CU_MODE_DISABLED' }] } });
  });
  test.each([{ tenantId: 'foreign' }, { enabled: false }, { modelBindingFingerprint: null }, { blockers: ['blocked'] }, { ready: 'true' }])
    ('rejects contradictory or foreign capabilities %j', async extra => {
      routes = () => Response.json({ ...readyCapabilities, ...extra });
      expect(await cu(['capabilities', ...scoped])).toMatchObject({ ok: false, error: { code: 'CU_INVALID_RESPONSE' } });
    });
  test('read-only planning binds the exact original file, canonical gateway and server preconditions', async () => {
    const result = await cu(['plan', '--file', file, ...scoped]);
    expect(result).toMatchObject({ ok: true, kind: 'eai.content-understanding.plan', binding: { tenantId, bundleKey: manifest.bundleKey, publicApiUrl: gateway }, body: readyPlan });
    expect(calls).toHaveLength(1); expect(calls[0].url.pathname).toBe(`${base}/configurations/plan`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ tenantId, manifest });
    expect(result.binding).toMatchObject({ manifestSha256: createHash('sha256').update(await readFile(file)).digest('hex') });
  });
  test.each([{ tenantId: 'foreign' }, { bundleKey: 'foreign' }, { definitionDigest: '' }, { ready: true, blockers: ['blocked'] }])
    ('rejects invalid plan scope and readiness %j', async extra => {
      routes = () => Response.json({ ...readyPlan, ...extra });
      expect(await cu(['plan', '--file', file, ...scoped])).toMatchObject({ ok: false, error: { code: 'CU_PLAN_MISMATCH' } });
    });
  test('apply uses unchanged normalized manifest and opaque server versions without minting an operation', async () => {
    expect(await cu(applyArgs())).toMatchObject({ ok: true, status: 200, body: operation('succeeded') });
    expect(calls.map(call => call.init.method)).toEqual(['GET', 'POST']);
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ tenantId, manifest, planDigest: readyPlan.planDigest, expectedVersions: readyPlan.expectedVersions });
  });
  test.each(['apply', 'status'])('succeeded %s requires exactly true current readiness after historical completion', async command => {
    for (const currentReady of [true, false, undefined, 'true']) {
      routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities) : Response.json(operation('succeeded', { currentReady }));
      const result = await cu(command === 'apply' ? applyArgs() : ['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]);
      if (currentReady === true) expect(result).toMatchObject({ ok: true, status: 200, body: { currentReady: true } });
      else expect(result).toMatchObject({ ok: false, body: { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'succeeded' },
        error: { code: 'CU_CURRENT_READINESS_UNVERIFIED', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    }
  });
  test('whitespace-only original file drift refuses the saved plan before auth and POST', async () => {
    await writeFile(file, JSON.stringify(original, null, 2));
    expect(await cu(applyArgs())).toMatchObject({ ok: false, error: { code: 'CU_PLAN_MISMATCH' } });
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  test('saved gateway drift refuses apply before any backend write', async () => {
    const plan = JSON.parse(await readFile(planPath, 'utf8')); plan.binding.publicApiUrl = 'https://test-api.au.myenterprise.ai/public'; await writeFile(planPath, JSON.stringify(plan));
    expect(await cu(applyArgs())).toMatchObject({ ok: false, error: { code: 'CU_PLAN_MISMATCH' } }); expect(calls).toHaveLength(0);
  });
  test('mismatched tenant selection refuses before authentication', async () => {
    expect(await cu(['plan', '--file', file, '--tenant-id', '22222222-2222-4222-8222-222222222222'])).toMatchObject({ ok: false, error: { code: 'CU_TENANT_MISMATCH' } });
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  test('current disabled mode blocks apply even when the saved plan was ready', async () => {
    routes = () => Response.json({ ...readyCapabilities, enabled: false, ready: false, modelBindingFingerprint: null, blockers: ['disabled'] });
    expect(await cu(applyArgs())).toMatchObject({ ok: false, error: { code: 'CU_NOT_READY' } }); expect(calls).toHaveLength(1); expect(calls[0].init.method).toBe('GET');
  });
  test.each(['authentication', 'gateway', 'saved-readiness', 'capability-readiness', 'capability-http', 'capability-transport'])(
    'known apply operation survives %s preflight failure without creating or confirming replacement work', async stage => {
      if (stage === 'authentication') vi.mocked(resolveCommandContext).mockRejectedValueOnce(new Error('Sign in is required'));
      if (stage === 'gateway' || stage === 'saved-readiness') {
        const plan = JSON.parse(await readFile(planPath, 'utf8'));
        if (stage === 'gateway') plan.binding.publicApiUrl = 'https://test-api.au.myenterprise.ai/public';
        else { plan.body.ready = false; plan.body.blockers = [{ code: 'CU_WORKFLOW_BINDING_REQUIRED' }]; }
        await writeFile(planPath, JSON.stringify(plan));
      }
      if (stage === 'capability-readiness') routes = () => Response.json({ ...readyCapabilities,
        enabled: false, ready: false, modelBindingFingerprint: null, blockers: [{ code: 'CU_MODE_DISABLED' }] });
      if (stage === 'capability-http') routes = () => Response.json({ error: 'CU_AUTHORIZATION_REQUIRED', message: 'Tenant admin access required' }, { status: 403 });
      if (stage === 'capability-transport') routes = () => { throw new TypeError('Controlled capability read failure'); };
      const result = await cu(applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']));
      expect(result).toMatchObject({ ok: false, error: { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
      expect(result.error).toMatchObject({ code: stage === 'gateway' ? 'CU_PLAN_MISMATCH'
        : ['saved-readiness', 'capability-readiness'].includes(stage) ? 'CU_NOT_READY'
          : stage === 'capability-http' ? 'CU_AUTHORIZATION_REQUIRED' : 'CU_REQUEST_FAILED' });
      expect(result).not.toHaveProperty('body');
      expect(result).not.toHaveProperty('binding');
      expect(calls.every(call => call.init.method === 'GET')).toBe(true);
      expect(process.exitCode).toBe(1);
    });
  test('status context failure retains only its valid supplied operation identity without observing or creating it', async () => {
    vi.mocked(resolveCommandContext).mockRejectedValueOnce(new Error('Sign in is required'));
    const result = await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]);
    expect(result).toMatchObject({ ok: false, error: { code: 'CU_REQUEST_FAILED', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect(result).not.toHaveProperty('body'); expect(calls).toHaveLength(0); expect(process.exitCode).toBe(1);
  });
  test.each(['apply', 'status'].flatMap(command => ['../foreign-operation', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', '00000000-0000-0000-0000-000000000000'].map(id => ({ command, id }))))('invalid $command operation identity is rejected without echoing it or resolving auth: $id', async ({ command, id }) => {
    const args = command === 'apply' ? applyArgs(['--operation-id', id]) : ['status', '--operation-id', id, ...scoped];
    const result = await cu(args);
    expect(result).toMatchObject({ ok: false, error: { code: 'CU_OPERATION_INVALID' } });
    expect(result.error).not.toHaveProperty('operationId'); expect(JSON.stringify(result)).not.toContain(id);
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  test('a final newline in a server digest is rejected rather than saved as a qualified plan', async () => {
    routes = () => Response.json({ ...readyPlan, planDigest: readyPlan.planDigest + '\n' });
    expect(await cu(['plan', '--file', file, ...scoped])).toMatchObject({ ok: false, error: { code: 'CU_PLAN_MISMATCH' } });
  });
  test.each(['apply', 'status'].flatMap(command => ['profile', 'project', 'membership', 'missing-login'].map(stage => ({ command, stage }))))(
    'compiled $command retains the supplied identity through actual $stage preflight failure', async ({ command, stage }) => {
      const actualGateway = 'https://api.au.myenterprise.ai/public';
      const observer = join(directory, 'observe-preflight-fetch.mjs'), networkLog = join(directory, 'preflight-network.log');
      await writeFile(observer, `import { appendFileSync } from 'node:fs';\nglobalThis.fetch = async (input) => {\n  const path = new URL(String(input)).pathname;\n  appendFileSync(${JSON.stringify(networkLog)}, path + '\\n');\n  if (path === '/public/v4/identity/tenants') return new Response('{}', { status: 401 });\n  throw new Error('Unexpected preflight dispatch');\n};\n`, { mode: 0o600 });
      const childEnv = { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '<owned-preflight-token>', EAI_PROFILE: '',
        BASE_URL_PUBLIC_API: actualGateway, EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1', NODE_OPTIONS: `--import=${observer}` };
      if (stage === 'membership' || stage === 'missing-login') {
        await mkdir(join(directory, 'src', 'eai.config'), { recursive: true });
        await writeFile(join(directory, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
        await writeFile(join(directory, '.env.local'), `BASE_URL_PUBLIC_API=${actualGateway}\n`);
        if (stage === 'membership') {
        const setup = spawnSync(process.execPath, ['--input-type=module', '-e', `
          import { storeTokens } from ${JSON.stringify(new URL('../../dist/lib/auth.js', import.meta.url).href)};
          import { DEFAULT_PROD_AUTH_TENANT_ID, DEFAULT_PROD_AUTH_TENANT_NAME, DEFAULT_PROD_AUTH_CLIENT_ID } from ${JSON.stringify(new URL('../../dist/lib/profile.js', import.meta.url).href)};
          await storeTokens({ accessToken: '<owned-preflight-token>', refreshToken: '<owned-preflight-refresh>', expiresAt: Date.now() + 3600000,
            tenantId: DEFAULT_PROD_AUTH_TENANT_ID, tenantName: DEFAULT_PROD_AUTH_TENANT_NAME, clientId: DEFAULT_PROD_AUTH_CLIENT_ID,
            oid: 'owned-preflight-actor', upn: 'owned@example.invalid', activeTenantId: ${JSON.stringify(tenantId)}, publicApiUrl: ${JSON.stringify(actualGateway)} });
        `], { encoding: 'utf8', timeout: 5000, env: childEnv });
        expect(setup.status).toBe(0); expect(setup.stderr).toBe('');
        }
      }
      const args = command === 'apply' ? applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']) : ['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped];
      const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname,
        ...(stage === 'profile' ? ['--profile', 'missing-owned-profile'] : []), 'content-understanding', ...args, '--format', 'json'],
        { encoding: 'utf8', timeout: 10000, cwd: directory, env: childEnv });
      expect(result.status).toBe(1); expect(result.signal).toBeNull();
      const output = result.stdout.trim() || result.stderr.trim();
      const payload = output.startsWith('{') ? JSON.parse(output) : null;
      expect(payload).toMatchObject({ error: { code: stage === 'profile' ? 'E006' : stage === 'project' ? 'E001' : stage === 'missing-login' ? 'E101' : 'E102', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
      expect(payload).not.toHaveProperty('body');
      const dispatched = existsSync(networkLog) ? (await readFile(networkLog, 'utf8')).trim().split('\n') : [];
      expect(dispatched).toEqual(stage === 'membership' ? ['/public/v4/identity/tenants'] : []);
      expect(output).not.toContain('owned-preflight-token');
    });
  test.each(['apply', 'status'])('compiled %s maps stored-login/profile mismatch to safe typed authentication failure', async command => {
    const actualGateway = 'https://api.au.myenterprise.ai/public';
    const profile = 'owned-auth-mismatch';
    const observer = join(directory, 'observe-auth-mismatch.mjs'), networkLog = join(directory, 'auth-mismatch-network.log');
    await mkdir(join(directory, 'src', 'eai.config'), { recursive: true });
    await writeFile(join(directory, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
    await writeFile(join(directory, '.env.local'), `BASE_URL_PUBLIC_API=${actualGateway}\n`);
    await writeFile(observer, `import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(networkLog)},'attempt\\n');throw new Error('Unexpected auth-mismatch request');};`, { mode: 0o600 });
    const childEnv = { ...process.env, HOME: directory, USERPROFILE: directory, EAI_PROFILE: '', EAI_ACCESS_TOKEN: '',
      BASE_URL_PUBLIC_API: actualGateway, EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1', NODE_OPTIONS: `--import=${observer}` };
    const setup = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {mkdir,writeFile} from 'node:fs/promises';
      import {join} from 'node:path';
      import {storeTokens} from ${JSON.stringify(new URL('../../dist/lib/auth.js', import.meta.url).href)};
      import {setActiveProfile,DEFAULT_PROD_AUTH_TENANT_ID,DEFAULT_PROD_AUTH_TENANT_NAME,DEFAULT_PROD_AUTH_CLIENT_ID} from ${JSON.stringify(new URL('../../dist/lib/profile.js', import.meta.url).href)};
      await mkdir(join(process.env.HOME,'.eai'),{mode:0o700});
      await writeFile(join(process.env.HOME,'.eai','config.json'),JSON.stringify({profiles:{${JSON.stringify(profile)}:{publicApiUrl:${JSON.stringify(actualGateway)},
        authTenantId:DEFAULT_PROD_AUTH_TENANT_ID,authTenantName:DEFAULT_PROD_AUTH_TENANT_NAME,authClientId:DEFAULT_PROD_AUTH_CLIENT_ID}}}),{mode:0o600});
      setActiveProfile(${JSON.stringify(profile)});
      await storeTokens({accessToken:'<owned-auth-mismatch-token>',expiresAt:Date.now()+3600000,
        tenantId:'private-stored-authority',tenantName:'private-stored-authority-name',clientId:'private-stored-client',
        oid:'owned-auth-mismatch-actor',activeTenantId:${JSON.stringify(tenantId)},publicApiUrl:${JSON.stringify(actualGateway)}});`],
    { encoding: 'utf8', timeout: 5000, env: childEnv });
    expect(setup.status).toBe(0); expect(setup.stderr).toBe('');
    for (const operationId of ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jwtShapedIdentifier]) {
      const args = command === 'apply' ? applyArgs(['--operation-id', operationId]) : ['status', '--operation-id', operationId, ...scoped];
      const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname, '--profile', profile,
        'content-understanding', ...args, '--format', 'json'], { encoding: 'utf8', timeout: 10000, cwd: directory, env: childEnv });
      const output = result.stdout.trim() || result.stderr.trim(), payload = JSON.parse(output);
      expect(result.status).toBe(1); expect(result.signal).toBeNull(); expect(payload).not.toHaveProperty('body');
      if (operationId === jwtShapedIdentifier) {
        expect(payload).toMatchObject({ error: { code: 'CU_OPERATION_INVALID' } });
        expect(payload.error).not.toHaveProperty('operationId'); expect(output).not.toContain(operationId);
      } else {
        expect(payload).toMatchObject({ ok: false, error: { code: 'E104', operationId,
          message: 'Authentication failed: Stored CLI login does not match the active auth configuration for this environment. Run `eai login` again for this environment before using workspace or provisioning commands.' } });
      }
      for (const privateValue of ['private-stored-authority', 'private-stored-client', 'owned-auth-mismatch-token']) expect(output).not.toContain(privateValue);
      expect(existsSync(networkLog)).toBe(false);
    }
  });
  test.each(['apply', 'status'])('compiled %s rejects an invalid ID before a missing profile can resolve auth or expose it', async command => {
    const args = command === 'apply' ? applyArgs(['--operation-id', '../foreign-operation']) : ['status', '--operation-id', '../foreign-operation', ...scoped];
    const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname, '--profile', 'missing-owned-profile',
      'content-understanding', ...args, '--format', 'json'], { encoding: 'utf8', timeout: 10000, cwd: directory,
      env: { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '', EAI_PROFILE: '', EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1' } });
    expect(result.status).toBe(1); const output = result.stdout.trim() || result.stderr.trim();
    expect(JSON.parse(output)).toMatchObject({ error: { code: 'CU_OPERATION_INVALID' } });
    expect(output).not.toContain('../foreign-operation');
  });
  test('lost apply acknowledgement preserves original plan identity and never automatically repeats POST', async () => {
    routes = url => { if (url.pathname.endsWith('/capabilities')) return Response.json(readyCapabilities); throw new TypeError('controlled lost acknowledgement'); };
    expect(await cu(applyArgs(['--wait', '--timeout', '1']))).toMatchObject({ ok: false, binding: { tenantId, bundleKey: manifest.bundleKey }, planDigest: readyPlan.planDigest, error: { code: 'CU_APPLY_ACK_UNKNOWN' } });
    expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(1); expect(calls.filter(call => call.init.method === 'GET')).toHaveLength(1);
  });
  test('explicit original apply recovery returns the same durable operation after activation changed versions', async () => {
    await cu(applyArgs()); await cu(applyArgs());
    expect(results.map(result => (result.body as Record<string, unknown>).operationId)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    expect(calls.filter(call => call.init.method === 'POST').map(call => JSON.parse(call.init.body as string))).toEqual([
      { tenantId, manifest, planDigest: readyPlan.planDigest, expectedVersions: readyPlan.expectedVersions },
      { tenantId, manifest, planDigest: readyPlan.planDigest, expectedVersions: readyPlan.expectedVersions },
    ]);
  });
  test.each([{ tenantId: 'foreign' }, { bundleKey: 'foreign' }, { definitionDigest: 'c'.repeat(64) }, { operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])
    ('known operation resume rejects mismatched immutable scope %j', async extra => {
      routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities) : Response.json(operation('succeeded', extra));
      expect(await cu(applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']))).toMatchObject({ ok: false, error: { code: 'CU_OPERATION_MISMATCH', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
      expect(JSON.parse(calls[1].init.body as string).operationId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });
  test('a malformed success receipt still retains the original known apply operation ID', async () => {
    routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities) : Response.json(operation('succeeded', { operationId: '../foreign' }));
    expect(await cu(applyArgs(['--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']))).toMatchObject({ ok: false,
      error: { code: 'CU_OPERATION_INVALID', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  });
  test.each(['failed', 'unknown', 'partial'])('terminal %s is nonzero and retains operation and step observations', async status => {
    routes = () => Response.json(operation(status, { steps: [{ logicalKey: 'Invoice', status }] }));
    expect(await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped])).toMatchObject({ ok: false, body: { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status, steps: [{ logicalKey: 'Invoice', status }] }, error: { code: `CU_OPERATION_${status.toUpperCase()}` } });
    expect(process.exitCode).toBe(1);
  });
  test('pending status is acceptance and never causes apply, including an expired wait', async () => {
    routes = () => Response.json(operation());
    expect(await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped])).toMatchObject({ ok: true, status: 202, body: { status: 'pending' } });
    expect(await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped, '--wait', '--timeout', '1'])).toMatchObject({ ok: false, body: { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, error: { code: 'CU_OPERATION_PENDING' } });
    expect(calls.every(call => call.init.method === 'GET')).toBe(true);
  });
  test('status --wait explicitly asks for apply when provider work is ready and never mutates', async () => {
    routes = () => Response.json(operation('running', { nextAction: 'apply' }));
    expect(await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped, '--wait'])).toMatchObject({ ok: false, body: { nextAction: 'apply' }, error: { code: 'CU_REQUIRES_APPLY', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect(calls).toHaveLength(1); expect(calls[0].init.method).toBe('GET');
  });
  test('a lost poll retains the acknowledged operation and latest observations without replacement work', async () => {
    let reads = 0;
    routes = () => { if (++reads === 1) return Response.json(operation()); throw new TypeError('controlled read failure'); };
    expect(await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped, '--wait', '--timeout', '5']))
      .toMatchObject({ ok: false, body: { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'pending' }, error: { code: 'CU_OPERATION_READ_FAILED', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect(calls.every(call => call.init.method === 'GET')).toBe(true);
  });
  test('even an initial status read failure retains its explicit known operation ID', async () => {
    routes = () => Response.json({ error: 'CU_OPERATION_NOT_FOUND', message: 'Original operation is unavailable' }, { status: 404 });
    expect(await cu(['status', '--operation-id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...scoped]))
      .toMatchObject({ ok: false, status: 404, error: { code: 'CU_OPERATION_NOT_FOUND', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  });
  test('apply --wait resumes only the known original operation when nextAction explicitly requires apply', async () => {
    let applies = 0;
    routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities)
      : url.pathname.endsWith('/apply') ? Response.json(++applies === 1 ? operation('running', { nextAction: 'apply' }) : operation('succeeded'))
      : Response.json(operation('succeeded'));
    expect(await cu(applyArgs(['--wait', '--timeout', '5']))).toMatchObject({ ok: true, status: 200, body: { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect(calls.filter(call => call.init.method === 'POST').map(call => JSON.parse(call.init.body as string).operationId)).toEqual([undefined, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  });
  test.each(['0', '1801', '-1', '1.5', 'abc'])('invalid wait %s refuses before context or writes', async timeout => {
    expect(await cu(applyArgs(['--timeout', timeout]))).toMatchObject({ ok: false, error: { code: 'INVALID_WAIT_TIMEOUT' } });
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  test('safe server HTTP failures keep their status/code and do not become unknown acknowledgement', async () => {
    routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities)
      : Response.json({ error: 'CU_STALE_PLAN', message: 'Plan preconditions changed' }, { status: 409 });
    expect(await cu(applyArgs())).toMatchObject({ ok: false, status: 409, error: { code: 'CU_STALE_PLAN' } });
    expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(1);
  });
  test('a validated owned reservation ID survives a later initial-apply HTTP error without replay', async () => {
    routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities)
      : Response.json({ error: 'CU_OPERATION_BUSY', message: 'Original operation is leased', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { status: 409 });
    expect(await cu(applyArgs(['--wait']))).toMatchObject({ ok: false, status: 409, error: { code: 'CU_OPERATION_BUSY', operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(1);
    expect(calls.filter(call => call.init.method === 'GET')).toHaveLength(1);
  });
  test('a malformed error-envelope operation ID never acknowledges replacement work', async () => {
    routes = url => url.pathname.endsWith('/capabilities') ? Response.json(readyCapabilities)
      : Response.json({ error: 'CU_OPERATION_BUSY', operationId: '../foreign', message: 'Original operation is leased' }, { status: 409 });
    const result = await cu(applyArgs()); expect(result).toMatchObject({ ok: false, status: 409, error: { code: 'CU_OPERATION_BUSY' } });
    expect(result.error).not.toHaveProperty('operationId'); expect(calls.filter(call => call.init.method === 'POST')).toHaveLength(1);
  });

  test('document job exposes exact observed request and job without re-uploading', async () => {
    const job = { jobId: 'job-one', tenantId, status: 'queued', documents: [{ documentId: 'doc-one', storage: { status: 'queued' } }] };
    routes = () => Response.json(job);
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: true, request: { publicApiUrl: gateway, tenantId, path: '/v4/data/documents/jobs/job-one' }, body: job });
    expect(calls).toHaveLength(1); expect(calls[0].init.method).toBe('GET');
  });
  test('processing job inspection remains a successful single read without --wait', async () => {
    const job = { jobId: 'job-one', tenantId, status: 'processing', documents: [{ documentId: 'doc-one',
      storage: { status: 'completed' }, classification: { status: 'processing' }, rag: { status: 'skipped' } }] };
    routes = () => Response.json(job);
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: true, body: job });
    expect(process.exitCode).toBe(0); expect(calls).toHaveLength(1);
  });
  test.each(['storage', 'classification', 'rag'].flatMap(stage => ['pending', 'processing'].map(status => ({ stage, status })) ))(
    'completed document summary with $stage=$status is pending and preserves the observed body', async ({ stage, status }) => {
      const job = { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one',
        storage: { status: 'completed' }, classification: { status: 'completed' }, rag: { status: 'skipped' }, [stage]: { status } }] };
      routes = () => Response.json(job);
      expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, body: job,
        error: { code: 'DOC_JOB_PENDING', jobId: 'job-one' } });
      expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1);
      expect(calls[0].init.method).toBe('GET');
    });
  test('document wait reads through a completed aggregate until its supplied pipeline completes', async () => {
    vi.useFakeTimers(); let reads = 0;
    const job = { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one',
      storage: { status: 'completed' }, classification: { status: 'processing' }, rag: { status: 'skipped' } }] };
    const completed = { ...job, documents: [{ ...job.documents[0], classification: { status: 'completed' } }] };
    routes = () => Response.json(++reads === 1 ? job : completed);
    const result = docs(['job', 'job-one', ...scoped, '--wait', '--timeout', '5']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ ok: true, body: completed });
    expect(calls).toHaveLength(2); expect(calls.every(call => call.init.method === 'GET')).toBe(true);
  });
  test('document wait deadline retains a completed summary with an unfinished pipeline as pending', async () => {
    vi.useFakeTimers();
    const job = { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one',
      storage: { status: 'completed' }, classification: { status: 'pending' }, rag: { status: 'skipped' } }] };
    routes = () => Response.json(job);
    const result = docs(['job', 'job-one', ...scoped, '--wait', '--timeout', '1']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ ok: false, body: job, error: { code: 'DOC_JOB_PENDING', jobId: 'job-one' } });
    expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1);
  });
  test('document wait stops at an observed failed pipeline before polling again', async () => {
    const job = { jobId: 'job-one', tenantId, status: 'processing', documents: [{ documentId: 'doc-one',
      storage: { status: 'completed' }, classification: { status: 'failed' }, rag: { status: 'pending' } }] };
    routes = () => Response.json(job);
    expect(await docs(['job', 'job-one', ...scoped, '--wait', '--timeout', '1']))
      .toMatchObject({ ok: false, body: job, error: { code: 'DOC_JOB_FAILED', jobId: 'job-one' } });
    expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1);
  });
  test.each([
    { name: 'skipped optional pipelines', document: { documentId: 'doc-one', storage: { status: 'completed' }, classification: { status: 'skipped' }, rag: { status: 'skipped' } } },
    { name: 'absent optional pipeline fields', document: { documentId: 'doc-one' } },
  ])('document wait preserves successful $name', async ({ document }) => {
    const job = { jobId: 'job-one', tenantId, status: 'completed', documents: [document] };
    routes = () => Response.json(job);
    expect(await docs(['job', 'job-one', ...scoped, '--wait'])).toMatchObject({ ok: true, body: job });
    expect(process.exitCode).toBe(0); expect(calls).toHaveLength(1);
  });
  const malformedJobStages = [
    { name: 'null', value: null }, { name: 'boolean', value: false },
    { name: 'primitive completion', value: 'completed' }, { name: 'array', value: [] },
    { name: 'missing status', value: {} }, { name: 'null status', value: { status: null } },
    { name: 'numeric status', value: { status: 1 } }, { name: 'array status', value: { status: ['completed'] } },
    { name: 'unrecognized response status', value: { status: 'unrecognized-fixture-value' } },
  ];
  test.each(['storage', 'classification', 'rag'].flatMap(stage => malformedJobStages.map(shape => ({ stage, ...shape }))))(
    'supplied $stage with $name cannot qualify a completed document job', async ({ stage, value }) => {
      const job = { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one',
        storage: { status: 'completed' }, classification: { status: 'completed' }, rag: { status: 'skipped' }, [stage]: value }] };
      routes = () => Response.json(job);
      expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, body: job,
        error: { code: 'DOC_JOB_PENDING', jobId: 'job-one' } });
      expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1); expect(calls[0].init.method).toBe('GET');
    });
  test('an empty document list cannot qualify a completed document job', async () => {
    const job = { jobId: 'job-one', tenantId, status: 'completed', documents: [] };
    routes = () => Response.json(job);
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, body: job,
      error: { code: 'DOC_JOB_PENDING', jobId: 'job-one' } });
    expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1);
  });
  test.each([
    { name: 'empty documents', documents: [] },
    { name: 'null stage', documents: [{ documentId: 'doc-one', classification: null }] },
    { name: 'malformed stage', documents: [{ documentId: 'doc-one', classification: { status: ['completed'] } }] },
    { name: 'unrecognized response status', documents: [{ documentId: 'doc-one', classification: { status: 'unrecognized-fixture-value' } }] },
  ])('document wait polls through $name until an exact terminal response', async ({ documents }) => {
    vi.useFakeTimers(); let reads = 0;
    const incomplete = { jobId: 'job-one', tenantId, status: 'completed', documents };
    const completed = { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one',
      storage: { status: 'completed' }, classification: { status: 'completed' }, rag: { status: 'skipped' } }] };
    routes = () => Response.json(++reads === 1 ? incomplete : completed);
    const result = docs(['job', 'job-one', ...scoped, '--wait', '--timeout', '5']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toMatchObject({ ok: true, body: completed });
    expect(calls).toHaveLength(2); expect(calls.every(call => call.init.method === 'GET')).toBe(true);
  });
  test.each([
    { name: 'empty documents', documents: [] },
    { name: 'null stage', documents: [{ documentId: 'doc-one', storage: null }] },
    { name: 'malformed stage', documents: [{ documentId: 'doc-one', rag: false }] },
    { name: 'unrecognized response status', documents: [{ documentId: 'doc-one', classification: { status: 'unrecognized-fixture-value' } }] },
  ])('document wait deadline retains $name as pending without coercion', async ({ documents }) => {
    vi.useFakeTimers();
    const job = { jobId: 'job-one', tenantId, status: 'completed', documents };
    routes = () => Response.json(job);
    const result = docs(['job', 'job-one', ...scoped, '--wait', '--timeout', '1']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ ok: false, body: job, error: { code: 'DOC_JOB_PENDING', jobId: 'job-one' } });
    expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1);
  });
  test.each(['queued', 'processing'])('non-wait %s inspection does not impose completion requirements', async status => {
    const job = { jobId: 'job-one', tenantId, status, documents: [{ documentId: 'doc-one', storage: null, rag: false }] };
    routes = () => Response.json(job);
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: true, body: job });
    expect(process.exitCode).toBe(0); expect(calls).toHaveLength(1);
  });
  test('a failed stage takes precedence over malformed pending stages', async () => {
    const job = { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one',
      storage: null, classification: { status: 'failed' }, rag: false }] };
    routes = () => Response.json(job);
    expect(await docs(['job', 'job-one', ...scoped, '--wait', '--timeout', '1']))
      .toMatchObject({ ok: false, body: job, error: { code: 'DOC_JOB_FAILED', jobId: 'job-one' } });
    expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1);
  });
  test.each(['https://fixture-user:fixture-scope-value@api.au.myenterprise.ai/public',
    'https://api.au.myenterprise.ai/public?opaque=fixture-scope-value', 'https://api.au.myenterprise.ai/public#fixture-scope-value',
    'ftp://api.au.myenterprise.ai/public', 'not-a-gateway'])(
    'default-profile request scope rejects unsafe configured gateway %s without echoing it', unsafeGateway => {
      setActiveProfile('default');
      const client = new PlatformAPIClient(unsafeGateway, tenantId);
      let caught: unknown;
      try { client.getRequestScope(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('PublicAPI request scope requires a safe HTTP(S) gateway without credentials, query or fragment.');
      expect((caught as Error).message).not.toContain('fixture-scope-value');
    });
  test.each(['https://api.au.myenterprise.ai/public', 'https://api.au.myenterprise.ai/public/',
    'https://custom-gateway.example.test:8443/public', 'http://127.0.0.1:8000', 'http://localhost:8000/public'])(
    'default-profile request scope preserves the exact clean gateway %s', safeGateway => {
      setActiveProfile('default');
      expect(new PlatformAPIClient(safeGateway, tenantId).getRequestScope()).toEqual({ publicApiUrl: safeGateway, tenantId });
    });
  test.each(['job', 'get'].flatMap(command => ['userinfo', 'query', 'fragment', 'clean'].map(kind => ({ command, kind }))))(
    'compiled default-profile docs $command rejects $kind scope before authenticated transport without leaking its value', async ({ command, kind }) => {
      const marker = 'fixture-scope-value';
      const unsafeGateway = kind === 'clean' ? 'https://api.au.myenterprise.ai/public'
        : kind === 'userinfo' ? `https://fixture-user:${marker}@api.au.myenterprise.ai/public`
          : `https://api.au.myenterprise.ai/public${kind === 'query' ? '?opaque=' : '#'}${marker}`;
      const observer = join(directory, 'unsafe-scope-observer.mjs'), networkLog = join(directory, 'unsafe-scope-network.log');
      const body = command === 'job' ? { jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one' }] }
        : { documentId: 'doc-one', tenantId, storageTarget: 'resourceapi', processingStatus: 'complete' };
      await mkdir(join(directory, 'src', 'eai.config'), { recursive: true });
      await writeFile(join(directory, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
      await writeFile(join(directory, '.env.local'), `BASE_URL_PUBLIC_API=${unsafeGateway}\n`);
      await writeFile(observer, `import {appendFileSync} from 'node:fs';globalThis.fetch=async(input)=>{
        appendFileSync(${JSON.stringify(networkLog)},'attempt\\n');
        if(String(input).includes('/v4/identity/tenants')) return Response.json({tenants:[{id:${JSON.stringify(tenantId)},slug:'owned-fixture',displayName:'Owned fixture',roles:['tenant-admin'],isActive:true,homeRegion:'au',hqCountryCode:'AU',parentId:null}]});
        return Response.json(${JSON.stringify(body)});
      };`, { mode: 0o600 });
      const childEnv = { ...process.env, HOME: directory, USERPROFILE: directory, EAI_PROFILE: '', EAI_ACCESS_TOKEN: '<scope-fixture-token>',
        BASE_URL_PUBLIC_API: unsafeGateway, EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1', NODE_OPTIONS: `--import=${observer}` };
      const setup = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import {storeTokens} from ${JSON.stringify(new URL('../../dist/lib/auth.js', import.meta.url).href)};
        import {DEFAULT_PROD_AUTH_TENANT_ID,DEFAULT_PROD_AUTH_TENANT_NAME,DEFAULT_PROD_AUTH_CLIENT_ID} from ${JSON.stringify(new URL('../../dist/lib/profile.js', import.meta.url).href)};
        await storeTokens({accessToken:'<scope-fixture-token>',refreshToken:'<scope-fixture-refresh>',expiresAt:Date.now()+3600000,
          tenantId:DEFAULT_PROD_AUTH_TENANT_ID,tenantName:DEFAULT_PROD_AUTH_TENANT_NAME,clientId:DEFAULT_PROD_AUTH_CLIENT_ID,
          oid:'scope-fixture-actor',upn:'owned@example.invalid',activeTenantId:${JSON.stringify(tenantId)},publicApiUrl:${JSON.stringify(unsafeGateway)}});`],
      { encoding: 'utf8', timeout: 5000, env: childEnv });
      expect(setup.status).toBe(0); expect(setup.stderr).toBe('');
      const result = spawnSync(process.execPath, [new URL('../../dist/index.js', import.meta.url).pathname,
        'docs', command, command === 'job' ? 'job-one' : 'doc-one', ...scoped, '--format', 'json'],
      { encoding: 'utf8', timeout: 10000, cwd: directory, env: childEnv });
      const printed = result.stdout.trim() || result.stderr.trim();
      expect(printed).not.toBe('');
      if (kind === 'clean') {
        expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, request: { publicApiUrl: unsafeGateway, tenantId }, body });
        expect(existsSync(networkLog)).toBe(true); return;
      }
      expect(result.status).toBe(1);
      expect(JSON.parse(printed)).toMatchObject({ error: { code: 'E006',
        message: 'Failed to load configuration: Project and profile PublicAPI endpoints must be HTTP(S) URLs without credentials, queries or fragments.' } });
      expect(result.stdout + result.stderr).not.toContain(marker); expect(result.stdout + result.stderr).not.toContain('fixture-user');
      expect(existsSync(networkLog)).toBe(false);
    });
  test.each(['job', 'get'])('document %s rejects path-normalizing dot identifiers before context or requests', async command => {
    for (const id of ['.', '..']) {
      expect(await docs([command, id, ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_IDENTIFIER_INVALID' } });
    }
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each(['job', 'get', 'job-option'].flatMap(target => [
    { target, kind: 'lone-high', id: '\uD800' }, { target, kind: 'lone-low', id: '\uDFFF' },
  ]))('document $target rejects $kind before context or dispatch', async ({ target, id }) => {
    const args = target === 'job-option' ? ['get', 'doc-one', '--job-id', id] : [target, id];
    expect(await docs([...args, ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_IDENTIFIER_INVALID' } });
    expect(resolveCommandContext).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each(['job', 'get', 'job-option'].flatMap(target => [
    { target, kind: 'lone-high', id: '\uD800' }, { target, kind: 'lone-low', id: '\uDFFF' },
    { target, kind: 'paired-unicode', id: 'r\u00e9sum\u00e9-\uD83D\uDE42' },
  ]))('compiled document $target enforces $kind before auth and preserves valid Unicode', async ({ target, kind, id }) => {
    const actualGateway = 'https://api.au.myenterprise.ai/public';
    const observer = join(directory, 'observe-document-identifier.mjs'), networkLog = join(directory, 'document-identifier-network.jsonl');
    const membership = { id: tenantId, slug: 'owned-fixture', displayName: 'Owned fixture', roles: ['tenant-admin'],
      isActive: true, homeRegion: 'au', hqCountryCode: 'AU', parentId: null };
    const body = target === 'job' ? { jobId: id, tenantId, status: 'completed', documents: [{ documentId: 'doc-one' }] }
      : { documentId: target === 'get' ? id : 'doc-one', tenantId, storageTarget: 'resourceapi', processingStatus: 'complete',
        jobId: target === 'job-option' ? id : null };
    await mkdir(join(directory, 'src', 'eai.config'), { recursive: true });
    await writeFile(join(directory, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
    await writeFile(join(directory, '.env.local'), `BASE_URL_PUBLIC_API=${actualGateway}\n`);
    await writeFile(observer, `import {appendFileSync} from 'node:fs';
      globalThis.fetch = async(input, init={}) => {
        const url = new URL(String(input));
        appendFileSync(${JSON.stringify(networkLog)},JSON.stringify({method:init.method||'GET',path:url.pathname,
          query:url.search,tenant:new Headers(init.headers).get('X-Tenant-Id')})+'\\n');
        if(url.pathname==='/public/v4/identity/tenants') return Response.json({tenants:[${JSON.stringify(membership)}]});
        if(url.pathname.startsWith('/public/v4/data/documents/')) return Response.json(${JSON.stringify(body)});
        throw new Error('Unexpected document identifier dispatch');
      };`, { mode: 0o600 });
    const childEnv = { ...process.env, HOME: directory, USERPROFILE: directory, EAI_ACCESS_TOKEN: '<compiled-contract-token>',
      EAI_PROFILE: '', BASE_URL_PUBLIC_API: actualGateway, EAI_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1', NODE_OPTIONS: `--import=${observer}` };
    const setup = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {storeTokens} from ${JSON.stringify(new URL('../../dist/lib/auth.js', import.meta.url).href)};
      import {DEFAULT_PROD_AUTH_TENANT_ID,DEFAULT_PROD_AUTH_TENANT_NAME,DEFAULT_PROD_AUTH_CLIENT_ID} from ${JSON.stringify(new URL('../../dist/lib/profile.js', import.meta.url).href)};
      await storeTokens({accessToken:'<compiled-contract-token>',refreshToken:'<compiled-contract-refresh>',expiresAt:Date.now()+3600000,
        tenantId:DEFAULT_PROD_AUTH_TENANT_ID,tenantName:DEFAULT_PROD_AUTH_TENANT_NAME,clientId:DEFAULT_PROD_AUTH_CLIENT_ID,
        oid:'compiled-contract-actor',upn:'owned@example.invalid',activeTenantId:${JSON.stringify(tenantId)},publicApiUrl:${JSON.stringify(actualGateway)}});`],
    { encoding: 'utf8', timeout: 5000, env: childEnv });
    expect(setup.status).toBe(0); expect(setup.stderr).toBe('');
    const args = target === 'job-option' ? ['docs', 'get', 'doc-one', '--job-id', id] : ['docs', target, id];
    const cliUrl = new URL('../../dist/index.js', import.meta.url);
    // Native argv encodes lone surrogates as replacement characters. Preserve the actual JS
    // argument string in this subprocess, then exercise the real compiled index/parser/hooks.
    const bootstrap = join(directory, 'document-identifier-bootstrap.mjs');
    await writeFile(bootstrap, `
      process.argv=[process.execPath,${JSON.stringify(cliUrl.pathname)},...${JSON.stringify([...args, ...scoped, '--format', 'json'])}];
      await import(${JSON.stringify(cliUrl.href)});`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [bootstrap],
    { encoding: 'utf8', timeout: 10000, cwd: directory, env: childEnv });
    const output = result.stdout.trim() || result.stderr.trim(), payload = JSON.parse(output);
    expect(result.signal).toBeNull();
    const observations = existsSync(networkLog) ? (await readFile(networkLog, 'utf8')).trim().split('\n').map(row => JSON.parse(row)) : [];
    if (kind === 'paired-unicode') {
      expect(result.status, JSON.stringify(payload)).toBe(0); expect(payload).toMatchObject({ ok: true, body });
      const documentReads = observations.filter(row => row.path.startsWith('/public/v4/data/documents/'));
      expect(documentReads).toHaveLength(1); expect(documentReads[0].tenant).toBe(tenantId);
      if (target === 'job-option') expect(new URLSearchParams(documentReads[0].query).get('job_id')).toBe(id);
      else expect(documentReads[0].path).toBe(`/public/v4/data/documents/${target === 'job' ? 'jobs' : 'records'}/${encodeURIComponent(id)}`);
      expect(observations.every(row => row.method === 'GET')).toBe(true);
    } else {
      expect(result.status).toBe(1); expect(payload).toMatchObject({ ok: false, error: { code: 'DOC_IDENTIFIER_INVALID' } });
      expect(observations).toHaveLength(0);
    }
    expect(output).not.toContain('compiled-contract-token');
  });
  test.each(['failed', 'completed_with_errors'])('document job %s is nonzero', async status => {
    routes = () => Response.json({ jobId: 'job-one', tenantId, status, documents: [{ documentId: 'doc-one' }] });
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_JOB_FAILED', jobId: 'job-one' } });
  });
  test.each(['pending', 'queued', 'accepted', 'processing', 'unknown', null, undefined, ['complete'], { status: 'completed' }])(
    'persisted document processing %s is incomplete and retains the original scoped body', async processingStatus => {
      const body = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, jobId: 'job-one', processingStatus,
        analysis: { retained: ['raw', { value: 42 }] } };
      routes = () => Response.json(body);
      expect(await docs(['get', 'doc-one', '--job-id', 'job-one', ...scoped])).toEqual(expect.objectContaining({
        ok: false, body: JSON.parse(JSON.stringify(body)), request: expect.objectContaining({ tenantId, publicApiUrl: gateway }),
        error: expect.objectContaining({ code: 'DOC_RECORD_PENDING', documentId: 'doc-one', jobId: 'job-one' }) }));
      expect(process.exitCode).toBe(1); expect(calls.every(call => call.init.method === 'GET')).toBe(true);
    });
  test.each(['failed', 'completed_with_errors', 'partial_failure'])(
    'persisted document processing %s is failure and retains the raw body', async processingStatus => {
      const body = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, processingStatus, retained: ['raw'] };
      routes = () => Response.json(body);
      expect(await docs(['get', 'doc-one', ...scoped])).toMatchObject({ ok: false, body,
        error: { code: 'DOC_RECORD_FAILED', documentId: 'doc-one' } });
      expect(process.exitCode).toBe(1); expect(calls).toHaveLength(1);
    });
  test.each(['complete', 'completed'])(
    'persisted document completion spelling %s preserves the entire successful record', async processingStatus => {
      const body = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, processingStatus,
        machineAnalysis: { processingStatus: 'completed', warnings: ['Retain evidence'] }, retained: { value: ['unchanged'] } };
      routes = () => Response.json(body);
      expect(await docs(['get', 'doc-one', ...scoped])).toMatchObject({ ok: true, body });
      expect(process.exitCode).toBe(0);
    });
  test.each(['failed', 'processing', null])(
    'persisted machine analysis %s cannot be hidden by a completed record summary', async processingStatus => {
      const body = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, processingStatus: 'complete',
        machineAnalysis: { processingStatus, retained: true } };
      routes = () => Response.json(body);
      expect(await docs(['get', 'doc-one', ...scoped])).toMatchObject({ ok: false, body,
        error: { code: processingStatus === 'failed' ? 'DOC_RECORD_FAILED' : 'DOC_RECORD_PENDING' } });
      expect(process.exitCode).toBe(1);
    });
  test('actual business projection pending summary preserves machine analysis failure', async () => {
    const body = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, jobId: 'job-one', processingStatus: 'pending',
      machineAnalysis: { processingStatus: 'failed', extractedFields: [], validationResult: null }, reviewStatus: 'needs_review' };
    routes = () => Response.json(body);
    expect(await docs(['get', 'doc-one', '--job-id', 'job-one', ...scoped])).toMatchObject({ ok: false, body,
      error: { code: 'DOC_RECORD_FAILED', documentId: 'doc-one', jobId: 'job-one' } });
    expect(process.exitCode).toBe(1); expect(calls.every(call => call.init.method === 'GET')).toBe(true);
  });
  test('failed document pipeline remains failure even if job summary claims completion', async () => {
    routes = () => Response.json({ jobId: 'job-one', tenantId, status: 'completed', documents: [{ documentId: 'doc-one', classification: { status: 'failed' } }] });
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_JOB_FAILED' } });
  });
  test('document job wait timeout retains the accepted job and dispatches no writes', async () => {
    routes = () => Response.json({ jobId: 'job-one', tenantId, status: 'processing', documents: [{ documentId: 'doc-one' }] });
    expect(await docs(['job', 'job-one', ...scoped, '--wait', '--timeout', '1'])).toMatchObject({ ok: false, body: { jobId: 'job-one' }, error: { code: 'DOC_JOB_PENDING', jobId: 'job-one' } });
    expect(calls.every(call => call.init.method === 'GET')).toBe(true);
  });
  test('job tenant mismatch is refused before treating observations as completion', async () => {
    routes = () => Response.json({ jobId: 'job-one', tenantId: 'foreign', status: 'completed', documents: [] });
    expect(await docs(['job', 'job-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_JOB_MISMATCH' } });
  });
  test('persisted record reads preserve recursive values and nullable evidence/provenance', async () => {
    const record = { documentId: 'doc-one', storageTarget: 'resourceapi', tenantId, jobId: 'job-one', processingStatus: 'completed',
      analysis: { fields: { LineItems: [{ Quantity: { value: 2, confidence: null, source: [{ pageNumber: 1 }] }, UnitPrice: { value: 3.4, confidence: 0.91 } }], FollowUp: { value: ['Ask reviewer'], confidence: null } },
        warnings: ['Verify generated suggestion'], analyzerId: 'opaque-provider-id', definitionDigest: digest, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } };
    routes = () => Response.json(record);
    expect(await docs(['get', 'doc-one', '--job-id', 'job-one', '--storage-target', 'resourceapi', ...scoped])).toMatchObject({ ok: true, body: record });
    expect(calls[0].url.pathname).toBe('/public/v4/data/documents/records/doc-one');
    expect(calls[0].url.searchParams.get('storage_target')).toBe('resourceapi'); expect(calls[0].url.searchParams.get('job_id')).toBe('job-one');
  });
  test.each([{ documentId: 'foreign' }, { tenantId: 'foreign' }, { tenant: 'foreign' }, { tenant_id: 'foreign' }, { jobId: 'foreign' }, { job_id: 'foreign' }, { storageTarget: 'legacy' }])
    ('document record rejects mismatched scope %j', async extra => {
      routes = () => Response.json({ documentId: 'doc-one', tenantId, jobId: 'job-one', storageTarget: 'resourceapi', ...extra });
      expect(await docs(['get', 'doc-one', '--job-id', 'job-one', ...scoped])).toMatchObject({ ok: false, error: { code: 'DOC_RECORD_MISMATCH' } });
    });
});
