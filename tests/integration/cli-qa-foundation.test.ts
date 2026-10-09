import { createRequire } from 'node:module';
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const qa = require('../../scripts/cli-qa-foundation.cjs');
const uuid = (number: number): string => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const directories: string[] = [];
function fixtureSpec() {
  const actor = (number: number) => ({ oid: uuid(number), email: `qa-${number}@example.invalid`, profile: `qa-${number}` });
  return { environment: 'DEV', region: 'au', parentTenantId: uuid(1), owner: actor(2),
    actors: Object.fromEntries(Object.keys(qa.SLOTS).map((slot, index) => [slot, actor(index + 3)])),
    workspaces: { a: { name: 'CLI QA A', slug: 'eai-cli-qa-a' }, b: { name: 'CLI QA B', slug: 'eai-cli-qa-b' } }, bindings: {} };
}
function privateFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-qa-foundation-'))); directories.push(root);
  const path = join(root, 'foundation.json'); const foundation = qa.initialize(fixtureSpec(), () => uuid(20));
  qa.writePrivate(path, foundation); return { root, path, foundation };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('retained CLI QA foundation authority', () => {
  test('initialization is a plan with distinct actors and no adopted tenant', () => {
    const value = qa.initialize(fixtureSpec(), () => uuid(20));
    expect(value.state).toBe('unprepared'); expect(value.workspaces.a.id).toBeNull();
    expect(Object.keys(value.actors)).toEqual(['adminA', 'builderA', 'viewerA', 'adminB', 'builderB']);
    expect(qa.publicApi('TEST', 'eu')).toBe('https://test-api.eu.myenterprise.ai/public');
  });
  test.each(['PROD', 'production', 'local'])('rejects environment %s', environment => {
    expect(() => qa.initialize({ ...fixtureSpec(), environment })).toThrow('DEV or TEST');
  });
  test('rejects DEV in another region and environment/gateway disagreement', () => {
    expect(() => qa.initialize({ ...fixtureSpec(), region: 'eu' })).toThrow('AU only');
    expect(() => qa.validateFoundation({ ...qa.initialize(fixtureSpec()), publicApiUrl: 'https://api.au.myenterprise.ai/public' })).toThrow('gateway');
  });
  test.each(['oid', 'profile', 'email'])('rejects repeated %s and operator impersonation', field => {
    const spec = fixtureSpec(); spec.actors.viewerA[field] = spec.owner[field];
    expect(() => qa.initialize(spec)).toThrow('distinct');
  });
  test('rejects foreign tenant binding and credential values', () => {
    const foundation = qa.initialize(fixtureSpec());
    expect(() => qa.validateFoundation({ ...foundation, bindings: { provider: { workspaceSlot: 'a', tenantId: uuid(90) } } })).toThrow('tenant');
    expect(() => qa.validateFoundation({ ...foundation, bindings: { provider: { workspaceSlot: 'a', token: 'fixture-token' } } })).toThrow('never credentials');
  });
  test('never adopts pre-existing children during initialization', () => {
    const spec = fixtureSpec(); (spec.workspaces.a as Record<string, unknown>).id = uuid(99);
    expect(() => qa.initialize(spec)).toThrow('cannot adopt');
  });
});

describe('private foundation and exclusive lease', () => {
  test('atomic updates preserve private permissions and release the lease on failure', () => {
    const { path, foundation } = privateFixture();
    expect(() => qa.withLease(path, () => { throw new Error('fixture failure'); })).toThrow('fixture failure');
    expect(existsSync(path + '.lease')).toBe(false);
    qa.writePrivate(path, { ...foundation, state: 'partial' });
    expect(qa.readPrivate(path).state).toBe('partial');
  });
  test('a second lease cannot dispatch mutations or remove the first lease', () => {
    const { path } = privateFixture(); writeFileSync(path + '.lease', 'owned fixture', { mode: 0o600 });
    let ran = false;
    expect(() => qa.withLease(path, () => { ran = true; })).toThrow('leased');
    expect(ran).toBe(false); expect(readFileSync(path + '.lease', 'utf8')).toBe('owned fixture');
  });
  test('rejects public-readable, linked and hard-linked fixture state', () => {
    const { root, path } = privateFixture();
    chmodSync(path, 0o644); expect(() => qa.readPrivate(path)).toThrow('0600'); chmodSync(path, 0o600);
    const alias = join(root, 'alias.json'); symlinkSync(path, alias); expect(() => qa.readPrivate(alias)).toThrow('0600');
    const hard = join(root, 'hard.json'); linkSync(path, hard); expect(() => qa.writePrivate(path, {})).toThrow('0600');
  });
  test('private markdown updates reject public or linked existing output and preserve its target', () => {
    const { root } = privateFixture(), path = join(root, 'capabilities.md');
    qa.writePrivateText(path, 'owned evidence\n'); expect(readFileSync(path, 'utf8')).toBe('owned evidence\n');
    chmodSync(path, 0o644); expect(() => qa.writePrivateText(path, 'replacement')).toThrow('0600');
    chmodSync(path, 0o600); const link = join(root, 'linked.md'); symlinkSync(path, link);
    expect(() => qa.writePrivateText(link, 'replacement')).toThrow('0600');
    expect(readFileSync(path, 'utf8')).toBe('owned evidence\n');
  });
  test.each(['.env.local', 'eai.config.ts'])('retained context %s cannot overwrite an outside linked file', filename => {
    const { root, foundation } = privateFixture(); let dispatches = 0;
    const contextRoot = join(root, 'contexts'), call = qa.cliCaller('dist/index.js', foundation, contextRoot,
      { env: {}, execute: () => { dispatches++; return { status: 0, stdout: '{}', stderr: '' }; } });
    call(foundation.owner, ['whoami'], foundation.parentTenantId);
    const target = join(root, 'outside.txt'); writeFileSync(target, 'outside sentinel', { mode: 0o600 });
    const path = join(contextRoot, 'context-' + foundation.parentTenantId, filename);
    unlinkSync(path); symlinkSync(target, path);
    expect(() => call(foundation.owner, ['whoami'], foundation.parentTenantId)).toThrow('0600');
    expect(readFileSync(target, 'utf8')).toBe('outside sentinel'); expect(dispatches).toBe(1);
  });
  test('named-profile callers cannot inherit a headless token or foreign app authority', () => {
    const { root, foundation } = privateFixture(); let checked = false;
    const call = qa.cliCaller('dist/index.js', foundation, join(root, 'contexts'), { env: { HOME: '/normal-profile-home',
      EAI_ACCESS_TOKEN: 'foreign-token', EAI_AUTH_TENANT_ID: uuid(99), ENTRA_CLIENT_SECRET: 'foreign-secret', NEXT_PUBLIC_EAI_TENANT_ID: uuid(99) },
      execute: (_cli: string, args: string[], options: { env: Record<string, string> }) => {
        expect(args.slice(0, 2)).toEqual(['--profile', foundation.owner.profile]);
        expect(options.env.HOME).toBe('/normal-profile-home'); expect(options.env.EAI_TENANT_ID).toBe(foundation.parentTenantId);
        for (const key of ['EAI_ACCESS_TOKEN', 'EAI_AUTH_TENANT_ID', 'ENTRA_CLIENT_SECRET', 'NEXT_PUBLIC_EAI_TENANT_ID']) expect(options.env[key]).toBeUndefined();
        checked = true; return { status: 0, stdout: '{}', stderr: '' };
      } });
    call(foundation.owner, ['whoami'], foundation.parentTenantId); expect(checked).toBe(true);
  });
});

describe('normal CLI retained fixture preparation', () => {
  function controlled(mode = 'ok') {
    const { path, foundation } = privateFixture(); const calls: string[][] = [];
    const memberships = new Map<string, string>();
    let invitations = 0;
    const execute = (_cli: string, args: string[]) => {
      calls.push(args); const profile = args[1], command = args.slice(2);
      const actor = [foundation.owner, ...Object.values(foundation.actors) as Array<{ profile: string; oid: string; email: string }>].find(item => item.profile === profile)!;
      const output = (body: unknown, status = 0) => ({ status, stdout: JSON.stringify(body), stderr: '' });
      const body = (value: unknown) => output({ ok: true, status: 200, body: value });
      const selected = (flag: string) => command[command.indexOf(flag) + 1];
      if (command[0] === 'whoami') return { status: 0, stdout: 'PublicAPI: ' + foundation.publicApiUrl, stderr: '' };
      if (command[0] === 'publicapi' && command[1] === 'get') {
        const route = command[2];
        if (route === '/v4/identity/me') return body({ oid: actor.oid, email: actor.email });
        if (route.includes('/management')) {
          const tenantId = route.split('/')[4]; const slot = tenantId === uuid(30) ? 'a' : 'b';
          return body({ id: tenantId, slug: foundation.workspaces[slot].slug, parentTenantId: foundation.parentTenantId });
        }
        if (route === '/v4/identity/tenants') {
          const tenantId = selected('--tenant-id');
          return body({ tenants: [{ id: tenantId }], totalCount: 1, superAdmin: mode === 'global-actor' });
        }
        if (route.includes('/memberships?')) {
          const tenantId = selected('--tenant-id');
          const memberOid = route.split('/')[4];
          if (memberOid !== actor.oid) return output({ ok: false, status: 403, body: { error: 'FORBIDDEN' } }, 1);
          const member = { id: tenantId, isActive: mode !== 'inactive-member',
            roles: [tenantId === foundation.parentTenantId ? 'tenant-admin' : memberships.get(memberOid),
              ...(mode === 'extra-role' && tenantId !== foundation.parentTenantId ? ['system-admin'] : [])] };
          return body({ tenants: mode === 'duplicate-member' && tenantId !== foundation.parentTenantId ? [member, member] : [member] });
        }
      }
      if (command[0] === 'publicapi' && command[1] === 'post') return body({ outcome: mode === 'no-entitlement' ? 'deny' : 'allow' });
      if (command[0] === 'workspace' && command[1] === 'create') {
        if (mode === 'unknown-create') return { status: 1, stdout: '', stderr: 'fixture timeout' };
        const slot = selected('--slug').endsWith('-a') ? 'a' : 'b';
        return output({ tenant: { id: slot === 'a' ? uuid(30) : uuid(31), slug: foundation.workspaces[slot].slug,
          parentTenantId: mode === 'foreign-create' ? uuid(99) : foundation.parentTenantId, reused: false } }, mode === 'ack-before-failure' ? 1 : 0);
      }
      if (command[0] === 'workspace' && command[1] === 'bootstrap-admin') {
        if (selected('--user-oid') !== foundation.owner.oid) return output({ error: 'CHILD_ALREADY_HAS_ADMIN' }, 1);
        return output({ parentTenantId: selected('--parent'), childTenantId: selected('--child'), userOid: selected('--user-oid'),
          usable: true, membershipCreated: false, adminAssigned: false, status: 'already-usable' });
      }
      if (command[0] === 'user' && command[1] === 'invite') {
        invitations++;
        const invited = Object.values(foundation.actors).find((item: any) => item.email === selected('--email')) as { oid: string };
        if (mode !== 'unknown-invite') memberships.set(invited.oid, selected('--role'));
        if (mode === 'unknown-invite' || (mode === 'lost-invite-ack' && invitations === 1)) return { status: 1, stdout: '', stderr: 'fixture timeout' };
        return output({ status: 'invited', email: selected('--email'), role: selected('--role'),
          userId: mode === 'unexpected-user' ? uuid(99) : invited.oid, inviteMode: 'existing_user_reused' });
      }
      throw new Error('Unexpected controlled CLI dispatch: ' + command.slice(0, 3).join(' '));
    };
    return { path, calls, execute };
  }
  test('prepares exactly two owned siblings and five existing actors, retaining the baseline', () => {
    const fixture = controlled();
    const report = qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute });
    expect(report.state).toBe('verified'); expect(report.authorizationVerified).toBe(false);
    expect(fixture.calls.filter(args => args.includes('create'))).toHaveLength(2);
    expect(fixture.calls.filter(args => args.includes('bootstrap-admin')).every(args => args[args.indexOf('--user-oid') + 1] === uuid(2))).toBe(true);
    expect(fixture.calls.filter(args => args.includes('invite'))).toHaveLength(5);
    expect(fixture.calls.some(args => args.includes('delete'))).toBe(false);
    expect(qa.readPrivate(fixture.path).workspaces.a.id).toBe(uuid(30));
    qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute });
    expect(fixture.calls.filter(args => args.includes('create'))).toHaveLength(2);
    expect(fixture.calls.filter(args => args.includes('invite'))).toHaveLength(5);
    expect(fixture.calls.filter(args => args.some(arg => arg.includes('/memberships?')))
      .every(args => args[4].includes(`/users/${uuid(Number(args[1].split('-')[1]))}/memberships?`))).toBe(true);
  });
  test('entitlement denial blocks before the first workspace write', () => {
    const fixture = controlled('no-entitlement');
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow('entitlement');
    expect(fixture.calls.some(args => args.includes('create'))).toBe(false);
  });
  test('unknown creation stays journaled and is never automatically retried', () => {
    const fixture = controlled('unknown-create');
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow('creation');
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow('unresolved');
    expect(fixture.calls.filter(args => args.includes('create'))).toHaveLength(1);
    expect(qa.readPrivate(fixture.path).journal.a.phase).toBe('creating');
  });
  test('acknowledged child ID is saved before a nonzero exit', () => {
    const fixture = controlled('ack-before-failure');
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow('creation');
    expect(qa.readPrivate(fixture.path).workspaces.a.id).toBe(uuid(30));
  });
  test('lost invitation acknowledgment reconciles through the exact actor self-read without replay', () => {
    const fixture = controlled('lost-invite-ack');
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow('Membership setup');
    expect(qa.readPrivate(fixture.path).journal.adminA.phase).toBe('inviting');
    expect(qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute }).state).toBe('verified');
    expect(fixture.calls.filter(args => args.includes('invite'))).toHaveLength(5);
    expect(qa.readPrivate(fixture.path).journal.adminA.reconciledFromFreshMembership).toBe(true);
  });
  test('unknown membership cannot replay invitations or infer ownership from a journal', () => {
    const fixture = controlled('unknown-invite');
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow('Membership setup');
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow('manual reconciliation');
    expect(fixture.calls.filter(args => args.includes('invite'))).toHaveLength(1);
  });
  test.each(['extra-role', 'duplicate-member', 'inactive-member'])('rejects %s as an independent fixture authority', mode => {
    const fixture = controlled(mode);
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow();
    expect(qa.readPrivate(fixture.path).state).not.toBe('verified');
  });
  test.each(['foreign-create', 'unexpected-user', 'global-actor'])('rejects %s without claiming qualification', mode => {
    const fixture = controlled(mode);
    expect(() => qa.prepareFoundation(fixture.path, 'dist/index.js', { execute: fixture.execute })).toThrow();
    expect(qa.readPrivate(fixture.path).state).not.toBe('verified');
  });
});

describe('deployment and authorization evidence integrity', () => {
  const now = Date.parse('2026-10-09T06:00:00Z');
  const context = { environment: 'DEV', publicApiUrl: qa.publicApi('DEV', 'au'), now };
  const deployments = qa.SERVICES.map((service: string) => service === 'CIAM' ? { service, ...context,
    observedAt: new Date(now).toISOString(), source: 'oidc-discovery',
    sourceReference: `https://qa.ciamlogin.com/${uuid(50)}/v2.0/.well-known/openid-configuration`,
    identity: { tenantId: uuid(50), clientId: uuid(51), issuer: `https://qa.ciamlogin.com/${uuid(50)}/v2.0`,
      discoveryUrl: `https://qa.ciamlogin.com/${uuid(50)}/v2.0/.well-known/openid-configuration`, verified: true } }
    : { service, ...context, parity: 'main', mainSha: 'a'.repeat(40), observedSha: 'a'.repeat(40), mainObservedAt: new Date(now).toISOString(),
      observedAt: new Date(now).toISOString(), source: 'revision-endpoint', sourceReference: 'https://example.invalid/revisions/' + service,
      runtime: { sourceSha: 'a'.repeat(40), active: true, ready: true, revision: 'owned-revision', artifactDigest: 'sha256:' + 'b'.repeat(64) },
      selectedRelease: { sourceSha: 'a'.repeat(40), configured: true, status: 'succeeded', kind: 'container', deploymentId: 'owned-deployment', artifactDigest: 'sha256:' + 'b'.repeat(64) } });
  test('requires every service exactly once, the same environment and fresh actual SHA observations', () => {
    expect(qa.deploymentParity(deployments, context)).toBe(true);
    expect(qa.deploymentParity(deployments.slice(1), context)).toBe(false);
    expect(qa.deploymentParity([...deployments, deployments[0]], context)).toBe(false);
    for (const patch of [{ environment: 'TEST' }, { observedSha: 'b'.repeat(40) }, { mainSha: 'synthetic', observedSha: 'synthetic' },
      { observedAt: '2020-01-01' }, { source: 'health-only' }, { sourceReference: '' }]) {
      expect(qa.deploymentParity([{ ...deployments[0], ...patch }, ...deployments.slice(1)], context)).toBe(false);
    }
    expect(qa.deploymentParity([{ ...deployments[0], runtime: { ...deployments[0].runtime, ready: false } }, ...deployments.slice(1)], context)).toBe(false);
    expect(qa.deploymentParity([{ ...deployments[0], selectedRelease: { ...deployments[0].selectedRelease, sourceSha: 'c'.repeat(40) } }, ...deployments.slice(1)], context)).toBe(false);
  });
  test('bare pass flags cannot certify role, isolation or ten-cycle qualification', () => {
    const candidate = { gitSha: 'a'.repeat(40), runtimeSha256: 'b'.repeat(64) };
    expect(qa.authorizationVerified({ authorizationEvidence: { roleMatrix: 'passed', tenantIsolation: 'passed' } }, candidate, context)).toBe(false);
    expect(qa.cyclesVerified({ cycleEvidence: { qualified: true } }, candidate, context)).toBe(false);
  });
});
