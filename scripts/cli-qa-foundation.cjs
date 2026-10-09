#!/usr/bin/env node
// Retained non-production fixtures; normal CLI identities and PublicAPI only.
const fs = require('node:fs');
const { join, resolve, dirname } = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const smoke = require('./eai-full-e2e-smoke.cjs');

const SCHEMA = 'eai.cli-qa-foundation.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const SLOTS = { adminA: ['a', 'tenant-admin'], builderA: ['a', 'tenant-builder'], viewerA: ['a', 'tenant-viewer'],
  adminB: ['b', 'tenant-admin'], builderB: ['b', 'tenant-builder'] };
const SERVICES = ['PublicAPI', 'AdminAPI', 'ResourceAPI', 'Authz', 'Configurator', 'TenantInfra', 'AICore', 'AdminPortal', 'AzureAPI', 'CIAM'];
const ROLE_CASES = ['adminA:read', 'adminA:write', 'builderA:read', 'builderA:write', 'viewerA:read', 'viewerA:write-denied',
  'adminB:read', 'adminB:write', 'builderB:read', 'builderB:write',
  ...Object.keys(SLOTS).map(slot => slot + ':sibling-denied')];

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function publicApi(environment, region) {
  requireCondition(['DEV', 'TEST'].includes(environment) && ['au', 'ca', 'eu'].includes(region), 'Use DEV or TEST and a supported region.');
  requireCondition(environment !== 'DEV' || region === 'au', 'DEV foundation uses AU only.');
  return `https://${environment.toLowerCase()}-api.${region}.myenterprise.ai/public`;
}
function rejectSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    requireCondition(!/password|secret|token|credential/i.test(key), 'Fixture manifests contain references, never credentials.');
    rejectSecrets(entry);
  }
}
function validateFoundation(value) {
  rejectSecrets(value);
  requireCondition(value?.schemaVersion === SCHEMA && UUID.test(value.fixtureId || ''), 'Invalid foundation schema or ownership identity.');
  requireCondition(value.publicApiUrl === publicApi(value.environment, value.region), 'Foundation gateway does not match its environment.');
  requireCondition(UUID.test(value.parentTenantId || ''), 'An exact QA parent UUID is required.');
  const identities = [value.owner, ...Object.keys(SLOTS).map(slot => value.actors?.[slot])];
  requireCondition(identities.every(actor => actor && UUID.test(actor.oid || '') && /^[A-Za-z0-9_.-]{1,100}$/.test(actor.profile || '')
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email || '')), 'Owner and all five actors need explicit profile, OID and email references.');
  for (const field of ['oid', 'profile', 'email']) requireCondition(new Set(identities.map(actor => actor[field].toLowerCase())).size === identities.length,
    'Qualification actors and setup operator must use distinct identities and profiles.');
  for (const slot of ['a', 'b']) {
    const workspace = value.workspaces?.[slot];
    requireCondition(workspace && /^eai-cli-qa-[a-z0-9-]{1,60}$/.test(workspace.slug || '')
      && typeof workspace.name === 'string' && workspace.name.length > 0 && workspace.name.length <= 100, 'Each retained workspace needs a bounded owned QA name and slug.');
    requireCondition(workspace.id === null || (UUID.test(workspace.id || '') && workspace.id !== value.parentTenantId), 'Retained workspace IDs must be exact children, never the parent.');
  }
  requireCondition(value.workspaces.a.slug !== value.workspaces.b.slug
    && (!value.workspaces.a.id || value.workspaces.a.id !== value.workspaces.b.id), 'Sibling QA workspaces must be distinct.');
  requireCondition(value.journal && typeof value.journal === 'object' && !Array.isArray(value.journal), 'An ownership journal is required.');
  requireCondition(['unprepared', 'partial', 'verified'].includes(value.state), 'Invalid foundation preparation state.');
  for (const [name, binding] of Object.entries(value.bindings || {})) {
    requireCondition(['provider', 'analyzer', 'classifier', 'documentWorkflow', 'github', 'authorization'].includes(name)
      && binding && ['a', 'b'].includes(binding.workspaceSlot), 'Bindings must name a supported fixture and one exact workspace slot.');
    const allowed = ['workspaceSlot', 'tenantId', 'id', 'key', 'version', 'provider', 'model', 'repository', 'ref', 'commit', 'objectType', 'nonceField', 'data'];
    requireCondition(Object.keys(binding).every(key => allowed.includes(key)), 'Fixture binding contains an unsupported field.');
    requireCondition(!binding.tenantId || binding.tenantId === value.workspaces[binding.workspaceSlot].id, 'Fixture binding tenant differs from its owned workspace.');
    requireCondition(!binding.commit || SHA.test(binding.commit), 'GitHub fixture needs an immutable source commit.');
  }
  return value;
}
function initialize(spec, uuid = randomUUID) {
  requireCondition(!spec.workspaces?.a?.id && !spec.workspaces?.b?.id, 'Initialization cannot adopt pre-existing workspaces.');
  return validateFoundation({ ...spec, schemaVersion: SCHEMA, fixtureId: uuid(), publicApiUrl: publicApi(spec.environment, spec.region),
    workspaces: { a: { ...spec.workspaces.a, id: null }, b: { ...spec.workspaces.b, id: null } }, journal: {}, state: 'unprepared' });
}
function privateDirectory(path) {
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(path);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077)
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'Foundation directory must be owned and private (0700).');
}
function privateStat(path) {
  const stat = fs.lstatSync(path);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.size <= 1024 * 1024
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'Foundation file must be a private regular file (0600), at most 1 MiB.');
  return stat;
}
function readPrivate(path) {
  privateDirectory(dirname(path)); const before = privateStat(path);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    requireCondition(opened.dev === before.dev && opened.ino === before.ino && opened.isFile() && opened.nlink === 1
      && !(opened.mode & 0o077) && opened.size <= 1024 * 1024, 'Private evidence changed while opening.');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
function writePrivateText(path, content) {
  requireCondition(typeof content === 'string' && Buffer.byteLength(content) <= 1024 * 1024, 'Private evidence is bounded to 1 MiB.');
  privateDirectory(dirname(path));
  if (fs.existsSync(path) || (() => { try { fs.lstatSync(path); return true; } catch { return false; } })()) privateStat(path);
  const temporary = join(dirname(path), '.' + randomUUID() + '.json');
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, path);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function writePrivate(path, value) { return writePrivateText(path, JSON.stringify(value, null, 2) + '\n'); }
function withLease(path, action) {
  privateDirectory(dirname(path));
  let fd;
  try { fd = fs.openSync(path + '.lease', 'wx', 0o600); } catch { throw new Error('Foundation is leased or a prior operation needs manual reconciliation.'); }
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(path + '.lease'); }
}
function executeCli(cliPath, args, options) {
  return spawnSync(process.execPath, [resolve(cliPath), ...args], { ...options, encoding: 'utf8', timeout: options.timeout || 120000,
    maxBuffer: 8 * 1024 * 1024, shell: false });
}
function context(root, foundation, tenantId) {
  privateDirectory(root);
  writePrivateText(join(root, 'eai.config.ts'), 'export default {};\n');
  writePrivateText(join(root, '.env.local'), `BASE_URL_PUBLIC_API=${foundation.publicApiUrl}\nEAI_TENANT_ID=${tenantId}\n`);
}
function cliCaller(cliPath, foundation, root, dependencies) {
  const execute = dependencies.execute || executeCli;
  const env = { ...(dependencies.env || process.env) };
  for (const key of Object.keys(env)) if (/^(EAI_|NEXT_PUBLIC_|BASE_URL_|ROUTING_|ENTRA_|AUTH_|OBO_|TENANT_|WORKFLOW_|PUBLICAPI_)/.test(key)) delete env[key];
  return (actor, args, tenantId) => {
    const cwd = join(root, 'context-' + tenantId);
    context(cwd, foundation, tenantId);
    const result = execute(cliPath, ['--profile', actor.profile, ...args], { cwd,
      env: { ...env, EAI_PROFILE: actor.profile, BASE_URL_PUBLIC_API: foundation.publicApiUrl, EAI_TENANT_ID: tenantId,
        ROUTING_BOOTSTRAP_PUBLIC_API_URL: foundation.publicApiUrl } });
    let body; try { body = JSON.parse(result.stdout || ''); } catch { /* raw errors are not emitted */ }
    return { result, body };
  };
}
function getBody(call, actor, path, tenantId) {
  const { result, body } = call(actor, ['publicapi', 'get', path, '--tenant-id', tenantId, '--format', 'json'], tenantId);
  requireCondition(result.status === 0 && body?.ok === true && body.status === 200 && body.body && typeof body.body === 'object', 'Authenticated fixture read failed or returned an incomplete contract.');
  return body.body;
}
function verifyIdentity(call, actor, foundation, tenantId = foundation.parentTenantId) {
  const { result } = call(actor, ['whoami'], tenantId);
  const line = (result.stdout || '').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find(entry => entry.includes('PublicAPI')) || '';
  requireCondition(result.status === 0 && (line.match(/https?:\/\/\S+/g) || []).some(url => url.replace(/\/$/, '') === foundation.publicApiUrl), 'QA profile gateway or authentication does not match.');
  const identity = getBody(call, actor, '/v4/identity/me', tenantId);
  requireCondition(identity.oid === actor.oid && (identity.email || identity.upn || '').toLowerCase() === actor.email.toLowerCase(), 'QA profile actor does not match its explicit identity reference.');
}
function verifyWorkspaces(call, foundation) {
  for (const workspace of Object.values(foundation.workspaces)) {
    requireCondition(UUID.test(workspace.id || ''), 'Foundation workspace preparation is incomplete.');
    const tenant = getBody(call, foundation.owner, `/v4/platform/tenants/${workspace.id}/management`, foundation.parentTenantId);
    requireCondition(tenant.id === workspace.id && tenant.slug === workspace.slug
      && (tenant.parentTenantId || tenant.parentTenant?.id || tenant.parentTenant) === foundation.parentTenantId, 'Owned workspace identity or immediate parent changed.');
  }
}
function verifyActors(call, foundation) {
  for (const [slot, [workspaceSlot, role]] of Object.entries(SLOTS)) {
    const actor = foundation.actors[slot], tenantId = foundation.workspaces[workspaceSlot].id;
    verifyIdentity(call, actor, foundation, tenantId);
    const inventory = getBody(call, actor, '/v4/identity/tenants', tenantId);
    requireCondition(inventory.superAdmin === false && Array.isArray(inventory.tenants)
      && Number.isSafeInteger(inventory.totalCount) && inventory.totalCount === inventory.tenants.length
      && new Set(inventory.tenants.map(tenant => tenant.id)).size === inventory.tenants.length, 'Actor inventory is incomplete or has global administrator authority.');
    requireCondition(!inventory.tenants.some(tenant => tenant.id === foundation.parentTenantId
      || tenant.id === foundation.workspaces[workspaceSlot === 'a' ? 'b' : 'a'].id), 'Qualification actor has parent or sibling access.');
    const memberships = getBody(call, actor, `/v4/platform/users/${actor.oid}/memberships?tenant_id=${tenantId}`, tenantId);
    const matches = memberships.tenants?.filter(tenant => tenant.id === tenantId);
    const member = Array.isArray(matches) && matches.length === 1 ? matches[0] : undefined;
    requireCondition(member && member.isActive === true && Array.isArray(member.roles) && member.roles.length === 1
      && member.roles[0] === role, 'Actor role does not match the exact active independent QA permission.');
  }
}

/** Create only journaled children, reuse known identities, and retain the baseline. */
function prepareFoundation(path, cliPath, dependencies = {}) {
  return withLease(path, () => {
    const foundation = validateFoundation(readPrivate(path));
    const root = path + '.contexts', call = cliCaller(cliPath, foundation, root, dependencies);
    const save = () => writePrivate(path, foundation);
    verifyIdentity(call, foundation.owner, foundation);
    for (const actor of Object.values(foundation.actors)) verifyIdentity(call, actor, foundation);
    const parentMembership = getBody(call, foundation.owner,
      `/v4/platform/users/${foundation.owner.oid}/memberships?tenant_id=${foundation.parentTenantId}`, foundation.parentTenantId);
    requireCondition(parentMembership.tenants?.some(tenant => tenant.id === foundation.parentTenantId && tenant.isActive !== false
      && tenant.roles?.includes('tenant-admin')), 'Setup operator needs exact active QA parent administration.');
    const capability = call(foundation.owner, ['publicapi', 'post', '/v4/platform/capabilities/evaluate', '--tenant-id', foundation.parentTenantId,
      '--data', JSON.stringify({ tenant_id: foundation.parentTenantId, target_capability: 'child-tenants', requested_operation: 'create' }), '--format', 'json'], foundation.parentTenantId);
    requireCondition(capability.result.status === 0 && capability.body?.ok === true && capability.body.body?.outcome === 'allow', 'QA parent child-workspace entitlement is unavailable.');
    for (const slot of ['a', 'b']) {
      const workspace = foundation.workspaces[slot];
      if (!workspace.id) {
        requireCondition(!foundation.journal[slot], 'A prior creation outcome is unresolved; reconcile its exact acknowledgment before retrying.');
        foundation.journal[slot] = { phase: 'creating', slug: workspace.slug }; foundation.state = 'partial'; save();
        const { result, body } = call(foundation.owner, ['workspace', 'create', '--name', workspace.name, '--slug', workspace.slug,
          '--parent', foundation.parentTenantId, '--domain', workspace.slug + '.example.invalid', '--usecase', 'generic', '--industry', 'test',
          '--starter-template', 'eai-app-template', '--home-region', foundation.region, '--format', 'json'], foundation.parentTenantId);
        const tenant = body?.tenant;
        if (UUID.test(tenant?.id || '') && tenant.id !== foundation.parentTenantId && tenant.slug === workspace.slug
          && (tenant.parentTenantId || tenant.parentTenant?.id || tenant.parentTenant) === foundation.parentTenantId && tenant.reused !== true) {
          workspace.id = tenant.id; foundation.journal[slot].phase = 'created'; save();
        }
        requireCondition(result.status === 0 && workspace.id, 'QA child creation did not return a successful exact new-child acknowledgment; inspect the private journal.');
      }
    }
    verifyWorkspaces(call, foundation);
    for (const workspace of Object.values(foundation.workspaces)) {
      const { result, body } = call(foundation.owner, ['workspace', 'bootstrap-admin', '--parent', foundation.parentTenantId,
        '--child', workspace.id, '--user-oid', foundation.owner.oid, '--user-email', foundation.owner.email, '--format', 'json'], foundation.parentTenantId);
      requireCondition(result.status === 0 && body?.childTenantId === workspace.id
        && body.parentTenantId === foundation.parentTenantId && body.userOid === foundation.owner.oid && body.usable === true
        && typeof body.membershipCreated === 'boolean' && typeof body.adminAssigned === 'boolean'
        && ['bootstrapped', 'already-usable'].includes(body.status)
        && (body.status !== 'already-usable' || (body.membershipCreated === false && body.adminAssigned === false)),
      'Creator bootstrap must acknowledge the exact usable owned child and actor.');
    }
    for (const [slot, [workspaceSlot, role]] of Object.entries(SLOTS)) {
      const actor = foundation.actors[slot], tenantId = foundation.workspaces[workspaceSlot].id;
      const prior = foundation.journal[slot];
      if (prior) {
        requireCondition(!prior.unexpectedDirectoryResult, 'An unexpected directory identity result requires manual reconciliation.');
        requireCondition(prior.tenantId === tenantId && prior.oid === actor.oid && prior.role === role,
          'Membership journal identity changed; reconcile the original exact fixture first.');
        const memberships = getBody(call, actor, `/v4/platform/users/${actor.oid}/memberships?tenant_id=${tenantId}`, tenantId);
        requireCondition(memberships.tenants?.some(member => member.id === tenantId && member.isActive !== false
          && Array.isArray(member.roles) && member.roles.includes(role)), 'Pending or changed membership requires manual reconciliation; invitations are not automatically replayed.');
        foundation.journal[slot] = { ...prior, phase: 'membership-acknowledged', reconciledFromFreshMembership: true }; save();
        continue;
      }
      foundation.journal[slot] = { phase: 'inviting', tenantId, oid: actor.oid, role }; save();
      const { result, body } = call(foundation.owner, ['user', 'invite', '--workspace', tenantId, '--email', actor.email,
        '--role', role, '--format', 'json'], tenantId);
      if (body && (body.userId !== actor.oid || body.inviteMode !== 'existing_user_reused')) {
        foundation.journal[slot].unexpectedDirectoryResult = true;
        if (UUID.test(body.userId || '')) foundation.journal[slot].unexpectedUserId = body.userId;
        save();
      }
      requireCondition(result.status === 0 && body?.userId === actor.oid && body.inviteMode === 'existing_user_reused'
        && body.status === 'invited' && body.email?.toLowerCase() === actor.email.toLowerCase() && body.role === role,
        'Membership setup must acknowledge the exact existing QA actor; no directory user is adopted or deleted.');
      foundation.journal[slot] = { phase: 'membership-acknowledged', tenantId, oid: actor.oid, role }; save();
    }
    verifyActors(call, foundation);
    foundation.state = 'verified'; foundation.verifiedAt = new Date((dependencies.now || Date.now)()).toISOString();
    foundation.candidate = smoke.candidateEvidence(cliPath); save();
    return { fixtureId: foundation.fixtureId, state: foundation.state, workspaces: foundation.workspaces,
      authorizationVerified: false, explanation: 'Fresh identity/role baseline only; allow/deny and cross-tenant runtime probes still required.' };
  });
}
function deploymentParity(deployments, { environment, publicApiUrl, now = Date.now(), requiredServices = SERVICES }) {
  if (!Array.isArray(deployments) || !deployments.length || new Set(deployments.map(row => row.service)).size !== deployments.length) return false;
  return requiredServices.every(service => deployments.some(row => row.service === service)) && deployments.every(row => {
    const age = now - Date.parse(row.observedAt);
    const scope = row.environment === environment && row.publicApiUrl === publicApiUrl
      && typeof row.sourceReference === 'string' && /^https:\/\/[^\s?#]+$/.test(row.sourceReference)
      && Number.isFinite(age) && age >= -60000 && age <= 3600000;
    if (!scope) return false;
    if (row.service === 'CIAM') {
      const identity = row.identity;
      if (!identity || !UUID.test(identity.tenantId || '') || !UUID.test(identity.clientId || '') || identity.verified !== true
        || row.source !== 'oidc-discovery' || row.mainSha !== undefined || row.observedSha !== undefined) return false;
      try {
        const issuer = new URL(identity.issuer);
        return issuer.protocol === 'https:' && !issuer.username && !issuer.password && !issuer.search && !issuer.hash
          && /^(?:[a-z0-9-]+\.ciamlogin\.com|login\.microsoftonline\.com)$/i.test(issuer.hostname)
          && issuer.pathname === `/${identity.tenantId}/v2.0`
          && identity.discoveryUrl === issuer.href + '/.well-known/openid-configuration'
          && row.sourceReference === identity.discoveryUrl;
      } catch { return false; }
    }
    const mainAge = now - Date.parse(row.mainObservedAt), runtime = row.runtime, selected = row.selectedRelease;
    return row.parity === 'main' && SHA.test(row.mainSha || '') && row.mainSha === row.observedSha
      && Number.isFinite(mainAge) && mainAge >= -60000 && mainAge <= 3600000
      && ['revision-endpoint', 'github-deployment', 'image-label', 'onedeploy-receipt'].includes(row.source)
      && runtime?.sourceSha === row.observedSha && runtime.active === true && runtime.ready === true
      && typeof runtime.revision === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(runtime.revision)
      && /^sha256:[a-f0-9]{64}$/.test(runtime.artifactDigest || '')
      && selected?.sourceSha === row.observedSha && selected.configured === true && selected.status === 'succeeded'
      && selected.artifactDigest === runtime.artifactDigest && ['container', 'onedeploy'].includes(selected.kind)
      && typeof selected.deploymentId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(selected.deploymentId);
  });
}
function authorizationVerified(evidence, candidate, context) {
  const authorization = evidence?.authorizationEvidence;
  const age = (context.now ?? Date.now()) - Date.parse(authorization?.completedAt);
  if (!authorization || authorization.schemaVersion !== 'eai.cli-authorization-evidence.v1' || !UUID.test(authorization.fixtureId || '')
    || authorization.qualified !== true || authorization.qualification !== 'normal-cli-profiles' || authorization.status !== 'passed'
    || authorization.environment !== context.environment || authorization.publicApiUrl !== context.publicApiUrl
    || authorization.candidate?.gitSha !== candidate.gitSha || authorization.candidate?.runtimeSha256 !== candidate.runtimeSha256
    || authorization.candidate?.binarySha256 !== candidate.binarySha256 || !Number.isFinite(age) || age < -60000 || age > 3600000
    || !authorization.foundationVerified || authorization.cleanupVerified !== true || !Array.isArray(authorization.cases)) return false;
  const actors = authorization.actors || {}, tenants = authorization.tenantIds || {};
  if (!UUID.test(tenants.a || '') || !UUID.test(tenants.b || '') || tenants.a === tenants.b) return false;
  if (!Object.keys(SLOTS).every(slot => UUID.test(actors[slot]?.oid || '') && typeof actors[slot]?.profile === 'string')
    || new Set(Object.values(actors).map(actor => actor.oid)).size !== 5 || new Set(Object.values(actors).map(actor => actor.profile)).size !== 5) return false;
  return ROLE_CASES.every(name => authorization.cases.filter(row => row.name === name).length === 1
    && authorization.cases.some(row => row.name === name && row.status === 'passed'
      && row.profile === actors[name.split(':')[0]].profile && row.actorId === actors[name.split(':')[0]].oid
      && row.scopeTenantId === tenants[name.endsWith(':sibling-denied')
        ? (SLOTS[name.split(':')[0]][0] === 'a' ? 'b' : 'a') : SLOTS[name.split(':')[0]][0]]
      && (name.endsWith('-denied') ? [403, 404].includes(row.httpStatus) : row.httpStatus >= 200 && row.httpStatus < 300)));
}
function cycleReceiptVerified(row) {
  return UUID.test(row.clientId || '') && UUID.test(row.tenantId || '') && /^eai-e2e-[a-z0-9-]+$/.test(row.appKey || '')
    && row.status === 'passed' && row.rotationDispatches === 1 && row.credentialChanged === true && row.firstInventoryEmpty === true
    && row.recreatedSameKey === true && UUID.test(row.enrollmentId || '') && UUID.test(row.recreatedEnrollmentId || '')
    && row.recreatedEnrollmentId.toLowerCase() !== row.enrollmentId.toLowerCase()
    && row.cleanupVerified === true && row.registrationAbsent === true && row.deletionVerified === true && row.appBuildVerified === true;
}
function cyclesVerified(evidence, candidate, context) {
  const cycle = evidence?.cycleEvidence;
  const age = (context.now ?? Date.now()) - Date.parse(cycle?.completedAt);
  if (cycle?.schemaVersion !== 'eai.cli-permanent-cycles.v1' || cycle.qualified !== true || cycle.qualification !== 'normal-cli-profiles' || cycle.status !== 'passed'
    || !UUID.test(cycle.fixtureId || '') || cycle.environment !== context.environment || cycle.publicApiUrl !== context.publicApiUrl
    || cycle.candidate?.gitSha !== candidate.gitSha || cycle.candidate?.runtimeSha256 !== candidate.runtimeSha256
    || cycle.candidate?.binarySha256 !== candidate.binarySha256 || !Number.isFinite(age) || age < -60000 || age > 3600000
    || !Array.isArray(cycle.cycles) || cycle.cycles.length !== 10) return false;
  return cycle.cycles.every(cycleReceiptVerified) && new Set(cycle.cycles.map(row => row.clientId.toLowerCase())).size === 10
    && new Set(cycle.cycles.map(row => row.tenantId.toLowerCase())).size === 10 && new Set(cycle.cycles.map(row => row.appKey)).size === 10;
}

function main() {
  const args = process.argv.slice(2), argument = name => args[args.indexOf(name) + 1];
  requireCondition(args.includes('--manifest'), 'Provide --manifest /private/path/foundation.json.');
  const path = resolve(argument('--manifest'));
  if (args.includes('--init')) {
    requireCondition(args.includes('--spec') && !fs.existsSync(path), 'Initialization needs --spec and a new manifest path.');
    const foundation = initialize(readPrivate(resolve(argument('--spec')))); writePrivate(path, foundation);
    console.log(JSON.stringify({ fixtureId: foundation.fixtureId, state: foundation.state, externalWrites: false }));
  } else if (args.includes('--prepare')) {
    requireCondition(args.includes('--cli'), 'Preparation needs the exact built --cli candidate.');
    console.log(JSON.stringify(prepareFoundation(path, resolve(argument('--cli')))));
  } else {
    const foundation = validateFoundation(readPrivate(path));
    console.log(JSON.stringify({ fixtureId: foundation.fixtureId, state: foundation.state, plannedChildren: ['a', 'b'],
      actors: Object.keys(SLOTS), retained: true, externalWrites: false, pendingBindings: ['provider', 'analyzer', 'classifier', 'documentWorkflow', 'github'].filter(name => !foundation.bindings?.[name]) }));
  }
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { SCHEMA, SLOTS, SERVICES, ROLE_CASES, publicApi, initialize, validateFoundation, readPrivate, writePrivate, writePrivateText,
  withLease, prepareFoundation, deploymentParity, authorizationVerified, cycleReceiptVerified, cyclesVerified,
  cliCaller, getBody, verifyActors, verifyIdentity, verifyWorkspaces };
