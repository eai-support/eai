import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { ErrorCode, formatError, formatErrorJSON } from '../../src/lib/error-codes.js';
import {
  findGuidanceByCodeOrReason,
  findGuidanceByIdentifier,
  listErrorGuidance,
} from '../../src/lib/error-guidance/catalog.js';
import { validateErrorGuidanceCatalog } from '../../src/lib/error-guidance/validate.js';
import { findGuidance } from '../../src/lib/error-guidance/match.js';
import { runCommand } from '../helpers/action-dsl.js';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';

interface AuthzReasonCodeFixture {
  source: { repository: string; path: string; commit: string };
  denyReasonCodes: string[];
  nonErrorReasonCodes: string[];
}

// Frozen from the Authz capability policy; see the fixture for the source path and commit.
const authzReasonCodes = JSON.parse(
  readFileSync(new URL('./fixtures/authz-capability-reason-codes.json', import.meta.url), 'utf8'),
) as AuthzReasonCodeFixture;

// Frozen 2026-10-22 from Configurator origin/main 0fc9e3d1:
// app deletion (apps/[appKey]/deletion-metadata/route.ts, services/AppDeletionManifest.ts) and
// app ownership scope registration (apps/[appKey]/ownership-scope/route.ts, services/AppOwnershipScope.ts).
const APP_DELETION_OWNERSHIP_CODES = [
  'APP_DELETION_TARGET_TENANT_FORBIDDEN',
  'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS',
  'APP_OWNERSHIP_MANIFEST_CONFLICT',
  'APP_OWNERSHIP_MANIFEST_INCOMPLETE',
  'APP_OWNERSHIP_MANIFEST_NOT_FOUND',
  'APP_OWNERSHIP_OBJECT_TYPE_AMBIGUOUS',
  'APP_OWNERSHIP_OBJECT_TYPE_INVALID',
  'APP_OWNERSHIP_OBJECT_TYPE_NOT_FOUND',
  'APP_OWNERSHIP_STORAGE_ROUTE_INVALID',
];
const APP_OWNERSHIP_SCOPE_CODES = [
  'APP_OWNERSHIP_SCOPE_AMBIGUOUS',
  'APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE',
  'APP_OWNERSHIP_SCOPE_EXISTING_SCOPE_INVALID',
  'APP_OWNERSHIP_SCOPE_FAILED',
  'APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS',
  'APP_OWNERSHIP_SCOPE_INSTALL_CONFLICT',
  'APP_OWNERSHIP_SCOPE_INSTALL_INCOMPLETE',
  'APP_OWNERSHIP_SCOPE_INSTALL_NOT_FOUND',
  'APP_OWNERSHIP_SCOPE_INVALID_APP_KEY',
  'APP_OWNERSHIP_SCOPE_INVALID_BODY',
  'APP_OWNERSHIP_SCOPE_INVALID_OBJECT_TYPES',
  'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_CONFLICT',
  'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_NOT_EXCLUSIVE',
];

// Frozen 2026-10-22 from AdminAPI origin/main 1ef71d6a: child capacity check in
// services/configurator_service.py (require_child_tenant_capacity, which upper-cases the policy
// reason code and maps tenant_limit_reached to TENANT_QUOTA_EXCEEDED) and billing actions in
// api/routes/billing.py.
const ADMIN_API_CODES = [
  'CHILD_CAPACITY_UNAVAILABLE',
  'NO_SUBSCRIPTION',
  'SUBSCRIPTION_INACTIVE',
  'TENANT_QUOTA_EXCEEDED',
  'WORKSPACE_PLAN_BILLING_UNAVAILABLE',
];

describe('error guidance catalog', () => {
  test('all bundled guidance entries are valid and public-safe', () => {
    const issues = validateErrorGuidanceCatalog(listErrorGuidance());

    expect(issues).toEqual([]);
  });

  test('resolves an entry by server code alias regardless of case', () => {
    for (const value of ['TENANT_ADMIN_REQUIRED', 'tenant_admin_required', ' Tenant-Admin-Required ']) {
      expect(findGuidanceByIdentifier(value)?.code, value).toBe('E204');
    }
    for (const value of ['SUBSCRIPTION_INACTIVE', 'subscription_inactive']) {
      expect(findGuidanceByIdentifier(value)?.reasonCode, value).toBe('subscription_inactive');
    }
  });

  test('identifier lookup still resolves guidance codes and reason codes', () => {
    expect(findGuidanceByIdentifier('e101')?.reasonCode).toBe('not_logged_in');
    expect(findGuidanceByIdentifier('not-logged-in')?.code).toBe('E101');
  });

  test('identifier lookup does not treat message text or unknown values as aliases', () => {
    expect(findGuidanceByIdentifier('Tenant admin role required')).toBeUndefined();
    expect(findGuidanceByIdentifier('NOT_A_REAL_SERVER_CODE')).toBeUndefined();
    expect(findGuidanceByIdentifier('  ')).toBeUndefined();
  });

  test('catalog validation rejects a server code alias claimed by two entries', () => {
    const [first] = listErrorGuidance();
    const claimed = listErrorGuidance().find((entry) => entry.match?.some((matcher) => matcher.serverCode));
    if (!first || !claimed) throw new Error('Expected catalog entries with a server code alias.');
    const alias = claimed.match?.find((matcher) => matcher.serverCode)?.serverCode ?? '';
    const duplicate = {
      ...first,
      code: 'E999',
      reasonCode: 'duplicate_alias_probe',
      match: [{ serverCode: alias.toLowerCase() }],
    };

    expect(validateErrorGuidanceCatalog([claimed, duplicate])).toEqual([
      `E999 claims server code ${alias.toLowerCase()} already used by ${claimed.code}.`,
    ]);
  });

  test('catalog validation rejects an alias that shadows another entry code or reason', () => {
    const [first, second] = listErrorGuidance();
    if (!first || !second) throw new Error('Expected at least two catalog entries.');
    const shadowing = { ...second, match: [{ serverCode: first.reasonCode.toUpperCase() }] };

    expect(validateErrorGuidanceCatalog([first, shadowing])).toEqual([
      `${second.code} server code ${first.reasonCode.toUpperCase()} shadows the code or reason of ${first.code}.`,
    ]);
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

  test('calling application guidance does not reinterpret provision-me as target app authorization', () => {
    const guidance = findGuidance({
      operation: 'user provision-me',
      status: 403,
      serverCode: 'CALLING_APPLICATION_NOT_AUTHORIZED',
      message: 'The calling application is not authorized for this workspace.',
    });

    expect(guidance?.code).toBe('E247');
    expect(guidance?.why.join(' ')).toContain('does not evaluate a different workspace app client');
    expect(guidance?.diagnostics.map((diagnostic) => diagnostic.command)).toContain(
      'eai app auth status <app-key> --tenant-id <tenant-id> --client-id <app-client-id> --format json',
    );
    expect(guidance?.fixes.map((fix) => fix.command)).not.toContain('eai provision entra --force --debug');
  });

  test('tenant app creation permission failures explain the admin recovery path', () => {
    const guidance = findGuidance({
      operation: 'tenant app create',
      status: 403,
      serverCode: 'TENANT_ADMIN_REQUIRED',
      message: 'Tenant admin role required for tenant tenant-123',
    });

    expect(guidance?.code).toBe('E204');
    expect(guidance?.title).toContain('Workspace admin access is required');
    expect(guidance?.fixes.map((fix) => fix.command)).toEqual(
      expect.arrayContaining([
        'eai workspace select <workspace>',
        'Ask a workspace admin to grant your account workspace admin access',
      ]),
    );
  });

  test('permission guidance sends normal user addition through user invite before child bootstrap repair', () => {
    const guidance = findGuidanceByCodeOrReason('permission_denied');

    const fixCommands = guidance?.fixes.map((fix) => fix.command) ?? [];
    expect(fixCommands).toEqual(
      expect.arrayContaining([
        'eai user invite --email <email> --workspace <workspace-id> --role tenant-admin',
        'eai user roles --workspace <workspace-id> --format json',
        'eai workspace bootstrap-admin --parent <parent-id> --child <child-id>',
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
          command: 'eai user invite --email <email> --workspace <workspace-id> --role tenant-admin',
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
          command: 'eai user list --workspace <workspace-id> --search <email> --format json',
          mutates: false,
        }),
      ]),
    );
    expect(guidance?.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai user role set --workspace <workspace-id> --member-id <member-id> --role tenant-admin --format json',
          mutates: true,
        }),
      ]),
    );
    expect(guidance?.why.join(' ')).toContain('Auth.js session or JWT');
  });

  test('app-token missing tenant guidance routes agents to workspace-scoped platform paths first', () => {
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
    expect(guidance?.why.join(' ')).toContain('Do not treat this as the first signal to edit workspace members');
    expect(findGuidanceByCodeOrReason('app_token_tenant_context_required')?.code).toBe('E246');
  });

  test('install-registry NO_MATCH maps to non-retryable provisioning guidance', () => {
    const guidance = findGuidance({
      status: 503,
      serverCode: 'RESOURCEAPI_INSTALL_REGISTRY_NO_MATCH',
      message: 'install registry did not resolve an active install for this workspace',
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

  test('resource mutation guidance is operation-aware for maintained and raw clients', () => {
    const updateGuidance = findGuidance({
      operation: 'resources.update',
      status: 422,
      serverCode: 'RESOURCE_MUTATION_CONTRACT_INVALID',
      message: 'Invalid PublicAPI v4 resource.update request body.',
    });

    expect(updateGuidance?.code).toBe('E276');
    expect(updateGuidance?.why.join(' ')).toContain(
      'resources update client already sends PUT',
    );
    expect(updateGuidance?.fixes.map((fix) => fix.command)).toEqual(
      expect.arrayContaining([
        'eai update',
        expect.stringContaining('resources update'),
      ]),
    );
    expect(updateGuidance?.fixes.map((fix) => fix.command).join(' ')).not.toContain(
      'publicapi',
    );

    const createGuidance = findGuidance({
      operation: 'resources.create',
      status: 422,
      serverCode: 'RESOURCE_MUTATION_CONTRACT_INVALID',
    });
    expect(createGuidance?.why.join(' ')).toContain(
      'resources create client already sends POST',
    );
    expect(createGuidance?.fixes.map((fix) => fix.command)).toContain(
      'eai resources create <type> --data \'<json>\'',
    );

    const actionGuidance = findGuidance({
      operation: 'resources.action',
      status: 422,
      serverCode: 'RESOURCE_MUTATION_CONTRACT_INVALID',
    });
    expect(actionGuidance?.why.join(' ')).toContain(
      'resource action client already sends POST',
    );
    expect(actionGuidance?.fixes.map((fix) => fix.command).join(' ')).toContain(
      'action result version',
    );

    const rawGuidance = findGuidance({
      operation: 'PATCH /v4/data/resources/tenant/type/id',
      status: 405,
      serverCode: 'RESOURCE_MUTATION_METHOD_NOT_ALLOWED',
    });
    expect(rawGuidance?.fixes.map((fix) => fix.command)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('publicapi post'),
        expect.stringContaining('publicapi put'),
      ]),
    );
  });

  test('app manifest validation guidance keeps request-shape repair inside the CLI', () => {
    const guidance = findGuidanceByCodeOrReason(
      'app_manifest_validation_failed',
    );

    expect(guidance?.code).toBe('E261');
    expect(guidance?.why.join(' ')).toContain(
      'source Object Type schema is not the app-manifest HTTP request schema',
    );
    expect(guidance?.why.join(' ')).toContain(
      'stops instead of using name derivation',
    );
    expect(guidance?.diagnostics.map((item) => item.command)).toEqual(
      expect.arrayContaining([
        'eai update --check',
        'eai types validate --tenant-key <key> --tenant-id <workspace-id>',
      ]),
    );
    expect(guidance?.fixes.map((item) => item.command)).toEqual(
      expect.arrayContaining([
        'eai update',
        'eai types seed --tenant-key <key> --tenant-id <workspace-id> --format json',
      ]),
    );
    expect(guidance?.retry.maxAttempts).toBe(1);
  });
});

describe('platform reason code guidance', () => {
  test('the Authz fixture records its source and a full commit SHA', () => {
    expect(authzReasonCodes.source.path).toBe('policies/capabilities/evaluate.rego');
    expect(authzReasonCodes.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(authzReasonCodes.denyReasonCodes.length).toBeGreaterThan(0);
    expect(authzReasonCodes.nonErrorReasonCodes).toEqual(['allowed']);
  });

  test.each(authzReasonCodes.denyReasonCodes)('Authz capability reason %s has guidance', (reasonCode) => {
    const guidance = findGuidanceByIdentifier(reasonCode);

    expect(guidance, `${reasonCode} is missing from the error guidance catalog`).toBeDefined();
    // AdminAPI upper-cases the policy reason code when it denies child workspace creation.
    expect(findGuidanceByIdentifier(reasonCode.toUpperCase())?.code).toBe(guidance?.code);
  });

  test('a successful Authz decision is not error guidance', () => {
    for (const reasonCode of authzReasonCodes.nonErrorReasonCodes) {
      expect(findGuidanceByIdentifier(reasonCode)).toBeUndefined();
    }
  });

  test.each([
    ...APP_DELETION_OWNERSHIP_CODES,
    ...APP_OWNERSHIP_SCOPE_CODES,
    ...ADMIN_API_CODES,
  ])('server code %s has guidance that runtime matching also finds', (serverCode) => {
    const guidance = findGuidanceByIdentifier(serverCode);

    expect(guidance, `${serverCode} is missing from the error guidance catalog`).toBeDefined();
    expect(findGuidance({ serverCode })?.code).toBe(guidance?.code);
    expect(findGuidance({ message: `${serverCode}: request refused` })?.code).toBe(guidance?.code);
  });

  test('generic server wording shared by several ownership codes does not pick one entry', () => {
    // The platform sends these sentences for many different codes, so only the code may select guidance.
    for (const message of [
      'App deletion cannot proceed without an unambiguous ownership manifest.',
      'The requested ownership scope cannot be proven safely.',
    ]) {
      expect(findGuidance({ message }), message).toBeUndefined();
    }
  });

  test('tenant limit guidance covers the policy code and the AdminAPI quota code', () => {
    const reached = findGuidanceByIdentifier('tenant_limit_reached');

    expect(findGuidanceByIdentifier('TENANT_QUOTA_EXCEEDED')?.code).toBe(reached?.code);
    expect(reached?.retry.allowed).toBe(false);
    expect(reached?.escalation.audience).toBe('tenant-admin');
  });

  test('subscription guidance does not promise a CLI command that changes billing', () => {
    for (const value of ['subscription_inactive', 'NO_SUBSCRIPTION', 'workspace_plan_billing_unavailable']) {
      const guidance = findGuidanceByIdentifier(value);

      expect(guidance?.fixes.filter((fix) => fix.mutates), value).toEqual([]);
      expect(guidance?.safety.mutatesState, value).toBe(false);
    }
    expect(findGuidanceByIdentifier('subscription_inactive')?.retry.allowed).toBe(false);
  });

  test('billing and capacity checks that could not be confirmed allow only a bounded retry', () => {
    for (const value of ['CHILD_CAPACITY_UNAVAILABLE', 'WORKSPACE_PLAN_BILLING_UNAVAILABLE']) {
      const guidance = findGuidanceByIdentifier(value);

      expect(guidance?.retry.allowed, value).toBe(true);
      expect(guidance?.retry.maxAttempts, value).toBeLessThanOrEqual(3);
      expect(guidance?.escalation.audience, value).toBe('platform-support');
    }
  });

  test('forbidden app deletion target sends the user back to the owning workspace', () => {
    const guidance = findGuidanceByIdentifier('APP_DELETION_TARGET_TENANT_FORBIDDEN');

    expect(guidance?.category).toBe('authorization');
    expect(guidance?.retry.allowed).toBe(false);
    expect(guidance?.fixes.map((fix) => fix.command)).toEqual(
      expect.arrayContaining([
        'eai app delete <app-key> --tenant-id <owning-workspace-id> --target-tenant-id <runtime-child-id>',
      ]),
    );
    expect(guidance?.why.join(' ')).toContain('workspace admin');
  });

  test('ambiguous or incomplete ownership stops instead of retrying and escalates to support', () => {
    for (const serverCode of [
      'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS',
      'APP_OWNERSHIP_MANIFEST_INCOMPLETE',
      'APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS',
    ]) {
      const guidance = findGuidanceByIdentifier(serverCode);

      expect(guidance?.retry.allowed, serverCode).toBe(false);
      expect(guidance?.escalation.audience, serverCode).toBe('platform-support');
      expect(guidance?.fixes.filter((fix) => fix.mutates), serverCode).toEqual([]);
    }
  });

  test('only transient ownership scope outcomes are retryable, and only a bounded number of times', () => {
    const retryable = [...APP_DELETION_OWNERSHIP_CODES, ...APP_OWNERSHIP_SCOPE_CODES].filter(
      (serverCode) => findGuidanceByIdentifier(serverCode)?.retry.allowed,
    );

    expect(retryable).toEqual([
      'APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE',
      'APP_OWNERSHIP_SCOPE_FAILED',
    ]);
    for (const serverCode of retryable) {
      expect(findGuidanceByIdentifier(serverCode)?.retry.maxAttempts, serverCode).toBeLessThanOrEqual(3);
    }
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
          command: 'eai user role set --workspace <workspace-id> --member-id <member-id> --role tenant-admin --format json',
          mutates: true,
        }),
      ]),
    );
  });

  test.each(['SUBSCRIPTION_INACTIVE', 'subscription_inactive'])(
    'explains the %s server code in text mode',
    async (value) => {
      const result = await runCommand(ctx, `eai errors explain ${value}`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('subscription_inactive');
      expect(result.stdout).toContain('Why this might happen:');
    },
  );

  test('explains a server code alias in JSON mode for agents', async () => {
    const result = await runCommand(ctx, 'eai errors explain TENANT_ADMIN_REQUIRED --format json');

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      guidance: { code: string; reasonCode: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.guidance).toEqual(
      expect.objectContaining({ code: 'E204', reasonCode: 'permission_denied' }),
    );
  });

  test('explains every Authz capability reason code from the frozen fixture', async () => {
    for (const reasonCode of authzReasonCodes.denyReasonCodes) {
      const result = await runCommand(ctx, `eai errors explain ${reasonCode} --format json`);

      expect(result.exitCode, reasonCode).toBe(0);
      expect(JSON.parse(result.stdout).ok, reasonCode).toBe(true);
    }
  });

  test('reports an unknown identifier without guessing', async () => {
    const result = await runCommand(ctx, 'eai errors explain NOT_A_REAL_SERVER_CODE --format json');

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as { ok: boolean; error: { message: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toContain('NOT_A_REAL_SERVER_CODE');
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
