/** Knowledge Base upload transport regressions use only controlled local files and fetch. */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/auth.js', () => ({ getAccessToken: vi.fn(async () => '<controlled-token>'), loadTokens: vi.fn(async () => null), getActiveAuthConfigMismatch: vi.fn(async () => null) }));
import { PlatformAPIClient } from '../../src/lib/api.js';
import { uploadKnowledgeBaseDocument, knowledgeBaseCommand, KNOWLEDGE_BASE_CONTENT_TYPES } from '../../src/commands/knowledge-base.js';
import * as publicApiModule from '../../src/commands/publicapi.js';
import * as output from '../../src/lib/output.js';
import * as config from '../../src/lib/config.js';
import * as profile from '../../src/lib/profile.js';
import * as auth from '../../src/lib/auth.js';

const TENANT = '11111111-2222-4333-8444-555555555555';
const GATEWAY = 'https://test-api.au.myenterprise.ai/public';

describe('KB file MIME and mounted PublicAPI route family', () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([
    ['owned.PDF', 'application/pdf'],
    ['owned.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['owned.unknown', 'application/octet-stream'],
  ])('resource upload retains %s bytes and correct media type', async (name, contentType) => {
    const dir = await mkdtemp(join(tmpdir(), 'eai-kb-mime-'));
    const bytes = Buffer.from('%PDF-controlled-only\u0000');
    const file = join(dir, name);
    await writeFile(file, bytes);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    try {
      await new PlatformAPIClient(GATEWAY, TENANT).uploadResourceFile('shared-kb-article', 'owned-id', 'file', file);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe(`${GATEWAY}/v4/data/resources/${TENANT}/shared-kb-article/owned-id/files/file?filename=${name}`);
      expect(init?.headers).toMatchObject({ 'Content-Type': contentType, 'X-Tenant-Id': TENANT, Authorization: 'Bearer <controlled-token>' });
      expect(init?.body).toEqual(bytes);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test.each([
    ['GET', '/v4/data/knowledge-base/documents'],
    ['POST', '/v4/data/knowledge-base/reindex'],
  ] as const)('mounted KB %s %s uses normal authenticated transport', async (method, path) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await new PlatformAPIClient(GATEWAY, TENANT).requestPublicApi(path, { method });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(GATEWAY + path);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Tenant-Id': TENANT, Authorization: 'Bearer <controlled-token>' });
  });

  test.each(['/v4/data/knowledge-base-other/reindex', '/v4/data/knowledge-base/unknown', '/v4/data/knowledge-base/../unknown',
    '/v4/data/knowledge-base/%2e%2e/unknown', '/v4/data/knowledge-base/reindex/extra', '/v4/data/knowledge-base/reindex#fragment',
    '/v4/unknown/reindex', `/v${3}/knowledge-base/reindex`, 'https://foreign.invalid/v4/data/knowledge-base/reindex'])('unrelated or legacy route %s is still refused before transport', async path => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_NETWORK'));
    await expect(new PlatformAPIClient(GATEWAY, TENANT).requestPublicApi(path)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a valid explicit media type is used without changing file bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eai-kb-override-'));
    const file = join(dir, 'owned.bin'); await writeFile(file, 'controlled');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    try {
      await new PlatformAPIClient(GATEWAY, TENANT).uploadResourceFile('shared-kb-article', 'owned-id', 'file', file, 'application/pdf');
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'Content-Type': 'application/pdf' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test.each(['', 'application/pdf\r\nAuthorization: private', '*/*', 'text/plain; charset=utf-8', 'not-a-type'])('invalid explicit media type %s makes no request', async contentType => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_NETWORK'));
    await expect(new PlatformAPIClient(GATEWAY, TENANT).uploadResourceFile('shared-kb-article', 'owned-id', 'file', '/not-read', contentType)).rejects.toThrow('Content type must');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const RESOURCE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FOREIGN = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const SENTINEL = 'private https://secret.invalid/file?sig=must-not-print bearer-sensitive';

interface Transcript { phase: string; method: string; path: string; url: string; body: unknown; headers: HeadersInit | undefined }

async function uploadFixture(fault?: string, command = false, kind: 'pdf' | 'docx' = 'pdf', outsideProject = false): Promise<{ result: Awaited<ReturnType<typeof uploadKnowledgeBaseDocument>>; transcript: Transcript[]; storedData: Record<string, unknown> }> {
  const directory = await mkdtemp(join(tmpdir(), 'eai-kb-flow-'));
  const name = kind === 'docx' ? 'owned.docx' : 'owned.PDF';
  const mime = kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
  const filePath = join(directory, name); const bytes = kind === 'docx' ? await readFile(new URL('../fixtures/kb-supported-word.docx', import.meta.url)) : Buffer.from('%PDF-source-controlled');
  await writeFile(filePath, bytes);
  const { createHash } = await import('node:crypto');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const transcript: Transcript[] = []; let createdData: Record<string, unknown> = {}, storedData: Record<string, unknown> = {};
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname, method = String(init?.method || 'GET');
    if (path.endsWith('/session/resolve')) {
      transcript.push({ phase: 'route', method, path, url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers });
      expect(init?.redirect).toBe('error');
      return new Response(JSON.stringify({ status: 'resolved', product: 'eai-cli', activeTenantId: fault === 'route-tenant' ? FOREIGN : TENANT,
        homeRegion: fault === 'route-region' ? 'unknown' : fault === 'route-eu' ? 'eu' : 'au', productAllowed: fault !== 'route-blocked',
        routingMode: fault === 'route-mode' ? 'unknown' : 'api_only', apiBaseUrl: fault === 'route-foreign' ? 'https://foreign.invalid/public'
          : fault === 'route-env' ? 'https://api.au.myenterprise.ai/public' : fault === 'route-eu' ? 'https://test-api.eu.myenterprise.ai/public' : GATEWAY }));
    }
    const phase = path.endsWith('/reindex') ? 'index' : path.endsWith('/files/file') ? 'upload' : method === 'GET' ? 'verify' : method === 'PUT' ? 'link' : 'create';
    const body = phase === 'upload' ? init?.body : method === 'GET' ? undefined : JSON.parse(String(init?.body));
    transcript.push({ phase, method, path, url: String(url), body, headers: init?.headers });
    expect(init?.redirect).toBe('error');
    if (fault === `${phase}-unknown`) throw new Error(SENTINEL);
    if (fault === `${phase}-http`) return new Response(JSON.stringify({ error: SENTINEL }), { status: 403 });
    let reply: Record<string, unknown>;
    if (phase === 'create') {
      createdData = body.data;
      storedData = structuredClone(createdData);
      reply = { id: fault === 'create-malformed' ? null : RESOURCE, version: 1, data: createdData };
    } else if (phase === 'upload') {
      expect(init?.body).toEqual(bytes);
      storedData = { ...storedData, file: 'azureblob://owned/file.pdf', fileMetadata: { file: { filename: name, contentType: mime, size: bytes.length, blobRef: 'azureblob://owned/file.pdf', checksumSha256: checksum, serverOwnedField: 'retained' } } };
      reply = { tenantId: fault === 'upload-foreign' ? FOREIGN : TENANT, resourceId: RESOURCE, objectType: 'shared-kb-article', propertyName: 'file',
        contentType: fault === 'upload-mime' ? 'application/octet-stream' : mime, checksumSha256: fault === 'upload-drift' ? '0'.repeat(64) : checksum,
        filename: fault === 'upload-filename' ? 'foreign.pdf' : name, size: fault === 'upload-size' ? 0 : bytes.length,
        blobRef: 'azureblob://owned/file.pdf', blobUrl: SENTINEL, version: 2 };
    } else if (phase === 'link') {
      expect(body.version).toBe(2); expect(body.data.articleKey).toBe(createdData.articleKey);
      storedData = body.data;
      reply = { id: fault === 'link-foreign' ? FOREIGN : RESOURCE, version: 3, data: body.data };
    } else if (phase === 'verify') {
      const recordData = structuredClone(storedData);
      const metadata = (recordData.fileMetadata as { file: Record<string, unknown> }).file;
      if (fault === 'verify-missing') delete recordData.fileMetadata;
      if (fault === 'verify-mime') metadata.contentType = 'application/octet-stream';
      if (fault === 'verify-checksum') metadata.checksumSha256 = '0'.repeat(64);
      if (fault === 'verify-size') metadata.size = 0;
      if (fault === 'verify-file') recordData.file = 'azureblob://foreign/file.pdf';
      if (fault === 'verify-article') recordData.articleKey = 'foreign';
      reply = { id: fault === 'verify-id' ? FOREIGN : RESOURCE, tenant_id: fault === 'verify-tenant' ? FOREIGN : TENANT,
        object_type: fault === 'verify-type' ? 'file-asset' : 'shared-kb-article', version: fault === 'verify-stale' ? 1 : 2, data: recordData };
    } else {
      expect(body).toEqual({ tenantId: TENANT, resourceId: RESOURCE, confirmDocumentId: `kb-${RESOURCE}`, forceReindex: true });
      reply = { success: fault !== 'index-failed', status: fault === 'index-pending' ? 'in_progress' : fault === 'index-failed' ? 'failed' : fault === 'index-skipped' ? 'skipped' : 'indexed',
        resourceId: fault === 'index-foreign' ? FOREIGN : RESOURCE, documentId: `kb-${RESOURCE}`, operationId: 'kb-rag-' + 'a'.repeat(32), chunkCount: fault === 'index-empty' ? 0 : 4, error: SENTINEL };
    }
    return new Response(JSON.stringify(reply), { status: fault === 'index-pending' && phase === 'index' ? 202 : 200 });
  });
  try {
    const client = new PlatformAPIClient(GATEWAY, TENANT, { publicRequestRedirect: 'error' });
    let result: Awaited<ReturnType<typeof uploadKnowledgeBaseDocument>>;
    if (command) {
      const context = outsideProject ? null : vi.spyOn(publicApiModule, 'resolvePublicApiClient').mockResolvedValue({ client, tenantId: TENANT, publicApiUrl: GATEWAY });
      const json = vi.spyOn(output, 'json').mockImplementation(() => {});
      await knowledgeBaseCommand.parseAsync(['upload', filePath, '--tenant-id', TENANT, '--tag', 'owned-marker', '--format', 'json'], { from: 'user' });
      if (context) expect(context).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), { validateUrl: expect.any(Function), redirect: 'error' });
      expect(json).toHaveBeenCalledTimes(1);
      result = json.mock.calls[0][0] as Awaited<ReturnType<typeof uploadKnowledgeBaseDocument>>;
    } else result = await uploadKnowledgeBaseDocument(client, { tenantId: TENANT, filePath, tags: ['owned-marker'] });
    return { result, transcript, storedData };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('real SDK composed Portal KB upload/index sequence', () => {
  afterEach(() => vi.restoreAllMocks());
  test.each(['pdf', 'docx'] as const)('uploads supported %s once, preserves exact workspace/version/file and indexes through the KB route', async kind => {
    const { result, transcript } = await uploadFixture(undefined, false, kind);
    expect(result).toMatchObject({ ok: true, indexed: true, status: 'indexed', chunkCount: 4, resourceId: RESOURCE, documentId: `kb-${RESOURCE}` });
    expect(transcript.map(x => x.phase)).toEqual(['create', 'upload', 'verify', 'index']);
    expect(transcript.map(x => x.method)).toEqual(['POST', 'POST', 'GET', 'POST']);
    expect(transcript[1].headers).toMatchObject({ 'Content-Type': kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf' });
    expect(transcript.every(x => new Headers(x.headers).get('X-Tenant-Id') === TENANT)).toBe(true);
    expect(transcript.some(x => x.path.includes('/data/documents'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  test('server-committed upload metadata is retained without a redundant resource PUT', async () => {
    const { result, transcript, storedData } = await uploadFixture();
    expect(result.indexed).toBe(true);
    expect(storedData.fileMetadata).toEqual({ file: expect.objectContaining({ filename: 'owned.PDF', contentType: 'application/pdf', serverOwnedField: 'retained' }) });
    expect(transcript.some(row => row.method === 'PUT')).toBe(false);
  });

  test('202 is pending rather than indexed and never starts a second reindex', async () => {
    const { result, transcript } = await uploadFixture('index-pending');
    expect(result).toMatchObject({ ok: true, status: 'in_progress', indexed: false, chunkCount: null });
    expect(transcript.filter(x => x.phase === 'index')).toHaveLength(1);
  });

  test.each(['create', 'upload', 'verify', 'index'])('%s HTTP rejection stops with actual phase/status and no retry or cleanup', async phase => {
    const { result, transcript } = await uploadFixture(`${phase}-http`);
    expect(result).toMatchObject({ ok: false, status: 'failed', phase, httpStatus: 403, indexed: false });
    expect(transcript.map(x => x.phase).at(-1)).toBe(phase);
    expect(transcript.filter(x => x.phase === phase)).toHaveLength(1);
    expect(transcript.some(x => x.method === 'DELETE')).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  test.each(['create', 'upload', 'verify', 'index'])('%s unknown acknowledgement retains only observed IDs and never repeats a write', async phase => {
    const { result, transcript } = await uploadFixture(`${phase}-unknown`);
    expect(result).toMatchObject({ ok: false, status: 'outcome_unknown', phase, indexed: false });
    expect(result.resourceId).toBe(phase === 'create' ? null : RESOURCE);
    expect(transcript.filter(x => x.phase === phase)).toHaveLength(1);
    expect(transcript.map(x => x.phase).at(-1)).toBe(phase);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  test.each(['create-malformed', 'upload-foreign', 'upload-mime', 'upload-drift', 'upload-filename', 'upload-size',
    'verify-id', 'verify-tenant', 'verify-type', 'verify-stale', 'verify-missing', 'verify-mime', 'verify-checksum', 'verify-size', 'verify-file', 'verify-article',
    'index-foreign', 'index-empty'])('%s successful but unverified reply cannot become indexed or advance another write', async fault => {
    const { result, transcript } = await uploadFixture(fault);
    expect(result.ok).toBe(false); expect(result.status).toBe('outcome_unknown'); expect(result.indexed).toBe(false);
    expect(transcript.map(x => x.phase).at(-1)).toBe(fault.split('-')[0]);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  test.each(['index-failed', 'index-skipped'])('%s HTTP200 is not indexing success', async fault => {
    const { result } = await uploadFixture(fault);
    expect(result).toMatchObject({ ok: false, status: 'failed', phase: 'index', indexed: false });
    expect(result.error?.code).toBe('KB_INDEX_FAILED');
  });

  test('an explicit workspace mismatch is refused before opening a file or sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_NETWORK'));
    const result = await uploadKnowledgeBaseDocument(new PlatformAPIClient(GATEWAY, TENANT), { tenantId: FOREIGN, filePath: '/private-not-opened' });
    expect(result).toMatchObject({ status: 'failed', phase: 'prepare', indexed: false });
    expect(fetchMock).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('/private-not-opened');
  });

  test.each([undefined, 'index-pending', 'index-failed', 'upload-unknown'])('CLI emits truthful JSON and exit status for %s without raw body/errors', async fault => {
    const original = process.exitCode;
    try {
      process.exitCode = undefined;
      const { result } = await uploadFixture(fault, true);
      expect(process.exitCode).toBe(result.ok ? undefined : 1);
      expect(result.indexed).toBe(fault === undefined);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(result.resourceId).toBe(RESOURCE);
    } finally { process.exitCode = original; }
  });

  test('CLI resolves an EU workspace from a default AU gateway before sending upload/index operations and readback to EU', async () => {
    const original = process.exitCode;
    try {
      const { result, transcript } = await uploadFixture('route-eu', true);
      expect(result.indexed).toBe(true);
      expect(transcript.filter(row => row.phase === 'route')).toHaveLength(1);
      expect(transcript[0].body).toEqual({ product: 'eai-cli', requestedTenantId: TENANT });
      expect(transcript.filter(row => row.phase !== 'route')).toHaveLength(4);
      expect(transcript.filter(row => row.phase !== 'route').every(row => row.url.startsWith('https://test-api.eu.myenterprise.ai/public/'))).toBe(true);
    } finally { process.exitCode = original; }
  });

  test.each(['route-foreign', 'route-env', 'route-region', 'route-tenant', 'route-blocked', 'route-mode'])('CLI %s never sends a mutation or credentials to the rejected route', async fault => {
    const original = process.exitCode;
    try {
      const { result, transcript } = await uploadFixture(fault, true);
      expect(result).toMatchObject({ ok: false, phase: 'prepare', resourceId: null, indexed: false });
      expect(transcript.map(row => row.phase)).toEqual(['route']);
      expect(transcript.every(row => row.url.startsWith(GATEWAY + '/'))).toBe(true);
    } finally { process.exitCode = original; }
  });

  test('a foreign bootstrap is refused by the real context chain before any credentialed fetch', async () => {
    const original = process.exitCode;
    vi.spyOn(config, 'findProjectRoot').mockResolvedValue(null);
    vi.spyOn(profile, 'getActiveProfile').mockReturnValue('default');
    vi.stubEnv('BASE_URL_PUBLIC_API', '');
    vi.stubEnv('ROUTING_BOOTSTRAP_PUBLIC_API_URL', 'https://foreign.invalid/public');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_PROVIDER_ALLOWED'));
    const json = vi.spyOn(output, 'json').mockImplementation(() => {});
    try {
      await knowledgeBaseCommand.parseAsync(['upload', '/file-not-opened', '--tenant-id', TENANT, '--format', 'json'], { from: 'user' });
      expect(json.mock.calls[0][0]).toMatchObject({ ok: false, phase: 'prepare', resourceId: null });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { process.exitCode = original; vi.unstubAllEnvs(); }
  });

  test('ordinary selected-login mismatch holds before routing without exposing its diagnostic', async () => {
    const original = process.exitCode;
    vi.mocked(auth.getActiveAuthConfigMismatch).mockResolvedValueOnce(SENTINEL);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_PROVIDER_ALLOWED'));
    const json = vi.spyOn(output, 'json').mockImplementation(() => {});
    try {
      await knowledgeBaseCommand.parseAsync(['upload', '/file-not-opened', '--tenant-id', TENANT, '--format', 'json'], { from: 'user' });
      expect(json.mock.calls[0][0]).toMatchObject({ ok: false, phase: 'prepare', resourceId: null });
      expect(JSON.stringify(json.mock.calls)).not.toContain(SENTINEL);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { process.exitCode = original; }
  });

  test.each(['owned.md', 'owned.csv', 'owned.unknown'])('unsupported KB file %s is refused before create/upload/index', async name => {
    const directory = await mkdtemp(join(tmpdir(), 'eai-kb-unsupported-')); const filePath = join(directory, name);
    await writeFile(filePath, 'synthetic unsupported KB input');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_PROVIDER_ALLOWED'));
    try {
      const result = await uploadKnowledgeBaseDocument(new PlatformAPIClient(GATEWAY, TENANT), { tenantId: TENANT, filePath });
      expect(result).toMatchObject({ ok: false, phase: 'prepare', error: { code: 'KB_UPLOAD_UNSUPPORTED_CONTENT_TYPE' } });
      expect(result.error?.message).toContain('PDF'); expect(result.error?.message).toContain('DOCX');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test('invalid KB MIME syntax retains its known safe reason with zero dispatch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_PROVIDER_ALLOWED'));
    const result = await uploadKnowledgeBaseDocument(new PlatformAPIClient(GATEWAY, TENANT), { tenantId: TENANT, filePath: '/not-opened.pdf', contentType: 'text/plain\r\nAuthorization: private' });
    expect(result.error?.code).toBe('KB_UPLOAD_INVALID_CONTENT_TYPE');
    expect(JSON.stringify(result)).not.toContain('Authorization'); expect(fetchMock).not.toHaveBeenCalled();
  });

  test('empty KB input retains its specific safe message before any record creation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eai-kb-empty-')); const filePath = join(directory, 'empty.pdf'); await writeFile(filePath, '');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_PROVIDER_ALLOWED'));
    try {
      const result = await uploadKnowledgeBaseDocument(new PlatformAPIClient(GATEWAY, TENANT), { tenantId: TENANT, filePath });
      expect(result.error?.code).toBe('KB_UPLOAD_EMPTY_FILE'); expect(result.error?.message).toContain('empty');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test('KB MIME contract equals the immutable AICore source fixture, while generic resource uploads stay general', async () => {
    const fixture = JSON.parse(await readFile(new URL('../fixtures/kb-extraction-content-types.json', import.meta.url), 'utf8'));
    expect([...KNOWLEDGE_BASE_CONTENT_TYPES].sort()).toEqual([...fixture.extractableContentTypes, ...fixture.textContentTypes].sort());
    const directory = await mkdtemp(join(tmpdir(), 'eai-generic-md-')); const filePath = join(directory, 'owned.md'); await writeFile(filePath, 'synthetic markdown');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    try {
      await new PlatformAPIClient(GATEWAY, TENANT).uploadResourceFile('file-asset', RESOURCE, 'file', filePath);
      expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'Content-Type': 'text/markdown' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test('tenant-explicit KB upload works outside an EAI project through the actual normal resolver and SDK', async () => {
    const original = process.exitCode;
    const root = vi.spyOn(config, 'findProjectRoot').mockResolvedValue(null);
    vi.spyOn(profile, 'getActiveProfile').mockReturnValue('default'); vi.stubEnv('BASE_URL_PUBLIC_API', GATEWAY);
    try {
      const { result, transcript } = await uploadFixture(undefined, true, 'docx', true);
      expect(root).toHaveBeenCalled(); expect(result.indexed).toBe(true);
      expect(transcript.map(row => row.phase)).toEqual(['route', 'create', 'upload', 'verify', 'index']);
    } finally { process.exitCode = original; vi.unstubAllEnvs(); }
  });
});
