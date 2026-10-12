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
    cleanupAttempted: false, cleanupVerified: false, hardPurgeVerified: false, absenceVerified: false, cleanupOffset: 0 });
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
  } else if (mode === 'cleanup-finished') {
    valid = valid && journal.cleanupAttempted && journal.hardPurgeVerified && journal.absenceVerified;
    journal.cleanupVerified = Boolean(valid);
  } else throw new Error('Invalid local cleanup observation.');
  if (!valid) journal.cleanupVerified = false;
  qa.writePrivate(path, journal);
  if (!valid) throw new Error('Exact local child purge or complete parent absence is unverified.');
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
  else if (['cleanup-attempted', 'cleanup-finished'].includes(mode) && values.length === 0) cleanupObservation(path, mode);
  else if (mode === 'cleanup-purge' && values.length === 0) cleanupObservation(path, mode, input());
  else if (mode === 'cleanup-page' && values.length === 1) cleanupObservation(path, mode, input(), Number(values[0]));
  else throw new Error('Invalid local ownership operation.');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Local child creation ownership is unresolved; inspect the retained private journal.'); process.exitCode = 1; }
}
module.exports = { initialize, acknowledge, reconcile, cleanupObservation };
