#!/usr/bin/env node
// Retained non-production fixtures; normal CLI identities and PublicAPI only.
const fs = require('node:fs');
const { join, resolve, dirname, parse, sep } = require('node:path');
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
function childCreationVerified(foundation, slot) {
  const workspace = foundation.workspaces[slot], record = foundation.journal?.[slot], acknowledgment = record?.acknowledgment;
  return record?.phase === 'created' && record.slug === workspace.slug && acknowledgment?.exitCode === 0
    && acknowledgment.newChild === true && acknowledgment.fixtureId === foundation.fixtureId
    && acknowledgment.actorId === foundation.owner.oid && acknowledgment.tenantId === workspace.id
    && acknowledgment.slug === workspace.slug && acknowledgment.parentTenantId === foundation.parentTenantId;
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
  requireCondition(value.journal && typeof value.journal === 'object' && !Array.isArray(value.journal), 'An ownership journal is required.');
  for (const slot of ['a', 'b']) {
    const workspace = value.workspaces?.[slot];
    requireCondition(workspace && /^eai-cli-qa-[a-z0-9-]{1,60}$/.test(workspace.slug || '')
      && typeof workspace.name === 'string' && workspace.name.length > 0 && workspace.name.length <= 100, 'Each retained workspace needs a bounded owned QA name and slug.');
    requireCondition(workspace.id === null || (UUID.test(workspace.id || '') && workspace.id !== value.parentTenantId), 'Retained workspace IDs must be exact children, never the parent.');
    requireCondition(workspace.id === null || childCreationVerified(value, slot),
      'Saved child needs an exact successful creation acknowledgment for this fixture, operator and parent; reconcile unresolved ownership manually.');
  }
  requireCondition(value.workspaces.a.slug !== value.workspaces.b.slug
    && (!value.workspaces.a.id || value.workspaces.a.id !== value.workspaces.b.id), 'Sibling QA workspaces must be distinct.');
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
function safePrivateAncestor(stat) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return (uid === undefined || stat.uid === uid || stat.uid === 0)
    && (!(stat.mode & 0o022) || Boolean(stat.mode & 0o1000));
}
function privateDirectory(path) {
  path = resolve(path);
  const root = parse(path).root, identities = [];
  const bind = current => {
    const stat = fs.lstatSync(current);
    const expectedTarget = process.platform === 'darwin' && dirname(current) === root
      ? ({ '/tmp': '/private/tmp', '/var': '/private/var' })[current] : undefined;
    let aliasTarget;
    if (stat.isSymbolicLink() && expectedTarget && fs.realpathSync(current) === expectedTarget) {
      const target = fs.lstatSync(expectedTarget);
      requireCondition(target.isDirectory() && !target.isSymbolicLink() && safePrivateAncestor(target),
        'Private directory ancestor must be a trusted regular directory without unsafe write access.');
      aliasTarget = { path: expectedTarget, dev: target.dev, ino: target.ino, uid: target.uid, mode: target.mode & 0o7777 };
    }
    requireCondition((stat.isDirectory() && !stat.isSymbolicLink()) || aliasTarget,
      'Private directory ancestor must be a regular directory; caller-created links are refused.');
    requireCondition(aliasTarget || safePrivateAncestor(stat), 'Private directory ancestor has unsafe ownership or non-sticky write access.');
    identities.push({ path: current, dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o7777, aliasTarget });
  };
  bind(root);
  let current = root;
  for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
    assertPrivateDirectory(identities); current = join(current, component);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    bind(current);
  }
  assertPrivateDirectory(identities);
  const stat = fs.lstatSync(path);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077)
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'Foundation directory must be owned and private (0700).');
  return identities;
}
function assertPrivateDirectory(identities) {
  for (const identity of identities) {
    const stat = fs.lstatSync(identity.path);
    requireCondition(stat.dev === identity.dev && stat.ino === identity.ino
      && stat.uid === identity.uid && (stat.mode & 0o7777) === identity.mode
      && (identity.aliasTarget ? stat.isSymbolicLink() : stat.isDirectory() && !stat.isSymbolicLink()),
    'Private directory ancestor changed during the operation.');
    if (identity.aliasTarget) {
      const target = fs.lstatSync(identity.aliasTarget.path);
      requireCondition(fs.realpathSync(identity.path) === identity.aliasTarget.path && target.isDirectory() && !target.isSymbolicLink()
        && target.dev === identity.aliasTarget.dev && target.ino === identity.aliasTarget.ino
        && target.uid === identity.aliasTarget.uid && (target.mode & 0o7777) === identity.aliasTarget.mode && safePrivateAncestor(target),
      'Private directory ancestor alias changed during the operation.');
    }
  }
}
function privateStat(path) {
  const stat = fs.lstatSync(path);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.size <= 1024 * 1024
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'Foundation file must be a private regular file (0600), at most 1 MiB.');
  return stat;
}
function readPrivate(path) {
  const parents = privateDirectory(dirname(path)); const before = privateStat(path);
  assertPrivateDirectory(parents);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    requireCondition(opened.dev === before.dev && opened.ino === before.ino && opened.isFile() && opened.nlink === 1
      && !(opened.mode & 0o077) && opened.size <= 1024 * 1024, 'Private evidence changed while opening.');
    const value = JSON.parse(fs.readFileSync(fd, 'utf8')); assertPrivateDirectory(parents); return value;
  } finally { fs.closeSync(fd); }
}
function writePrivateText(path, content) {
  requireCondition(typeof content === 'string' && Buffer.byteLength(content) <= 1024 * 1024, 'Private evidence is bounded to 1 MiB.');
  const parents = privateDirectory(dirname(path));
  if (fs.existsSync(path) || (() => { try { fs.lstatSync(path); return true; } catch { return false; } })()) privateStat(path);
  const temporary = join(dirname(path), '.' + randomUUID() + '.json');
  assertPrivateDirectory(parents);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    assertPrivateDirectory(parents); fs.renameSync(temporary, path); assertPrivateDirectory(parents);
  } finally { assertPrivateDirectory(parents); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function writePrivate(path, value) { return writePrivateText(path, JSON.stringify(value, null, 2) + '\n'); }
function withLease(path, action) {
  const parents = privateDirectory(dirname(path)); assertPrivateDirectory(parents);
  let fd;
  try { fd = fs.openSync(path + '.lease', 'wx', 0o600); } catch { throw new Error('Foundation is leased or a prior operation needs manual reconciliation.'); }
  const identity = fs.fstatSync(fd);
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); assertPrivateDirectory(parents); return action(); }
  finally {
    fs.closeSync(fd); assertPrivateDirectory(parents);
    const current = fs.lstatSync(path + '.lease');
    requireCondition(current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino,
      'Foundation lease changed; manual reconciliation is required.');
    fs.unlinkSync(path + '.lease');
  }
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
/** Preserve normal profile homes and OS/network settings, never ambient credentials or code injection. */
function operationalEnvironment(environment) {
  const allowed = new Set(['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'PATH', 'Path', 'PATHEXT',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'COMSPEC', 'ComSpec', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
    'TERM', 'CI', 'NO_COLOR', 'FORCE_COLOR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
  return Object.fromEntries(Object.entries(environment).filter(([key, value]) => allowed.has(key) && typeof value === 'string'));
}
function cliCaller(cliPath, foundation, root, dependencies) {
  const execute = dependencies.execute || executeCli;
  const env = operationalEnvironment(dependencies.env || process.env);
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
    requireCondition(inventory.tenants.some(tenant => tenant.id === tenantId), 'Actor inventory does not include its exact assigned QA workspace.');
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
          && (tenant.parentTenantId || tenant.parentTenant?.id || tenant.parentTenant) === foundation.parentTenantId
          && (!Object.hasOwn(tenant, 'reused') || tenant.reused === false)) {
          workspace.id = tenant.id;
          foundation.journal[slot] = { phase: result.status === 0 ? 'created' : 'acknowledged', slug: workspace.slug,
            acknowledgment: { fixtureId: foundation.fixtureId, actorId: foundation.owner.oid, tenantId: tenant.id,
              slug: tenant.slug, parentTenantId: foundation.parentTenantId, newChild: true, exitCode: result.status } }; save();
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
/** Validate the actual probe's published/created/cleanup rows before accepting its pass flags. */
function authorizationReceiptsVerified(authorization, actors, tenants) {
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const uuid = value => typeof value === 'string' && UUID.test(value);
  const published = authorization.publishedFixture, created = authorization.created, cleanup = authorization.cleanup;
  const writers = Object.keys(SLOTS).filter(slot => SLOTS[slot][1] !== 'tenant-viewer');
  if (!uuid(authorization.runId) || authorization.localCleanupVerified !== true
    || !Array.isArray(authorization.leftovers) || authorization.leftovers.length !== 0
    || !Array.isArray(published) || published.length !== 2 || !published.every(record)
    || !Array.isArray(created) || created.length !== writers.length || !created.every(record)
    || !Array.isArray(cleanup) || cleanup.length !== writers.length || !cleanup.every(record)) return false;
  if (!['a', 'b'].every(slot => published.filter(row => row.tenantId === tenants[slot]).length === 1)
    || !published.every(row => typeof row.definitionId === 'string' && row.definitionId.trim() === row.definitionId
      && row.definitionId.length > 0 && row.definitionId.length <= 128 && /^cli-qa-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.objectType || '')
      && typeof row.nonceField === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(row.nonceField)
      && Number.isSafeInteger(row.schemaVersion) && row.schemaVersion >= 1 && row.publicationStatus === 'published'
      && typeof row.propertyFingerprintSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.propertyFingerprintSha256))
    || !['objectType', 'nonceField', 'propertyFingerprintSha256'].every(field => published[0][field] === published[1][field])) return false;
  if (!writers.every(slot => created.filter(row => row.creatorSlot === slot).length === 1
    && cleanup.filter(row => row.creatorSlot === slot).length === 1)
    || !created.every(row => {
      const prefix = `cli-qa-${authorization.runId}-${row.creatorSlot}-`;
      return row.tenantId === tenants[SLOTS[row.creatorSlot]?.[0]] && uuid(row.resourceId) && uuid(row.idempotencyKey)
        && uuid(row.creatorId) && row.creatorId === actors[row.creatorSlot]?.oid
        && typeof row.nonce === 'string' && row.nonce.startsWith(prefix) && uuid(row.nonce.slice(prefix.length))
        && row.creationDispatched === true && row.acknowledgedBound === true && row.phase === 'absent'
        && Number.isSafeInteger(row.version) && row.version >= 1;
    }) || new Set(created.map(row => row.resourceId.toLowerCase())).size !== writers.length
    || new Set(created.map(row => row.idempotencyKey.toLowerCase())).size !== writers.length) return false;
  if (!cleanup.every(row => {
    const owned = created.find(entry => entry.creatorSlot === row.creatorSlot);
    const admin = SLOTS[row.creatorSlot]?.[0] === 'a' ? 'adminA' : 'adminB';
    return owned && row.resourceId === owned.resourceId && row.tenantId === owned.tenantId && row.profile === actors[admin].profile
      && row.status === 'passed' && row.deleteAcknowledged === true && row.absenceVerified === true
      && row.deleteHttpStatus === 200 && row.absenceHttpStatus === 404;
  })) return false;
  return authorization.cases.every(row => {
    const slot = row.name.split(':')[0], sibling = row.name.endsWith(':sibling-denied');
    const creator = sibling ? (SLOTS[slot][0] === 'a' ? 'adminB' : 'adminA') : slot === 'viewerA' ? 'adminA' : slot;
    return row.resourceId === created.find(entry => entry.creatorSlot === creator)?.resourceId;
  });
}
function authorizationVerified(evidence, candidate, context) {
  const authorization = evidence?.authorizationEvidence;
  const age = (context.now ?? Date.now()) - Date.parse(authorization?.completedAt);
  if (!authorization || authorization.schemaVersion !== 'eai.cli-authorization-evidence.v1' || !UUID.test(authorization.fixtureId || '')
    || authorization.qualified !== true || authorization.qualification !== 'normal-cli-profiles' || authorization.status !== 'passed'
    || authorization.environment !== context.environment || authorization.publicApiUrl !== context.publicApiUrl
    || !require('./cli-qa-build-receipt.cjs').candidateMatches(authorization.candidate, candidate)
    || !Number.isFinite(age) || age < -60000 || age > 3600000
    || !authorization.foundationVerified || authorization.cleanupVerified !== true || !Array.isArray(authorization.cases)
    || authorization.cases.length !== ROLE_CASES.length) return false;
  const actors = authorization.actors || {}, tenants = authorization.tenantIds || {};
  if (!UUID.test(tenants.a || '') || !UUID.test(tenants.b || '') || tenants.a === tenants.b) return false;
  if (!Object.keys(SLOTS).every(slot => UUID.test(actors[slot]?.oid || '') && typeof actors[slot]?.profile === 'string')
    || new Set(Object.values(actors).map(actor => actor.oid)).size !== 5 || new Set(Object.values(actors).map(actor => actor.profile)).size !== 5) return false;
  return ROLE_CASES.every(name => authorization.cases.filter(row => row.name === name).length === 1
    && authorization.cases.some(row => row.name === name && row.status === 'passed'
      && row.profile === actors[name.split(':')[0]].profile && row.actorId === actors[name.split(':')[0]].oid
      && row.scopeTenantId === tenants[name.endsWith(':sibling-denied')
        ? (SLOTS[name.split(':')[0]][0] === 'a' ? 'b' : 'a') : SLOTS[name.split(':')[0]][0]]
      && (name.endsWith('-denied') ? [403, 404].includes(row.httpStatus) : row.httpStatus === (name.endsWith(':write') ? 201 : 200))))
    && authorizationReceiptsVerified(authorization, actors, tenants);
}
function cycleReceiptVerified(row) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && UUID.test(row.clientId || '') && UUID.test(row.tenantId || '') && /^eai-e2e-[a-z0-9-]+$/.test(row.appKey || '')
    && row.status === 'passed' && row.rotationDispatches === 1 && row.credentialChanged === true && row.firstInventoryEmpty === true
    && row.recreatedSameKey === true && UUID.test(row.enrollmentId || '') && UUID.test(row.recreatedEnrollmentId || '')
    && row.recreatedEnrollmentId.toLowerCase() !== row.enrollmentId.toLowerCase()
    && row.cleanupVerified === true && row.localProjectCleanupVerified === true && row.registrationAbsent === true
    && row.deletionVerified === true && row.appBuildVerified === true;
}
function cycleIdentitiesFresh(rows) {
  return rows.length === 10 && new Set(rows.map(row => row.clientId.toLowerCase())).size === 10
    && new Set(rows.map(row => row.tenantId.toLowerCase())).size === 10 && new Set(rows.map(row => row.appKey)).size === 10
    && new Set(rows.flatMap(row => [row.enrollmentId.toLowerCase(), row.recreatedEnrollmentId.toLowerCase()])).size === 20;
}
function cyclesVerified(evidence, candidate, context) {
  const cycle = evidence?.cycleEvidence;
  const age = (context.now ?? Date.now()) - Date.parse(cycle?.completedAt);
  if (cycle?.schemaVersion !== 'eai.cli-permanent-cycles.v1' || cycle.qualified !== true || cycle.qualification !== 'normal-cli-profiles' || cycle.status !== 'passed'
    || !UUID.test(cycle.fixtureId || '') || cycle.environment !== context.environment || cycle.publicApiUrl !== context.publicApiUrl
    || !require('./cli-qa-build-receipt.cjs').candidateMatches(cycle.candidate, candidate)
    || !Number.isFinite(age) || age < -60000 || age > 3600000
    || !Array.isArray(cycle.cycles) || cycle.cycles.length !== 10) return false;
  return cycle.cycles.every(cycleReceiptVerified) && cycleIdentitiesFresh(cycle.cycles);
}
/** Separate valid receipts must still name the same retained foundation. */
function foundationEvidenceBound(evidence) {
  const authorization = evidence?.authorizationEvidence, cycles = evidence?.cycleEvidence;
  if (!UUID.test(authorization?.fixtureId || '') || authorization.fixtureId !== cycles?.fixtureId) return false;
  if (!['a', 'b'].every(slot => UUID.test(authorization.tenantIds?.[slot] || '')
    && authorization.tenantIds[slot] === cycles.tenantIds?.[slot])) return false;
  return Object.keys(SLOTS).every(slot => {
    const actor = authorization.actors?.[slot], cycleActor = cycles.actors?.[slot];
    return UUID.test(actor?.oid || '') && actor.oid === cycleActor?.oid
      && typeof actor.profile === 'string' && actor.profile.length > 0 && actor.profile === cycleActor?.profile;
  });
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
  withLease, prepareFoundation, deploymentParity, authorizationVerified, cycleReceiptVerified, cycleIdentitiesFresh, cyclesVerified, foundationEvidenceBound,
  privateDirectory, assertPrivateDirectory, operationalEnvironment,
  cliCaller, getBody, verifyActors, verifyIdentity, verifyWorkspaces };
