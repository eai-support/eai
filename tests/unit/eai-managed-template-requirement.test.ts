import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformAPIClient } from '../../src/lib/api.js';
import { ManagedSourceError } from '../../src/lib/eai-managed-source.js';
import { responseOperation } from '../../src/lib/eai-managed-source-operation-client.js';
import {
  TEMPLATE_MIGRATION_DOCS_URL,
  assertProjectTemplateApproved,
} from '../../src/lib/eai-managed-template-requirement.js';
import type { CliManagedSourceScope } from '../../src/lib/eai-managed-source-client.js';

const scope: CliManagedSourceScope = { tenantId: 'company', appKey: 'my-app', targetTenantId: 'runtime', environment: 'preview', actorId: 'eai-user-oid' };
const OLD = '3af817f688d374b6260dcffcecb53c4bb94675ef';
const NEW = '3162df8dffd36465ef2cec474eee4f8e6285ec3c';
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const requirement = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 'eai.cli_managed_template_requirement.v1', tenantId: 'company', appKey: 'my-app',
  requiredTemplateCommitSha: NEW, requiredTemplateVersion: 'v1.0.17', ...overrides,
});

async function caught(promise: Promise<unknown>): Promise<ManagedSourceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ManagedSourceError);
    return error as ManagedSourceError;
  }
  throw new Error('expected a ManagedSourceError');
}

describe('managed source operation errors keep the server reason (Issues2025#3574)', () => {
  test('a stale template names both versions and the supported fixes', async () => {
    const future = 'f'.repeat(40);
    const error = await caught(responseOperation(json({
      error: 'TEMPLATE_VERSION_NOT_APPROVED',
      message: 'Local app template commit is not the approved platform version.',
      details: { currentTemplateCommitSha: OLD, requiredTemplateCommitSha: future, requiredTemplateVersion: 'v9.0.0', hint: 'Update the EAI CLI.' },
    }, 409)));
    expect(error.code).toBe('TEMPLATE_VERSION_NOT_APPROVED');
    expect(error.message).toBe('Your project uses app template 3af817f; this environment requires v9.0.0 (fffffff).');
    expect(error.nextAction).toContain('npm install -g eai-cli@latest so it bundles app template v9.0.0 (fffffff)');
    expect(error.nextAction).toContain(TEMPLATE_MIGRATION_DOCS_URL);
    expect(error.details).toMatchObject({ httpStatus: 409, currentTemplateCommitSha: OLD, requiredTemplateCommitSha: future, requiredTemplateVersion: 'v9.0.0' });
  });

  test('FastAPI-wrapped stale templates tell an up-to-date CLI to migrate the project', async () => {
    const error = await caught(responseOperation(json({ detail: {
      error: 'TEMPLATE_VERSION_NOT_APPROVED',
      details: { currentTemplateCommitSha: OLD, requiredTemplateCommitSha: NEW, requiredTemplateVersion: 'v1.0.17' },
    } }, 409)));
    expect(error.code).toBe('TEMPLATE_VERSION_NOT_APPROVED');
    expect(error.nextAction).toMatch(/^This CLI already bundles app template v1\.0\.17 \(3162df8\): create a new project/);
  });

  test('older or unknown server codes stay readable instead of a bare status', async () => {
    const error = await caught(responseOperation(json({ error: 'CLI_MANAGED_SOURCE_UPSTREAM_REJECTED', message: 'The managed source request was rejected.' }, 409)));
    expect(error.code).toBe('MANAGED_SOURCE_UNAVAILABLE');
    expect(error.message).toContain('(409 CLI_MANAGED_SOURCE_UPSTREAM_REJECTED)');
    expect(error.message).toContain('The managed source request was rejected.');
    expect(error.details).toEqual({ httpStatus: 409, serverCode: 'CLI_MANAGED_SOURCE_UPSTREAM_REJECTED' });
  });

  test('FastAPI detail strings are bounded and stripped of control characters', async () => {
    const error = await caught(responseOperation(json({ detail: `An earlier\u001b[31m CLI operation is still active.${'x'.repeat(400)}` }, 409)));
    expect(error.code).toBe('MANAGED_SOURCE_UNAVAILABLE');
    expect(error.message).toContain('An earlier [31m CLI operation is still active.');
    expect(error.message).not.toContain('\u001b');
    expect(error.message.length).toBeLessThan(500);
  });

  test('non-JSON bodies and nested FastAPI errors still report the status', async () => {
    expect((await caught(responseOperation(new Response('<html>bad gateway</html>', { status: 502 })))).message)
      .toContain('(502)');
    const nested = await caught(responseOperation(json({ detail: { error: 'CLI_MANAGED_SOURCE_DIGEST_MISMATCH' } }, 502)));
    expect(nested.message).toContain('(502 CLI_MANAGED_SOURCE_DIGEST_MISMATCH)');
  });

  test('a malformed stale-template body falls back to the readable generic error', async () => {
    const error = await caught(responseOperation(json({ error: 'TEMPLATE_VERSION_NOT_APPROVED', details: { currentTemplateCommitSha: 'nope' } }, 409)));
    expect(error.code).toBe('MANAGED_SOURCE_UNAVAILABLE');
    expect(error.message).toContain('TEMPLATE_VERSION_NOT_APPROVED');
  });
});

describe('template preflight before the GitHub link step', () => {
  let root: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function project(manifest: unknown): Promise<string> {
    root = await mkdtemp(join(tmpdir(), 'eai-template-preflight-'));
    if (manifest !== undefined) await writeFile(join(root, '.eai-manifest.json'), JSON.stringify(manifest));
    return root;
  }

  test('stops an outdated project with its version and the required version', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const read = vi.spyOn(client, 'getCliManagedTemplateRequirement').mockResolvedValue(json(requirement()));
    const error = await caught(assertProjectTemplateApproved(
      client, scope, await project({ template: { version: 'v1.0.7', commit: OLD } }), 1000,
    ));
    expect(read).toHaveBeenCalledExactlyOnceWith('company', 'my-app', 'runtime', 1000);
    expect(error.code).toBe('TEMPLATE_VERSION_NOT_APPROVED');
    expect(error.message).toBe('Your project uses app template v1.0.7 (3af817f); this environment requires v1.0.17 (3162df8).');
    expect(error.nextAction).toContain('eai create');
    expect(error.nextAction).toContain(TEMPLATE_MIGRATION_DOCS_URL);
  });

  test('continues when the project already uses the approved template', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'getCliManagedTemplateRequirement').mockResolvedValue(json(requirement()));
    await expect(assertProjectTemplateApproved(client, scope, await project({ template: { commit: NEW } }), 1000)).resolves.toBeUndefined();
  });

  test.each([
    ['an older platform without the route', () => Promise.resolve(json({ detail: 'Not Found' }, 404))],
    ['a platform outage', () => Promise.resolve(json({ error: 'CLI_MANAGED_SOURCE_UPSTREAM_REJECTED' }, 503))],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['an unverifiable body', () => Promise.resolve(json(requirement({ requiredTemplateCommitSha: 'nope' })))],
    ['a crossed app scope', () => Promise.resolve(json(requirement({ appKey: 'other-app' })))],
  ])('fails open for %s', async (_label, outcome) => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    vi.spyOn(client, 'getCliManagedTemplateRequirement').mockImplementation(outcome);
    await expect(assertProjectTemplateApproved(client, scope, await project({ template: { version: 'v1.0.7', commit: OLD } }), 1000)).resolves.toBeUndefined();
  });

  test('leaves projects without a template pin to the existing bundle checks', async () => {
    const client = new PlatformAPIClient('https://api.example.test/public', scope.tenantId);
    const read = vi.spyOn(client, 'getCliManagedTemplateRequirement');
    await expect(assertProjectTemplateApproved(client, scope, await project(undefined), 1000)).resolves.toBeUndefined();
    await expect(assertProjectTemplateApproved(client, scope, await project({ template: { commit: 'short' } }), 1000)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
