import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/auth.js', () => ({
  getAccessToken: vi.fn(async () => 'test-access-token'),
}))

import { PlatformAPIClient } from '../../src/lib/api.js'

describe('PlatformAPIClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('caps published object type preflight lookups at the public v4 object type limit', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-123')
    await client.getPublishedObjectTypes({ limit: 200 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const requestUrl = new URL(String(url))

    expect(requestUrl.pathname).toBe('/v4/data/resources/object-types')
    expect(init?.method).toBe('GET')
    expect(requestUrl.searchParams.get('limit')).toBe('100')
    expect(requestUrl.searchParams.get('where[tenant][equals]')).toBe('tenant-123')
  })

  test('routes tenant deletion through the public v4 platform API', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.deleteTenant('tenant-child')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]

    expect(String(url)).toBe('https://example.test/v4/platform/tenants/tenant-child/delete')
    expect(init?.method).toBe('POST')
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

  test('posts chat requests with PublicAPI thread id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.streamChat('workflow-1', 'analyze-process', 'Hello', 'thread-123', { topic: 'onboarding' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.test/v4/ai/chat/stream/tenant-parent/workflow-1/analyze-process')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      message: 'Hello',
      thread_id: 'thread-123',
      params: { topic: 'onboarding' },
    })
  })

  test('rotates Entra app secrets through the public provision router', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({
        client_id: 'client-1',
        client_secret: 'secret-1',
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
    expect(result.clientSecret).toBe('secret-1')
  })
})
