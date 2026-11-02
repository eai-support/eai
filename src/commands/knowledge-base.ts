/** Tenant-explicit Knowledge Base upload through the existing resource upload and reindex API flow. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Command } from 'commander';
import { PlatformAPIClient, resolveUploadContentType } from '../lib/api.js';
import { isRecord } from '../lib/utils.js';
import { normalizeFormat } from '../lib/context.js';
import { getActiveAuthConfigMismatch } from '../lib/auth.js';
import { resolvePublicApiClient } from './publicapi.js';
import * as out from '../lib/output.js';

const OBJECT_TYPE = 'shared-kb-article';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REGIONAL_GATEWAY = /^https:\/\/(dev-api|test-api|api)\.(au|ca|eu)\.myenterprise\.ai\/public\/?$/;
/** KB extraction accepts the current document extraction and plain-text contracts only. */
export const KNOWLEDGE_BASE_CONTENT_TYPES: readonly string[] = Object.freeze([
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/html',
  'image/png', 'image/jpeg', 'image/jpg', 'image/bmp', 'image/tiff', 'image/heif', 'image/heic', 'text/plain',
]);
const KB_EXTRA_EXTENSION_TYPES: Record<string, string> = {
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.html': 'text/html', '.htm': 'text/html',
  '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heif': 'image/heif', '.heic': 'image/heic',
};
const KB_SUPPORTED_FORMATS = 'PDF, DOCX, XLSX, PPTX, plain text, HTML, PNG, JPEG/JPG, BMP, TIFF, HEIF and HEIC';
const INPUT_MESSAGES: Record<string, string> = {
  KB_UPLOAD_UNSUPPORTED_CONTENT_TYPE: `Knowledge Base uploads support ${KB_SUPPORTED_FORMATS}. Choose a supported file; use --content-type only when it correctly describes the file.`,
  KB_UPLOAD_INVALID_CONTENT_TYPE: 'Content type must be a MIME type such as application/pdf, without parameters or header newlines.',
  KB_UPLOAD_EMPTY_FILE: 'The selected file is empty. No Knowledge Base record was created.',
  KB_UPLOAD_FILE_UNREADABLE: 'The selected file could not be read. No Knowledge Base record was created.',
};

export interface KnowledgeBaseUploadOptions {
  tenantId: string;
  filePath: string;
  title?: string;
  documentType?: string;
  contentType?: string;
  visibleToChildren?: boolean;
  tags?: string[];
}

export interface KnowledgeBaseUploadResult {
  ok: boolean;
  status: 'failed' | 'outcome_unknown' | 'in_progress' | 'indexed';
  phase: 'prepare' | 'create' | 'upload' | 'verify' | 'index';
  tenantId: string;
  articleKey: string;
  resourceId: string | null;
  documentId: string | null;
  operationId: string | null;
  indexed: boolean;
  chunkCount: number | null;
  httpStatus?: number;
  error?: { code: string; message: string };
}

class UploadFailure extends Error {
  constructor(readonly code: string, readonly uncertain = false) { super(code); }
}

function requireProof(value: unknown, code: string): asserts value {
  if (!value) throw new UploadFailure(code, true);
}

/** Apply the closed platform boundary before the ordinary resolver can send a bootstrap credential. */
function requireKnowledgeBaseGateway(value: string): string {
  const match = REGIONAL_GATEWAY.exec(value);
  if (!match || (match[1] === 'dev-api' && match[2] !== 'au')) throw new Error('KB_UPLOAD_REGIONAL_CONTEXT_FAILED');
  return value.replace(/\/$/, '');
}

/** Resolve the exact workspace through the normal session API, keeping credentials inside its environment. */
async function resolveKnowledgeBaseClient(contextClient: PlatformAPIClient): Promise<PlatformAPIClient> {
  const scope = contextClient.getRequestScope();
  const gateway = REGIONAL_GATEWAY.exec(requireKnowledgeBaseGateway(scope.publicApiUrl));
  if (!gateway || (gateway[1] === 'dev-api' && gateway[2] !== 'au')) throw new Error('KB_UPLOAD_REGIONAL_CONTEXT_FAILED');
  const client = new PlatformAPIClient(scope.publicApiUrl, scope.tenantId, { publicRequestRedirect: 'error' });
  const response = await client.requestPublicApi('/v4/identity/session/resolve', { method: 'POST', body: {
    product: 'eai-cli', requestedTenantId: scope.tenantId,
  } });
  if (!response.ok || response.redirected) throw new Error('KB_UPLOAD_REGIONAL_CONTEXT_FAILED');
  const route: unknown = await response.json();
  if (!isRecord(route) || route.status !== 'resolved' || route.activeTenantId !== scope.tenantId
    || route.product !== 'eai-cli' || route.productAllowed !== true
    || !['api_only', 'in_place', 'redirect'].includes(String(route.routingMode))
    || !['au', 'ca', 'eu'].includes(String(route.homeRegion))
    || (gateway[1] === 'dev-api' && route.homeRegion !== 'au')) throw new Error('KB_UPLOAD_REGIONAL_CONTEXT_FAILED');
  const expected = `https://${gateway[1]}.${route.homeRegion}.myenterprise.ai/public`;
  if (route.apiBaseUrl !== expected && route.apiBaseUrl !== expected + '/') throw new Error('KB_UPLOAD_REGIONAL_CONTEXT_FAILED');
  contextClient.assertProfileAuthority();
  return new PlatformAPIClient(expected, scope.tenantId, { publicRequestRedirect: 'error' });
}

/** Send each existing API operation at most once; retain known IDs and never compensate an uncertain write. */
export async function uploadKnowledgeBaseDocument(
  client: PlatformAPIClient, options: KnowledgeBaseUploadOptions,
): Promise<KnowledgeBaseUploadResult> {
  const result: KnowledgeBaseUploadResult = { ok: false, status: 'failed', phase: 'prepare', tenantId: options.tenantId,
    articleKey: `kb-cli-${randomUUID()}`, resourceId: null, documentId: null, operationId: null, indexed: false, chunkCount: null };
  let dispatched = false;
  async function reply(phase: KnowledgeBaseUploadResult['phase'], send: () => Promise<Response>): Promise<Record<string, unknown>> {
    result.phase = phase; dispatched = true; delete result.httpStatus;
    const response = await send();
    result.httpStatus = response.status;
    if (!response.ok) throw new UploadFailure('KB_UPLOAD_HTTP_FAILED');
    if (response.redirected) throw new UploadFailure('KB_UPLOAD_RESPONSE_UNVERIFIED', true);
    let value: unknown;
    try { value = await response.json(); } catch { throw new UploadFailure('KB_UPLOAD_RESPONSE_UNVERIFIED', true); }
    requireProof(isRecord(value), 'KB_UPLOAD_RESPONSE_UNVERIFIED');
    return value;
  }
  try {
    const scope = client.getRequestScope();
    if (!UUID.test(options.tenantId) || scope.tenantId !== options.tenantId) throw new UploadFailure('KB_UPLOAD_TENANT_INVALID');
    let contentType: string;
    try { contentType = resolveUploadContentType(options.filePath, options.contentType).toLowerCase(); }
    catch { throw new UploadFailure('KB_UPLOAD_INVALID_CONTENT_TYPE'); }
    if (options.contentType === undefined && contentType === 'application/octet-stream') {
      contentType = KB_EXTRA_EXTENSION_TYPES[extname(options.filePath).toLowerCase()] ?? contentType;
    }
    if (!KNOWLEDGE_BASE_CONTENT_TYPES.includes(contentType)) throw new UploadFailure('KB_UPLOAD_UNSUPPORTED_CONTENT_TYPE');
    let bytes: Buffer;
    try { bytes = await readFile(options.filePath); } catch { throw new UploadFailure('KB_UPLOAD_FILE_UNREADABLE'); }
    if (!bytes.length) throw new UploadFailure('KB_UPLOAD_EMPTY_FILE');
    const title = options.title?.trim() || basename(options.filePath);
    const documentType = options.documentType?.trim() || 'Other';
    const tags = options.tags || [];
    if (title.length > 300 || documentType.length > 100 || tags.length > 16
      || tags.some(tag => !tag || tag.length > 128)) throw new UploadFailure('KB_UPLOAD_METADATA_INVALID');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const data = { tenantId: options.tenantId, articleKey: result.articleKey, title, displayName: title,
      category: documentType, documentType, tags, visibleToChildren: options.visibleToChildren === true,
      fileName: basename(options.filePath), fileSize: bytes.length, contentType, status: 'active', ragStatus: 'pending',
      ragChunkCount: 0, source: 'eai-cli', metadata: { storage: 'resourceapi', fileProperty: 'file', contentType, fileSize: bytes.length } };
    const created = await reply('create', () => client.createResource(OBJECT_TYPE, data));
    requireProof(typeof created.id === 'string' && UUID.test(created.id)
      && Number.isSafeInteger(created.version) && Number(created.version) > 0, 'KB_CREATE_RESPONSE_UNVERIFIED');
    const resourceId = created.id;
    result.resourceId = resourceId; result.documentId = `kb-${resourceId}`;
    const uploaded = await reply('upload', () => client.uploadResourceFile(OBJECT_TYPE, resourceId, 'file', options.filePath, contentType));
    requireProof(uploaded.tenantId === options.tenantId && uploaded.resourceId === resourceId && uploaded.objectType === OBJECT_TYPE
      && uploaded.propertyName === 'file' && uploaded.contentType === contentType && uploaded.checksumSha256 === checksum
      && uploaded.filename === basename(options.filePath) && uploaded.size === bytes.length
      && typeof uploaded.blobRef === 'string' && uploaded.blobRef.startsWith('azureblob://')
      && Number.isSafeInteger(uploaded.version) && Number(uploaded.version) > 0, 'KB_UPLOAD_RESPONSE_UNVERIFIED');
    const stored = await reply('verify', () => client.getResource(OBJECT_TYPE, resourceId));
    const fileMetadata = isRecord(stored.data) && isRecord(stored.data.fileMetadata) ? stored.data.fileMetadata.file : null;
    requireProof(stored.id === resourceId && stored.tenant_id === options.tenantId && stored.object_type === OBJECT_TYPE
      && Number.isSafeInteger(stored.version) && Number(stored.version) >= Number(uploaded.version)
      && isRecord(stored.data) && stored.data.file === uploaded.blobRef && stored.data.articleKey === result.articleKey
      && isRecord(fileMetadata) && fileMetadata.blobRef === uploaded.blobRef && fileMetadata.filename === uploaded.filename
      && fileMetadata.contentType === contentType && fileMetadata.size === bytes.length && fileMetadata.checksumSha256 === checksum,
    'KB_STORED_FILE_UNVERIFIED');
    const indexed = await reply('index', () => client.requestPublicApi('/v4/data/knowledge-base/reindex', { method: 'POST', body: {
      tenantId: options.tenantId, resourceId, confirmDocumentId: result.documentId, forceReindex: true,
    } }));
    requireProof(indexed.resourceId === resourceId && indexed.documentId === result.documentId, 'KB_INDEX_RESPONSE_UNVERIFIED');
    if (typeof indexed.operationId === 'string' && /^kb-rag-[a-f0-9]{32}$/.test(indexed.operationId)) result.operationId = indexed.operationId;
    if (result.httpStatus === 202 && indexed.status === 'in_progress' && indexed.success === true) {
      result.ok = true; result.status = 'in_progress'; return result;
    }
    if (indexed.success === false && indexed.status === 'failed'
      && indexed.error === 'KB_EXTRACTION_UNSUPPORTED_CONTENT_TYPE') throw new UploadFailure('KB_UPLOAD_UNSUPPORTED_CONTENT_TYPE');
    if (indexed.success !== true || indexed.status !== 'indexed') throw new UploadFailure('KB_INDEX_FAILED');
    requireProof(Number.isSafeInteger(indexed.chunkCount) && Number(indexed.chunkCount) > 0, 'KB_INDEX_RESPONSE_UNVERIFIED');
    result.ok = true; result.status = 'indexed'; result.indexed = true; result.chunkCount = Number(indexed.chunkCount);
  } catch (error) {
    const failure = error instanceof UploadFailure ? error : new UploadFailure(dispatched ? 'KB_UPLOAD_ACK_UNKNOWN' : 'KB_UPLOAD_INPUT_FAILED', dispatched);
    result.status = failure.uncertain ? 'outcome_unknown' : 'failed';
    result.error = { code: failure.code, message: dispatched
      ? (failure.code === 'KB_UPLOAD_UNSUPPORTED_CONTENT_TYPE' ? INPUT_MESSAGES[failure.code] + ' ' : '')
        + 'The document may remain stored. No request was repeated. Inspect the returned workspace, article key and record before uploading again.'
      : INPUT_MESSAGES[failure.code] || 'The upload could not start. Check the file, workspace and media type.' };
  }
  return result;
}

export const knowledgeBaseCommand = new Command('kb').description('Upload tenant Knowledge Base files and index their content');
knowledgeBaseCommand.command('upload <file>')
  .description('Upload one shared-kb-article file, verify it is stored, then request KB indexing once')
  .requiredOption('--tenant-id <id>', 'Exact workspace ID; PublicAPI enforces access')
  .option('--title <title>', 'Knowledge document title (defaults to the filename)')
  .option('--document-type <type>', 'Knowledge document category', 'Other')
  .option('--content-type <mime>', 'Override the MIME type inferred from the filename')
  .option('--tag <tag>', 'Knowledge search tag (repeatable)', (value, previous: string[]) => [...previous, value], [])
  .option('--visible-to-children', 'Allow descendant workspaces to retrieve this document', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .addHelpText('after', `\nSupported KB files: ${KB_SUPPORTED_FORMATS}.\nMarkdown, CSV and unknown media types are rejected before record creation.\nThis uses the existing KB APIs, separate from docs upload/classification.\nA pending index is not complete. Do not repeat this command after a timeout.\nNo failed or uncertain write is retried or deleted automatically.\n`)
  .action(async (filePath: string, options: KnowledgeBaseUploadOptions & { tag: string[]; format: string }) => {
    const format = normalizeFormat(options);
    let result: KnowledgeBaseUploadResult;
    try {
      if (await getActiveAuthConfigMismatch()) throw new Error('KB_UPLOAD_CONTEXT_FAILED');
      const context = await resolvePublicApiClient(options, { validateUrl: requireKnowledgeBaseGateway, redirect: 'error' });
      context.client.assertProfileAuthority();
      const client = await resolveKnowledgeBaseClient(context.client);
      result = await uploadKnowledgeBaseDocument(client, { ...options, filePath, tags: options.tag });
    } catch {
      result = { ok: false, status: 'failed', phase: 'prepare', tenantId: options.tenantId, articleKey: '', resourceId: null,
        documentId: null, operationId: null, indexed: false, chunkCount: null,
        error: { code: 'KB_UPLOAD_CONTEXT_FAILED', message: 'The selected login or workspace route is unavailable. Select a matching regional profile and check session routing. No upload started.' } };
    }
    if (format === 'json') out.json(result);
    else {
      if (!result.ok) out.error(`${result.error?.code}: ${result.error?.message}`);
      else if (!result.indexed) out.warn(`Indexing is still in progress for ${result.resourceId}. Do not upload again.`);
      else out.success(`Indexed ${result.resourceId}: ${result.chunkCount} chunks.`);
      if (result.phase !== 'prepare') {
        out.info(`Workspace: ${result.tenantId}; article key: ${result.articleKey}`);
        if (result.resourceId) out.info(`Inspect record ${result.resourceId} through this workspace's regional Knowledge Base before taking another action.`);
      }
    }
    if (!result.ok) process.exitCode = 1;
  });
