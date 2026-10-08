import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { InitRequestAuthority, InitRequestAuthorityObserver } from './api.js';
import { assertDirectoryIdentities, createPrivateFileNoFollow, isContained, snapshotNoLinkDirectoryPath, updatePrivateFileNoFollow } from './eai-managed-deploy-filesystem.js';

const SCHEMA = 'eai.init_app_binding.v1';
const MAX_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface PendingBinding {
  schema: typeof SCHEMA;
  status: 'pending';
  nonce: string;
  recordedAt: string;
  requestKind: 'create' | 'select';
}
/** Acknowledgement proves the returned enrollment; scaffold success and cleanup completion remain separate. */
export interface InitAppBindingReceipt extends Omit<PendingBinding, 'status'>, InitRequestAuthority {
  status: 'acknowledged';
  appKey: string;
  parentTenantId: string;
  runtimeTenantId: string;
  enrollmentId: string;
  createdApp: boolean;
  createdChildTenant: boolean;
}
/** One original request may advance only its unchanged fresh pending reservation. */
export interface ReservedInitBindingReceipt {
  captureAuthority: InitRequestAuthorityObserver;
  acknowledge(binding: Omit<InitAppBindingReceipt, keyof PendingBinding | keyof InitRequestAuthority | 'status'>): Promise<void>;
}

function exactString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:@-]{1,256}$/.test(value)) {
    throw new Error(`Init receipt requires exact ${label}.`);
  }
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Init receipt response is not an object.');
  return value as Record<string, unknown>;
}
function equal(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new Error(`Init receipt ${label} differs from its original request.`);
}

/** Reserve a fresh external owner-only receipt before any provider work; existing paths never gain authority. */
export async function reserveInitBindingReceipt(
  path: unknown, nonce: unknown, projectPath: string, requestKind: 'create' | 'select',
): Promise<ReservedInitBindingReceipt | undefined> {
  if (path === undefined && nonce === undefined) return undefined;
  if (typeof path !== 'string' || !isAbsolute(path) || path.split(/[\\/]/).some(part => part === '.' || part === '..')
    || typeof nonce !== 'string' || !UUID.test(nonce)) throw new Error('Pair --binding-receipt with an absolute private path and canonical UUID --binding-receipt-nonce.');
  const retainedParents = await snapshotNoLinkDirectoryPath(dirname(path));
  for (const parent of retainedParents) {
    const gitMetadata = await lstat(resolve(parent.path, '.git')).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    });
    if (gitMetadata) throw new Error('Init binding receipt must remain outside Git working trees.');
  }
  const parent = await realpath(dirname(path));
  const parentStatus = await lstat(parent);
  if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink() || process.platform === 'win32'
    || parentStatus.uid !== process.getuid?.() || (parentStatus.mode & 0o077) !== 0) {
    throw new Error('Init receipt requires a supported POSIX owner-only directory.');
  }
  const target = resolve(parent, basename(path));
  const canonicalProject = await realpath(projectPath).catch(async error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return resolve(await realpath(dirname(projectPath)), basename(projectPath));
  });
  if (isContained(canonicalProject, target)) throw new Error('Init binding receipt must remain outside the generated project and source bundle.');
  const pending: PendingBinding = { schema: SCHEMA, status: 'pending', nonce, recordedAt: new Date().toISOString(), requestKind };
  const original = `${JSON.stringify(pending)}\n`;
  await assertDirectoryIdentities(retainedParents);
  try { await createPrivateFileNoFollow(target, original); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw Object.assign(new Error('Init binding receipt already exists. Preserve the original evidence and choose a fresh private path and nonce; no provider request was sent.', { cause: error }), { code: 'EEXIST' });
  }
  await assertDirectoryIdentities(retainedParents);
  let authority: InitRequestAuthority | undefined;
  return {
    captureAuthority(value) {
      if (authority) throw new Error('Init receipt request authority was already captured.');
      authority = { publicApiUrl: value.publicApiUrl, actorId: value.actorId };
    },
    async acknowledge(binding) {
      if (!authority) throw new Error('Init receipt has no captured request authority.');
      for (const [name, value] of Object.entries(binding)) {
        if (!['createdApp', 'createdChildTenant'].includes(name)) exactString(value, name);
      }
      if (typeof binding.createdApp !== 'boolean' || typeof binding.createdChildTenant !== 'boolean'
        || (requestKind === 'select' && (binding.createdApp || binding.createdChildTenant))) throw new Error('Init receipt requires actual creation flags.');
      const receipt: InitAppBindingReceipt = { ...pending, ...authority,
        appKey: binding.appKey, parentTenantId: binding.parentTenantId, runtimeTenantId: binding.runtimeTenantId,
        enrollmentId: binding.enrollmentId, createdApp: binding.createdApp, createdChildTenant: binding.createdChildTenant,
        status: 'acknowledged', recordedAt: new Date().toISOString() };
      const bytes = `${JSON.stringify(receipt)}\n`;
      if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('Init receipt exceeds 16 KiB.');
      await updatePrivateFileNoFollow(target, current => {
        if (current !== original) throw new Error('Init receipt reservation changed; no acknowledgement was published.');
        return bytes;
      }, MAX_BYTES, retainedParents);
    },
  };
}

/** The platform response app.id is the immutable tenant-vertical-enrollment ID, not a generated-app ID. */
export function acknowledgedCreatedAppBinding(
  value: unknown, appKey: string, parentTenantId: string, immediateParentTenantId: string,
): Pick<InitAppBindingReceipt, 'appKey' | 'parentTenantId' | 'runtimeTenantId' | 'enrollmentId' | 'createdApp' | 'createdChildTenant'> {
  const body = record(value);
  const app = record(body.app);
  const created = record(body.created);
  equal(body.tenantId, parentTenantId, 'company tenant');
  equal(body.appKey, appKey, 'app key');
  equal(body.verticalKey, appKey, 'app alias');
  equal(app.verticalKey, appKey, 'enrollment app');
  equal(app.tenantId, parentTenantId, 'enrollment company');
  equal(app.parentTenantId, immediateParentTenantId, 'enrollment parent');
  if (typeof created.app !== 'boolean' || typeof created.childTenant !== 'boolean') throw new Error('Init receipt requires actual created.app/created.childTenant booleans.');
  const child = body.childTenant == null ? undefined : record(body.childTenant);
  const childId = child ? exactString(child.id, 'child tenant ID') : undefined;
  if (childId) equal(app.childTenantId, childId, 'enrollment child tenant');
  else if (app.childTenantId) throw new Error('Init receipt child binding is missing from the response.');
  if (created.childTenant && !childId) throw new Error('Init receipt child creation has no child identity.');
  return { appKey, parentTenantId, runtimeTenantId: childId || immediateParentTenantId,
    enrollmentId: exactString(app.id, 'enrollment ID'), createdApp: created.app, createdChildTenant: created.childTenant };
}

/** Selection corroborates one complete exact-company enrollment and grants no creation ownership. */
export function acknowledgedSelectedAppBinding(
  value: unknown, appKey: string, parentTenantId: string,
): Pick<InitAppBindingReceipt, 'appKey' | 'parentTenantId' | 'runtimeTenantId' | 'enrollmentId' | 'createdApp' | 'createdChildTenant'> {
  const body = record(value);
  const docs = Array.isArray(body.docs) ? body.docs : body.items;
  if (!Array.isArray(docs) || docs.length >= 50
    || (Array.isArray(body.docs) && Array.isArray(body.items) && JSON.stringify(body.docs) !== JSON.stringify(body.items))
    || body.hasNextPage !== false || body.hasPrevPage !== false || body.nextCursor || body.nextPage
    || body.page !== 1 || body.totalPages !== 1 || body.totalDocs !== docs.length) {
    throw new Error('Init receipt existing enrollment lookup is incomplete.');
  }
  const matches = docs.map(record).filter(item => (item.data ? record(item.data) : item).verticalKey === appKey);
  if (matches.length !== 1) throw new Error('Init receipt requires one exact app enrollment.');
  const enrollment = matches[0];
  const data = enrollment.data ? record(enrollment.data) : enrollment;
  equal(data.tenantId, parentTenantId, 'selected enrollment company');
  if (enrollment.tenantId !== undefined) equal(enrollment.tenantId, parentTenantId, 'selected resource company');
  const runtime = data.childTenantId ?? data.parentTenantId ?? data.tenantId;
  return { appKey, parentTenantId, runtimeTenantId: exactString(runtime, 'selected runtime tenant ID'),
    enrollmentId: exactString(enrollment.id, 'selected enrollment ID'), createdApp: false, createdChildTenant: false };
}
