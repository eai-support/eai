#!/usr/bin/env node
// Opt-in normal-profile role checks against retained DEV/TEST sibling fixtures.
const fs = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const qa = require('./cli-qa-foundation.cjs');
const smoke = require('./eai-full-e2e-smoke.cjs');

const SCHEMA = 'eai.cli-authorization-evidence.v1';
const ROLE_CASES = qa.ROLE_CASES;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const WRITERS = ['adminA', 'builderA', 'adminB', 'builderB'];
const SIMPLE_TYPES = ['text', 'number', 'boolean', 'date', 'select', 'json'];

function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function sourceHash(path) { return createHash('sha256').update(fs.readFileSync(path)).digest('hex'); }
function candidateValid(candidate) {
  return candidate && SHA.test(candidate.gitSha || '') && SHA256.test(candidate.runtimeSha256 || '')
    && SHA256.test(candidate.binarySha256 || '') && candidate.dirty === false;
}
function candidateSame(left, right) {
  return candidateValid(right) && ['gitSha', 'runtimeSha256', 'binarySha256'].every(key => left[key] === right[key]);
}
function fixtureBinding(foundation) {
  const binding = foundation.bindings?.authorization;
  requireCondition(binding && typeof binding.objectType === 'string' && binding.objectType.length <= 128
    && /^cli-qa-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(binding.objectType)
    && FIELD.test(binding.nonceField || '') && !['constructor', 'prototype'].includes(binding.nonceField)
    && record(binding.data) && Buffer.byteLength(JSON.stringify(binding.data)) <= 16384,
  'Provide a retained cli-qa-* Object Type binding with a text nonce field and bounded synthetic data.');
  requireCondition(!Object.hasOwn(binding.data, binding.nonceField)
    && Object.keys(binding.data).length <= 32 && Object.keys(binding.data).every(key => FIELD.test(key)
      && !['constructor', 'prototype'].includes(key)), 'Synthetic fixture data must leave the run nonce to the probe.');
  requireCondition(binding.id === undefined || (typeof binding.id === 'string' && binding.id.length > 0
    && binding.id.trim() === binding.id && binding.id.length <= 128),
    'An optional retained Object Type ID must be exact and bounded.');
  return binding;
}
function finiteJson(value, depth = 0) {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(entry => finiteJson(entry, depth + 1));
  return record(value) && Object.values(value).every(entry => finiteJson(entry, depth + 1));
}

function fieldSupported(property, value) {
  if (value === null) return true; // ResourceAPI permits null for a present field.
  if (property.type === 'text') return typeof value === 'string';
  if (property.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (property.type === 'boolean') return typeof value === 'boolean';
  if (property.type === 'date') return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value);
  if (property.type === 'select') return !property.options?.length
    || property.options.some(option => record(option) && isDeepStrictEqual(option.value, value));
  if (property.type === 'json') return finiteJson(value);
  return false;
}

/** Read the receiver's published schema in both siblings before issuing mutations. */
function verifyPublishedFixture(call, foundation, binding) {
  const observations = [];
  const scopedRead = (actor, args, tenantId) => {
    const response = call(actor, args, tenantId);
    requireCondition(exactWire(response, 'GET', args[2], tenantId, foundation),
      'Published fixture reads require an exact gateway, path and tenant acknowledgment.');
    return response;
  };
  for (const slot of ['a', 'b']) {
    const tenantId = foundation.workspaces[slot].id;
    const schema = qa.getBody(scopedRead, foundation.actors[slot === 'a' ? 'adminA' : 'adminB'],
      `/v4/data/resources/schema/${tenantId}`, tenantId);
    requireCondition(schema.tenant_id === tenantId && Array.isArray(schema.object_types)
      && Array.isArray(schema.dropped_types), 'Published fixture schema must acknowledge its exact tenant.');
    const matches = schema.object_types.filter(type => type?.slug === binding.objectType);
    requireCondition(matches.length === 1 && record(matches[0]) && typeof matches[0].id === 'string'
      && (!binding.id || matches[0].id === binding.id) && !schema.dropped_types.some(type => type?.slug === binding.objectType),
    'The exact retained Object Type is missing, ambiguous or dropped from a sibling published schema.');
    const type = matches[0];
    requireCondition(Array.isArray(type.properties) && type.properties.every(property => record(property)
      && typeof property.name === 'string') && new Set(type.properties.map(property => property.name)).size === type.properties.length,
    'Published fixture properties are incomplete or ambiguous.');
    const nonce = type.properties.find(property => property.name === binding.nonceField);
    requireCondition(nonce?.type === 'text', 'The published run nonce must be an explicit text property.');
    const data = { ...binding.data, [binding.nonceField]: 'cli-qa-schema-preflight' };
    for (const property of type.properties) {
      requireCondition(!property.required || Object.hasOwn(data, property.name) || property.defaultValue != null,
        'Synthetic fixture data omits a required published property.');
    }
    for (const [key, value] of Object.entries(data)) {
      const property = type.properties.find(item => item.name === key);
      requireCondition(property && SIMPLE_TYPES.includes(property.type) && fieldSupported(property, value),
        'Synthetic fixture data does not match supported published properties.');
    }
    observations.push({ tenantId, definitionId: type.id, objectType: type.slug,
      schemaVersion: type.schemaVersion, nonceField: binding.nonceField });
  }
  return observations;
}

function dispatch(call, actor, method, path, tenantId, data) {
  return call(actor, ['publicapi', method.toLowerCase(), path, '--tenant-id', tenantId,
    ...(data === undefined ? [] : ['--data', JSON.stringify(data)]), '--format', 'json'], tenantId);
}
function exactWire(response, method, path, tenantId, foundation) {
  const body = response?.body, request = body?.request;
  return record(body) && Number.isInteger(body.status) && record(request)
    && request.method === method && request.path === path && request.tenantId === tenantId
    && request.publicApiUrl === foundation.publicApiUrl;
}
function httpStatus(response) {
  const status = response?.body?.status;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}
function success(response, method, path, tenantId, foundation, httpStatus) {
  requireCondition(exactWire(response, method, path, tenantId, foundation) && response.result?.status === 0
    && response.body.ok === true && response.body.status === httpStatus, 'A role allow check lacks a successful exact PublicAPI envelope.');
  return response.body.body;
}
function denial(response, method, path, tenantId, foundation, statuses = [403, 404]) {
  requireCondition(exactWire(response, method, path, tenantId, foundation) && Number.isInteger(response.result?.status)
    && response.result.status > 0 && response.body.ok === false && statuses.includes(response.body.status),
  'Only an exact authenticated 403/404 envelope proves denial; unauthenticated, outage or malformed responses do not.');
}
function resourceMatches(dto, row, binding, expectedNonce = row.nonce) {
  return record(dto) && UUID.test(dto.id || '') && (!row.resourceId || dto.id === row.resourceId)
    && dto.tenant_id === row.tenantId && dto.object_type === binding.objectType && record(dto.data)
    && dto.data[binding.nonceField] === expectedNonce;
}
function requireResource(dto, row, binding, nonce = row.nonce) {
  requireCondition(resourceMatches(dto, row, binding, nonce) && Number.isSafeInteger(dto.version) && dto.version >= 1
    && Object.entries(binding.data).every(([key, value]) => isDeepStrictEqual(dto.data[key], value)),
  'The resource DTO does not match the exact new synthetic row, scope, data or version.');
  return dto;
}

/** Run all role cases and independently verify absence of every acknowledged owned row. */
function runAuthorizationProbe(options, dependencies = {}) {
  const now = dependencies.now || Date.now, uuid = dependencies.uuid || randomUUID;
  const evidenceFor = dependencies.candidateEvidence || smoke.candidateEvidence;
  return qa.withLease(options.foundationPath, () => {
    const foundation = qa.validateFoundation(qa.readPrivate(options.foundationPath));
    const output = resolve(options.output), candidate = evidenceFor(options.cliPath), runId = uuid();
    requireCondition(output !== resolve(options.foundationPath) && !fs.existsSync(output), 'Use a new private evidence file, separate from the foundation.');
    requireCondition(UUID.test(runId), 'The probe requires a new ownership UUID.');
    const contextRoot = output + '.contexts-' + runId;
    requireCondition(!fs.existsSync(contextRoot), 'A prior context directory cannot be adopted.');
    const report = { schemaVersion: SCHEMA, fixtureId: foundation.fixtureId, runId, environment: foundation.environment,
      publicApiUrl: foundation.publicApiUrl, candidate, probeSourceSha256: sourceHash(__filename),
      foundationSourceSha256: sourceHash(require.resolve('./cli-qa-foundation.cjs')),
      qualification: Object.keys(dependencies).some(key => !['env', 'log'].includes(key))
        ? 'controlled-fixtures' : 'normal-cli-profiles', qualified: false,
      actors: Object.fromEntries(Object.entries(foundation.actors).map(([slot, actor]) => [slot, { oid: actor.oid, profile: actor.profile }])),
      tenantIds: { a: foundation.workspaces.a.id, b: foundation.workspaces.b.id },
      startedAt: new Date(now()).toISOString(), status: 'running', foundationVerified: false,
      cases: ROLE_CASES.map(name => {
        const slot = name.split(':')[0], workspace = qa.SLOTS[slot][0], sibling = workspace === 'a' ? 'b' : 'a';
        return { name, profile: foundation.actors[slot].profile, actorId: foundation.actors[slot].oid,
          scopeTenantId: foundation.workspaces[name.endsWith(':sibling-denied') ? sibling : workspace].id, status: 'not-run' };
      }), created: [], cleanup: [], leftovers: [], cleanupVerified: false, localCleanupVerified: false };
    const save = () => qa.writePrivate(output, report);
    const call = qa.cliCaller(options.cliPath, foundation, contextRoot, dependencies);
    const assertCandidate = () => requireCondition(candidateSame(candidate, evidenceFor(options.cliPath))
      && sourceHash(__filename) === report.probeSourceSha256
      && sourceHash(require.resolve('./cli-qa-foundation.cjs')) === report.foundationSourceSha256,
    'The CLI candidate or QA source changed during the probe.');
    let stage = 'preflight', binding;
    save();
    function runCase(name, action) {
      const entry = report.cases.find(row => row.name === name); entry.status = 'running'; save();
      try { assertCandidate(); action(entry); entry.status = 'passed'; }
      catch { entry.status = 'failed'; entry.reason = 'Required exact runtime authorization evidence was not established.'; }
      save(); return entry.status === 'passed';
    }
    const rowPath = row => `/v4/data/resources/${row.tenantId}/${binding.objectType}/${row.resourceId}`;
    try {
      requireCondition(foundation.state === 'verified' && UUID.test(foundation.workspaces.a.id || '')
        && UUID.test(foundation.workspaces.b.id || ''), 'Prepare the exact retained sibling foundation first.');
      requireCondition(candidateValid(candidate), 'Use a clean, source-bound built CLI candidate.');
      binding = fixtureBinding(foundation);
      qa.verifyIdentity(call, foundation.owner, foundation); qa.verifyWorkspaces(call, foundation); qa.verifyActors(call, foundation);
      report.publishedFixture = verifyPublishedFixture(call, foundation, binding);
      report.foundationVerified = true; save(); stage = 'runtime';
      for (const slot of WRITERS) {
        const tenantId = foundation.workspaces[qa.SLOTS[slot][0]].id;
        const row = { creatorSlot: slot, tenantId, nonce: `cli-qa-${runId}-${slot}-${uuid()}`,
          idempotencyKey: uuid(), phase: 'not-dispatched', creationDispatched: false, acknowledgedBound: false, allowedNonces: [] };
        requireCondition(UUID.test(row.idempotencyKey)
          && !report.created.some(existing => existing.idempotencyKey === row.idempotencyKey), 'Creation needs a fresh UUID idempotency key.');
        row.allowedNonces.push(row.nonce); report.created.push(row); save();
        const path = `/v4/data/resources/${tenantId}/${binding.objectType}`;
        const passed = runCase(slot + ':write', entry => {
          row.creationDispatched = true; row.phase = 'creating'; save();
          const response = dispatch(call, foundation.actors[slot], 'POST', path, tenantId,
            { data: { ...binding.data, [binding.nonceField]: row.nonce }, idempotencyKey: row.idempotencyKey });
          const dto = response.body?.body;
          if (UUID.test(dto?.id || '')) row.resourceId = dto.id;
          row.acknowledgedBound = resourceMatches(dto, row, binding);
          row.phase = row.acknowledgedBound ? 'acknowledged' : 'outcome-unknown';
          save(); // Never lose a returned ID because of the following exit/status checks.
          entry.httpStatus = httpStatus(response);
          requireResource(success(response, 'POST', path, tenantId, foundation, 201), row, binding);
          requireCondition(dto.idempotentReplay !== true && !report.created.some(other => other !== row && other.resourceId === row.resourceId),
            'A create must acknowledge a distinct new row, not an idempotent replay.');
          row.version = dto.version; entry.resourceId = row.resourceId;
        });
        requireCondition(passed, 'Creation stopped; reconcile unknown outcomes without retrying.');
      }
      for (const slot of WRITERS) {
        const row = report.created.find(item => item.creatorSlot === slot);
        runCase(slot + ':read', entry => {
          const path = rowPath(row), response = dispatch(call, foundation.actors[slot], 'GET', path, row.tenantId);
          entry.httpStatus = httpStatus(response);
          const dto = requireResource(success(response, 'GET', path, row.tenantId, foundation, 200), row, binding);
          requireCondition(dto.version === row.version, 'Owned read must preserve the acknowledged row version.');
          entry.resourceId = row.resourceId;
        });
      }
      const viewerRow = report.created.find(row => row.creatorSlot === 'adminA');
      runCase('viewerA:read', entry => {
        const path = rowPath(viewerRow), response = dispatch(call, foundation.actors.viewerA, 'GET', path, viewerRow.tenantId);
        entry.httpStatus = httpStatus(response);
        const dto = requireResource(success(response, 'GET', path, viewerRow.tenantId, foundation, 200), viewerRow, binding);
        requireCondition(dto.version === viewerRow.version, 'Viewer read must preserve the exact owned version.'); entry.resourceId = viewerRow.resourceId;
      });
      runCase('viewerA:write-denied', entry => {
        const path = rowPath(viewerRow), attemptNonce = `cli-qa-${runId}-viewer-attempt-${uuid()}`;
        viewerRow.allowedNonces.push(attemptNonce); save();
        const response = dispatch(call, foundation.actors.viewerA, 'PUT', path, viewerRow.tenantId,
          { data: { ...binding.data, [binding.nonceField]: attemptNonce }, version: viewerRow.version });
        entry.httpStatus = httpStatus(response); denial(response, 'PUT', path, viewerRow.tenantId, foundation);
      });
      for (const slot of Object.keys(qa.SLOTS)) {
        const other = qa.SLOTS[slot][0] === 'a' ? 'adminB' : 'adminA', row = report.created.find(item => item.creatorSlot === other);
        runCase(slot + ':sibling-denied', entry => {
          const path = rowPath(row), response = dispatch(call, foundation.actors[slot], 'GET', path, row.tenantId);
          entry.httpStatus = httpStatus(response); denial(response, 'GET', path, row.tenantId, foundation);
        });
      }
    } catch {
      report.status = stage === 'preflight' ? 'blocked' : 'failed';
      report.reason = stage === 'preflight' ? 'Required retained fixture, source, identity or role baseline is unavailable.'
        : 'A creation outcome or runtime case failed; automatic retries are disabled.';
    } finally {
      for (const row of report.created) {
        const cleanup = { creatorSlot: row.creatorSlot, tenantId: row.tenantId, resourceId: row.resourceId,
          status: 'unverified', deleteAcknowledged: false, absenceVerified: false };
        report.cleanup.push(cleanup); save();
        if (!row.creationDispatched) {
          row.phase = 'not-dispatched'; cleanup.status = 'not-needed';
        } else if (!row.acknowledgedBound) {
          row.phase = 'outcome-unknown'; cleanup.reason = 'Creation did not acknowledge an exact owned synthetic row.';
        } else {
          const profile = foundation.actors[qa.SLOTS[row.creatorSlot][0] === 'a' ? 'adminA' : 'adminB'];
          cleanup.profile = profile.profile; const path = rowPath(row);
          try {
            assertCandidate();
            const current = success(dispatch(call, profile, 'GET', path, row.tenantId), 'GET', path, row.tenantId, foundation, 200);
            const nonce = current?.data?.[binding.nonceField];
            requireCondition(row.allowedNonces.includes(nonce), 'Cleanup cannot adopt a changed or foreign row.');
            requireResource(current, row, binding, nonce);
            assertCandidate();
            const response = dispatch(call, profile, 'DELETE', path, row.tenantId);
            cleanup.deleteHttpStatus = httpStatus(response);
            const deleted = success(response, 'DELETE', path, row.tenantId, foundation, 200);
            requireCondition(deleted?.id === row.resourceId && deleted.deleted === true && typeof deleted.deleted_at === 'string'
              && Number.isFinite(Date.parse(deleted.deleted_at)), 'Deletion lacks its exact success receipt.');
            cleanup.deleteAcknowledged = true;
          } catch { cleanup.reason = 'Exact owned-row deletion did not return verified success.'; }
          // A failed deletion never stops the other rows or hides a subsequent absence observation.
          try {
            const response = dispatch(call, profile, 'GET', path, row.tenantId);
            cleanup.absenceHttpStatus = httpStatus(response);
            denial(response, 'GET', path, row.tenantId, foundation, [404]); cleanup.absenceVerified = true;
          } catch { cleanup.reason = 'Deletion or exact authenticated GET 404 absence proof is incomplete.'; }
          if (cleanup.deleteAcknowledged && cleanup.absenceVerified) { cleanup.status = 'passed'; row.phase = 'absent'; }
        }
        if (!['passed', 'not-needed'].includes(cleanup.status)) report.leftovers.push({ creatorSlot: row.creatorSlot, tenantId: row.tenantId,
          resourceId: row.resourceId, nonce: row.nonce, idempotencyKey: row.idempotencyKey, outcome: row.phase });
        save();
      }
      try { if (fs.existsSync(contextRoot)) fs.rmSync(contextRoot, { recursive: true }); report.localCleanupVerified = true; }
      catch { report.localCleanupVerified = false; }
      report.cleanupVerified = report.leftovers.length === 0 && report.cleanup.every(row => ['passed', 'not-needed'].includes(row.status))
        && report.localCleanupVerified;
      let sourceUnchanged = false; try { assertCandidate(); sourceUnchanged = true; } catch { /* preserve failure, never emit raw errors */ }
      const casesPassed = report.cases.length === ROLE_CASES.length && report.cases.every(row => row.status === 'passed');
      report.status = report.status === 'blocked' ? 'blocked'
        : casesPassed && report.foundationVerified && report.cleanupVerified && sourceUnchanged ? 'passed' : 'failed';
      report.qualified = report.status === 'passed' && report.qualification === 'normal-cli-profiles';
      report.completedAt = new Date(now()).toISOString(); save();
    }
    requireCondition(!report.qualified || qa.authorizationVerified({ authorizationEvidence: report }, candidate, foundation),
      'Complete exact role evidence was not accepted by the foundation validator.');
    if (report.status !== 'passed') {
      const failure = new Error('CLI authorization probe did not qualify. Private evidence: ' + output);
      failure.report = report; throw failure;
    }
    return { ...report, summaryPath: output };
  });
}

/** Parse only the three explicit opt-in paths; missing or repeated flags cannot dispatch. */
function parseArguments(args) {
  const allowed = ['--foundation', '--cli', '--output'], result = {};
  requireCondition(args.length === 6, 'Authorization probe requires --foundation, --cli and --output.');
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    requireCondition(allowed.includes(flag) && !Object.hasOwn(result, flag) && typeof value === 'string'
      && value.length > 0 && !value.startsWith('--'), 'Provide each authorization probe path exactly once.');
    result[flag] = resolve(value);
  }
  requireCondition(allowed.every(flag => result[flag]), 'Authorization probe requires all three opt-in paths.');
  return { foundationPath: result['--foundation'], cliPath: result['--cli'], output: result['--output'] };
}
if (require.main === module) {
  try {
    const report = runAuthorizationProbe(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify({ status: report.status, qualified: report.qualified, cases: report.cases.length,
      cleanupVerified: report.cleanupVerified, summaryPath: report.summaryPath }));
  } catch { console.error('CLI authorization probe did not qualify; inspect its private evidence and retained fixture references.'); process.exitCode = 1; }
}
module.exports = { SCHEMA, ROLE_CASES, runAuthorizationProbe, parseArguments, verifyPublishedFixture };
