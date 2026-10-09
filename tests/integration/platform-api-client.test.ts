import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/auth.js', () => ({
  getAccessToken: vi.fn(async () => '<fixture-access-token>'),
}))

import { INIT_APP_CREATE_REQUEST_TIMEOUT_MS, MANAGED_PUBLIC_REQUEST_TIMEOUT_MS, MANAGED_SOURCE_UPLOAD_TIMEOUT_MS, PlatformAPIClient, isChildTenantCreateRequest, isManagedPublicRequestTimeout, parseApiError, readManagedPublicResponseText } from '../../src/lib/api.js'
import { getAccessToken } from '../../src/lib/auth.js'
import { pollExactOperation, readExactOperation } from '../../src/commands/eai-managed-deploy-operation.js'

describe('PlatformAPIClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('preserves exact tenant filter, stable sorting and bounded deadlines on every type export page', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'owned-tenant')
    for (const page of [1, 2, 3]) await client.getPublishedObjectTypes({ page, limit: 100, sort: 'id', timeoutMs: 500 })
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [index, [input, options]] of fetch.mock.calls.entries()) {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/public/v4/data/resources/object-types')
      expect(url.searchParams.get('where[tenant][equals]')).toBe('owned-tenant')
      expect(url.searchParams.get('page')).toBe(String(index + 1))
      expect(url.searchParams.get('sort')).toBe('id')
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.has('where[status][equals]')).toBe(false)
      expect(options?.headers).toMatchObject({ 'X-Tenant-Id': 'owned-tenant', Authorization: 'Bearer <fixture-access-token>' })
      expect(options?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  test('caps managed requests and preserves a tighter client or per-read budget', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    await client.getManagedDeploymentOperation('tenant-one', 'my-app', 'operation-one', 'runtime-tenant')
    await client.getManagedDeploymentOperation('tenant-one', 'my-app', 'operation-one', 'runtime-tenant', 50)
    const tight = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one', { managedRequestTimeoutMs: 75 })
    await tight.getManagedDeploymentOperation('tenant-one', 'my-app', 'operation-one', 'runtime-tenant', 5000)
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([MANAGED_PUBLIC_REQUEST_TIMEOUT_MS, 50, 75])
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal && init.redirect === 'error')).toBe(true)
  })

  test('gives only source upload a bounded longer deadline while preserving tighter command budgets', () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    const tight = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one', { managedRequestTimeoutMs: 75 })
    client.managedSourceUploadSignal()
    client.managedSourceUploadSignal(50)
    tight.managedSourceUploadSignal()
    client.managedRequestSignal()
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      MANAGED_SOURCE_UPLOAD_TIMEOUT_MS, 50, 75, MANAGED_PUBLIC_REQUEST_TIMEOUT_MS,
    ])
  })

  test.each([0, -1, Infinity, NaN, 0.5])('rejects invalid managed HTTP budget %s before credentials or fetch', async timeoutMs => {
    const token = vi.mocked(getAccessToken)
    token.mockClear()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    await expect(client.getManagedDeploymentOperation('tenant-one', 'my-app', 'operation-one', 'runtime-tenant', timeoutMs)).rejects.toThrow('positive bounded integer')
    expect(token).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('aborts an actual hung fetch lifetime without retrying or dropping the original authority', async () => {
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requestSignal = init?.signal ?? undefined
      if (!requestSignal) throw new Error('A managed deadline signal is required')
      // A real in-flight fetch owns a live socket; this mock retains that lifetime until abort.
      const alive = setInterval(() => {}, 1000)
      try {
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
        })
      } finally { clearInterval(alive) }
    })
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    let error: unknown
    try { await client.getManagedDeploymentOperation('tenant-one', 'my-app', 'operation-one', 'runtime-tenant', 25) }
    catch (caught) { error = caught }
    expect(requestSignal?.aborted).toBe(true)
    expect(isManagedPublicRequestTimeout(error)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual([
      'https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-one/apps/my-app/managed-deployments/operations/operation-one?targetTenantId=runtime-tenant',
      expect.objectContaining({ method: 'GET', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer <fixture-access-token>' }) }),
    ])
  })

  test('keeps the deadline active after headers and classifies a hung exact-operation body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const signal = init?.signal
      if (!signal) throw new Error('A managed deadline signal is required')
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const alive = setInterval(() => {}, 1000)
          signal.addEventListener('abort', () => {
            clearInterval(alive)
            controller.error(new DOMException('Native body read aborted', 'AbortError'))
          }, { once: true })
          controller.enqueue(new TextEncoder().encode('{'))
        },
      })
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    await expect(readExactOperation(client, 'tenant-one', 'runtime-tenant', 'my-app', 'operation-one', 'source-unknown', 25)).rejects.toMatchObject({
      code: 'SOURCE_OPERATION_TIMEOUT',
      nextAction: 'Keep the original recovery receipt and use --retry operation-one against its saved gateway; do not dispatch a duplicate workflow.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  test('times out slow credential acquisition before any managed authority is sent', async () => {
    let finishToken!: (value: string) => void
    vi.mocked(getAccessToken).mockImplementationOnce(() => new Promise(resolve => { finishToken = resolve }))
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const alive = setInterval(() => {}, 1000)
    try {
      const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one', { managedRequestTimeoutMs: 25 })
      await expect(client.getCliManagedGithubLinkSession('tenant-one', 'my-app', 'link-one', 'runtime-tenant', 'preview')).rejects.toMatchObject({ name: 'TimeoutError' })
      finishToken('<fixture-access-token>')
      await Promise.resolve()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { clearInterval(alive) }
  })

  test.each(['AbortError', 'TimeoutError'])('does not misclassify an unrelated provider %s as its own deadline', async name => {
    const error = new DOMException('Provider aborted independently', name)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error)
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    await expect(readExactOperation(client, 'tenant-one', 'runtime-tenant', 'my-app', 'operation-one')).rejects.toBe(error)
    expect(isManagedPublicRequestTimeout(error)).toBe(false)
  })

  test('passes only the remaining polling budget into the next exact HTTP read', async () => {
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      now += 990
      return new Response(JSON.stringify({ operationId: 'operation-one', appKey: 'my-app', appScopeTenantId: 'tenant-one', targetTenantId: 'runtime-tenant', sourceMode: 'source-unknown', environment: 'preview', status: 'pending', sourceStatus: 'issued', setup: {} }))
    })
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    await expect(pollExactOperation(client, { tenantId: 'tenant-one', targetTenantId: 'runtime-tenant', appKey: 'my-app', operationId: 'operation-one' }, true, 1)).rejects.toMatchObject({ code: 'SOURCE_OPERATION_TIMEOUT' })
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([1000, 10])
  })

  test('applies the same body-active deadline to legacy OIDC evidence without replacing its credential', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const digest = `sha256:${'b'.repeat(64)}`
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    const response = await client.submitSourceUnknownWorkflowEvidence('tenant-one', 'my-app', {
      operationId: 'source-unknown-abc123', nonce: 'one-time-nonce', sourceMode: 'source-unknown',
      workflowPath: '.github/workflows/eai-app.yml', workflowBlobSha: 'a'.repeat(40), collectorDigest: digest,
      ref: 'refs/heads/main', commitSha: 'a'.repeat(40), configHash: digest, artifactDigest: digest,
      imageArtifact: { id: '123', name: 'eai-generated-app-image', archiveDigest: digest }, imageDigest: digest,
      schemaProvenance: { templateVersion: '3.12.0', schemaDigest: digest, validatorDigest: digest },
      workflowRun: { id: '456', attempt: '1' }, validationSummary: { status: 'passed' },
    }, '<fixture-github-oidc>')
    expect(await readManagedPublicResponseText(response)).toBe('{}')
    expect(timeout).toHaveBeenCalledExactlyOnceWith(MANAGED_PUBLIC_REQUEST_TIMEOUT_MS)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-one/apps/my-app/source-unknown/workflow-evidence',
      expect.objectContaining({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal), headers: expect.objectContaining({ Authorization: 'Bearer <fixture-github-oidc>' }) }),
    )
  })

  test('keeps managed source preparation and actor linking on tenant/app-scoped v4 routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    const link = { schemaVersion: 'eai.cli_managed_github_link.v1' as const, targetTenantId: 'runtime-tenant', environment: 'preview' as const, idempotencyKey: '12345678-1234-1234-1234-123456789abc' }
    await client.createCliManagedGithubLinkSession('tenant-one', 'my-app', link)
    await client.getCliManagedGithubLinkSession('tenant-one', 'my-app', 'link-one', 'runtime-tenant', 'preview')
    const prep = {
      schemaVersion: 'eai.cli_managed_source_preparation.v1' as const, templateCommitSha: 'a'.repeat(40),
      bundleSha256: `sha256:${'b'.repeat(64)}`, configHash: `sha256:${'c'.repeat(64)}`, fileCount: 2, totalBytes: 120, githubLinkSessionId: 'link-one',
      targetTenantId: link.targetTenantId, environment: link.environment, idempotencyKey: link.idempotencyKey,
    }
    await client.prepareCliManagedSource('tenant-one', 'my-app', prep)
    await client.getCliManagedSourceOperation('tenant-one', 'my-app', 'operation-one', 'runtime-tenant', 'preview')
    await client.getManagedDeploymentOperation('tenant-one', 'my-app', 'operation-one', 'runtime-tenant')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-one/apps/my-app/cli-managed-source/github-link-sessions', 'POST'],
      ['https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-one/apps/my-app/cli-managed-source/github-link-sessions/link-one?targetTenantId=runtime-tenant&environment=preview', 'GET'],
      ['https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-one/apps/my-app/cli-managed-source/preparations', 'POST'],
      ['https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-one/apps/my-app/cli-managed-source/operations/operation-one?targetTenantId=runtime-tenant&environment=preview', 'GET'],
      ['https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-one/apps/my-app/managed-deployments/operations/operation-one?targetTenantId=runtime-tenant', 'GET'],
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(link)
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual(prep)
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer <fixture-access-token>' })
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true)
  })

  test.each(['operation/other', '../operation', '', 'operation?query=value'])('rejects a non-opaque managed operation ID %s before an HTTP request', async operationId => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    await expect(client.getCliManagedSourceOperation('tenant-one', 'my-app', operationId, 'runtime-tenant', 'preview')).rejects.toThrow('safe opaque path segments')
    await expect(client.getManagedDeploymentOperation('tenant-one', 'my-app', operationId, 'runtime-tenant')).rejects.toThrow('safe opaque path segments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('preserves dotted app and tenant scope segments on managed operation routes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant.parent')

    await client.getManagedDeploymentOperation(
      'tenant.parent',
      'planning.portal',
      'source-unknown-abc123',
      'runtime.child',
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant.parent/apps/planning.portal/managed-deployments/operations/source-unknown-abc123?targetTenantId=runtime.child',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    )
  })

  test.each([
    ['operation/other', 'runtime-tenant'],
    ['../operation', 'runtime-tenant'],
    ['', 'runtime-tenant'],
    ['operation?query=value', 'runtime-tenant'],
    ['source-unknown-abc123', '../runtime-tenant'],
  ])('rejects unsafe legacy operation binding %s / %s before an HTTP request', async (operationId, targetTenantId) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-one')
    await expect(client.getSourceUnknownOperation(
      'tenant-one',
      'my-app',
      operationId,
      targetTenantId,
    )).rejects.toThrow('safe opaque path segments')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('rejects an untrusted managed PublicAPI origin before acquiring or sending a bearer token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const tokenMock = vi.mocked(getAccessToken)
    tokenMock.mockClear()
    const client = new PlatformAPIClient('https://attacker.example/public', 'tenant-parent')

    await expect(
      client.getLatestSourceUnknownDeployment('tenant-parent', 'rates-review'),
    ).rejects.toThrow('trusted EAI regional PublicAPI')
    expect(tokenMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('formats FastAPI field validation details with a stable reason code', async () => {
    const parsed = await parseApiError(new Response(JSON.stringify({
      detail: [
        {
          type: 'missing',
          loc: ['body', 'storagePath'],
          msg: 'Field required',
          input: { documentId: 'DOC-123' },
        },
        {
          type: 'value_error',
          loc: ['body', 'documentId'],
          msg: 'Invalid document state: tax-file-secret',
          input: 'tax-file-secret',
        },
      ],
    }), {
      status: 422,
      statusText: 'Unprocessable Entity',
    }))

    expect(parsed.code).toBe('VALIDATION_ERROR')
    expect(parsed.message).toBe(
      'body.storagePath: Field required; body.documentId: Invalid value',
    )
    expect(parsed.message).not.toContain('tax-file-secret')
    expect(parsed.bodyText).toBeUndefined()
  })

  test('parses the PublicAPI validation envelope without exposing rejected values', async () => {
    const parsed = await parseApiError(new Response(JSON.stringify({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      invalidFields: [
        { path: 'body.storagePath', code: 'missing' },
        { path: 'body.<field>', code: 'extra_forbidden' },
      ],
      rejectedValue: 'tax-file-secret',
    }), {
      status: 422,
      statusText: 'Unprocessable Entity',
    }))

    expect(parsed.code).toBe('VALIDATION_ERROR')
    expect(parsed.message).toBe(
      'body.storagePath: Field required; body.<field>: Unexpected field',
    )
    expect(parsed.message).not.toContain('tax-file-secret')
    expect(parsed.bodyText).toBeUndefined()
  })

  test('does not expose opaque validation response bodies', async () => {
    const parsed = await parseApiError(new Response('tax-file-secret', {
      status: 422,
      statusText: 'Unprocessable Entity',
    }))

    expect(parsed).toEqual({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Unprocessable Entity',
    })
  })

  test.each([
    { status: 409, code: 'TENANT_SLUG_CONFLICT', field: 'slug', message: 'A child workspace with this slug already exists under this parent. Choose a different slug.' },
    { status: 409, code: 'TENANT_SLUG_CONFLICT', field: 'portalSlug', message: 'This portal slug is already in use. Choose a different portal slug.' },
    { status: 422, code: 'TENANT_SLUG_INVALID', field: 'slug', message: 'Use a lowercase kebab-case workspace slug, beginning and ending with a letter or number.' },
    { status: 422, code: 'TENANT_PORTAL_SLUG_INVALID', field: 'portalSlug', message: 'Use a lowercase kebab-case portal slug, beginning and ending with a letter or number.' },
    { status: 422, code: 'HOME_REGION_REQUIRED', field: 'homeRegion', message: 'Pass --home-region au|ca|eu to select the child workspace home region.' },
    { status: 422, code: 'HOME_REGION_INVALID', field: 'homeRegion', message: 'Pass --home-region au|ca|eu with a supported home region.' },
    { status: 422, code: 'PARENT_HOME_REGION_REQUIRED', field: 'homeRegion', message: 'Repair the parent workspace home-region metadata or pass --home-region au|ca|eu for the child workspace.' },
  ])('keeps safe child-create guidance for $code/$field without rejected input', async ({ status, code, field, message }) => {
    for (const body of [
      { error: code, message: 'tax-file-secret', field, input: 'tax-file-secret' },
      { error: code, message: 'tax-file-secret', details: { field, input: 'tax-file-secret' } },
      { error: code, message: 'tax-file-secret', detail: { field, input: 'tax-file-secret' } },
      { detail: { error: code, message: 'tax-file-secret', field, input: 'tax-file-secret' } },
      { detail: { error: code, message: 'tax-file-secret', details: { field, input: 'tax-file-secret' } } },
    ]) {
      const parsed = await parseApiError(new Response(JSON.stringify(body), { status }), { childTenantCreate: true })
      expect(parsed).toEqual({ status, code, field, message })
      expect(JSON.stringify(parsed)).not.toContain('tax-file-secret')
    }
  })

  test.each([
    { status: 422, code: 'TENANT_SLUG_CONFLICT' },
    { status: 409, code: 'TENANT_RENAME_CONFLICT' },
  ])('leaves an unexpected $code/$status child-create error to the generic parser', async ({ status, code }) => {
    const body = { error: code, message: 'Server explanation', field: 'slug' }
    const scoped = await parseApiError(new Response(JSON.stringify(body), { status }), { childTenantCreate: true })
    const generic = await parseApiError(new Response(JSON.stringify(body), { status }))
    expect(scoped).toEqual(generic)
    expect(scoped).not.toHaveProperty('field')
  })

  test('keeps the server meaning of tenant codes outside a child-create request', async () => {
    const parsed = await parseApiError(new Response(JSON.stringify({
      error: 'TENANT_SLUG_CONFLICT',
      message: 'A workspace with this slug already exists.',
      field: 'slug',
    }), { status: 409 }))
    expect(parsed.code).toBe('TENANT_SLUG_CONFLICT')
    expect(parsed.message).toBe('A workspace with this slug already exists.')
    expect(parsed).not.toHaveProperty('field')
  })

  test.each([
    ['POST', '/v4/platform/tenants/parent-tenant/children', undefined, true],
    ['POST', '/v4/platform/tenants/parent-tenant/children/', undefined, true],
    ['post', '/v4/platform/tenants', { parentTenant: 'parent-tenant' }, true],
    ['POST', '/v4/platform/tenants', { slug: 'root-workspace' }, false],
    ['POST', '/v4/platform/tenants', { parentTenant: '' }, false],
    ['GET', '/v4/platform/tenants/parent-tenant/children', undefined, false],
    ['POST', '/v4/platform/tenants/parent-tenant/apps', undefined, false],
  ])('recognises only child-create requests (%s %s)', (method, path, body, expected) => {
    expect(isChildTenantCreateRequest(method, path, body)).toBe(expected)
  })

  test('does not relay a caller-controlled field or arbitrary provider validation message', async () => {
    const parsed = await parseApiError(new Response(JSON.stringify({
      error: 'TENANT_SLUG_INVALID',
      message: 'Rejected value: tax-file-secret',
      field: 'tax-file-secret',
    }), { status: 422 }), { childTenantCreate: true })
    expect(parsed).toEqual({
      status: 422,
      code: 'TENANT_SLUG_INVALID',
      message: 'Use a lowercase kebab-case workspace slug, beginning and ending with a letter or number.',
    })

    const provider = await parseApiError(new Response(JSON.stringify({
      error: 'PROVIDER_VALIDATION_FAILED',
      message: 'Rejected value: tax-file-secret',
      field: 'slug',
    }), { status: 422 }))
    expect(provider).toEqual({ status: 422, code: 'PROVIDER_VALIDATION_FAILED', message: 'Request validation failed' })
    expect(JSON.stringify(provider)).not.toContain('tax-file-secret')
  })
  test('caps published object type preflight lookups at the orchestrator limit', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.getPublishedObjectTypes({ limit: 200 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const calledUrl = new URL(String(url))

    expect(calledUrl.origin).toBe('https://example.test')
    expect(calledUrl.pathname).toBe('/v4/data/resources/object-types')
    expect(calledUrl.searchParams.get('limit')).toBe('100')
    expect(calledUrl.searchParams.get('where[tenant][equals]')).toBe('tenant-123')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('creates object types through the public data resources router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.createObjectType({ name: 'Customer', tenant: 'tenant-123' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/data/resources/object-types')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Customer', tenant: 'tenant-123' })
  })

  test('updates object types through the public data resources router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.updateObjectType('type-id-123', { status: 'draft' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/data/resources/object-types/type-id-123')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'draft' })
  })

  test('scopes ResourceAPI schema sync to requested object types', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.syncStorageSchema({
      dryRun: false,
      objectTypes: ['draft-workflow', 'submission-file'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/data/resources/tenant-123/storage/sync-schema')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      dry_run: false,
      objectTypes: ['draft-workflow', 'submission-file'],
    })
  })

  test('plans only explicit exact slugs through the strict PublicAPI index-plan receiver', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://example.test/v4/platform/tenants/tenant-123/resourceapi/index-plan')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      // PublicAPI ResourceAPIIndexPlanRequest forbids client apply/dryRun fields.
      expect(Object.keys(body)).toEqual(['objectTypes'])
      expect(body.objectTypes).toEqual(['opameasure', 'observability-aisummary'])
      return new Response(JSON.stringify({ tenantId: 'tenant-123', objectTypeCount: 2 }))
    })

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    const response = await client.planResourceIndexes(['opameasure', 'observability-aisummary'])

    expect(response.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test.each([
    undefined, null, 'project', [], [''], ['Project'], ['project_name'], ['project '],
    ['project\n'], ['project/other'], ['storage'], [42], ['a'.repeat(256)], Array(1001).fill('project'),
  ])('rejects invalid or unbounded index scope %# before auth or fetch', async objectTypes => {
    const token = vi.mocked(getAccessToken)
    token.mockClear()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const client = new PlatformAPIClient('https://example.test', 'tenant-123')

    await expect(client.planResourceIndexes(objectTypes as string[])).rejects.toThrow('Index planning')

    expect(token).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('accepts the exact public selection limits without rewriting the slugs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const objectTypes = Array(1000).fill('a'.repeat(255))
    const client = new PlatformAPIClient('https://example.test', 'tenant-123')

    await client.planResourceIndexes(objectTypes)

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ objectTypes })
  })

  test.each([undefined, ['fact-batch-load']])('rejects index apply without turning it into a dry run %#', async objectTypes => {
    const token = vi.mocked(getAccessToken)
    token.mockClear()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const client = new PlatformAPIClient('https://example.test', 'tenant-123')

    await expect(client.applyResourceIndexes(objectTypes)).rejects.toMatchObject({
      code: 'RESOURCE_INDEX_APPLY_UNSUPPORTED',
      message: expect.stringContaining('unavailable through PublicAPI'),
    })

    expect(token).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('refreshes cache through the system-admin AdminAPI route with an audit reason', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.refreshResourceCache(['fact-batch-load'], 'INC-1234')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://example.test/v4/platform/tenants/tenant-123/resourceapi/cache-refresh')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      objectTypes: ['fact-batch-load'], reason: 'INC-1234',
    })
  })

  test('reads ResourceAPI passive schema status through the public data router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.getResourceStorageSchemaStatus()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/data/resources/tenant-123/storage/schema-status')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('saves app object type manifests through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.saveAppObjectTypeManifest('no-code-builder', [
      { name: 'SubmissionFile', status: 'published' },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-123/apps/no-code-builder/object-types/manifest')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      objectTypes: [
        { name: 'SubmissionFile', status: 'published' },
      ],
    })
  })

  test('publishes app object types through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.publishAppObjectTypes('no-code-builder')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-123/apps/no-code-builder/object-types/publish')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  test('indexes documents through the public rag-index route without a client-side record lookup', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.indexDocument('DOC-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/data/documents/rag-index')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      documentId: 'DOC-123',
      tenantId: 'tenant-123',
    })
  })

  test('reads tenant details through the public management tenant route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.getTenant('tenant-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-123/management')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('routes tenant deletion through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.deleteTenant('tenant-child')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/delete')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  test('sends force-hard-purge confirmation when deleting a tenant permanently', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.deleteTenant('tenant-child', { forceHardPurge: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/delete')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      forceHardPurge: true,
      confirmationTenantId: 'tenant-child',
      reason: 'eai tenant delete --force-hard-purge',
    })
  })

  test('hard purges one immediate child through the exact parent-authorized route and header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'tenant-child', parentTenantId: 'tenant-parent', status: 'hard_purged',
    }), { status: 200 }))
    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')

    await client.deleteTenant('tenant-child', {
      parentTenantId: 'tenant-parent',
      forceHardPurge: true,
      reason: 'Disposable QA child cleanup',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-parent/children/tenant-child/delete')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe('tenant-parent')
    expect(JSON.parse(String(init?.body))).toEqual({
      forceHardPurge: true,
      confirmationTenantId: 'tenant-child',
      reason: 'Disposable QA child cleanup',
    })
  })

  test.each([
    { parentTenantId: 'tenant-child', forceHardPurge: true, scope: 'tenant-child' },
    { parentTenantId: 'tenant-parent', forceHardPurge: false, scope: 'tenant-parent' },
    { parentTenantId: 'tenant-parent', forceHardPurge: true, scope: 'another-tenant' },
    { parentTenantId: 'system', forceHardPurge: true, scope: 'system' },
    { parentTenantId: '', forceHardPurge: true, scope: '' },
  ])('rejects unsafe parent delete arguments before credentials or fetch: %j', async options => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const token = vi.mocked(getAccessToken)
    token.mockClear()
    const client = new PlatformAPIClient('https://example.test', options.scope)

    await expect(client.deleteTenant('tenant-child', options)).rejects.toThrow(/Parent-authorized deletion/)
    expect(token).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('routes child tenant admin bootstrap through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.bootstrapChildTenantAdmin('tenant-parent', 'tenant-child', {
      userOid: 'user-oid',
      userEmail: 'user@example.com',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-parent/children/tenant-child/bootstrap-admin')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      userOid: 'user-oid',
      userEmail: 'user@example.com',
    })
  })

  test('lists child tenants through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ children: [] }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.listTenantChildren('tenant-parent', {
      includeDescendants: true,
      limit: 100,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe(
      'https://example.test/v4/platform/tenants/tenant-parent/children?include_descendants=true&limit=100',
    )
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('invites tenant members through the public platform member route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.inviteTenantMember('tenant-child', {
      email: 'poppy@example.com',
      role: 'tenant-admin',
      firstName: 'Poppy',
      lastName: 'Lucas',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/members/invite')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'poppy@example.com',
      role: 'tenant-admin',
      firstName: 'Poppy',
      lastName: 'Lucas',
    })
  })

  test('invites tenant members with a role definition id without adding a default role', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.inviteTenantMember('tenant-child', {
      email: 'poppy@example.com',
      roleDefinitionId: 'role-definition-123',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/members/invite')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'poppy@example.com',
      roleDefinitionId: 'role-definition-123',
    })
  })

  test('lists tenant members through the public platform member route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.listTenantMembers('tenant-child', {
      page: 2,
      limit: 50,
      sort: 'email',
      search: 'poppy@example.com',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/members?page=2&limit=50&sort=email&search=poppy%40example.com')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('lists tenant role definitions through the public platform member route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.listTenantRoleDefinitions('tenant-child')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/role-definitions')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('looks up users and memberships through tenant-scoped public platform routes', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.lookupUserByEmail('tenant-child', 'jane@example.com')
    await client.getUserMemberships('tenant-child', 'user-123')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.test/v4/platform/tenants/tenant-child/users/by-email?email=jane%40example.com',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.test/v4/platform/tenants/tenant-child/users/user-123/memberships',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  test('updates tenant member role through the public platform member route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.updateTenantMemberRole('tenant-child', 'user-123', {
      role: 'tenant-admin',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/members/user-123/roles')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({
      role: 'tenant-admin',
    })
  })

  test('sends child tenant homeRegion through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.createTenant({
      name: 'Elevate',
      slug: 'elevate',
      parent: 'tenant-parent',
      usecase: 'generic',
      homeRegion: 'eu',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-parent/children')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      displayName: 'Elevate',
      slug: 'elevate',
      usecase: 'generic',
      homeRegion: 'eu',
    })
  })

  test('creates apps through the public company app route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.createTenantApp('tenant-parent', {
      appDisplayName: 'DEF',
      verticalKey: 'def',
      parentTenantId: 'tenant-def',
      childTenantDisplayName: 'IJK',
      source: 'eai-cli',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-parent/apps')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      appDisplayName: 'DEF',
      verticalKey: 'def',
      parentTenantId: 'tenant-def',
      childTenantDisplayName: 'IJK',
      source: 'eai-cli',
    })
  })

  test('gives only receipt-bound app creation a 90s ceiling without retrying the POST', async () => {
    const token = `header.${Buffer.from(JSON.stringify({ oid: 'exact-create-actor' })).toString('base64url')}.signature`
    vi.mocked(getAccessToken).mockResolvedValueOnce(token).mockResolvedValueOnce(token)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"docs":[]}'))
    const client = new PlatformAPIClient('http://localhost:18000', 'tenant-parent')
    const capture = vi.fn()

    await client.createTenantApp('tenant-parent', { appDisplayName: 'App', verticalKey: 'app' }, capture)
    await client.listResources('tenant-vertical-enrollment', { where: { verticalKey: 'app' } }, capture)

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      INIT_APP_CREATE_REQUEST_TIMEOUT_MS,
      MANAGED_PUBLIC_REQUEST_TIMEOUT_MS,
    ])
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET'])
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
  })

  test('a timed-out create POST is not retried or converted into a read acknowledgement', async () => {
    const token = `header.${Buffer.from(JSON.stringify({ oid: 'exact-create-actor' })).toString('base64url')}.signature`
    vi.mocked(getAccessToken).mockResolvedValueOnce(token)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const signal = init?.signal
      if (!signal) throw new Error('The exact create request must carry a deadline')
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const client = new PlatformAPIClient('http://localhost:18000', 'tenant-parent', { managedRequestTimeoutMs: 20 })
    const capture = vi.fn()

    let failure: unknown
    try {
      await client.createTenantApp('tenant-parent', { appDisplayName: 'App', verticalKey: 'app' }, capture)
    } catch (error) {
      failure = error
    }
    expect(isManagedPublicRequestTimeout(failure)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(capture).toHaveBeenCalledExactlyOnceWith({ publicApiUrl: 'http://localhost:18000', actorId: 'exact-create-actor' })
  })

  test('init acknowledgement captures the exact refreshed bearer actor once, without an identity read', async () => {
    const token = `header.${Buffer.from(JSON.stringify({ oid: 'actual-request-actor' })).toString('base64url')}.signature`
    const acquire = vi.mocked(getAccessToken)
    acquire.mockClear(); acquire.mockResolvedValueOnce(token)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 201 }))
    const capture = vi.fn()
    await new PlatformAPIClient('http://localhost:18000', 'parent', { publicRequestRedirect: 'follow' })
      .createTenantApp('parent', { appDisplayName: 'App', verticalKey: 'app' }, capture)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledExactlyOnceWith({ publicApiUrl: 'http://localhost:18000', actorId: 'actual-request-actor' })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal), headers: { Authorization: `Bearer ${token}` } })
    expect(JSON.stringify(capture.mock.calls)).not.toContain(token)
  })

  test('ordinary listResources keeps its query, redirect option and single token acquisition without a receipt deadline', async () => {
    const acquire = vi.mocked(getAccessToken)
    acquire.mockClear()
    const deadline = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"docs":[]}'))
    await new PlatformAPIClient('https://example.test/public', 'parent', { publicRequestRedirect: 'manual' })
      .listResources('tenant_vertical_enrollment', { page: 2, limit: 17, sort: '-createdAt', where: { verticalKey: 'a+b' } })
    expect(acquire).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0]
    const url = new URL(String(input))
    expect(url.pathname).toBe('/public/v4/data/resources/parent/tenant-vertical-enrollment')
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', limit: '17', sort: '-createdAt', where: JSON.stringify({ verticalKey: 'a+b' }) })
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { Authorization: 'Bearer <fixture-access-token>', 'X-Tenant-Id': 'parent' } })
    expect(init?.signal).toBeUndefined(); expect(deadline).not.toHaveBeenCalled()
  })

  test('opted-in init stops slow headers before fetch or authority capture, including late token completion', async () => {
    let finish!: (token: string) => void
    vi.mocked(getAccessToken).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const capture = vi.fn()
    const alive = setInterval(() => {}, 1000)
    try {
      await expect(new PlatformAPIClient('http://localhost:18000', 'parent', { managedRequestTimeoutMs: 25 })
        .createTenantApp('parent', { appDisplayName: 'App' }, capture)).rejects.toMatchObject({ name: 'TimeoutError' })
      finish(`header.${Buffer.from(JSON.stringify({ oid: 'late-actor' })).toString('base64url')}.signature`)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(fetchMock).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled()
    } finally { clearInterval(alive) }
  })

  test('opted-in init body remains within the original request deadline even if its body never settles', async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce(`header.${Buffer.from(JSON.stringify({ oid: 'actual-actor' })).toString('base64url')}.signature`)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const response = new Response('{}')
      vi.spyOn(response, 'text').mockImplementation(() => new Promise(() => {}))
      return response
    })
    const capture = vi.fn()
    const alive = setInterval(() => {}, 1000)
    try {
      const response = await new PlatformAPIClient('http://localhost:18000', 'parent', { managedRequestTimeoutMs: 25 })
        .createTenantApp('parent', { appDisplayName: 'App' }, capture)
      await expect(readManagedPublicResponseText(response)).rejects.toMatchObject({ name: 'TimeoutError' })
      expect(fetchMock).toHaveBeenCalledTimes(1); expect(capture).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    } finally { clearInterval(alive) }
  })

  test('opted-in selection captures its exact bearer with one enrollment GET and no create', async () => {
    const token = `header.${Buffer.from(JSON.stringify({ oid: 'selected-actor' })).toString('base64url')}.signature`
    const acquire = vi.mocked(getAccessToken)
    acquire.mockClear(); acquire.mockResolvedValueOnce(token)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"docs":[]}'))
    const capture = vi.fn()
    await new PlatformAPIClient('http://localhost:18000', 'parent').listResources('tenant-vertical-enrollment', { where: { verticalKey: 'app' } }, capture)
    expect(acquire).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(capture).toHaveBeenCalledExactlyOnceWith({ publicApiUrl: 'http://localhost:18000', actorId: 'selected-actor' })
  })

  test('missing actor and unsafe init gateway fail before the next provider call, without fallback', async () => {
    const acquire = vi.mocked(getAccessToken)
    acquire.mockClear()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const capture = vi.fn()
    await expect(new PlatformAPIClient('https://user:secret@example.test', 'parent').createTenantApp('parent', { appDisplayName: 'App' }, capture)).rejects.toThrow(/gateway/)
    expect(acquire).not.toHaveBeenCalled()
    acquire.mockResolvedValueOnce(`header.${Buffer.from(JSON.stringify({ sub: 'not-an-oid' })).toString('base64url')}.signature`)
    await expect(new PlatformAPIClient('http://localhost:18000', 'parent').createTenantApp('parent', { appDisplayName: 'App' }, capture)).rejects.toThrow(/oid/)
    expect(acquire).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled()
  })

  test('registers source-unknown app repositories through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.registerSourceUnknownApp('tenant-parent', 'rates-review', {
      repoOwner: 'enterpriseaigroup',
      repoName: 'rates-review',
      repoUrl: 'https://github.com/enterpriseaigroup/rates-review',
      defaultBranch: 'main',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      configPath: 'src/eai.config/index.ts',
      runtimePath: 'src/eai.runtime.ts',
      sourceMode: 'source-unknown',
      schemaProvenance: {
        templateVersion: 'eai.generated_app_config.v1',
        baseTemplateSha: '483c609cd974fa732c8ccb5ce37855911f881d76',
        schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validatorDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      validationSummary: { status: 'registered_by_cli' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/source-unknown/register')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      repoOwner: 'enterpriseaigroup',
      repoName: 'rates-review',
      repoUrl: 'https://github.com/enterpriseaigroup/rates-review',
      defaultBranch: 'main',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      configPath: 'src/eai.config/index.ts',
      runtimePath: 'src/eai.runtime.ts',
      sourceMode: 'source-unknown',
      schemaProvenance: {
        templateVersion: 'eai.generated_app_config.v1',
        baseTemplateSha: '483c609cd974fa732c8ccb5ce37855911f881d76',
        schemaDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validatorDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      validationSummary: { status: 'registered_by_cli' },
    })
  })

  test('registers observed-only source-unknown app adoption metadata', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.registerSourceUnknownApp('tenant-parent', 'rates-review', {
      repoOwner: 'enterpriseaigroup',
      repoName: 'rates-review',
      repoUrl: 'https://github.com/enterpriseaigroup/rates-review',
      defaultBranch: 'main',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      configPath: 'src/eai.config/index.ts',
      runtimePath: 'src/eai.runtime.ts',
      sourceMode: 'source-unknown',
      adoptionMode: 'adopted-observed',
      observedDeployment: {
        environment: 'production',
        activeUrl: 'https://rates.example.com',
        status: 'adopted_observed',
        observedAt: '2026-07-02T00:00:00.000Z',
        deploymentId: 'aca-revision-42',
      },
      validationSummary: {
        status: 'adopted_observed_by_cli',
        destructiveOperationsBlocked: true,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/source-unknown/register')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      repoOwner: 'enterpriseaigroup',
      repoName: 'rates-review',
      repoUrl: 'https://github.com/enterpriseaigroup/rates-review',
      defaultBranch: 'main',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      configPath: 'src/eai.config/index.ts',
      runtimePath: 'src/eai.runtime.ts',
      sourceMode: 'source-unknown',
      adoptionMode: 'adopted-observed',
      observedDeployment: {
        environment: 'production',
        activeUrl: 'https://rates.example.com',
        status: 'adopted_observed',
        observedAt: '2026-07-02T00:00:00.000Z',
        deploymentId: 'aca-revision-42',
      },
      validationSummary: {
        status: 'adopted_observed_by_cli',
        destructiveOperationsBlocked: true,
      },
    })
  })

  test('issues source-unknown workflow setup through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.setupSourceUnknownWorkflow('tenant-parent', 'rates-review', {
      environment: 'preview',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      configHash: 'sha256:config',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/source-unknown/workflow-setup')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      environment: 'preview',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      configHash: 'sha256:config',
    })
  })

  test('submits source-unknown workflow evidence through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.submitSourceUnknownWorkflowEvidence('tenant-parent', 'rates-review', {
      operationId: 'source-unknown-op',
      nonce: 'nonce-token',
      environment: 'preview',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'a'.repeat(40),
      configHash: `sha256:${'e'.repeat(64)}`,
      artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      imageArtifact: { id: '98765', name: 'eai-generated-app-image', archiveDigest: `sha256:${'f'.repeat(64)}` },
      schemaProvenance: { templateVersion: '1', baseTemplateSha: 'b'.repeat(40), schemaDigest: `sha256:${'c'.repeat(64)}`, validatorDigest: `sha256:${'d'.repeat(64)}` },
      workflowRun: { id: '123456789', attempt: 1 },
      validationSummary: { status: 'passed' },
    }, 'github-oidc-token')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/source-unknown/workflow-evidence')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer github-oidc-token',
    }))
    expect(JSON.parse(String(init?.body))).toEqual({
      operationId: 'source-unknown-op',
      nonce: 'nonce-token',
      environment: 'preview',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'a'.repeat(40),
      configHash: `sha256:${'e'.repeat(64)}`,
      artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      imageArtifact: { id: '98765', name: 'eai-generated-app-image', archiveDigest: `sha256:${'f'.repeat(64)}` },
      schemaProvenance: { templateVersion: '1', baseTemplateSha: 'b'.repeat(40), schemaDigest: `sha256:${'c'.repeat(64)}`, validatorDigest: `sha256:${'d'.repeat(64)}` },
      workflowRun: { id: '123456789', attempt: 1 },
      validationSummary: { status: 'passed' },
    })
  })

  test('bootstraps a source-unknown runtime with the exact operation and explicit target', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.bootstrapSourceUnknownRuntime('tenant-parent', 'rates-review', 'preview', 'source-unknown-op', 'tenant-runtime')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/environments/preview/runtime-bootstrap')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ sourceOperationId: 'source-unknown-op', targetTenantId: 'tenant-runtime', sourceMode: 'source-unknown' })
  })

  test('requests source-unknown deployment handoff through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }))

    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.requestSourceUnknownDeployment('tenant-parent', 'rates-review', {
      operationId: 'source-unknown-op',
      environment: 'preview',
      repoOwner: 'enterpriseaigroup',
      repoName: 'rates-review',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      workflowRunId: '123456789',
      configHash: 'sha256:config',
      artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deploymentTarget: {
        kind: 'tenantinfra',
        releaseChannel: 'preview',
      },
      validationSummary: {
        status: 'deployment_requested_by_cli',
        requiresTenantInfra: true,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/source-unknown/deploy')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      operationId: 'source-unknown-op',
      environment: 'preview',
      repoOwner: 'enterpriseaigroup',
      repoName: 'rates-review',
      workflowPath: '.github/workflows/eai-app.yml',
      ref: 'refs/heads/main',
      commitSha: 'abcdef1234567890',
      workflowRunId: '123456789',
      configHash: 'sha256:config',
      artifactDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      imageDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deploymentTarget: {
        kind: 'tenantinfra',
        releaseChannel: 'preview',
      },
      validationSummary: {
        status: 'deployment_requested_by_cli',
        requiresTenantInfra: true,
      },
    })
  })

  test('reads latest source-unknown deployment handoff status through the public platform router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.getLatestSourceUnknownDeployment('tenant-parent', 'rates-review')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/source-unknown/deployments/latest')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('reads one exact source-unknown operation with the authorized target tenant', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'tenant-parent')
    await client.getSourceUnknownOperation(
      'tenant-parent',
      'rates-review',
      'source-unknown-abc123',
      'tenant-runtime',
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://test-api.au.myenterprise.ai/public/v4/platform/tenants/tenant-parent/apps/rates-review/source-unknown/operations/source-unknown-abc123?targetTenantId=tenant-runtime',
    )
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  test('creates app provisioning jobs through the public company app route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.createAppProvisioningJob('planning-portal')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe(
      'https://example.test/v4/platform/tenants/tenant-parent/apps/planning-portal/provisioning-jobs',
    )
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe('tenant-parent')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test('reads the exact app provisioning job with company authority, encoded identifiers and runtime query', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const client = new PlatformAPIClient('https://example.test', 'tenant/parent')
    await client.getAppProvisioningJob('planning/portal', 'app-prov/exact', 'runtime/child', 1250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant%2Fparent/apps/planning%2Fportal/provisioning-jobs/app-prov%2Fexact?targetTenantId=runtime%2Fchild')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('X-Tenant-Id')).toBe('tenant/parent')
    expect(timeout).toHaveBeenCalledWith(1250)
  })

  test('keeps the app provisioning read deadline active through a hung response body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const signal = init?.signal
      if (!signal) throw new Error('Provisioning reads require a deadline')
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        const alive = setInterval(() => {}, 1000)
        signal.addEventListener('abort', () => { clearInterval(alive); controller.error(signal.reason) }, { once: true })
      } })
      return new Response(body)
    })
    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const response = await client.getAppProvisioningJob('planning-portal', 'app-prov-owned', 'runtime-child', 25)
    let error: unknown
    try { await readManagedPublicResponseText(response) } catch (caught) { error = caught }
    expect(isManagedPublicRequestTimeout(error)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  test('posts capability evaluation requests to the public capability router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        outcome: 'allow',
        reasonCode: 'allowed',
        reasonMessage: 'Capability is included in the current plan.',
      }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.evaluateCapability({
      tenantId: 'tenant-parent',
      targetCapability: 'child-tenants',
      requestedOperation: 'create',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/platform/capabilities/evaluate')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      tenant_id: 'tenant-parent',
      target_capability: 'child-tenants',
      requested_operation: 'create',
    })
    expect(result.outcome).toBe('allow')
  })

  test('gets runtime workflow status from the public workflow router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        workflow_key: 'strategy-monitor',
        tenant_id: 'tenant-parent',
        status: 'operator_required',
        reason_code: 'runtime_workflow_not_bound',
        reason_message: 'Workflow is not bound.',
      }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.getRuntimeWorkflowStatus('strategy-monitor')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://example.test/v4/workflows/runtime/strategy-monitor/status?tenant_id=tenant-parent',
    )
    expect(init?.method).toBe('GET')
    expect(result.status).toBe('operator_required')
    expect(result.reasonCode).toBe('runtime_workflow_not_bound')
  })

  test('gets builder readiness with repeated workflow key query params', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        tenant_id: 'tenant-parent',
        status: 'operator_required',
        checks: [
          {
            key: 'tenant-access',
            status: 'available',
            reason_code: 'tenant_access_allowed',
            reason_message: 'Tenant is available.',
          },
        ],
      }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.getBuilderReadiness({
      workflowKeys: ['strategy-monitor', 'advisory'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://example.test/v4/integrations/builder/readiness?tenant_id=tenant-parent&workflow_keys=strategy-monitor&workflow_keys=advisory',
    )
    expect(init?.method).toBe('GET')
    expect(result.checks[0]?.key).toBe('tenant-access')
  })

  test('posts runtime workflow requests to the public workflow router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        request_id: 'rwf_123',
        workflow_key: 'strategy-monitor',
        tenant_id: 'tenant-parent',
        status: 'operator_required',
        reason_code: 'runtime_workflow_operator_required',
        reason_message: 'Operator required.',
      }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.requestRuntimeWorkflow({
      workflowKey: 'strategy-monitor',
      reason: 'CEO strategy cockpit',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/workflows/runtime-requests')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      tenant_id: 'tenant-parent',
      workflow_key: 'strategy-monitor',
      reason: 'CEO strategy cockpit',
    })
    expect(result.requestId).toBe('rwf_123')
  })

  test('posts chat requests with PublicAPI conversation id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.streamChat('workflow-1', 'analyze-process', 'Hello', 'conv-123', { topic: 'onboarding' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/ai/chat/stream/tenant-parent/workflow-1/analyze-process')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      message: 'Hello',
      conversation_id: 'conv-123',
      params: { topic: 'onboarding' },
    })
  })

  test('posts non-streaming chat requests with PublicAPI conversation id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.sendChat('workflow-1', 'analyze-process', 'Hello', 'conv-123', { topic: 'onboarding' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/ai/chat/tenant-parent/workflow-1/analyze-process')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      message: 'Hello',
      conversation_id: 'conv-123',
      params: { topic: 'onboarding' },
    })
  })

  test('calls arbitrary allowed PublicAPI V4 paths through the guarded request helper', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.requestPublicApi('/v4/geo/resolve-location', {
      method: 'POST',
      body: { query: 'Copenhagen' },
      params: { locale: 'da-DK' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/geo/resolve-location?locale=da-DK')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'Copenhagen' })
  })

  test('rejects non-v4 paths in the public request helper', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await expect(client.requestPublicApi('/orchestrate', { method: 'POST' }))
      .rejects
      .toThrow('Only PublicAPI V4 paths are supported')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('rotates Entra app secrets through the public provision router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        client_id: 'client-1',
        client_secret: '<fixture-client-secret>',
        tenant_id: 'tenant-parent',
        expires_at: '2026-12-31T00:00:00Z',
      }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.rotateEntraAppSecret({
      tenantId: 'tenant-parent',
      clientId: 'client-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/platform/provisioning/entra-apps/client-1/rotate-secret')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ tenant_id: 'tenant-parent' })
    expect(result.clientSecret).toBe('<fixture-client-secret>')
  })

  test('passes an existing Entra client id when provisioning should reconcile a local registration', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        client_id: 'client-1',
        client_secret: null,
        existing: true,
      }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.provisionEntraApp({
      tenantId: 'tenant-parent',
      appName: 'my-app',
      redirectUris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      existingClientId: 'client-1',
      idempotent: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/platform/provisioning/entra-apps')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      tenant_id: 'tenant-parent',
      app_name: 'my-app',
      redirect_uris: ['http://localhost:3000/api/auth/callback/microsoft-entra-id'],
      existing_client_id: 'client-1',
      idempotent: true,
    })
    expect(result.clientId).toBe('client-1')
    expect(result.existing).toBe(true)
  })

  test.each([null, 'openid', {}, ['openid', 7], ['openid', ''], ['openid', '  ']])(
    'rejects malformed present Entra scopes without dropping entries: %j', async scopes => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        client_id: 'client-1', client_secret: '<fixture-client-secret>', scopes,
      }), { status: 200 }))
      const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
      await expect(client.provisionEntraApp({ tenantId: 'tenant-parent', appName: 'my-app', redirectUris: [] }))
        .rejects.toMatchObject({ statusText: 'Invalid provisioning response' })
      expect(fetchMock).toHaveBeenCalledOnce()
    },
  )

  test.each([{}, { scopes: [] }, { scopes: ['openid', 'fixture_scope#literal'] }, { scopes: [' openid '] }])(
    'preserves complete Entra scope arrays and absent legacy metadata: %j', async metadata => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ client_id: 'client-1', ...metadata }), { status: 200 }))
      const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
      const result = await client.provisionEntraApp({ tenantId: 'tenant-parent', appName: 'my-app', redirectUris: [] })
      expect(result.scopes).toEqual('scopes' in metadata ? metadata.scopes : [])
    },
  )

  test('deprovisions Entra app registrations through the public provision router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        client_id: 'client-1',
        tenant_id: 'tenant-parent',
        tenant_deauthorization: {
          removed: true,
          already_absent: false,
        },
        app_registration_found: true,
        app_registration_deleted: true,
        app_registration_already_absent: false,
        app_registration_absence_verified: true,
      }), { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.deprovisionEntraApp({
      tenantId: 'tenant-parent',
      clientId: 'client-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/platform/provisioning/entra-apps/client-1')
    expect(init?.method).toBe('DELETE')
    expect(JSON.parse(String(init?.body))).toEqual({
      tenant_id: 'tenant-parent',
      delete_registration: true,
    })
    expect(result.tenantDeauthorization.removed).toBe(true)
    expect(result.appRegistrationDeleted).toBe(true)
    expect(result.appRegistrationAlreadyAbsent).toBe(false)
    expect(result.appRegistrationAbsenceVerified).toBe(true)
  })

  test.each(['snake', 'camel'])('accepts exact verified idempotent Entra deletion with %s receipt fields', async style => {
    const receipt = style === 'snake' ? {
      client_id: 'client-1', tenant_id: 'tenant-parent',
      tenant_deauthorization: { removed: false, already_absent: true },
      app_registration_found: false, app_registration_deleted: false,
      app_registration_already_absent: true, app_registration_absence_verified: true,
    } : {
      clientId: 'client-1', tenantId: 'tenant-parent',
      tenantDeauthorization: { removed: false, alreadyAbsent: true },
      appRegistrationFound: false, appRegistrationDeleted: false,
      appRegistrationAlreadyAbsent: true, appRegistrationAbsenceVerified: true,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(receipt), { status: 200 }))
    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await expect(client.deprovisionEntraApp({ tenantId: 'tenant-parent', clientId: 'client-1' })).resolves.toEqual({
      clientId: 'client-1', tenantId: 'tenant-parent',
      tenantDeauthorization: { removed: false, alreadyAbsent: true },
      appRegistrationFound: false, appRegistrationDeleted: false,
      appRegistrationAlreadyAbsent: true, appRegistrationAbsenceVerified: true,
    })
  })

  test('kept registration is explicitly unverified while runtime deauthorization is proven', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      client_id: 'client-1', tenant_id: 'tenant-parent',
      tenant_deauthorization: { removed: true, already_absent: false },
      app_registration_found: true, app_registration_deleted: false,
      app_registration_already_absent: false, app_registration_absence_verified: false,
    }), { status: 200 }))
    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    const result = await client.deprovisionEntraApp({ tenantId: 'tenant-parent', clientId: 'client-1', deleteRegistration: false })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).delete_registration).toBe(false)
    expect(result.tenantDeauthorization.removed).toBe(true)
    expect(result.appRegistrationAbsenceVerified).toBe(false)
  })

  test.each([
    { label: 'wrong-client', change: { client_id: 'foreign-client' } },
    { label: 'wrong-tenant', change: { tenant_id: 'foreign-tenant' } },
    { label: 'conflicting-client-alias', change: { clientId: 'foreign-client' } },
    { label: 'conflicting-tenant-alias', change: { tenantId: 'foreign-tenant' } },
    { label: 'missing-deauthorization', change: { tenant_deauthorization: undefined } },
    { label: 'redacted-deauthorization', change: { tenant_deauthorization: '[redacted]' } },
    { label: 'serialized-deauthorization', change: { tenant_deauthorization: '{"removed":true,"already_absent":false}' } },
    { label: 'truthy-removed', change: { tenant_deauthorization: { removed: 'true', already_absent: false } } },
    { label: 'missing-already-absent', change: { tenant_deauthorization: { removed: true } } },
    { label: 'neither-deauthorized', change: { tenant_deauthorization: { removed: false, already_absent: false } } },
    { label: 'contradictory-deauthorization', change: { tenant_deauthorization: { removed: true, already_absent: true } } },
    { label: 'conflicting-deauthorization-alias', change: { tenant_deauthorization: { removed: true, already_absent: false, alreadyAbsent: true } } },
    { label: 'conflicting-authorization-summary', change: { tenantDeauthorization: { removed: false, alreadyAbsent: true } } },
    { label: 'missing-registration-found', change: { app_registration_found: undefined } },
    { label: 'truthy-registration-deleted', change: { app_registration_deleted: 'true' } },
    { label: 'unverified-registration', change: { app_registration_absence_verified: false } },
    { label: 'missing-verification', change: { app_registration_absence_verified: undefined } },
    { label: 'truthy-verification', change: { app_registration_absence_verified: 'true' } },
    { label: 'conflicting-verification-alias', change: { appRegistrationAbsenceVerified: false } },
    { label: 'contradictory-registration', change: { app_registration_already_absent: true } },
    { label: 'no-registration-action', change: { app_registration_deleted: false } },
    { label: 'deleted-but-not-found', change: { app_registration_found: false } },
  ])('rejects $label deletion receipts without leaking upstream content', async ({ change }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      client_id: 'client-1', tenant_id: 'tenant-parent',
      tenant_deauthorization: { removed: true, already_absent: false },
      app_registration_found: true, app_registration_deleted: true,
      app_registration_already_absent: false, app_registration_absence_verified: true,
      client_secret: '<fixture-private-deletion-content>', ...change,
    }), { status: 200 }))
    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    let caught: unknown
    try { await client.deprovisionEntraApp({ tenantId: 'tenant-parent', clientId: 'client-1' }) }
    catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).toMatchObject({ operation: 'Entra app deprovisioning', status: 200, statusText: 'Invalid deprovision response' })
    expect(String(caught)).not.toContain('<fixture-private-deletion-content>')
    expect(caught).not.toHaveProperty('cause')
  })

  test.each(['null', '[]', '"<fixture-private-deletion-content>"', '{bad <fixture-private-deletion-content>'])('rejects malformed successful deletion bodies %s safely', async body => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await expect(client.deprovisionEntraApp({ tenantId: 'tenant-parent', clientId: 'client-1' })).rejects.toMatchObject({
      operation: 'Entra app deprovisioning', status: 200, statusText: 'Invalid deprovision response', rawBody: undefined,
    })
  })
})
