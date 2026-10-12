import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { cycleStepModel } from '../helpers/cli-qa-cycle-model.js';
const require = createRequire(import.meta.url);
const qa = require('../../scripts/cli-qa-foundation.cjs');
const cycles = require('../../scripts/qualify-cli-permanent.cjs');
const canonicalExecutionModel = { ...require('../../scripts/cli-qa-build-receipt.cjs').canonicalBuildExecution(),
  exitCode: 0, executablesUnchanged: true };
const selectedGit = require('../../scripts/cli-qa-operational-env.cjs').installedGitExecution();
const gitExecutionModel = { ...selectedGit, executablesUnchanged: true, invocations: [
  ['rev-parse', '--show-toplevel'], ['rev-parse', '--verify', 'HEAD'], ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
  ['ls-files', '--stage', '-z']].map(args => [selectedGit.gitPath, ...args]) };
const uuid = (number: number): string => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const candidate = { gitSha: 'a'.repeat(40), binarySha256: 'b'.repeat(64), runtimeSha256: 'c'.repeat(64),
  runtimeFileCount: 200, version: '3.19.2', dirty: false };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function controlled() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eai-permanent-cycles-'))); roots.push(root);
  const actor = (number: number) => ({ oid: uuid(number), profile: 'qa-' + number, email: `qa-${number}@example.invalid` });
  const foundation = qa.initialize({ environment: 'DEV', region: 'au', parentTenantId: uuid(1), owner: actor(2),
    actors: Object.fromEntries(Object.keys(qa.SLOTS).map((slot, index) => [slot, actor(index + 3)])),
    workspaces: { a: { name: 'QA A', slug: 'eai-cli-qa-a' }, b: { name: 'QA B', slug: 'eai-cli-qa-b' } }, bindings: {} });
  foundation.workspaces.a.id = uuid(30); foundation.workspaces.b.id = uuid(31); foundation.state = 'verified';
  for (const slot of ['a', 'b']) foundation.journal[slot] = { phase: 'created', slug: foundation.workspaces[slot].slug,
    acknowledgment: { fixtureId: foundation.fixtureId, actorId: foundation.owner.oid, tenantId: foundation.workspaces[slot].id,
      slug: foundation.workspaces[slot].slug, parentTenantId: foundation.parentTenantId, newChild: true, exitCode: 0 } };
  const foundationPath = join(root, 'foundation.json'), deploymentsPath = join(root, 'deployments.json');
  const now = Date.parse('2026-10-09T06:00:00Z'); qa.writePrivate(foundationPath, foundation);
  const deploymentContext = { environment: 'DEV', publicApiUrl: foundation.publicApiUrl, observedAt: new Date(now).toISOString() };
  const deployments = qa.SERVICES.map((service: string) => service === 'CIAM' ? { service, ...deploymentContext,
    source: 'oidc-discovery', sourceReference: `https://qa.ciamlogin.com/${uuid(50)}/v2.0/.well-known/openid-configuration`,
    identity: { tenantId: uuid(50), clientId: uuid(51), issuer: `https://qa.ciamlogin.com/${uuid(50)}/v2.0`,
      discoveryUrl: `https://qa.ciamlogin.com/${uuid(50)}/v2.0/.well-known/openid-configuration`, verified: true } }
    : { service, ...deploymentContext, parity: 'main', mainSha: 'd'.repeat(40), observedSha: 'd'.repeat(40), mainObservedAt: new Date(now).toISOString(),
      source: 'revision-endpoint', sourceReference: 'https://example.invalid/revisions/' + service,
      runtime: { sourceSha: 'd'.repeat(40), active: true, ready: true, revision: 'owned-revision', artifactDigest: 'sha256:' + 'e'.repeat(64) },
      selectedRelease: { sourceSha: 'd'.repeat(40), configured: true, status: 'succeeded', kind: 'container', deploymentId: 'owned-deployment', artifactDigest: 'sha256:' + 'e'.repeat(64) } });
  qa.writePrivate(deploymentsPath, deployments);
  const options = { foundationPath, deploymentsPath, cliPath: 'dist/index.js', cleanupPreflight: join(root, 'preflight.json'),
    buildReceiptPath: join(root, 'build.json'), output: join(root, 'summary.json') };
  // Synthetic positive DTO model; the overridden driver still marks all output controlled-fixtures.
  const preflight = { schemaVersion: 'eai.cli-child-cleanup-preflight.v1', publicApiUrl: foundation.publicApiUrl,
    parentTenantId: foundation.workspaces.a.id, actorId: foundation.actors.adminA.oid, observedAt: new Date(now).toISOString(),
    childDeleteRoute: '/v4/platform/tenants/{parent}/children/{child}/delete', childDeleteVerified: true,
    publicApiGitSha: 'd'.repeat(40), adminApiGitSha: 'd'.repeat(40) };
  qa.writePrivate(options.cleanupPreflight, preflight);
  const buildReceipt = { schemaVersion: 'eai.cli-source-build.v1', status: 'passed', qualification: 'normal-build', qualified: true,
    sourceSha: candidate.gitSha, sourceSha256: 'f'.repeat(64), sourceFileCount: 1000,
    sourceFingerprintVersion: 'eai.cli-tracked-source-sha256.v1', sourceUnchanged: true, command: ['npm', 'run', 'build'],
    exitCode: 0, nodeVersion: process.version, observedAt: new Date(now).toISOString(), candidate,
    canonicalExecution: canonicalExecutionModel, gitExecution: gitExecutionModel };
  qa.writePrivate(options.buildReceiptPath, buildReceipt);
  const execute = (_cli: string, args: string[]) => {
    const profile = args[1], command = args.slice(2), scope = command[command.indexOf('--tenant-id') + 1];
    const identities = [foundation.owner, ...Object.values(foundation.actors)] as Array<{ profile: string; oid: string; email: string }>;
    const selected = identities.find(entry => entry.profile === profile)!;
    const body = (value: unknown) => ({ status: 0, stdout: JSON.stringify({ ok: true, status: 200, body: value }), stderr: '' });
    if (command[0] === 'whoami') return { status: 0, stdout: 'PublicAPI: ' + foundation.publicApiUrl, stderr: '' };
    if (command[2] === '/v4/identity/me') return body(selected);
    if (command[2].includes('/management')) return body({ id: command[2].split('/')[4],
      slug: command[2].includes(uuid(30)) ? 'eai-cli-qa-a' : 'eai-cli-qa-b', parentTenantId: uuid(1) });
    if (command[2] === '/v4/identity/tenants') return body({ superAdmin: false, tenants: [{ id: scope }], totalCount: 1 });
    if (command[2].includes('/memberships?')) {
      const slot = Object.keys(qa.SLOTS).find(slot => foundation.actors[slot].profile === profile)!;
      return body({ tenants: [{ id: scope, isActive: true, roles: [qa.SLOTS[slot][1]] }] });
    }
    throw new Error('Unexpected controlled identity read');
  };
  let runs = 0;
  const liveReport = () => {
    const index = ++runs, child = uuid(100 + index), client = uuid(200 + index), enrollment = uuid(300 + index), recreated = uuid(400 + index);
    const appKey = 'eai-e2e-cycle-' + index;
    const steps = cycleStepModel({ tenantId: child, clientId: client, appKey, enrollmentId: enrollment, recreatedEnrollmentId: recreated });
    return { candidate, preflight, fixtureId: foundation.fixtureId,
      foundationParentTenantId: foundation.parentTenantId,
      tenantIds: { a: foundation.workspaces.a.id, b: foundation.workspaces.b.id },
      actors: Object.fromEntries(Object.entries(foundation.actors).map(([slot, actor]) => {
        const identity = actor as { oid: string; profile: string }; return [slot, { oid: identity.oid, profile: identity.profile }];
      })), profile: foundation.actors.adminA.profile, environment: 'DEV', expectedPublicApi: foundation.publicApiUrl,
      parentTenantId: uuid(30), status: 'passed', cleanupVerified: true, leftovers: [],
      created: { appKey, childTenantId: child, runtimeTenantId: child, entraClientId: client, enrollmentId: enrollment, recreatedEnrollmentId: recreated },
      rotationCycle: { clientId: client, tenantId: child, appKey, commandDispatches: 1, credentialChanged: true },
      deletionCycle: { tenantId: child, appKey, enrollmentId: enrollment, recreatedEnrollmentId: recreated,
        deletionVerified: true, firstInventoryEmpty: true, recreatedSameKey: true },
      commands: [...steps.commands].sort((a, b) => a.sequence - b.sequence).map(row => ({ ...row, assertions: row.assertions.map(value => value.name) })),
      assertions: steps.commands.flatMap(row => row.assertions),
      cleanup: [{ artifact: 'entra-registration', status: 'passed', evidence: steps.registration },
        { artifact: 'child-tenant', status: 'passed', evidence: { tenantId: child, parentTenantId: uuid(30), hardPurged: true, absenceVerified: true } }] };
  };
  const dependencies = { now: () => now, env: {}, execute, candidateEvidence: () => candidate,
    runLive: (_cli: string, dependencies: { env: Record<string, string> }) => {
      expect(dependencies.env.EAI_E2E_REQUIRE_FIRST_EMPTY).toBe('1'); expect(dependencies.env.EAI_E2E_RECREATE_AFTER_DELETE).toBe('1');
      expect(dependencies.env.EAI_E2E_PROVISION_ENTRA).toBe('1'); return liveReport();
    } };
  return { root, foundation, options, dependencies, deployments, preflight, buildReceipt, liveReport, runs: () => runs };
}

describe('ten fresh owned CLI rotation/delete/recreate cycles', () => {
  test.each(['a', 'b', 'qa-parent'])('a lifecycle cannot claim retained %s as its fresh child', slot => {
    const fixture = controlled(), report = fixture.liveReport();
    const child = slot === 'qa-parent' ? fixture.foundation.parentTenantId : fixture.foundation.workspaces[slot].id;
    Object.assign(report.created, { childTenantId: child, runtimeTenantId: child });
    report.rotationCycle.tenantId = child; report.deletionCycle.tenantId = child;
    Object.assign(report.cleanup[1].evidence, { tenantId: child });
    expect(cycles.ownedReportValid(report, fixture.foundation, candidate, fixture.preflight)).toBe(false);
  });
  test.each(['publicApiUrl', 'parentTenantId', 'actorId', 'childDeleteVerified'])('runner preflight %s must match the full parent-authorized observation', field => {
    const fixture = controlled(), report = fixture.liveReport();
    report.preflight = { ...report.preflight, [field]: field === 'childDeleteVerified' ? false : 'foreign-context' };
    expect(cycles.ownedReportValid(report, fixture.foundation, candidate, fixture.preflight)).toBe(false);
  });
  test('unbacked runner lifecycle booleans cannot qualify rotation, deletion or recreation', () => {
    const fixture = controlled();
    const runLive = () => { const report = fixture.liveReport();
      Object.assign(report, { assertions: [] });
      for (const row of report.commands) Object.assign(row, { assertions: [] });
      return report; };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    expect(fixture.runs()).toBe(1); expect(qa.readPrivate(fixture.options.output).qualified).toBe(false);
  });
  test.each(['rotation', 'first-delete', 'first-inventory', 'recreation', 'recreated-inventory', 'recreated-delete', 'registration'])
    ('failed underlying %s observation cannot be replaced by runner success flags', step => {
      const fixture = controlled();
      const runLive = () => {
        const report = fixture.liveReport();
        const names: Record<string, string> = { rotation: 'rotation-changed-local-credential', 'first-delete': 'app-deletion-receipt',
          'first-inventory': 'first-app-inventory-empty', recreation: 'new-enrollment-same-key',
          'recreated-inventory': 'recreated-app-first-inventory-empty', 'recreated-delete': 'recreated-app-deletion-receipt',
          registration: 'entra-cleanup-receipt' };
        report.assertions.find(row => row.name === names[step])!.status = 'failed'; return report;
      };
      expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
      expect(fixture.runs()).toBe(1); expect(qa.readPrivate(fixture.options.output).qualified).toBe(false);
    });
  test.each(['legacy', 'foreign-scope', 'order', 'registration-client'])('serialized %s cycle evidence cannot certify retained cycles', failure => {
    const fixture = controlled(), report = fixture.liveReport(), receipt = cycles.cycleReceipt({ ...report, localProjectCleanupVerified: true });
    expect(qa.cycleReceiptVerified(receipt)).toBe(true);
    if (failure === 'legacy') delete receipt.stepEvidence;
    if (failure === 'foreign-scope') receipt.stepEvidence.commands[0].scopeTenantId = uuid(999);
    if (failure === 'order') receipt.stepEvidence.commands[3].sequence = receipt.stepEvidence.commands[2].sequence;
    if (failure === 'registration-client') receipt.stepEvidence.registration.clientId = uuid(998);
    expect(qa.cycleReceiptVerified(receipt)).toBe(false);
  });
  test.each(['fixtureId', 'foundationParentTenantId', 'tenantIds.a', 'tenantIds.b',
    ...Object.keys(qa.SLOTS).flatMap(slot => [`actors.${slot}.oid`, `actors.${slot}.profile`])])(
    'rejects lifecycle evidence from another retained fixture field %s', field => {
      const fixture = controlled();
      const runLive = () => {
        const report = fixture.liveReport();
        const parts = field.split('.'); let target: any = report;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)!] = field.endsWith('profile') ? 'foreign-profile' : uuid(999);
        return report;
      };
      expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
      expect(fixture.runs()).toBe(1);
      expect(qa.readPrivate(fixture.options.output)).toMatchObject({ qualified: false, status: 'failed' });
    });
  test('missing retained-fixture context cannot qualify a lifecycle', () => {
    const fixture = controlled();
    const runLive = () => { const { fixtureId: _fixture, tenantIds: _tenants, actors: _actors, ...report } = fixture.liveReport(); return report; };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    expect(fixture.runs()).toBe(1);
  });
  test('the actual runner retains its explicit fixture context even when identity preflight blocks', () => {
    const fixture = controlled(); const model = fixture.liveReport(); let report: any;
    const expectedFixture = { fixtureId: model.fixtureId, foundationParentTenantId: fixture.foundation.parentTenantId,
      tenantIds: model.tenantIds, actors: model.actors };
    try {
      require('../../scripts/eai-full-e2e-smoke.cjs').runLiveSmoke(fixture.options.cliPath, {
        expectedFixture, env: { EAI_E2E_OUTPUT_ROOT: fixture.root, EAI_E2E_TEST_PROFILE: fixture.foundation.actors.adminA.profile,
          EAI_E2E_TEST_USERNAME: fixture.foundation.actors.adminA.email, EAI_E2E_TEST_USER_OID: fixture.foundation.actors.adminA.oid,
          EAI_E2E_PARENT_TENANT_ID: fixture.foundation.workspaces.a.id, EAI_E2E_EXPECTED_PUBLIC_API: fixture.foundation.publicApiUrl,
          EAI_E2E_CLEANUP_PREFLIGHT: fixture.options.cleanupPreflight },
        execute: () => ({ status: 1, stdout: '', stderr: 'controlled identity denial' }), log: () => {},
      });
    } catch (error) { report = (error as Error & { report: unknown }).report; }
    expect(report).toMatchObject({ ...expectedFixture, status: 'blocked' });
    expect(report.created.childTenantId).toBe('');
  });
  test.each(['profile', 'actor', 'parent'])('the actual runner rejects a %s inconsistent with its retained fixture before any CLI dispatch', mismatch => {
    const fixture = controlled(); const model = fixture.liveReport(); let report: any; let dispatches = 0;
    try {
      require('../../scripts/eai-full-e2e-smoke.cjs').runLiveSmoke(fixture.options.cliPath, {
        expectedFixture: { fixtureId: model.fixtureId, foundationParentTenantId: fixture.foundation.parentTenantId,
          tenantIds: model.tenantIds, actors: model.actors },
        env: { EAI_E2E_OUTPUT_ROOT: fixture.root,
          EAI_E2E_TEST_PROFILE: mismatch === 'profile' ? 'foreign-profile' : fixture.foundation.actors.adminA.profile,
          EAI_E2E_TEST_USERNAME: fixture.foundation.actors.adminA.email,
          EAI_E2E_TEST_USER_OID: mismatch === 'actor' ? uuid(999) : fixture.foundation.actors.adminA.oid,
          EAI_E2E_PARENT_TENANT_ID: mismatch === 'parent' ? uuid(998) : fixture.foundation.workspaces.a.id,
          EAI_E2E_EXPECTED_PUBLIC_API: fixture.foundation.publicApiUrl, EAI_E2E_CLEANUP_PREFLIGHT: fixture.options.cleanupPreflight },
        execute: () => { dispatches++; return { status: 1, stdout: '', stderr: 'controlled identity denial' }; }, log: () => {},
      });
    } catch (error) { report = (error as Error & { report: unknown }).report; }
    expect(report.status).toBe('blocked'); expect(dispatches).toBe(0);
    expect(report.assertions[0]).toMatchObject({ name: 'retained-fixture-context', status: 'blocked' });
    expect(report.created.childTenantId).toBe('');
  });
  test.each(['b', 'qa-parent'])('the actual runner never selects or purges reserved %s returned by create', slot => {
    const fixture = controlled(), model = fixture.liveReport(), parent = fixture.foundation.workspaces.a.id;
    const reserved = slot === 'b' ? fixture.foundation.workspaces.b.id : fixture.foundation.parentTenantId;
    const calls: string[][] = []; let report: any;
    const execute = (_command: string, invocation: string[]) => {
      const args = invocation.slice(2); calls.push(args);
      const ok = (value: unknown) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
      if (args[0] === 'whoami') return { status: 0, stdout: 'PublicAPI: ' + fixture.foundation.publicApiUrl, stderr: '' };
      if (args[0] === 'tenant' && args[1] === 'list') return ok({ tenants: [{ id: parent }] });
      if (args[0] === 'tenant' && args[1] === 'select') return ok({ selected: true });
      if (args[0] === 'tenant' && args[1] === 'info') return ok({ id: parent });
      if (args[0] === 'tenant' && args[1] === 'create') return ok({ tenant: { id: reserved,
        slug: args[args.indexOf('--slug') + 1], parentTenantId: parent } });
      if (args[2] === '/v4/identity/me') return ok({ ok: true, status: 200, body: fixture.foundation.actors.adminA });
      if (args[2]?.endsWith('/management')) return ok({ ok: true, status: 200, body: { id: parent } });
      if (args[2]?.includes('/memberships?')) return ok({ ok: true, status: 200, body: { tenants: [{ id: parent, roles: ['tenant-admin'] }] } });
      if (args[2] === '/v4/platform/capabilities/evaluate') return ok({ ok: true, status: 200, body: { outcome: 'allow', reasonCode: 'subscription_active' } });
      throw new Error('No other simulated backend operation is permitted.');
    };
    try { require('../../scripts/eai-full-e2e-smoke.cjs').runLiveSmoke(fixture.options.cliPath, {
      expectedFixture: { fixtureId: model.fixtureId, foundationParentTenantId: fixture.foundation.parentTenantId,
        tenantIds: model.tenantIds, actors: model.actors }, now: fixture.dependencies.now, execute, log: () => {},
      env: { EAI_E2E_OUTPUT_ROOT: fixture.root, EAI_E2E_TEST_PROFILE: fixture.foundation.actors.adminA.profile,
        EAI_E2E_TEST_USERNAME: fixture.foundation.actors.adminA.email, EAI_E2E_TEST_USER_OID: fixture.foundation.actors.adminA.oid,
        EAI_E2E_PARENT_TENANT_ID: parent, EAI_E2E_EXPECTED_PUBLIC_API: fixture.foundation.publicApiUrl,
        EAI_E2E_CLEANUP_PREFLIGHT: fixture.options.cleanupPreflight },
    }); } catch (error) { report = (error as Error & { report: unknown }).report; }
    expect(calls.filter(args => args[0] === 'tenant' && args[1] === 'create')).toHaveLength(1);
    expect(report.created.childTenantId).toBe(''); expect(report.cleanupVerified).toBe(false);
    expect(calls.some(args => args[0] === 'tenant' && ['select', 'delete', 'bootstrap-admin'].includes(args[1]) && args.includes(reserved))).toBe(false);
    expect(report.preflight).toMatchObject(fixture.preflight);
  });
  test('controller cleanup failure cannot retain a runner local-cleanup success claim', () => {
    const fixture = controlled();
    const runLive = (_cli: string, options: { env: Record<string, string> }) => {
      writeFileSync(join(options.env.EAI_E2E_OUTPUT_ROOT, 'unexpected-output'), 'synthetic-control');
      return { ...fixture.liveReport(), localProjectCleanupVerified: true };
    };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow('qualification stopped');
    const report = qa.readPrivate(fixture.options.output);
    expect(report.status).toBe('failed'); expect(report.qualified).toBe(false); expect(report.cycles).toHaveLength(1);
    expect(report.cycles[0].localProjectCleanupVerified).toBe(false);
  });
  test.each(['dirty', 'version', 'runtimeFileCount', 'missing-count'])('a runner with mismatched %s cannot contribute a successful cycle', field => {
    const fixture = controlled();
    const runLive = () => { const report = fixture.liveReport(); report.candidate = { ...candidate,
      ...(field === 'dirty' ? { dirty: true } : field === 'version' ? { version: '99.0.0' }
        : { runtimeFileCount: field === 'missing-count' ? undefined : candidate.runtimeFileCount + 1 }) } as typeof candidate;
      return report; };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    const report = qa.readPrivate(fixture.options.output); expect(report.qualified).toBe(false); expect(report.cycles).toHaveLength(1);
    expect(report.cycles[0].status).toBe('failed'); expect(report.cycles[0].localProjectCleanupVerified).toBe(true);
  });
  test.each(['throw-before-report', 'throw-primitive', 'summary-without-report'])('retains a sanitized failed attempt for %s', failure => {
    const fixture = controlled(); let dispatches = 0;
    const runLive = () => { dispatches++;
      if (failure === 'throw-primitive') throw 'synthetic-private-provider-marker';
      throw Object.assign(new Error('synthetic-private-provider-marker'), failure === 'summary-without-report'
        ? { summaryPath: join(fixture.root, 'untrusted-summary.json') } : {});
    };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow('qualification stopped');
    const report = qa.readPrivate(fixture.options.output);
    expect(dispatches).toBe(1); expect(report.status).toBe('failed'); expect(report.qualified).toBe(false);
    expect(report.cycles).toHaveLength(1); expect(report.cycles[0]).toMatchObject({ cycleNumber: 1, status: 'failed',
      runnerReportAvailable: false, cleanupVerified: false, localProjectCleanupVerified: true });
    expect(report.cycles[0]).not.toHaveProperty('clientId'); expect(report.cycles[0]).not.toHaveProperty('summaryPath');
    expect(readFileSync(fixture.options.output, 'utf8')).not.toContain('synthetic-private-provider-marker');
  });
  test.each(['missing-deployments', 'malformed-deployments', 'public-deployments', 'candidate-read'])('retains %s preflight failure in a blocked summary', failure => {
    const fixture = controlled();
    if (failure === 'missing-deployments') rmSync(fixture.options.deploymentsPath);
    if (failure === 'malformed-deployments') writeFileSync(fixture.options.deploymentsPath, '{broken', { mode: 0o600 });
    if (failure === 'public-deployments') {
      const fs = require('node:fs'); fs.chmodSync(fixture.options.deploymentsPath, 0o644);
    }
    const dependencies = failure === 'candidate-read' ? { ...fixture.dependencies,
      candidateEvidence: () => { throw new Error('Synthetic unreadable candidate'); } } : fixture.dependencies;
    let report: any; try { cycles.runQualification(fixture.options, dependencies); }
    catch (error) { report = (error as Error & { report: unknown }).report; }
    expect(report).toMatchObject({ status: 'blocked', qualified: false, cycles: [], stoppedAt: 'preflight' });
    expect(qa.readPrivate(fixture.options.output)).toMatchObject({ status: 'blocked', qualified: false });
    expect(fixture.runs()).toBe(0); expect(existsSync(fixture.options.foundationPath + '.lease')).toBe(false);
    expect(readFileSync(fixture.options.output, 'utf8')).not.toContain('Synthetic unreadable candidate');
  });
  test('live cycle subprocesses receive only operational environment and explicit owned settings', () => {
    const fixture = controlled();
    const ambient = { GH_TOKEN: 'synthetic-gh', GITHUB_TOKEN: 'synthetic-github', AZURE_CLIENT_SECRET: 'synthetic-azure',
      NPM_TOKEN: 'synthetic-npm', NODE_OPTIONS: '--require=foreign.cjs', EAI_E2E_RUN_ID: 'foreign-run' };
    const report = cycles.runQualification(fixture.options, { ...fixture.dependencies,
      env: { ...ambient, HOME: '/normal-home', PATH: '/normal-bin' }, runLive: (_cli: string, options: { env: Record<string, string>; expectedFixture: unknown }) => {
        for (const key of Object.keys(ambient)) expect(options.env[key]).toBeUndefined();
        expect(options.env.HOME).toBe('/normal-home'); expect(options.env.PATH).toBe('/normal-bin');
        expect(options.env.EAI_E2E_TEST_PROFILE).toBe(fixture.foundation.actors.adminA.profile);
        expect(options.expectedFixture).toEqual({ fixtureId: fixture.foundation.fixtureId, foundationParentTenantId: fixture.foundation.parentTenantId,
          tenantIds: { a: fixture.foundation.workspaces.a.id, b: fixture.foundation.workspaces.b.id },
          actors: Object.fromEntries(Object.entries(fixture.foundation.actors).map(([slot, actor]) => {
            const identity = actor as { oid: string; profile: string }; return [slot, { oid: identity.oid, profile: identity.profile }];
          })) });
        return fixture.liveReport();
      } });
    expect(report.status).toBe('passed'); expect(report.cycles).toHaveLength(10);
  });
  test('records exactly ten fresh proven lifecycles and releases the single-host lease', () => {
    const fixture = controlled(); const report = cycles.runQualification(fixture.options, fixture.dependencies);
    expect(report.status).toBe('passed'); expect(report.contractsVerified).toBe(true); expect(report.qualified).toBe(false); expect(report.cycles).toHaveLength(10);
    expect(report.tenantIds).toEqual({ a: fixture.foundation.workspaces.a.id, b: fixture.foundation.workspaces.b.id });
    expect(report.actors).toEqual(Object.fromEntries(Object.entries(fixture.foundation.actors).map(([slot, actor]) => {
      const identity = actor as { oid: string; profile: string }; return [slot, { oid: identity.oid, profile: identity.profile }];
    })));
    expect(fixture.runs()).toBe(10); expect(existsSync(fixture.options.foundationPath + '.lease')).toBe(false);
    expect(qa.readPrivate(fixture.options.output).qualification).toBe('controlled-fixtures');
  });
  test('missing deployment, dirty source or unprepared fixture blocks before mutations', () => {
    for (const reason of ['deployments', 'dirty', 'unprepared']) {
      const fixture = controlled();
      if (reason === 'deployments') qa.writePrivate(fixture.options.deploymentsPath, fixture.deployments.slice(1));
      if (reason === 'unprepared') qa.writePrivate(fixture.options.foundationPath, { ...fixture.foundation, state: 'partial' });
      const dependencies = reason === 'dirty' ? { ...fixture.dependencies, candidateEvidence: () => ({ ...candidate, dirty: true }) } : fixture.dependencies;
      expect(() => cycles.runQualification(fixture.options, dependencies)).toThrow('qualification stopped');
      expect(fixture.runs()).toBe(0); expect(qa.readPrivate(fixture.options.output)).toMatchObject({ status: 'blocked', qualified: false });
    }
  });
  test.each(['credentialChanged', 'firstInventoryEmpty', 'recreatedSameKey', 'cleanupVerified'])('stops immediately on missing %s proof', field => {
    const fixture = controlled();
    const runLive = () => {
      const report = fixture.liveReport();
      if (field === 'credentialChanged') report.rotationCycle.credentialChanged = false;
      else if (field === 'cleanupVerified') report.cleanupVerified = false;
      else report.deletionCycle[field as 'firstInventoryEmpty' | 'recreatedSameKey'] = false;
      return report;
    };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    expect(fixture.runs()).toBe(1); expect(qa.readPrivate(fixture.options.output).qualified).toBe(false);
  });
  test('a first-read server error stays failed while the attempted runner cleanup is preserved', () => {
    const fixture = controlled();
    const runLive = () => { const report = fixture.liveReport(); report.status = 'failed'; report.deletionCycle.firstInventoryEmpty = false;
      throw Object.assign(new Error('controlled first-read 503'), { report }); };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    const report = qa.readPrivate(fixture.options.output);
    expect(report.cycles).toHaveLength(1); expect(report.cycles[0].cleanupVerified).toBe(true); expect(report.qualified).toBe(false);
  });
  test('rejects reused registration identities even when each isolated report claims success', () => {
    const fixture = controlled(); const client = uuid(200);
    const runLive = () => { const report = fixture.liveReport(); report.created.entraClientId = client; report.rotationCycle.clientId = client; return report; };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    expect(qa.readPrivate(fixture.options.output).qualified).toBe(false);
  });
  test('cross-cycle original/recreated enrollment reuse cannot qualify the driver', () => {
    const fixture = controlled(), reused = uuid(301);
    const runLive = () => { const report = fixture.liveReport();
      if (fixture.runs() === 2) { report.created.recreatedEnrollmentId = reused; report.deletionCycle.recreatedEnrollmentId = reused; }
      return report; };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    expect(qa.readPrivate(fixture.options.output).qualified).toBe(false);
  });
  test('the receipt consumer independently rejects cross-cycle enrollment reuse', () => {
    const fixture = controlled();
    const receipts = Array.from({ length: 10 }, () => cycles.cycleReceipt({ ...fixture.liveReport(), localProjectCleanupVerified: true }));
    const cycleEvidence = { schemaVersion: 'eai.cli-permanent-cycles.v1', qualified: true, qualification: 'normal-cli-profiles', status: 'passed',
      fixtureId: fixture.foundation.fixtureId, environment: 'DEV', publicApiUrl: fixture.foundation.publicApiUrl,
      candidate, completedAt: new Date(fixture.dependencies.now()).toISOString(), cycles: receipts };
    expect(qa.cyclesVerified({ cycleEvidence }, candidate, { environment: 'DEV', publicApiUrl: fixture.foundation.publicApiUrl,
      now: fixture.dependencies.now() })).toBe(true);
    receipts[1].recreatedEnrollmentId = receipts[0].enrollmentId;
    expect(qa.cyclesVerified({ cycleEvidence }, candidate, { environment: 'DEV', publicApiUrl: fixture.foundation.publicApiUrl,
      now: fixture.dependencies.now() })).toBe(false);
  });
  test.each(['success', 'failure'])('removes generated local credentials on cycle %s while retaining private receipts', outcome => {
    const fixture = controlled(), projects: string[] = [], summaries: string[] = [];
    const sentinel = join(fixture.root, 'unrelated.txt'); writeFileSync(sentinel, 'outside sentinel', { mode: 0o600 });
    const runLive = (_cli: string, dependencies: { env: Record<string, string> }) => {
      const report = fixture.liveReport();
      const runRoot = join(dependencies.env.EAI_E2E_OUTPUT_ROOT || fixture.root, 'eai-full-e2e-' + fixture.runs());
      const projectRoot = join(runRoot, 'app'), summaryPath = join(runRoot, 'summary.json');
      mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
      writeFileSync(join(projectRoot, '.env.local'), 'ENTRA_CLIENT_SECRET=synthetic-test-only\n', { mode: 0o600 });
      qa.writePrivate(summaryPath, report); projects.push(projectRoot); summaries.push(summaryPath);
      if (outcome === 'failure') throw Object.assign(new Error('controlled transport failure'), { report, summaryPath });
      return { ...report, summaryPath, projectRoot };
    };
    if (outcome === 'failure') expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    else expect(cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive }).status).toBe('passed');
    expect(projects.length).toBe(outcome === 'failure' ? 1 : 10);
    expect(projects.every(path => !existsSync(path))).toBe(true);
    expect(summaries.every(path => existsSync(path))).toBe(true);
    expect(readFileSync(sentinel, 'utf8')).toBe('outside sentinel');
    expect(qa.readPrivate(fixture.options.output).cycles.every((row: { localProjectCleanupVerified: boolean }) => row.localProjectCleanupVerified)).toBe(true);
  });
  test('a runner cannot authorize deletion of its reported unrelated project path', () => {
    const fixture = controlled(), outside = join(fixture.root, 'unrelated-app'); mkdirSync(outside, { mode: 0o700 });
    const sentinel = join(outside, '.env.local'); writeFileSync(sentinel, 'outside sentinel', { mode: 0o600 });
    const runLive = () => ({ ...fixture.liveReport(), projectRoot: outside });
    expect(cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive }).status).toBe('passed');
    expect(readFileSync(sentinel, 'utf8')).toBe('outside sentinel');
  });
  test('another actor, runtime scope or candidate can never provide qualified cycle evidence', () => {
    const fixture = controlled();
    const runLive = () => ({ ...fixture.liveReport(), candidate: { ...candidate, runtimeSha256: 'e'.repeat(64) }, profile: 'unrelated-owner' });
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    expect(fixture.runs()).toBe(1);
  });
  test.each([null, undefined, true])('unknown or dirty candidate state %s blocks before mutation', dirty => {
    const fixture = controlled();
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies,
      candidateEvidence: () => ({ ...candidate, dirty }) })).toThrow();
    expect(fixture.runs()).toBe(0);
  });
  test.each(['sourceSha', 'runtimeSha256', 'controlled', 'expired', 'missing'])('unqualified build receipt %s blocks before mutations', reason => {
    const fixture = controlled(), receipt = { ...fixture.buildReceipt, candidate: { ...candidate } };
    if (reason === 'sourceSha') receipt.sourceSha = 'e'.repeat(40);
    if (reason === 'runtimeSha256') receipt.candidate.runtimeSha256 = 'e'.repeat(64);
    if (reason === 'controlled') receipt.qualification = 'controlled-fixtures';
    if (reason === 'expired') receipt.observedAt = '2026-10-08T00:00:00Z';
    qa.writePrivate(fixture.options.buildReceiptPath, reason === 'missing' ? {} : receipt);
    expect(() => cycles.runQualification(fixture.options, fixture.dependencies)).toThrow();
    expect(fixture.runs()).toBe(0);
  });
  test.each(['actorId', 'parentTenantId', 'publicApiGitSha', 'childDeleteVerified', 'observedAt'])('mismatched cleanup field %s blocks before mutations', field => {
    const fixture = controlled();
    qa.writePrivate(fixture.options.cleanupPreflight, { ...fixture.preflight, [field]: field === 'childDeleteVerified' ? false : 'wrong' });
    expect(() => cycles.runQualification(fixture.options, fixture.dependencies)).toThrow();
    expect(fixture.runs()).toBe(0);
  });
  test('rechecks the cleanup observation between cycles and joins each runner receipt to deployed revisions', () => {
    const fixture = controlled();
    const runLive = () => { const report = fixture.liveReport();
      qa.writePrivate(fixture.options.cleanupPreflight, { ...fixture.preflight, adminApiGitSha: 'e'.repeat(40) }); return report; };
    expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
    expect(fixture.runs()).toBe(1);
    const other = controlled();
    expect(() => cycles.runQualification(other.options, { ...other.dependencies,
      runLive: () => ({ ...other.liveReport(), preflight: { ...other.preflight, publicApiGitSha: 'e'.repeat(40) } }) })).toThrow();
    expect(other.runs()).toBe(1);
  });
  test.each(['runtime-change', 'proof-expired'])('last-cycle %s cannot qualify from the runner initial snapshot', reason => {
    const fixture = controlled(); let changed = false;
    const started = fixture.dependencies.now();
    const runLive = () => { const report = fixture.liveReport(); if (fixture.runs() === 10) changed = true; return report; };
    const dependencies = { ...fixture.dependencies, runLive,
      candidateEvidence: () => reason === 'runtime-change' && changed ? { ...candidate, runtimeSha256: 'e'.repeat(64) } : candidate,
      now: () => reason === 'proof-expired' && changed ? started + 3600001 : started };
    expect(() => cycles.runQualification(fixture.options, dependencies)).toThrow();
    expect(fixture.runs()).toBe(10);
    expect(qa.readPrivate(fixture.options.output)).toMatchObject({ qualified: false, status: 'failed', stoppedAt: 'cycle-10' });
  });
  test.each(['foundationPath', 'deploymentsPath', 'cleanupPreflight', 'buildReceiptPath'])('output cannot overwrite retained %s', input => {
    const fixture = controlled(), path = fixture.options[input as keyof typeof fixture.options];
    const before = readFileSync(path);
    expect(() => cycles.runQualification({ ...fixture.options, output: path }, fixture.dependencies)).toThrow('new private cycle output');
    expect(readFileSync(path)).toEqual(before); expect(fixture.runs()).toBe(0);
  });
  test('ambient optional write lanes are removed and the consultant build cannot be disabled', () => {
    const fixture = controlled();
    const runLive = (_cli: string, dependencies: { env: Record<string, string> }) => {
      expect(dependencies.env.EAI_E2E_BUILD).toBe('1'); expect(dependencies.env.EAI_E2E_DEPLOY).toBeUndefined();
      expect(dependencies.env.EAI_E2E_CHAT).toBeUndefined(); expect(dependencies.env.EAI_E2E_WORKFLOW_REQUEST).toBeUndefined();
      return fixture.liveReport();
    };
    const report = cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive,
      env: { EAI_E2E_BUILD: '0', EAI_E2E_DEPLOY: '1', EAI_E2E_CHAT: '1', EAI_E2E_WORKFLOW_REQUEST: '1' } });
    expect(report.contractsVerified).toBe(true); expect(report.qualified).toBe(false);
  });
  test('skipped or failed consultant builds cannot qualify an otherwise successful cycle', () => {
    for (const reason of ['skipped', 'failed']) {
      const fixture = controlled();
      const runLive = () => { const report = fixture.liveReport();
        if (reason === 'skipped') report.commands = report.commands.filter(row => row.command !== 'npm run build');
        else report.commands[1].status = 'failed';
        return report; };
      expect(() => cycles.runQualification(fixture.options, { ...fixture.dependencies, runLive })).toThrow();
      expect(fixture.runs()).toBe(1); expect(qa.readPrivate(fixture.options.output).cycles[0].appBuildVerified).toBe(false);
    }
  });
});
