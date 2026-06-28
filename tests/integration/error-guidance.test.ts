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
    const result = await runCommand(ctx, 'eai errors explain tenant_authorization_incomplete --format json');

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
    expect(payload.guidance.code).toBe('E242');
    expect(payload.guidance.fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'eai provision entra --force --debug',
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
