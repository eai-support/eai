import { describe, expect, test, vi } from 'vitest';
import {
  CapabilityControlPlaneClient,
  assertNoSecretMaterial,
  sanitizeControlPlaneValue,
  type CapabilityControlPlaneTransport,
} from '../../src/lib/capability-control-plane.js';

function response(payload: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CapabilityControlPlaneClient', () => {
  test('normalizes definitions and preserves four independent readiness states', async () => {
    const requestPublicApi = vi.fn()
      .mockResolvedValueOnce(response({
        definitions: [{
          capabilityKey: 'ai.chat',
          displayName: 'AI chat',
          setupMode: 'portal_setup_cli_consume',
          portalRoute: '/tenants/{tenantId}/integrations',
        }],
      }))
      .mockResolvedValueOnce(response({
        tenantId: 'tenant-123',
        connections: [{
          capabilityKey: 'ai.chat',
          entitled: true,
          configured: true,
          bound: false,
          runtimeReady: false,
        }],
      }));
    const client = new CapabilityControlPlaneClient({ requestPublicApi }, 'tenant-123');

    await expect(client.listDefinitions()).resolves.toEqual([
      expect.objectContaining({ key: 'ai.chat', setupMode: 'portal_setup_cli_consume' }),
    ]);
    await expect(client.listConnections()).resolves.toEqual([
      expect.objectContaining({
        capabilityKey: 'ai.chat',
        entitled: true,
        configured: true,
        bound: false,
        runtimeReady: false,
      }),
    ]);
    expect(requestPublicApi).toHaveBeenNthCalledWith(2,
      '/v4/platform/tenants/tenant-123/capability-connections',
      undefined,
    );
  });

  test('uses typed CRUD envelopes and optimistic versions for AI assets', async () => {
    const requestPublicApi = vi.fn()
      .mockResolvedValueOnce(response({ key: 'default-chat', version: 4, data: {} }))
      .mockResolvedValueOnce(response({ key: 'default-chat', version: 5, data: {} }))
      .mockResolvedValueOnce(response({ key: 'new-chat', version: 1, data: {} }))
      .mockResolvedValueOnce(response({}, 204));
    const client = new CapabilityControlPlaneClient({ requestPublicApi }, 'tenant-123');

    await client.updateAsset('ai-profile', 'default-chat', {
      profileKey: 'default-chat',
      integrationKey: 'azure-openai',
      model: 'gpt-5',
    });
    await client.createAsset('ai-profile', {
      profileKey: 'new-chat',
      integrationKey: 'azure-openai',
      model: 'gpt-5',
    });
    await client.deleteAsset('ai-profile', 'old-chat');

    expect(requestPublicApi).toHaveBeenNthCalledWith(1,
      '/v4/platform/tenants/tenant-123/ai/profiles/default-chat',
      undefined,
    );
    expect(requestPublicApi).toHaveBeenNthCalledWith(2,
      '/v4/platform/tenants/tenant-123/ai/profiles/default-chat',
      {
        method: 'PATCH',
        body: {
          version: 4,
          data: {
            profileKey: 'default-chat',
            integrationKey: 'azure-openai',
            model: 'gpt-5',
          },
        },
      },
    );
    expect(requestPublicApi).toHaveBeenNthCalledWith(3,
      '/v4/platform/tenants/tenant-123/ai/profiles',
      {
        method: 'POST',
        body: {
          data: {
            profileKey: 'new-chat',
            integrationKey: 'azure-openai',
            model: 'gpt-5',
          },
        },
      },
    );
    expect(requestPublicApi).toHaveBeenNthCalledWith(4,
      '/v4/platform/tenants/tenant-123/ai/profiles/old-chat',
      { method: 'DELETE' },
    );
  });

  test('stores logical app bindings without tenant record ids', async () => {
    const requestPublicApi = vi.fn().mockResolvedValue(response({ bindings: [] }));
    const client = new CapabilityControlPlaneClient({ requestPublicApi }, 'tenant-123');

    await client.setBinding('my-app', {
      bindingKey: 'chatProfile',
      capabilityKey: 'ai.chat',
      assetKind: 'ai-profile',
      assetKey: 'default-chat',
    });

    expect(requestPublicApi).toHaveBeenCalledWith(
      '/v4/platform/tenants/tenant-123/apps/my-app/capability-bindings',
      {
        method: 'PUT',
        body: {
          bindings: [{
            bindingKey: 'chatProfile',
            logicalAlias: 'chatProfile',
            capabilityKey: 'ai.chat',
            assetType: 'shared-ai-profile',
            assetKey: 'default-chat',
            environment: 'default',
          }],
        },
      },
    );
  });

  test('sends canonical capability requirements to persisted binding validation', async () => {
    const requestPublicApi = vi.fn().mockResolvedValue(response({ valid: true, bindings: [] }));
    const client = new CapabilityControlPlaneClient({ requestPublicApi }, 'tenant-123');
    const capabilityRequirements = {
      schemaVersion: 'eai.app_capabilities.v1' as const,
      appKey: 'my-app',
      requirements: [{
        alias: 'primary-workflow',
        capability: 'workflows.runtime',
        required: true,
        description: 'Workflow executed by the generated application.',
        compatibleAssetTypes: ['shared-workflow-*', 'workflow-template'],
      }],
    };

    await client.validateBindings('my-app', capabilityRequirements);

    expect(requestPublicApi).toHaveBeenCalledWith(
      '/v4/platform/tenants/tenant-123/apps/my-app/capability-bindings/validate',
      { method: 'POST', body: { capabilityRequirements } },
    );
  });

  test('uses typed read-only shared-content routes and natural-key bindings', async () => {
    const requestPublicApi = vi.fn().mockImplementation(async () => response({ items: [] }));
    const client = new CapabilityControlPlaneClient({ requestPublicApi }, 'tenant-123');

    await client.listContent('document-templates');
    await client.getContent('knowledge-articles', 'planning-policy');
    await client.listSharedAssetTypes();
    await client.listSharedAssets('shared-asset-service-centre');
    await client.setAssetBinding('my-app', {
      bindingKey: 'approvalTemplate',
      capabilityKey: 'templates.documents',
      assetType: 'shared-document-template',
      assetKey: 'approval-letter',
    });

    expect(requestPublicApi).toHaveBeenNthCalledWith(1,
      '/v4/platform/tenants/tenant-123/content/document-templates',
      undefined,
    );
    expect(requestPublicApi).toHaveBeenNthCalledWith(2,
      '/v4/platform/tenants/tenant-123/content/knowledge-articles/planning-policy',
      undefined,
    );
    expect(requestPublicApi).toHaveBeenNthCalledWith(3,
      '/v4/platform/tenants/tenant-123/content/shared-asset-types',
      undefined,
    );
    expect(requestPublicApi).toHaveBeenNthCalledWith(4,
      '/v4/platform/tenants/tenant-123/content/shared-assets',
      { params: { assetType: 'shared-asset-service-centre' } },
    );
    expect(requestPublicApi).toHaveBeenNthCalledWith(5,
      '/v4/platform/tenants/tenant-123/apps/my-app/capability-bindings',
      {
        method: 'PUT',
        body: {
          bindings: [{
            bindingKey: 'approvalTemplate',
            logicalAlias: 'approvalTemplate',
            capabilityKey: 'templates.documents',
            assetType: 'shared-document-template',
            assetKey: 'approval-letter',
            environment: 'default',
          }],
        },
      },
    );
  });

  test('rejects outbound secret material and redacts accidental inbound credentials', () => {
    expect(() => assertNoSecretMaterial({ clientSecret: 'do-not-send' })).toThrow(/Admin Portal/);
    expect(() => assertNoSecretMaterial({ providerApiKey: 'do-not-send' })).toThrow(/Admin Portal/);
    expect(() => assertNoSecretMaterial({ credentialRef: 'tenant-ai-provider' })).not.toThrow();
    expect(sanitizeControlPlaneValue({
      integrationKey: 'azure-openai',
      accessToken: 'do-not-print',
      credentialRef: 'tenant-ai-provider',
      nested: { connection_string: 'do-not-print' },
    })).toEqual({
      integrationKey: 'azure-openai',
      accessToken: '[REDACTED]',
      credentialRef: 'tenant-ai-provider',
      nested: { connection_string: '[REDACTED]' },
    });
  });

  test('encodes tenant and app path segments', async () => {
    const requestPublicApi = vi.fn().mockResolvedValue(response({ bindings: [] }));
    const transport: CapabilityControlPlaneTransport = { requestPublicApi };
    const client = new CapabilityControlPlaneClient(transport, 'tenant/au');

    await client.listBindings('my app');

    expect(requestPublicApi).toHaveBeenCalledWith(
      '/v4/platform/tenants/tenant%2Fau/apps/my%20app/capability-bindings',
      undefined,
    );
  });
});
