const SCHEMA = 'eai.cli-qa-transport.v1';
const LOCAL_GROUPS = new Set(['start', 'dev', 'logout', 'runtime', 'update', 'gofer', 'template', 'blocks', 'errors', 'agent']);
const LOCAL_COMMANDS = new Set(['eai env list', 'eai types validate', 'eai deploy source validate', 'eai deploy setup', 'eai deploy env',
  'eai provision resourceapi-bundle', 'eai types define', 'eai resources indexes-apply', 'eai content-understanding schema', 'eai content-understanding validate']);
const RESOURCE_RESPONSES = new Set(['eai resources create', 'eai resources batch-create', 'eai resources batch-import',
  'eai resources delete', 'eai resources batch-delete']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function requiresProtectedScope(command) {
  return command.startsWith('eai ') && !LOCAL_GROUPS.has(command.split(' ')[1]) && !LOCAL_COMMANDS.has(command);
}
function primaryTransportMatches(command, observed) {
  if (observed.source === 'resource-json') return RESOURCE_RESPONSES.has(command);
  if (typeof observed.method !== 'string' || typeof observed.path !== 'string' || observed.path.length > 2048
    || !observed.path.startsWith('/') || /[?#\r\n]/.test(observed.path)) return false;
  let gateway;
  try { gateway = new URL(observed.publicApiUrl); } catch { return false; }
  const prefix = gateway.pathname.replace(/\/$/, '');
  if (!observed.path.startsWith(prefix + '/')) return false;
  const path = observed.path.slice(prefix.length), group = command.split(' ')[1], action = command.split(' ')[2];
  const tenant = '/v4/platform/tenants/' + encodeURIComponent(observed.tenantId);
  const resources = '/v4/data/resources/' + encodeURIComponent(observed.tenantId);
  const below = base => path === base || path.startsWith(base + '/');
  const segments = base => path.startsWith(base + '/') ? path.slice(base.length + 1).split('/') : [];
  const children = segments(tenant);
  if (group === 'publicapi') return observed.method === action.toUpperCase() && path.startsWith('/v4/');
  if (group === 'workspace' || group === 'tenant') {
    // These commands consume identity inventory/cache; a regional-routing
    // tenant-management lookup is auxiliary and cannot qualify their output.
    if (['list', 'info', 'select'].includes(action)) return path === '/v4/identity/tenants' && observed.method === 'GET';
    if (action === 'storage') {
      const suffix = { list: '/storage', verify: '/storage/doctor' }[command.split(' ')[3]];
      return suffix !== undefined && observed.method === 'GET' && path === resources + suffix;
    }
    if (observed.method !== 'POST') return false;
    if (action === 'create') return path === '/v4/platform/tenants' || path === tenant + '/children';
    if (action === 'bootstrap-admin') return children.length === 3 && children[0] === 'children'
      && children[1] !== '' && children[2] === 'bootstrap-admin';
    if (action === 'delete') return path === tenant + '/delete'
      || (children.length === 3 && children[0] === 'children' && children[1] !== '' && children[2] === 'delete');
    return false;
  }
  if (group === 'whoami') return path === '/v4/identity/tenants' && observed.method === 'GET';
  if (group === 'doctor') return path === '/health' || path === '/v4/identity/me';
  if (group === 'app' || group === 'vertical' || group === 'init' || group === 'create') {
    const apps = tenant + '/apps', enrollment = resources + '/tenant-vertical-enrollment';
    const appSegments = segments(apps);
    if (action === 'create') return observed.method === 'POST' && path === apps;
    if (action === 'delete') return observed.method === 'DELETE' && appSegments.length === 1 && appSegments[0] !== '';
    if (action === 'provision') return appSegments[0] !== '' && appSegments[1] === 'provisioning-jobs'
      && ((observed.method === 'POST' && appSegments.length === 2)
        || (observed.method === 'GET' && appSegments.length === 3 && appSegments[2] !== ''));
    if (action === 'list' || action === 'select') return observed.method === 'GET' && path === enrollment;
    return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(observed.method) && (below(apps) || below(enrollment));
  }
  if (group === 'user') {
    const members = tenant + '/members';
    const memberSegments = segments(members), userSegments = segments(tenant + '/users');
    if (action === 'list') return observed.method === 'GET' && path === members;
    if (action === 'roles') return observed.method === 'GET' && path === tenant + '/role-definitions';
    if (action === 'invite' || (action === 'role' && command.split(' ')[3] === 'set'))
      return (observed.method === 'POST' && path === members + '/invite')
        || (action === 'role' && observed.method === 'PATCH' && memberSegments.length === 2
          && memberSegments[0] !== '' && memberSegments[1] === 'roles');
    if (action === 'provision-me') return observed.method === 'POST' && userSegments.length === 2
      && userSegments[0] !== '' && userSegments[1] === 'provision';
    return false;
  }
  if (group === 'resources') {
    const methods = { create: ['POST'], 'batch-create': ['POST'], 'batch-import': ['POST'], delete: ['DELETE'],
      'batch-delete': ['POST', 'DELETE'], update: ['PATCH', 'PUT'], 'batch-update': ['PATCH', 'PUT', 'POST'], get: ['GET'], list: ['GET'] };
    if (action === 'indexes-plan') return observed.method === 'POST' && path === tenant + '/resourceapi/index-plan';
    return path.startsWith(resources + '/')
      && (!methods[action] || methods[action].includes(observed.method));
  }
  if (group === 'types') return /\/v4\/data\/resources\/(?:object-types|schema)(?:\/|$)/.test(path);
  if (group === 'classifier') return /\/v4\/data\/resources\/.*classifier/.test(path);
  if (group === 'docs' || group === 'content-understanding') return path.startsWith('/v4/data/documents/');
  if (group === 'workflow') return /^\/v4\/(?:workflows|integrations)(?:\/|$)/.test(path)
    || /\/(?:shared-workflow-config|vertical-product-config|shared-ai-profile|shared-chatbot-config)(?:\/|$)/.test(path);
  if (group === 'chat') return path.startsWith('/v4/ai/');
  if (group === 'provision') return path.startsWith('/v4/platform/provisioning/') || path.startsWith('/v4/data/resources/schema/');
  if (group === 'deploy') return path.startsWith('/v4/platform/') && !/\/tenants\/[^/]+\/?$/.test(path);
  if (group === 'verify') return observed.method === 'GET' && (path === '/health' || path === '/v4/identity/me'
    || path === '/v4/data/resources/health' || path === '/v4/data/resources/object-types'
    || path === '/v4/data/resources/schema/' + encodeURIComponent(observed.tenantId));
  return false;
}
function observationValid(value, executionId) {
  if (!record(value) || value.schemaVersion !== SCHEMA || value.executionId !== executionId || value.proofKind !== 'transport-response'
    || Object.keys(value).some(key => !['schemaVersion', 'executionId', 'publicApiUrl', 'tenantId', 'proofKind', 'method', 'path', 'source'].includes(key))
    || typeof value.publicApiUrl !== 'string' || (value.tenantId !== null && (typeof value.tenantId !== 'string'
      || !/^[A-Za-z0-9_.:@-]{1,128}$/.test(value.tenantId)))) return false;
  if (value.source === 'resource-json') {
    if (value.method !== undefined || value.path !== undefined) return false;
  } else if (value.source !== undefined || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value.method)
    || typeof value.path !== 'string' || value.path.length > 2048 || !value.path.startsWith('/') || /[?#\r\n]/.test(value.path)) return false;
  try { const url = new URL(value.publicApiUrl); return ['https:', 'http:'].includes(url.protocol)
    && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
function observedScopeVerified(entry) {
  const values = entry.transportObservations;
  return Array.isArray(values) && values.length > 0 && values.length <= 256
    && typeof entry.scopeTenantId === 'string' && entry.scopeTenantId !== 'system'
    && values.every(value => observationValid(value, entry.executionId) && value.publicApiUrl === entry.publicApiUrl
      && (value.tenantId === 'system' || value.tenantId === null || value.tenantId === entry.scopeTenantId))
    && values.some(value => value.tenantId === entry.scopeTenantId && primaryTransportMatches(entry.command, value));
}
module.exports = { SCHEMA, requiresProtectedScope, RESOURCE_RESPONSES, primaryTransportMatches, observationValid, observedScopeVerified };
