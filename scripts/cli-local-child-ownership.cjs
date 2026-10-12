#!/usr/bin/env node
// Private local-harness creation evidence; unresolved IDs never authorize cleanup.
const fs = require('node:fs');
const qa = require('./cli-qa-foundation.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function input() {
  const raw = fs.readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Local creation response is too large.');
  return JSON.parse(raw);
}
function initialize(path, publicApiUrl, profile, parentTenantId, slug) {
  const url = new URL(publicApiUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !profile || !parentTenantId || !/^e2e-local-[a-z0-9-]+$/.test(slug)) throw new Error('Invalid local ownership context.');
  qa.writePrivate(path, { schemaVersion: 'eai.cli-local-child-creation.v1', publicApiUrl, profile, parentTenantId, slug,
    phase: 'creating', creationExitCode: null, childTenantId: null, acknowledgmentBound: false,
    cleanupAttempted: false, cleanupVerified: false, hardPurgeVerified: false, absenceVerified: false, cleanupOffset: 0,
    resources: [], resourcesCleanupVerified: true, resourceCleanupUnverified: false });
}
function acknowledge(path, body, exitCode) {
  const journal = qa.readPrivate(path), envelope = body?.tenant;
  const tenant = envelope?.doc && typeof envelope.doc === 'object' ? envelope.doc : envelope;
  const id = tenant?.id;
  if (typeof id === 'string' && UUID.test(id)) journal.childTenantId = id;
  const markers = [envelope, tenant].filter(value => value && Object.hasOwn(value, 'reused'));
  const parents = [tenant?.parentTenantId, tenant?.parentTenant?.id || tenant?.parentTenant]
    .filter(value => value !== undefined && value !== null);
  journal.creationExitCode = exitCode;
  journal.acknowledgmentBound = exitCode === 0 && typeof id === 'string' && UUID.test(id) && id !== journal.parentTenantId
    && tenant.slug === journal.slug && parents.length > 0 && parents.every(value => value === journal.parentTenantId)
    && markers.every(value => value.reused === false);
  journal.phase = journal.acknowledgmentBound ? 'acknowledged' : 'unresolved'; qa.writePrivate(path, journal);
}
function reconcile(path, observations) {
  const journal = qa.readPrivate(path);
  const before = observations?.before?.tenants, after = observations?.after?.tenants;
  const beforeIds = new Set(Array.isArray(before) ? before.map(tenant => tenant.id) : []);
  const matches = Array.isArray(after) ? after.filter(tenant => tenant.slug === journal.slug && !beforeIds.has(tenant.id)) : [];
  const created = matches.length === 1 ? matches[0] : undefined;
  const verified = journal.acknowledgmentBound && Array.isArray(before) && Array.isArray(after)
    && created?.id === journal.childTenantId && created.parentId === journal.parentTenantId;
  journal.phase = verified ? 'verified' : 'unresolved'; journal.reconciliationVerified = Boolean(verified); qa.writePrivate(path, journal);
  if (!verified) throw new Error('Local child acknowledgment or inventory ownership is unresolved.');
  return { tenant: created };
}
function cleanupObservation(path, mode, body, offset) {
  const journal = qa.readPrivate(path);
  const owned = journal.phase === 'verified' && journal.reconciliationVerified === true && journal.acknowledgmentBound === true
    && UUID.test(journal.childTenantId || '') && journal.childTenantId !== journal.parentTenantId;
  let valid = owned;
  if (mode === 'cleanup-attempted') {
    journal.cleanupAttempted = true; journal.cleanupVerified = false; journal.hardPurgeVerified = false;
    journal.absenceVerified = false; journal.cleanupOffset = 0;
  } else if (mode === 'cleanup-purge') {
    valid = valid && journal.cleanupAttempted && body?.id === journal.childTenantId && body.deleted === true && body.hardPurged === true
      && body.response?.id === journal.childTenantId && body.response.status === 'hard_purged'
      && body.response.parentTenantId === journal.parentTenantId;
    journal.hardPurgeVerified = Boolean(valid);
  } else if (mode === 'cleanup-page') {
    const expected = `/v4/platform/tenants/${encodeURIComponent(journal.parentTenantId)}/children?limit=100&offset=${offset}`;
    valid = valid && journal.hardPurgeVerified && Number.isInteger(offset) && offset >= 0 && offset < 1000
      && offset === journal.cleanupOffset && body?.ok === true && body.status === 200 && body.request?.method === 'GET'
      && body.request.path === expected && body.request.tenantId === journal.parentTenantId
      && typeof body.request.publicApiUrl === 'string'
      && body.request.publicApiUrl.replace(/\/+$/, '') === journal.publicApiUrl.replace(/\/+$/, '')
      && Array.isArray(body.body) && body.body.length <= 100
      && body.body.every(row => typeof row?.id === 'string' && row.id.length > 0 && row.id !== journal.childTenantId);
    journal.absenceVerified = Boolean(valid && body.body.length < 100);
    if (valid) journal.cleanupOffset += 100;
  } else if (mode === 'cleanup-child-finished' || mode === 'cleanup-finished') {
    valid = valid && journal.cleanupAttempted && journal.hardPurgeVerified && journal.absenceVerified;
    journal.childCleanupVerified = Boolean(valid);
    journal.resourcesCleanupVerified = journal.resourceCleanupUnverified === false && Array.isArray(journal.resources)
      && journal.resources.every(row => row.deleteAcknowledged === true && row.absenceVerified === true);
    journal.cleanupVerified = Boolean(valid && journal.resourcesCleanupVerified);
    if (mode === 'cleanup-finished') valid = journal.cleanupVerified;
  } else throw new Error('Invalid local cleanup observation.');
  if (!valid) journal.cleanupVerified = false;
  qa.writePrivate(path, journal);
  if (!valid) throw new Error('Exact local child purge or complete parent absence is unverified.');
}
/** Keep exact resource DELETE and same-gateway GET404 observations, including failed attempts. */
function resourceObservation(path, mode, type, id, body, exitCode) {
  const journal = qa.readPrivate(path);
  const owned = journal.phase === 'verified' && journal.reconciliationVerified === true && journal.acknowledgmentBound === true
    && UUID.test(journal.childTenantId || '') && journal.childTenantId !== journal.parentTenantId;
  const types = ['tenant-pg-note', 'tenant-document-note', 'tenant-blob-note', 'tenant-search-note'];
  let valid = owned && types.includes(type) && typeof id === 'string' && UUID.test(id) && Array.isArray(journal.resources);
  let row = valid && journal.resources.find(value => value.type === type && value.id === id);
  if (mode === 'resource-created') {
    valid = valid && !row && !journal.resources.some(value => value.type === type) && body?.id === id && exitCode === 0;
    if (valid) journal.resources.push({ type, id, tenantId: journal.childTenantId, deleteAcknowledged: false, absenceVerified: false, attempts: [] });
  } else {
    valid = valid && Boolean(row) && row.tenantId === journal.childTenantId && Array.isArray(row.attempts) && row.attempts.length < 16;
    if (mode === 'resource-delete') {
      valid = valid && exitCode === 0 && body?.type === type && body.id === id && body.deleted === true;
      if (row) { row.deleteAcknowledged = Boolean(valid); row.deleteExitCode = exitCode; row.absenceVerified = false; }
    } else if (mode === 'resource-absence') {
      const expected = `/v4/data/resources/${encodeURIComponent(journal.childTenantId)}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
      valid = valid && row.deleteAcknowledged === true && exitCode === 1 && body?.ok === false && body.status === 404
        && body.request?.method === 'GET' && body.request.path === expected && body.request.tenantId === journal.childTenantId
        && typeof body.request.publicApiUrl === 'string'
        && body.request.publicApiUrl.replace(/\/+$/, '') === journal.publicApiUrl.replace(/\/+$/, '');
      if (row) { row.absenceVerified = Boolean(valid); row.absenceHttpStatus = Number.isInteger(body?.status) ? body.status : null; }
    } else throw new Error('Invalid local resource observation.');
    if (row && Array.isArray(row.attempts) && row.attempts.length < 16) row.attempts.push({ operation: mode,
      exitCode, httpStatus: Number.isInteger(body?.status) ? body.status : null, verified: Boolean(valid) });
  }
  if (!valid) journal.resourceCleanupUnverified = true;
  journal.resourcesCleanupVerified = journal.resourceCleanupUnverified === false && Array.isArray(journal.resources)
    && journal.resources.every(value => value.deleteAcknowledged && value.absenceVerified);
  journal.cleanupVerified = false; qa.writePrivate(path, journal);
  if (!valid) throw new Error('Exact local resource deletion or absence is unverified.');
}
/** Recover only a reconciled journal child in this exact current cleanup context. */
function cleanupChildId(path, publicApiUrl, profile, parentTenantId) {
  const journal = qa.readPrivate(path);
  if (journal.schemaVersion !== 'eai.cli-local-child-creation.v1' || journal.phase !== 'verified'
    || journal.reconciliationVerified !== true || journal.acknowledgmentBound !== true
    || journal.publicApiUrl !== publicApiUrl || journal.profile !== profile || journal.parentTenantId !== parentTenantId
    || !UUID.test(journal.childTenantId || '') || journal.childTenantId === parentTenantId) {
    throw new Error('Local child ownership is unresolved.');
  }
  return journal.childTenantId;
}
function main(args) {
  const [mode, path, ...values] = args;
  if (mode === 'init' && values.length === 4) initialize(path, ...values);
  else if (mode === 'ack' && values.length === 1) {
    const exitCode = Number(values[0]);
    if (!Number.isInteger(exitCode) || exitCode < 0) throw new Error('Invalid creation exit status.');
    let body; try { body = input(); } catch { body = null; }
    acknowledge(path, body, exitCode);
  } else if (mode === 'reconcile' && values.length === 0) process.stdout.write(JSON.stringify(reconcile(path, input())));
  else if (mode === 'cleanup-id' && values.length === 3) process.stdout.write(cleanupChildId(path, ...values));
  else if (['cleanup-attempted', 'cleanup-child-finished', 'cleanup-finished'].includes(mode) && values.length === 0) cleanupObservation(path, mode);
  else if (mode === 'cleanup-purge' && values.length === 0) cleanupObservation(path, mode, input());
  else if (mode === 'cleanup-page' && values.length === 1) cleanupObservation(path, mode, input(), Number(values[0]));
  else if (['resource-created', 'resource-delete', 'resource-absence'].includes(mode) && values.length === 3) {
    const exitCode = Number(values[2]);
    if (!Number.isSafeInteger(exitCode) || exitCode < 0) throw new Error('Invalid local resource exit status.');
    let body; try { body = input(); } catch { body = null; }
    resourceObservation(path, mode, values[0], values[1], body, exitCode);
  }
  else throw new Error('Invalid local ownership operation.');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Local child creation ownership is unresolved; inspect the retained private journal.'); process.exitCode = 1; }
}
module.exports = { initialize, acknowledge, reconcile, cleanupObservation, cleanupChildId, resourceObservation };
