import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const qa = require('../../scripts/cli-qa-foundation.cjs');
const probe = require('../../scripts/cli-qa-authorization.cjs');
const uuid = (number: number): string => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const directories: string[] = [];
type Slot = 'adminA' | 'builderA' | 'viewerA' | 'adminB' | 'builderB';
interface Actor { oid: string; profile: string; email: string }
interface ResourceDTO {
  id: string; tenant_id: string; object_type: string; data: Record<string, unknown>; version: number;
  created_by: string; updated_by: string; created_at: string; updated_at: string; idempotentReplay: boolean;
}
interface Invocation { slot: Slot | 'owner'; method: string; path: string; tenantId: string; data?: Record<string, unknown> }
interface Faults {
  create?: 'unknown' | 'nonzero-ack' | 'foreign-scope' | 'missing-nonce' | 'replay';
  baseline?: 'global' | 'wrong-oid' | 'builder-admin' | 'viewer-builder' | 'sibling-access' | 'wrong-parent' | 'admin-context-only';
  schema?: 'missing-b' | 'wrong-tenant' | 'wrong-request' | 'duplicate' | 'required' | 'nonce-type' | 'wrong-data-type' | 'dropped';
  ownRead?: 'tenant' | 'type' | 'nonce' | 'version';
  viewerStatus?: number; viewerExit?: number; viewerRequest?: boolean; siblingStatus?: number;
  cleanup?: 'delete-failed-but-absent' | 'absence403' | 'foreign-current' | 'wrong-delete-id' | 'delete-not-confirmed' | 'delete-no-timestamp';
  candidateDrift?: boolean;
}
const candidate = { gitSha: 'a'.repeat(40), runtimeSha256: 'b'.repeat(64), binarySha256: 'c'.repeat(64),
  runtimeFileCount: 802, version: '3.19.2', dirty: false };
const timestamp = '2026-10-09T06:00:00Z';

function controlled(faults: Faults = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-qa-authorization-'))); directories.push(root);
  const actor = (number: number): Actor => ({ oid: uuid(number), profile: `qa-${number}`, email: `qa-${number}@example.invalid` });
  const slots: Slot[] = ['adminA', 'builderA', 'viewerA', 'adminB', 'builderB'];
  const foundation = qa.initialize({ environment: 'DEV', region: 'au', parentTenantId: uuid(1), owner: actor(2),
    actors: Object.fromEntries(slots.map((slot, index) => [slot, actor(index + 3)])),
    workspaces: { a: { name: 'CLI QA A', slug: 'eai-cli-qa-a' }, b: { name: 'CLI QA B', slug: 'eai-cli-qa-b' } }, bindings: {} }, () => uuid(20));
  foundation.workspaces.a.id = uuid(30); foundation.workspaces.b.id = uuid(31); foundation.state = 'verified';
  foundation.bindings.authorization = { workspaceSlot: 'a', tenantId: uuid(30), objectType: 'cli-qa-authorization-row',
    nonceField: 'qaNonce', data: { label: 'cli-qa-synthetic', status: 'draft', count: 1, enabled: true } };
  const foundationPath = join(root, 'foundation.json'), output = join(root, 'authorization.json');
  qa.writePrivate(foundationPath, foundation);
  const calls: Invocation[] = [], rows = new Map<string, ResourceDTO>(), checkpoints: Record<string, unknown>[] = [];
  const rowKey = (tenant: string, id: string): string => `${tenant}/${id}`;
  let rowNumber = 100, uuidNumber = 500, createNumber = 0, ownReadFaultUsed = false, cleanupFaultUsed = false;
  const definition = () => ({ id: uuid(50), name: 'CliQaAuthorizationRow', slug: 'cli-qa-authorization-row', status: 'published',
    schemaVersion: 1, storageBackend: 'postgresql', properties: [
      { name: 'qaNonce', type: 'text', required: true }, { name: 'label', type: 'text', required: true },
      { name: 'status', type: 'select', options: [{ value: 'draft', label: 'Draft' }] },
      { name: 'count', type: 'number' }, { name: 'enabled', type: 'boolean' },
      { name: 'payload', type: 'json' },
    ] });
  const execute = (_cli: string, args: string[], options: { env: Record<string, string>; cwd: string }) => {
    expect(args[0]).toBe('--profile');
    const profile = args[1], command = args.slice(2), actors: Array<[Slot | 'owner', Actor]> =
      [['owner', foundation.owner], ...slots.map(slot => [slot, foundation.actors[slot]] as [Slot, Actor])];
    const actorEntry = actors.find(([, current]) => current.profile === profile);
    if (!actorEntry) throw new Error('Unexpected unnamed profile');
    const [slot, current] = actorEntry;
    const flag = (name: string): string | undefined => command.includes(name) ? command[command.indexOf(name) + 1] : undefined;
    if (command[0] === 'whoami') return { status: 0, stdout: `PublicAPI: ${foundation.publicApiUrl}`, stderr: '' };
    expect(command[0]).toBe('publicapi');
    const method = command[1].toUpperCase(), path = command[2], tenantId = flag('--tenant-id')!;
    expect(options.env.EAI_TENANT_ID).toBe(tenantId); expect(options.env.EAI_PROFILE).toBe(profile);
    expect(options.env.BASE_URL_PUBLIC_API).toBe(foundation.publicApiUrl);
    expect(options.env.ENTRA_CLIENT_SECRET).toBeUndefined(); expect(options.env.PUBLICAPI_TOKEN).toBeUndefined();
    const data = flag('--data') ? JSON.parse(flag('--data')!) as Record<string, unknown> : undefined;
    calls.push({ slot, method, path, tenantId, data });
    if (existsSync(output)) checkpoints.push(JSON.parse(readFileSync(output, 'utf8')));
    const wire = (httpStatus: number, body: unknown, exit = httpStatus < 400 ? 0 : 1, includeRequest = true) => ({
      status: exit, stderr: 'Private provider text is never stored in evidence.',
      stdout: JSON.stringify({ ok: httpStatus < 400, status: httpStatus,
        ...(includeRequest ? { request: { method, path, tenantId, publicApiUrl: foundation.publicApiUrl } } : {}),
        ...(httpStatus < 400 ? { body } : { error: { code: 'CONTROLLED_RESPONSE', message: 'Controlled response' } }) }),
    });
    if (path === '/v4/identity/me') {
      if (faults.baseline === 'admin-context-only' && slot !== 'owner') return { status: 1,
        stdout: JSON.stringify({ ok: false, error: { message: 'No active workspace admin memberships found for the current login.' } }), stderr: '' };
      return wire(200, { oid: faults.baseline === 'wrong-oid' ? uuid(99) : current.oid, email: current.email });
    }
    if (path.endsWith('/management')) {
      const id = path.split('/')[4], workspace = id === uuid(30) ? foundation.workspaces.a : foundation.workspaces.b;
      return wire(200, { id, slug: workspace.slug, parentTenantId: faults.baseline === 'wrong-parent' ? uuid(99) : foundation.parentTenantId });
    }
    if (path === '/v4/identity/tenants') {
      const tenants = [{ id: tenantId }];
      if (faults.baseline === 'sibling-access') tenants.push({ id: tenantId === uuid(30) ? uuid(31) : uuid(30) });
      return wire(200, { tenants, totalCount: tenants.length, superAdmin: faults.baseline === 'global' });
    }
    if (path.includes('/memberships?')) {
      const roles = [qa.SLOTS[slot][1]];
      if (faults.baseline === 'builder-admin' && slot === 'builderA') roles.push('tenant-admin');
      if (faults.baseline === 'viewer-builder' && slot === 'viewerA') roles.push('tenant-builder');
      return wire(200, { tenants: [{ id: tenantId, isActive: true, roles }] });
    }
    if (path.startsWith('/v4/data/resources/schema/')) {
      const type = definition();
      if (faults.schema === 'required') type.properties.push({ name: 'requiredExtra', type: 'text', required: true });
      if (faults.schema === 'nonce-type') type.properties[0].type = 'number';
      if (faults.schema === 'wrong-data-type') type.properties[3].type = 'text';
      const types = faults.schema === 'missing-b' && tenantId === uuid(31) ? [] : [type];
      if (faults.schema === 'duplicate') types.push(type);
      return wire(200, { tenant_id: faults.schema === 'wrong-tenant' ? uuid(99) : tenantId, object_types: types,
        dropped_types: faults.schema === 'dropped' ? [{ slug: type.slug, error: 'Controlled dropped type' }] : [], generated_at: timestamp },
      0, faults.schema !== 'wrong-request');
    }
    const match = /^\/v4\/data\/resources\/([^/]+)\/cli-qa-authorization-row(?:\/([^/]+))?$/.exec(path);
    if (!match) throw new Error('Unexpected controlled PublicAPI route');
    expect(match[1]).toBe(tenantId);
    expect(slot).not.toBe('owner');
    const ownTenant = foundation.workspaces[qa.SLOTS[slot][0]].id;
    if (ownTenant !== tenantId) return wire(faults.siblingStatus || 403, {});
    if (method === 'POST') {
      createNumber++;
      expect(['adminA', 'builderA', 'adminB', 'builderB']).toContain(slot);
      expect(Object.keys(data!).sort()).toEqual(['data', 'idempotencyKey']);
      expect(data).not.toHaveProperty('id'); expect(data!.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
      const dto: ResourceDTO = { id: uuid(++rowNumber), tenant_id: tenantId, object_type: 'cli-qa-authorization-row',
        data: data!.data as Record<string, unknown>, version: 1, created_by: current.oid, updated_by: current.oid,
        created_at: timestamp, updated_at: timestamp, idempotentReplay: false };
      rows.set(rowKey(tenantId, dto.id), structuredClone(dto));
      if (createNumber === 1 && faults.create === 'unknown') return { status: 1, stdout: '', stderr: 'Controlled unknown create' };
      const returned = structuredClone(dto);
      if (createNumber === 1 && faults.create === 'foreign-scope') returned.tenant_id = uuid(99);
      if (createNumber === 1 && faults.create === 'missing-nonce') delete returned.data.qaNonce;
      if (createNumber === 1 && faults.create === 'replay') returned.idempotentReplay = true;
      return wire(201, returned, createNumber === 1 && faults.create === 'nonzero-ack' ? 1 : 0);
    }
    const id = match[2], key = rowKey(tenantId, id), row = rows.get(key);
    if (method === 'GET') {
      if (!row) {
        if (!cleanupFaultUsed && faults.cleanup === 'absence403') { cleanupFaultUsed = true; return wire(403, {}); }
        return wire(404, {});
      }
      const dto = structuredClone(row);
      if (!ownReadFaultUsed && faults.ownRead && createNumber === 4) {
        ownReadFaultUsed = true;
        if (faults.ownRead === 'tenant') dto.tenant_id = uuid(99);
        if (faults.ownRead === 'type') dto.object_type = 'foreign-object-type';
        if (faults.ownRead === 'nonce') dto.data.qaNonce = 'foreign-nonce';
        if (faults.ownRead === 'version') dto.version = 9;
      }
      const saved = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {};
      if (!cleanupFaultUsed && faults.cleanup === 'foreign-current' && saved.cleanup?.length) {
        cleanupFaultUsed = true; dto.data.qaNonce = 'foreign-nonce';
      }
      return wire(200, dto);
    }
    if (method === 'PUT') {
      expect(slot).toBe('viewerA'); expect(Object.keys(data!).sort()).toEqual(['data', 'version']); expect(data!.version).toBe(1);
      if (faults.viewerStatus === 200) {
        row!.data = data!.data as Record<string, unknown>; row!.version++;
        return wire(200, row);
      }
      return wire(faults.viewerStatus || 403, {}, faults.viewerExit, faults.viewerRequest !== false);
    }
    if (method === 'DELETE') {
      expect(['adminA', 'adminB']).toContain(slot); expect(row).toBeDefined(); rows.delete(key);
      if (!cleanupFaultUsed && faults.cleanup === 'delete-failed-but-absent') { cleanupFaultUsed = true; return wire(503, {}); }
      if (!cleanupFaultUsed && ['wrong-delete-id', 'delete-not-confirmed', 'delete-no-timestamp'].includes(faults.cleanup || '')) {
        cleanupFaultUsed = true;
        return wire(200, { id: faults.cleanup === 'wrong-delete-id' ? uuid(999) : id,
          deleted: faults.cleanup !== 'delete-not-confirmed', ...(faults.cleanup === 'delete-no-timestamp' ? {} : { deleted_at: timestamp }) });
      }
      return wire(200, { id, deleted: true, deleted_at: timestamp });
    }
    throw new Error('Unexpected controlled method');
  };
  const dependencies = { execute, now: () => Date.parse(timestamp), uuid: () => uuid(++uuidNumber),
    env: { ENTRA_CLIENT_SECRET: 'controlled-unusable-value', PUBLICAPI_TOKEN: 'controlled-unusable-value' },
    candidateEvidence: () => faults.candidateDrift && createNumber > 0 ? { ...candidate, runtimeSha256: 'd'.repeat(64) } : candidate };
  const run = () => probe.runAuthorizationProbe({ foundationPath, cliPath: join(root, 'never-executed-cli.js'), output }, dependencies);
  const failed = () => {
    try { run(); } catch (error) { return (error as Error & { report: any }).report; }
    throw new Error('Expected controlled probe failure');
  };
  return { root, foundationPath, output, foundation, calls, rows, checkpoints, dependencies, run, failed };
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('normal-profile authorization role probe', () => {
  test.each([undefined, null, true, 0, 'false'])('requires an explicitly clean candidate, rejecting dirty=%s before runtime calls', dirty => {
    const fixture = controlled();
    fixture.dependencies.candidateEvidence = () => ({ ...candidate, dirty }) as typeof candidate;
    const report = fixture.failed();
    expect(report.status).toBe('blocked'); expect(report.qualified).toBe(false);
    expect(fixture.calls).toEqual([]); expect(report.created).toEqual([]);
    expect(report.cases.every((row: { status: string }) => row.status === 'not-run')).toBe(true);
  });

  test.each([
    { label: 'clock', dependencies: { now: () => Date.parse(timestamp) }, expected: 'controlled-fixtures' },
    { label: 'ownership UUID', dependencies: { uuid: () => uuid(999) }, expected: 'controlled-fixtures' },
    { label: 'candidate evidence', dependencies: { candidateEvidence: () => ({ ...candidate, dirty: null }) }, expected: 'controlled-fixtures' },
    { label: 'execution', dependencies: { execute: () => { throw new Error('No CLI should execute.'); } }, expected: 'controlled-fixtures' },
    { label: 'unknown override', dependencies: { guard: true }, expected: 'controlled-fixtures' },
    { label: 'explicit undefined override', dependencies: { now: undefined }, expected: 'controlled-fixtures' },
    { label: 'environment and logging only', dependencies: { env: {}, log: () => {} }, expected: 'normal-cli-profiles' },
    { label: 'no overrides', dependencies: {}, expected: 'normal-cli-profiles' },
  ])('records $label overrides honestly without qualifying a failed preflight', ({ dependencies, expected }) => {
    const fixture = controlled(), packageRoot = join(fixture.root, 'unexecuted-candidate');
    mkdirSync(join(packageRoot, 'dist'), { recursive: true }); mkdirSync(join(packageRoot, 'resources'));
    writeFileSync(join(packageRoot, 'dist', 'index.js'), 'throw new Error("Do not execute this candidate");\n');
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: '3.19.2', gitHead: candidate.gitSha }));
    let report: any;
    try { probe.runAuthorizationProbe({ foundationPath: fixture.foundationPath,
      cliPath: join(packageRoot, 'dist', 'index.js'), output: fixture.output }, dependencies); }
    catch (error) { report = (error as Error & { report: unknown }).report; }
    expect(report).toBeDefined(); expect(report.qualification).toBe(expected); expect(report.qualified).toBe(false);
    expect(report.status).toBe('blocked'); expect(report.created).toEqual([]); expect(fixture.calls).toEqual([]);
  });

  test('covers all 15 exact role cases on real shaped wire fixtures and cleans only acknowledged rows', () => {
    const fixture = controlled(); const before = readFileSync(fixture.foundationPath, 'utf8'); const report = fixture.run();
    expect(report.cases.map((row: { name: string }) => row.name)).toEqual(qa.ROLE_CASES);
    expect(report.cases).toHaveLength(15); expect(report.cases.every((row: { status: string }) => row.status === 'passed')).toBe(true);
    expect(report.foundationVerified).toBe(true); expect(report.status).toBe('passed');
    expect(report.qualification).toBe('controlled-fixtures'); expect(report.qualified).toBe(false);
    expect(report.cleanupVerified).toBe(true); expect(report.cleanup).toHaveLength(4); expect(report.leftovers).toEqual([]);
    expect(fixture.rows.size).toBe(0); expect(report.created.every((row: { phase: string }) => row.phase === 'absent')).toBe(true);
    expect(fixture.calls.filter(row => row.method === 'POST').map(row => row.slot)).toEqual(['adminA', 'builderA', 'adminB', 'builderB']);
    expect(fixture.calls.filter(row => row.method === 'DELETE').map(row => row.slot)).toEqual(['adminA', 'adminA', 'adminB', 'adminB']);
    expect(report.cleanup.every((row: any) => row.deleteHttpStatus === 200 && row.absenceHttpStatus === 404)).toBe(true);
    expect(report.candidate).toEqual(candidate); expect(report.probeSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.foundationSourceSha256).toMatch(/^[a-f0-9]{64}$/); expect(readFileSync(fixture.foundationPath, 'utf8')).toBe(before);
    expect(statSync(fixture.output).mode & 0o777).toBe(0o600); expect(existsSync(fixture.foundationPath + '.lease')).toBe(false);
    expect(readFileSync(fixture.output, 'utf8')).not.toContain('Private provider text');
    expect(fixture.checkpoints.some(row => (row.created as any[])?.some(entry => entry.phase === 'acknowledged' && entry.resourceId))).toBe(true);
  });

  test.each([401, 500, 503])('viewer PUT %s is failure rather than authorization denial', viewerStatus => {
    const fixture = controlled({ viewerStatus }); const report = fixture.failed();
    expect(report.cases.find((row: any) => row.name === 'viewerA:write-denied')).toMatchObject({ status: 'failed', httpStatus: viewerStatus });
    expect(report.qualified).toBe(false); expect(report.cleanupVerified).toBe(true); expect(fixture.rows.size).toBe(0);
    expect(report.cases).toHaveLength(15);
  });
  test.each([403, 404])('authenticated exact %s response establishes the viewer and sibling denial cases', status => {
    const fixture = controlled({ viewerStatus: status, siblingStatus: status }); const report = fixture.run();
    expect(report.cases.filter((row: any) => row.name.endsWith('-denied')).every((row: any) => row.status === 'passed' && row.httpStatus === status)).toBe(true);
  });
  test.each([{ viewerExit: 0 }, { viewerRequest: false }])('a 403 without failed-exit/exact request evidence cannot pass: %j', fault => {
    const fixture = controlled(fault); const report = fixture.failed();
    expect(report.cases.find((row: any) => row.name === 'viewerA:write-denied').status).toBe('failed'); expect(report.cleanupVerified).toBe(true);
  });
  test('unexpected allowed viewer update fails the role check and still cleans the exact owned changed nonce', () => {
    const fixture = controlled({ viewerStatus: 200 }); const report = fixture.failed();
    expect(report.cases.find((row: any) => row.name === 'viewerA:write-denied')).toMatchObject({ status: 'failed', httpStatus: 200 });
    expect(report.cleanupVerified).toBe(true); expect(fixture.rows.size).toBe(0);
  });
  test.each([401, 500, 503])('sibling %s responses cannot masquerade as tenant isolation', siblingStatus => {
    const fixture = controlled({ siblingStatus }); const report = fixture.failed();
    expect(report.cases.filter((row: any) => row.name.endsWith(':sibling-denied')).every((row: any) => row.status === 'failed')).toBe(true);
    expect(report.cleanupVerified).toBe(true);
  });
  test.each(['tenant', 'type', 'nonce', 'version'] as const)('wrong %s in an allowed DTO fails, with independent cleanup', ownRead => {
    const fixture = controlled({ ownRead }); const report = fixture.failed();
    expect(report.cases.find((row: any) => row.name === 'adminA:read').status).toBe('failed');
    expect(report.cleanupVerified).toBe(true); expect(fixture.rows.size).toBe(0);
  });
});

describe('role probe fixture and authority preflight', () => {
  test.each(['global', 'wrong-oid', 'builder-admin', 'viewer-builder', 'sibling-access', 'wrong-parent', 'admin-context-only'] as const)('rejects %s before any row mutation', baseline => {
    const fixture = controlled({ baseline }); const report = fixture.failed();
    expect(report.status).toBe('blocked'); expect(report.foundationVerified).toBe(false); expect(report.qualified).toBe(false);
    expect(fixture.calls.some(row => row.method !== 'GET')).toBe(false); expect(report.created).toEqual([]);
    expect(report.cases.every((row: any) => row.status === 'not-run')).toBe(true);
  });
  test.each(['missing-b', 'wrong-tenant', 'wrong-request', 'duplicate', 'required', 'nonce-type', 'wrong-data-type', 'dropped'] as const)('requires real published fixture compatibility in both siblings: %s', schema => {
    const fixture = controlled({ schema }); const report = fixture.failed();
    expect(report.status).toBe('blocked'); expect(report.foundationVerified).toBe(false);
    expect(fixture.calls.some(row => row.method === 'POST')).toBe(false); expect(report.cases.every((row: any) => row.status === 'not-run')).toBe(true);
  });
  test.each(['missing', 'foreign-type', 'caller-nonce', 'unprepared'])('a %s foundation/binding cannot prove authorization', mode => {
    const fixture = controlled();
    if (mode === 'missing') delete fixture.foundation.bindings.authorization;
    if (mode === 'foreign-type') fixture.foundation.bindings.authorization.objectType = 'customer-row';
    if (mode === 'caller-nonce') fixture.foundation.bindings.authorization.data.qaNonce = 'adopted-value';
    if (mode === 'unprepared') fixture.foundation.state = 'partial';
    qa.writePrivate(fixture.foundationPath, fixture.foundation); const report = fixture.failed();
    expect(report.status).toBe('blocked'); expect(report.qualified).toBe(false); expect(fixture.calls).toHaveLength(0);
  });
  test('cannot overwrite a previous probe journal or enter an existing foundation lease', () => {
    const fixture = controlled(); qa.writePrivate(fixture.output, { prior: 'retained' });
    expect(fixture.run).toThrow('new private evidence'); expect(JSON.parse(readFileSync(fixture.output, 'utf8'))).toEqual({ prior: 'retained' });
    rmSync(fixture.output); writeFileSync(fixture.foundationPath + '.lease', 'existing owner', { mode: 0o600 });
    expect(fixture.run).toThrow('leased'); expect(fixture.calls).toHaveLength(0);
    expect(readFileSync(fixture.foundationPath + '.lease', 'utf8')).toBe('existing owner');
  });
  test('a JSON exponent that parses to Infinity is rejected before any row write', () => {
    const fixture = controlled(); fixture.foundation.bindings.authorization.data.payload = { score: 0 };
    qa.writePrivate(fixture.foundationPath, fixture.foundation);
    writeFileSync(fixture.foundationPath, readFileSync(fixture.foundationPath, 'utf8').replace('"score": 0', '"score": 1e999'), { mode: 0o600 });
    const report = fixture.failed(); expect(report.status).toBe('blocked');
    expect(fixture.calls.some(row => row.method === 'POST')).toBe(false); expect(report.created).toEqual([]);
  });
  test('unbounded nested JSON fixture data cannot dispatch a row mutation', () => {
    const fixture = controlled(); let data: unknown = 'synthetic';
    for (let index = 0; index < 25; index++) data = { nested: data };
    fixture.foundation.bindings.authorization.data.payload = data; qa.writePrivate(fixture.foundationPath, fixture.foundation);
    const report = fixture.failed(); expect(report.status).toBe('blocked'); expect(fixture.calls.some(row => row.method === 'POST')).toBe(false);
  });
});

describe('incremental acknowledgment and independent cleanup', () => {
  test('journals a valid returned ID before checking a nonzero create exit, then deletes that exact row', () => {
    const fixture = controlled({ create: 'nonzero-ack' }); const report = fixture.failed();
    expect(report.created).toHaveLength(1); expect(report.created[0].resourceId).toBe(uuid(101));
    expect(report.cases[1]).toMatchObject({ name: 'adminA:write', status: 'failed', httpStatus: 201 });
    expect(fixture.checkpoints.some(row => (row.created as any[])?.[0]?.phase === 'acknowledged')).toBe(true);
    expect(report.cleanupVerified).toBe(true); expect(fixture.rows.size).toBe(0);
    expect(fixture.calls.filter(row => row.method === 'POST')).toHaveLength(1);
  });
  test.each(['unknown', 'foreign-scope', 'missing-nonce'] as const)('records %s creation as an unresolved leftover without retry or guessed-ID delete', create => {
    const fixture = controlled({ create }); const report = fixture.failed();
    expect(report.cleanupVerified).toBe(false); expect(report.leftovers).toHaveLength(1); expect(report.created[0].phase).toBe('outcome-unknown');
    expect(fixture.calls.filter(row => row.method === 'POST')).toHaveLength(1); expect(fixture.calls.filter(row => row.method === 'DELETE')).toHaveLength(0);
    expect(fixture.rows.size).toBe(1); if (create !== 'unknown') expect(report.created[0].resourceId).toBe(uuid(101));
  });
  test('an unexpected idempotent replay cannot pass creation even with successful cleanup', () => {
    const fixture = controlled({ create: 'replay' }); const report = fixture.failed();
    expect(report.cases[1].status).toBe('failed'); expect(report.cleanupVerified).toBe(true); expect(fixture.rows.size).toBe(0);
  });
  test('a failed DELETE is retained even when a later GET is 404, and other rows still clean up', () => {
    const fixture = controlled({ cleanup: 'delete-failed-but-absent' }); const report = fixture.failed();
    expect(report.cleanup[0]).toMatchObject({ status: 'unverified', deleteAcknowledged: false, absenceVerified: true });
    expect(report.cleanup.slice(1).every((row: any) => row.status === 'passed')).toBe(true);
    expect(report.cleanupVerified).toBe(false); expect(report.leftovers).toHaveLength(1); expect(fixture.rows.size).toBe(0);
    expect(fixture.calls.filter(row => row.method === 'DELETE')).toHaveLength(4);
  });
  test.each(['wrong-delete-id', 'delete-not-confirmed', 'delete-no-timestamp'] as const)('an incomplete %s DELETE receipt cannot certify cleanup from HTTP 200 alone', cleanup => {
    const fixture = controlled({ cleanup }); const report = fixture.failed();
    expect(report.cleanup[0]).toMatchObject({ status: 'unverified', deleteAcknowledged: false, absenceVerified: true });
    expect(report.cleanupVerified).toBe(false); expect(report.cleanup.slice(1).every((row: any) => row.status === 'passed')).toBe(true);
    expect(fixture.calls.filter(row => row.method === 'DELETE')).toHaveLength(4);
    expect(fixture.calls.some(row => row.path.endsWith(uuid(999)))).toBe(false);
  });
  test('GET 403 after successful DELETE is not absence, while subsequent rows continue', () => {
    const fixture = controlled({ cleanup: 'absence403' }); const report = fixture.failed();
    expect(report.cleanup[0]).toMatchObject({ deleteAcknowledged: true, absenceVerified: false, absenceHttpStatus: 403 });
    expect(report.cleanupVerified).toBe(false); expect(report.cleanup.slice(1).every((row: any) => row.status === 'passed')).toBe(true);
  });
  test('fresh cleanup nonce mismatch cannot authorize deletion of that row', () => {
    const fixture = controlled({ cleanup: 'foreign-current' }); const report = fixture.failed();
    expect(report.cleanupVerified).toBe(false); expect(report.cleanup[0].deleteAcknowledged).toBe(false);
    expect(fixture.calls.filter(row => row.method === 'DELETE')).toHaveLength(3); expect(fixture.rows.size).toBe(1);
  });
  test('changed candidate stops new dispatches and prevents cleanup through an unqualified binary', () => {
    const fixture = controlled({ candidateDrift: true }); const report = fixture.failed();
    expect(report.qualified).toBe(false); expect(fixture.calls.filter(row => row.method === 'POST')).toHaveLength(1);
    expect(fixture.calls.filter(row => row.method === 'DELETE')).toHaveLength(0); expect(report.leftovers).toHaveLength(1);
    expect(report.created[1].phase).toBe('not-dispatched'); expect(report.cleanup[1].status).toBe('not-needed');
  });
});

describe('explicit authorization probe entry point', () => {
  test('requires exactly the three opt-in paths with no implicit live action', () => {
    expect(probe.parseArguments(['--foundation', './foundation.json', '--cli', './dist/index.js', '--output', './evidence.json']))
      .toEqual({ foundationPath: resolve('foundation.json'), cliPath: resolve('dist/index.js'), output: resolve('evidence.json') });
    for (const args of [[], ['--foundation', 'f'], ['--foundation', 'f', '--cli', 'c', '--foundation', 'o'],
      ['--foundation', 'f', '--cli', 'c', '--apply', 'o']]) expect(() => probe.parseArguments(args)).toThrow();
  });
});
