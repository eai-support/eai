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
    phase: 'creating', creationExitCode: null, childTenantId: null, acknowledgmentBound: false, cleanupAttempted: false });
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
function main(args) {
  const [mode, path, ...values] = args;
  if (mode === 'init' && values.length === 4) initialize(path, ...values);
  else if (mode === 'ack' && values.length === 1) {
    const exitCode = Number(values[0]);
    if (!Number.isInteger(exitCode) || exitCode < 0) throw new Error('Invalid creation exit status.');
    let body; try { body = input(); } catch { body = null; }
    acknowledge(path, body, exitCode);
  } else if (mode === 'reconcile' && values.length === 0) process.stdout.write(JSON.stringify(reconcile(path, input())));
  else if (mode === 'cleanup-attempted' && values.length === 0) {
    const journal = qa.readPrivate(path); journal.cleanupAttempted = true; qa.writePrivate(path, journal);
  } else throw new Error('Invalid local ownership operation.');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Local child creation ownership is unresolved; inspect the retained private journal.'); process.exitCode = 1; }
}
module.exports = { initialize, acknowledge, reconcile };
