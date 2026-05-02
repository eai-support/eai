import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/auth.js', () => ({
  getAccessToken: vi.fn(async () => 'test-access-token'),
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
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))

    expect(body.target_backend).toBe('payload')
    expect(body.endpoint).toBe('/object-types')
    expect(body.params.limit).toBe(100)
    expect(body.params['where[tenant][equals]']).toBe('tenant-123')
  })

  test('routes tenant deletion through the admin backend', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const client = new PlatformAPIClient('https://example.test', 'tenant-parent')
    await client.deleteTenant('tenant-child')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))

    expect(String(url)).toBe('https://example.test/v3/orchestrate')
    expect(body.target_backend).toBe('admin')
    expect(body.endpoint).toBe('/v1/accounts/tenant-child/delete')
    expect(body.method).toBe('POST')
  })
})
