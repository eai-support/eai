import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Command } from 'commander';

const fixture = vi.hoisted(() => ({
  authenticated: true,
  workspaceSelected: true,
  localTypesPresent: true,
  responses: new Map<string, { status: number; body: unknown }>(),
  json: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/lib/auth.js', async original => ({
  ...await original<typeof import('../../src/lib/auth.js')>(),
  isAuthenticated: async () => fixture.authenticated,
  loadTokens: async () => fixture.authenticated ? { oid: 'fixture-user', upn: 'fixture@example.invalid' } : null,
  getAccessToken: async () => 'fixture-access-token',
}));
vi.mock('../../src/lib/config.js', async original => ({
  ...await original<typeof import('../../src/lib/config.js')>(),
  findProjectRoot: async () => '/fixture-project',
  loadEnvFile: async () => ({}),
  loadObjectTypes: async () => {
    if (!fixture.localTypesPresent) throw new Error('No local Object Types found');
    return { fixture: [{ name: 'Customer', slug: 'customer', status: 'published' }] };
  },
}));
vi.mock('../../src/lib/tenant-context.js', async original => ({
  ...await original<typeof import('../../src/lib/tenant-context.js')>(),
  resolvePublicApiUrl: async () => 'https://dev-api.au.myenterprise.ai/public',
  resolveActiveTenantContext: async () => {
    if (!fixture.workspaceSelected) throw new Error('No active workspace selected');
    return {
      activeTenant: { id: 'fixture-workspace' },
      publicApiUrl: 'https://dev-api.au.myenterprise.ai/public',
    };
  },
}));
vi.mock('../../src/lib/output.js', async original => ({
  ...await original<typeof import('../../src/lib/output.js')>(),
  json: fixture.json,
  warn: fixture.warn,
  heading: vi.fn(),
  blank: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dim: vi.fn(),
}));
vi.mock('ora', () => {
  const spinner = { start: () => spinner, succeed: vi.fn(), fail: vi.fn(), warn: vi.fn() };
  return { default: () => spinner };
});

describe('verify diagnostic exit status', () => {
  let command: Command;
  let previousExitCode: typeof process.exitCode;
  let requests: string[];

  beforeEach(async () => {
    previousExitCode = process.exitCode;
    process.exitCode = 0;
    vi.resetModules();
    fixture.authenticated = true;
    fixture.workspaceSelected = true;
    fixture.localTypesPresent = true;
    fixture.responses.clear();
    fixture.json.mockClear();
    fixture.warn.mockClear();
    requests = [];
    const defaults: Record<string, unknown> = {
      '/public/v4/data/resources/health': { status: 'ok' },
      '/public/v4/data/resources/object-types': { docs: [{ name: 'Customer', status: 'published' }] },
      '/public/v4/data/resources/schema/fixture-workspace': { objectTypes: [{ name: 'Customer' }] },
      '/public/v4/platform/tenants/fixture-workspace/users/fixture-user/memberships': {
        tenants: [{ tenant: { id: 'fixture-workspace', displayName: 'Fixture', slug: 'fixture' }, roles: ['tenant-admin'] }],
      },
      '/public/v4/data/resources/fixture-workspace/storage': { objectTypes: [{ objectType: 'customer', isReady: true }] },
      '/public/v4/data/resources/fixture-workspace/storage/doctor': { healthy: true },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      requests.push(path);
      const response = fixture.responses.get(path) ?? { status: path in defaults ? 200 : 404, body: defaults[path] ?? {} };
      return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    }));
    command = (await import('../../src/commands/verify.js')).verifyCommand;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = previousExitCode;
  });

  test('quick verification succeeds when every required check passes', async () => {
    await command.parseAsync([], { from: 'user' });
    expect(process.exitCode).toBe(0);
    expect(requests).toContain('/public/v4/data/resources/schema/fixture-workspace');
  });

  test.each(['authentication', 'workspace', 'local-types', 'remote-schema'])('quick verification fails a missing or failed %s prerequisite', async prerequisite => {
    if (prerequisite === 'authentication') fixture.authenticated = false;
    if (prerequisite === 'workspace') fixture.workspaceSelected = false;
    if (prerequisite === 'local-types') fixture.localTypesPresent = false;
    if (prerequisite === 'remote-schema') fixture.responses.set('/public/v4/data/resources/schema/fixture-workspace', { status: 503, body: {} });
    await command.parseAsync([], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(fixture.warn.mock.calls.some(([message]) => /failed/.test(String(message)))).toBe(true);
    if (prerequisite === 'workspace') expect(requests).toEqual(['/public/v4/data/resources/health']);
  });

  test.each(['--format json', '--json'])('storage %s keeps the failing report and exit status', async format => {
    fixture.responses.set('/public/v4/data/resources/fixture-workspace/storage/doctor', { status: 200, body: { healthy: false } });
    await command.parseAsync(['storage', ...format.split(' ')], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { passed: 1, failed: 1, skipped: 0 },
      checks: expect.arrayContaining([expect.objectContaining({ id: 'storage-doctor', status: 'failed' })]),
    }));
    expect(process.exitCode).toBe(1);
  });

  test('storage still reports both checks when a request fails', async () => {
    fixture.responses.set('/public/v4/data/resources/fixture-workspace/storage', { status: 503, body: {} });
    await command.parseAsync(['storage', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ summary: { passed: 1, failed: 1, skipped: 0 } }));
    expect(process.exitCode).toBe(1);
  });

  test('storage records a transport failure and continues its independent doctor check', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Fixture transport unavailable'));
    await command.parseAsync(['storage', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { passed: 1, failed: 1, skipped: 0 },
      checks: expect.arrayContaining([expect.objectContaining({ id: 'storage-status', status: 'failed', details: 'Fixture transport unavailable' })]),
    }));
    expect(process.exitCode).toBe(1);
  });

  test('storage records malformed JSON as a failed contract', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not JSON', { status: 200 }));
    await command.parseAsync(['storage', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ summary: { passed: 1, failed: 1, skipped: 0 } }));
    expect(process.exitCode).toBe(1);
  });

  test('healthy storage JSON succeeds', async () => {
    await command.parseAsync(['storage', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ summary: { passed: 2, failed: 0, skipped: 0 } }));
    expect(process.exitCode).toBe(0);
  });

  test.each(['authentication', 'workspace'])('storage JSON fails a missing %s prerequisite without protected requests', async prerequisite => {
    if (prerequisite === 'authentication') fixture.authenticated = false;
    if (prerequisite === 'workspace') fixture.workspaceSelected = false;
    await command.parseAsync(['storage', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: { passed: 0, failed: 1, skipped: 2 },
      checks: expect.arrayContaining([
        expect.objectContaining({ id: prerequisite === 'authentication' ? 'auth' : 'workspace', status: 'failed' }),
        expect.objectContaining({ id: 'storage-status', status: 'skipped' }),
        expect.objectContaining({ id: 'storage-doctor', status: 'skipped' }),
      ]),
    }));
    expect(requests).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  test('storage accepts only an explicit healthy boolean', async () => {
    fixture.responses.set('/public/v4/data/resources/fixture-workspace/storage/doctor', { status: 200, body: { healthy: 'false' } });
    await command.parseAsync(['storage', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ summary: { passed: 1, failed: 1, skipped: 0 } }));
    expect(process.exitCode).toBe(1);
  });

  test('storage text fails a doctor issue after rendering the report', async () => {
    fixture.responses.set('/public/v4/data/resources/fixture-workspace/storage/doctor', { status: 200, body: { healthy: false } });
    await command.parseAsync(['storage'], { from: 'user' });
    expect(fixture.json).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test.each(['--format json', '--json'])('calls %s fails failed contracts without losing the JSON report', async format => {
    fixture.responses.set('/public/v4/data/resources/schema/fixture-workspace', { status: 503, body: {} });
    await command.parseAsync(['calls', ...format.split(' ')], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ failed: 1 }),
      checks: expect.arrayContaining([expect.objectContaining({ id: 'schema', status: 'failed' })]),
    }));
    expect(process.exitCode).toBe(1);
  });

  test.each(['authentication', 'workspace'])('calls JSON fails a missing %s prerequisite', async prerequisite => {
    if (prerequisite === 'authentication') fixture.authenticated = false;
    if (prerequisite === 'workspace') fixture.workspaceSelected = false;
    await command.parseAsync(['calls', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.objectContaining({ failed: 1 }) }));
    expect(process.exitCode).toBe(1);
  });

  test('calls text fails a contract after rendering the report', async () => {
    fixture.responses.set('/public/v4/data/resources/schema/fixture-workspace', { status: 503, body: {} });
    await command.parseAsync(['calls'], { from: 'user' });
    expect(fixture.json).not.toHaveBeenCalled();
    expect(fixture.warn.mock.calls.some(([message]) => /failed/.test(String(message)))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  test('read-only calls succeed while explicitly recording optional mutation skips', async () => {
    await command.parseAsync(['calls', '--format', 'json'], { from: 'user' });
    expect(fixture.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ failed: 0, skipped: expect.any(Number), coverageComplete: false }),
    }));
    expect(process.exitCode).toBe(0);
  });
});
