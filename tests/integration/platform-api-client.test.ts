import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/auth.js', () => ({
  getAccessToken: vi.fn(async () => '<fixture-access-token>'),
}))

import { PlatformAPIClient } from '../../src/lib/api.js'

describe('PlatformAPIClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
    await expect(client.requestPublicApi('/v3/orchestrate', { method: 'POST' }))
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
})
