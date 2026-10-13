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
  if (group === 'publicapi') return observed.method === action.toUpperCase() && path.startsWith('/v4/');
  if (group === 'workspace') {
    // These commands consume identity inventory/cache; a regional-routing
    // tenant-management lookup is auxiliary and cannot qualify their output.
    if (['list', 'info', 'select'].includes(action)) return path === '/v4/identity/tenants' && observed.method === 'GET';
    const methods = { create: 'POST', 'bootstrap-admin': 'POST', delete: 'DELETE', info: 'GET' };
    if (methods[action] && observed.method !== methods[action]) return false;
    if (action === 'create') return path === '/v4/platform/tenants' || path.startsWith('/v4/platform/tenants/' + encodeURIComponent(observed.tenantId) + '/children');
    return path.startsWith('/v4/platform/tenants/' + encodeURIComponent(observed.tenantId));
  }
  if (group === 'whoami') return path === '/v4/identity/tenants' && observed.method === 'GET';
  if (group === 'doctor') return path === '/health' || path === '/v4/identity/me';
  if (group === 'app' || group === 'init' || group === 'create') {
    const methods = { create: 'POST', delete: 'DELETE', provision: 'POST', list: 'GET' };
    return (!methods[action] || observed.method === methods[action])
      && (path.startsWith('/v4/platform/tenants/' + encodeURIComponent(observed.tenantId) + '/apps')
        || path.startsWith('/v4/data/resources/' + encodeURIComponent(observed.tenantId) + '/tenant-vertical-enrollment'));
  }
  if (group === 'user') return /^\/v4\/platform\/(?:users|tenants\/[^/]+\/(?:users|role-definitions))(?:\/|$)/.test(path);
  if (group === 'resources') {
    const methods = { create: ['POST'], 'batch-create': ['POST'], 'batch-import': ['POST'], delete: ['DELETE'],
      'batch-delete': ['POST', 'DELETE'], update: ['PATCH', 'PUT'], 'batch-update': ['PATCH', 'PUT', 'POST'], get: ['GET'], list: ['GET'] };
    return (path.startsWith('/v4/data/resources/' + encodeURIComponent(observed.tenantId) + '/')
      || (action === 'indexes-plan' && path.startsWith('/v4/data/resources/schema/indexes/plan')))
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
  if (group === 'verify') return path === '/health' || path === '/v4/identity/me' || path.startsWith('/v4/data/resources/object-types');
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
