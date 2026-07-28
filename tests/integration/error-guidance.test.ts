import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { ErrorCode, formatError, formatErrorJSON } from '../../src/lib/error-codes.js';
import { findGuidanceByCodeOrReason, listErrorGuidance } from '../../src/lib/error-guidance/catalog.js';
import { validateErrorGuidanceCatalog } from '../../src/lib/error-guidance/validate.js';
import { findGuidance } from '../../src/lib/error-guidance/match.js';
import { runCommand } from '../helpers/action-dsl.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';

describe('error guidance catalog', () => {
  test('all bundled guidance entries are valid and public-safe', () => {
    const issues = validateErrorGuidanceCatalog(listErrorGuidance());

    expect(issues).toEqual([]);
  });

  test('text errors explain why the error happened and what to try next', () => {
    const message = formatError(ErrorCode.E101);

    expect(message).toContain('Why this might happen:');
    expect(message).toContain('Try next:');
    expect(message).toContain('eai whoami');
    expect(message).toContain('eai login');
    expect(message).toContain('Reason: not_logged_in');
  });

  test('JSON errors preserve suggestion and add agent guidance', () => {
    const payload = formatErrorJSON(ErrorCode.E101) as {
      error: {
        suggestion: string;
        guidance: {
          reasonCode: string;
          diagnostics: Array<{ command: string; mutates: boolean }>;
          fixes: Array<{ command: string; mutates: boolean }>;
        };
      };
    };

    expect(payload.error.suggestion).toContain('eai login');
    expect(payload.error.guidance.reasonCode).toBe('not_logged_in');
    expect(payload.error.guidance.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'eai whoami', mutates: false }),
      ]),
    );
    expect(payload.error.guidance.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'eai login', mutates: true }),
      ]),
    );
  });

  test('tenant authorization guidance includes bounded next steps', () => {
    const guidance = findGuidanceByCodeOrReason('tenant_authorization_incomplete');

    expect(guidance?.code).toBe('E242');
    expect(guidance?.fixes.map((fix) => fix.command)).toEqual(
      expect.arrayContaining([
        'eai provision entra --force --debug',
        'eai user provision-me',
      ]),
    );
    expect(guidance?.retry.maxAttempts).toBe(3);
  });

  test('permission guidance sends normal user addition through user invite before child bootstrap repair', () => {
    const guidance = findGuidanceByCodeOrReason('permission_denied');

    const fixCommands = guidance?.fixes.map((fix) => fix.command) ?? [];
    expect(fixCommands).toEqual(
      expect.arrayContaining([
        'eai user invite --email <email> --tenant <tenant-id> --role tenant-admin',
        'eai user roles --tenant <tenant-id> --format json',
        'eai tenant bootstrap-admin --parent <parent-id> --child <child-id>',
      ]),
    );
    expect(guidance?.fixes.find((fix) => fix.command.includes('bootstrap-admin'))?.when)
      .toContain('immediate child');
  });

  test('child relation guidance tells agents to use user invite for normal member management', () => {
    const guidance = findGuidance({
      serverCode: 'CHILD_RELATION_INVALID',
      message: 'Tenant child is not an immediate child of parent',
    });

    expect(guidance?.code).toBe('E205');
    expect(guidance?.reasonCode).toBe('child_relation_invalid');
    expect(guidance?.retry.allowed).toBe(false);
    expect(guidance?.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai user invite --email <email> --tenant <tenant-id> --role tenant-admin',
          mutates: true,
        }),
      ]),
    );
  });

  test('user invite external-service guidance routes agents through existing member role repair', () => {
    const guidance = findGuidance({
      operation: 'user invite',
      status: 502,
      serverCode: 'EXTERNAL_SERVICE_ERROR',
      message: 'EXTERNAL_SERVICE_ERROR while inviting a tenant member',
    });

    expect(guidance?.code).toBe('E245');
    expect(guidance?.reasonCode).toBe('user_invite_external_service_existing_member');
    expect(guidance?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai user list --tenant <tenant-id> --search <email> --format json',
          mutates: false,
        }),
      ]),
    );
    expect(guidance?.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json',
          mutates: true,
        }),
      ]),
    );
    expect(guidance?.why.join(' ')).toContain('Auth.js session or JWT');
  });

  test('app-token missing tenant guidance routes agents to tenant-scoped platform paths first', () => {
    const guidance = findGuidance({
      operation: 'platform user lookup',
      status: 502,
      serverCode: 'MISSING_TENANT',
      message: 'Tenant context required for app tokens',
    });

    expect(guidance?.code).toBe('E246');
    expect(guidance?.reasonCode).toBe('app_token_tenant_context_required');
    expect(guidance?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai publicapi get /v4/platform/tenants/<tenant-id>/users/by-email?email=<email>',
          mutates: false,
        }),
        expect.objectContaining({
          command: 'eai publicapi get /v4/platform/tenants/<tenant-id>/users/<oid>/memberships',
          mutates: false,
        }),
      ]),
    );
    expect(guidance?.fixes.map((fix) => fix.command)).toEqual(
      expect.arrayContaining([
        'Use /v4/platform/tenants/<tenant-id>/users/by-email?email=<email>',
        'Use /v4/platform/tenants/<tenant-id>/users/<oid>/memberships',
        'Use /v4/platform/tenants/<tenant-id>/members and /v4/platform/tenants/<tenant-id>/role-definitions',
      ]),
    );
    expect(guidance?.why.join(' ')).toContain('Do not treat this as the first signal to edit tenant members');
    expect(findGuidanceByCodeOrReason('app_token_tenant_context_required')?.code).toBe('E246');
  });

  test('install-registry NO_MATCH maps to non-retryable provisioning guidance', () => {
    const guidance = findGuidance({
      status: 503,
      serverCode: 'RESOURCEAPI_INSTALL_REGISTRY_NO_MATCH',
      message: 'install registry did not resolve an active install for this tenant',
    });

    expect(guidance?.code).toBe('E244');
    expect(guidance?.reasonCode).toBe('tenant_data_install_no_match');
    expect(guidance?.retry.allowed).toBe(false);
    expect(guidance?.escalation.audience).toBe('platform-support');
    // also resolves from the message alone (when the server code is sanitised out)
    expect(
      findGuidance({ message: 'install registry did not resolve an active install' })?.code,
    ).toBe('E244');
  });

  test('semantic resource search guidance tells agents to use fulltext fallback', () => {
    const guidance = findGuidance({
      operation: 'resources.search',
      status: 400,
      message: 'Search vector embedding endpoint is not configured',
    });

    expect(guidance?.code).toBe('E275');
    expect(guidance?.reasonCode).toBe('resource_search_embedding_required');
    expect(guidance?.diagnostics.map((item) => item.command)).toContain(
      'eai resources storage doctor --format json',
    );
    expect(guidance?.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai resources search "<query>" --fulltext',
          mutates: false,
        }),
      ]),
    );
    expect(findGuidanceByCodeOrReason('resource_search_embedding_required')?.code).toBe('E275');
  });

  test('resource mutation guidance gives the exact strict v4 methods and envelopes', () => {
    const guidance = findGuidance({
      operation: 'resources.update',
      status: 422,
      serverCode: 'RESOURCE_MUTATION_CONTRACT_INVALID',
      message: 'Invalid PublicAPI v4 resource.update request body.',
    });

    expect(guidance?.code).toBe('E276');
    expect(guidance?.why).toEqual(
      expect.arrayContaining([
        'Create requires POST with {"data": {...}}.',
        'Update requires PUT with {"data": {...}, "version": n}, where n is the latest resource version.',
      ]),
    );
    expect(guidance?.fixes.map((fix) => fix.command)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('publicapi post'),
        expect.stringContaining('publicapi put'),
      ]),
    );
    expect(
      findGuidance({
        status: 405,
        serverCode: 'RESOURCE_MUTATION_METHOD_NOT_ALLOWED',
      })?.code,
    ).toBe('E276');
  });
});

describe('eai errors command', () => {
  let env: TestEnvironment;
  let ctx: TestContext;

  beforeEach(async () => {
    env = await createTestEnvironment();
    ctx = {
      workingDir: env.dir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {},
      prompts: [],
    };
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test('explains an error code in text mode', async () => {
    const result = await runCommand(ctx, 'eai errors explain E101');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('not_logged_in');
    expect(result.stdout).toContain('Why this might happen:');
    expect(result.stdout).toContain('eai login');
  });

  test('explains a reason code in JSON mode for agents', async () => {
    const result = await runCommand(ctx, 'eai errors explain user_invite_external_service_existing_member --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      guidance: {
        code: string;
        reasonCode: string;
        fixes: Array<{ command: string; mutates: boolean }>;
      };
    };

    expect(payload.ok).toBe(true);
    expect(payload.guidance.code).toBe('E245');
    expect(payload.guidance.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json',
          mutates: true,
        }),
      ]),
    );
  });

  test('lists known guidance in JSON mode', async () => {
    const result = await runCommand(ctx, 'eai errors list --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      entries: Array<{ code: string; reasonCode: string }>;
    };

    expect(payload.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'E101', reasonCode: 'not_logged_in' }),
      ]),
    );
  });
});
