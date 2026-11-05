import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => fixture.home }));

import {
  SIGN_IN_DIRECTORY_PORTALS,
  buildPortalLoginUrl,
  describeLoginConfirmation,
  isExpectedCallbackHost,
  isGuid,
  isPortalLoginDisabled,
  isValidDomainHint,
  isValidLoginHint,
  normalizePortalUrl,
  parsePortalRoute,
  resolvePortalUrl,
} from '../../src/lib/company-sign-in.js';
import {
  DEFAULT_PROD_AUTH_COMPANY_CLIENT_ID,
  DEFAULT_PROD_AUTH_TENANT_ID,
  captureProfileConfig,
  saveProfileConfig,
  setActiveProfile,
  type ProfileConfig,
} from '../../src/lib/profile.js';
import * as auth from '../../src/lib/auth.js';

const DEV_DIRECTORY = '50808ce0-f31b-4fd0-9861-74b83b8c112a';
const TEST_DIRECTORY = 'dffacd2b-7705-43f2-86ae-75d1ef003a71';
const STANDARD_CLIENT = '00000000-0000-4000-8000-0000000000a1';
const COMPANY_CLIENT = '00000000-0000-4000-8000-0000000000c1';
const OTHER_CLIENT = '00000000-0000-4000-8000-0000000000e1';
const ROUTE_STATE = 'r'.repeat(43);

function routeParams(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

function createJwt(payload: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('company sign-in routing helpers', () => {
  test('the Portal is chosen by sign-in directory ID, never by region', () => {
    expect(SIGN_IN_DIRECTORY_PORTALS).toEqual({
      [DEV_DIRECTORY]: 'https://dev-admin-portal.myenterprise.ai',
      [TEST_DIRECTORY]: 'https://test-admin-portal.myenterprise.ai',
      [DEFAULT_PROD_AUTH_TENANT_ID]: 'https://admin-portal.myenterprise.ai',
    });
    expect(resolvePortalUrl(DEV_DIRECTORY)).toBe('https://dev-admin-portal.myenterprise.ai');
    expect(resolvePortalUrl(DEFAULT_PROD_AUTH_TENANT_ID)).toBe('https://admin-portal.myenterprise.ai');
    expect(resolvePortalUrl('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(resolvePortalUrl('custom-directory', 'http://localhost:3010')).toBe('http://localhost:3010');
    expect(resolvePortalUrl(DEV_DIRECTORY, 'https://portal.example.test/')).toBe('https://portal.example.test');
  });

  test('a portalUrl override is https, or http only on localhost or 127.0.0.1', () => {
    expect(normalizePortalUrl('https://portal.example.test')).toBe('https://portal.example.test');
    expect(normalizePortalUrl('https://portal.example.test:8443/')).toBe('https://portal.example.test:8443');
    expect(normalizePortalUrl('http://localhost:3010')).toBe('http://localhost:3010');
    expect(normalizePortalUrl('http://127.0.0.1:3010')).toBe('http://127.0.0.1:3010');
    for (const bad of [
      'http://portal.example.test', 'http://localhost.example.test', 'ftp://portal.example.test',
      'https://user:pass@portal.example.test', 'https://portal.example.test/path',
      'https://portal.example.test/?q=1', 'https://portal.example.test/#x', 'not a url', '',
    ]) {
      expect(() => normalizePortalUrl(bad), bad).toThrow();
    }
  });

  test('client IDs are GUIDs', () => {
    expect(isGuid(COMPANY_CLIENT)).toBe(true);
    expect(isGuid(COMPANY_CLIENT.toUpperCase())).toBe(true);
    for (const bad of ['', 'company-client', `${COMPANY_CLIENT}0`, ` ${COMPANY_CLIENT}`, 42, undefined]) {
      expect(isGuid(bad), String(bad)).toBe(false);
    }
  });

  test('the callback answers only Host localhost:{PORT}, and bare localhost on port 80', () => {
    expect(isExpectedCallbackHost('localhost:3476', 3476)).toBe(true);
    expect(isExpectedCallbackHost('LOCALHOST:3476', 3476)).toBe(true);
    // Browsers leave the default port out of the Host header.
    expect(isExpectedCallbackHost('localhost', 80)).toBe(true);
    expect(isExpectedCallbackHost('localhost:80', 80)).toBe(true);
    for (const host of ['localhost', 'localhost:3477', '127.0.0.1:3476', '[::1]:3476', 'attacker.example.test:3476',
      'localhost.attacker.example.test:3476', '', undefined]) {
      expect(isExpectedCallbackHost(host, 3476), String(host)).toBe(false);
    }
    expect(isExpectedCallbackHost('127.0.0.1', 80)).toBe(false);
  });

  test('EAI_LOGIN_VIA_PORTAL=false turns the Portal hop off', () => {
    expect(isPortalLoginDisabled({})).toBe(false);
    expect(isPortalLoginDisabled({ EAI_LOGIN_VIA_PORTAL: 'true' })).toBe(false);
    for (const value of ['false', 'FALSE', '0', 'no', 'off', ' false ']) {
      expect(isPortalLoginDisabled({ EAI_LOGIN_VIA_PORTAL: value }), value).toBe(true);
    }
  });

  test('the Portal link carries only the decimal port and the route state', () => {
    const url = new URL(buildPortalLoginUrl('https://admin-portal.myenterprise.ai', 3476, ROUTE_STATE));
    expect(url.origin + url.pathname).toBe('https://admin-portal.myenterprise.ai/login/cli');
    expect([...url.searchParams.keys()]).toEqual(['port', 'state']);
    expect(url.searchParams.get('port')).toBe('3476');
    expect(url.searchParams.get('state')).toBe(ROUTE_STATE);
  });

  test('a valid route gives the kind, login hint and, for companies, the domain hint', () => {
    expect(parsePortalRoute(routeParams({ state: ROUTE_STATE, kind: 'standard', login_hint: 'person@example.test' }), ROUTE_STATE))
      .toEqual({ kind: 'standard', loginHint: 'person@example.test' });
    expect(parsePortalRoute(routeParams({
      state: ROUTE_STATE, kind: 'company', login_hint: 'student@school.example.test', domain_hint: 'school.example.test',
    }), ROUTE_STATE)).toEqual({ kind: 'company', loginHint: 'student@school.example.test', domainHint: 'school.example.test' });
    // A domain hint never travels with an ordinary route.
    expect(parsePortalRoute(routeParams({
      state: ROUTE_STATE, kind: 'standard', login_hint: 'person@example.test', domain_hint: 'example.test',
    }), ROUTE_STATE)).toEqual({ kind: 'standard', loginHint: 'person@example.test' });
  });

  test.each([
    ['a wrong state', { state: 's'.repeat(43), kind: 'standard', login_hint: 'person@example.test' }],
    ['a missing state', { kind: 'standard', login_hint: 'person@example.test' }],
    ['an unknown kind', { state: ROUTE_STATE, kind: 'admin', login_hint: 'person@example.test' }],
    ['a missing kind', { state: ROUTE_STATE, login_hint: 'person@example.test' }],
    ['a missing login hint', { state: ROUTE_STATE, kind: 'standard' }],
    ['a login hint that is not an email', { state: ROUTE_STATE, kind: 'standard', login_hint: 'person' }],
    ['a login hint with spaces', { state: ROUTE_STATE, kind: 'standard', login_hint: 'per son@example.test' }],
    ['a login hint with a control character', { state: ROUTE_STATE, kind: 'standard', login_hint: 'person\u001b@example.test' }],
    ['a login hint over 320 characters', { state: ROUTE_STATE, kind: 'standard', login_hint: `${'a'.repeat(310)}@example.test` }],
    ['a bad domain hint', { state: ROUTE_STATE, kind: 'company', login_hint: 'student@school.example.test', domain_hint: '-school' }],
    ['an empty domain hint', { state: ROUTE_STATE, kind: 'company', login_hint: 'student@school.example.test', domain_hint: '' }],
  ])('a route with %s is refused', (_name, values) => {
    expect(parsePortalRoute(routeParams(values as Record<string, string>), ROUTE_STATE)).toBeNull();
  });

  test('a route that repeats a parameter is refused', () => {
    const params = routeParams({ state: ROUTE_STATE, kind: 'standard', login_hint: 'person@example.test' });
    params.append('kind', 'company');
    expect(parsePortalRoute(params, ROUTE_STATE)).toBeNull();
  });

  test('hint formats follow the Portal contract', () => {
    expect(isValidLoginHint('a@b')).toBe(true);
    expect(isValidLoginHint(`${'a'.repeat(300)}@example.test`)).toBe(true);
    expect(isValidLoginHint('two@@example.test')).toBe(false);
    expect(isValidDomainHint('school.example.test')).toBe(true);
    // The shape of a lab directory's signInHint.
    expect(isValidDomainHint('fixture-lab.onmicrosoft.com')).toBe(true);
    expect(isValidDomainHint(`a${'b'.repeat(254)}`)).toBe(true);
    expect(isValidDomainHint(`a${'b'.repeat(255)}`)).toBe(false);
    expect(isValidDomainHint('school example')).toBe(false);
    expect(isValidDomainHint('.school')).toBe(false);
  });

  test('a matching email claim, in any case, saves without asking', () => {
    expect(describeLoginConfirmation({ signedInEmail: 'Student@School.Example.Test', typedEmail: 'student@school.example.test' }))
      .toBeNull();
  });

  test('a different email claim asks with a default of no', () => {
    expect(describeLoginConfirmation({ signedInEmail: 'other@school.example.test', typedEmail: 'student@school.example.test' }))
      .toEqual({
        question: 'You signed in as other@school.example.test, but typed student@school.example.test. Save this login? [y/N]',
        defaultYes: false,
      });
  });

  test('a missing email claim asks with a default of no, and never compares the display name', () => {
    const confirmation = describeLoginConfirmation({
      typedEmail: 'student@school.example.test',
      displayIdentity: 'student@school.example.test',
    });
    expect(confirmation?.defaultYes).toBe(false);
    expect(confirmation?.question).toContain('but typed student@school.example.test. Save this login? [y/N]');
    expect(confirmation?.question).toContain('no email address');
  });

  test('with nothing typed (--company) it asks with a default of yes', () => {
    expect(describeLoginConfirmation({ signedInEmail: 'student@school.example.test' })).toEqual({
      question: 'Signed in as student@school.example.test. Save this login? [Y/n]',
      defaultYes: true,
    });
  });

  test('terminal text from the token or the Portal is stripped of control characters', () => {
    const confirmation = describeLoginConfirmation({ signedInEmail: 'evil\u001b[2J@example.test' });
    expect(confirmation?.question).not.toContain('\u001b');
  });
});

describe('company sign-in client resolution', () => {
  const prodTarget = (): auth.ResolvedAuthConfig => ({
    tenantName: 'enterpriseaiplatform',
    tenantId: DEFAULT_PROD_AUTH_TENANT_ID,
    clientId: STANDARD_CLIENT,
    authScope: 'openid profile email offline_access api://833fc5ab-f1c9-4c60-b344-64e366f241cc/access_token',
    source: 'default-prod',
    clientIdSource: 'default-prod',
  });
  const devTarget = (): auth.ResolvedAuthConfig => ({
    ...prodTarget(),
    tenantName: 'fixture-dev',
    tenantId: DEV_DIRECTORY,
    authScope: 'openid profile email offline_access api://fixture-dev-api/access_token',
    source: 'runtime-env',
    clientIdSource: 'runtime-env',
  });

  test('the PROD constant stays unset until the PROD app is pinned', () => {
    expect(DEFAULT_PROD_AUTH_COMPANY_CLIENT_ID).toBeUndefined();
    expect(auth.resolveCompanyClient(prodTarget(), { env: {} })).toBeNull();
  });

  test('order: profile field, then EAI_CLI_COMPANY_CLIENT_ID, then the PROD constant', () => {
    const env = { EAI_CLI_COMPANY_CLIENT_ID: OTHER_CLIENT };
    expect(auth.resolveCompanyClient({ ...prodTarget(), authCompanyClientId: COMPANY_CLIENT }, { env, prodDefaultClientId: STANDARD_CLIENT }))
      .toEqual({ clientId: COMPANY_CLIENT, source: 'profile' });
    expect(auth.resolveCompanyClient(prodTarget(), { env, prodDefaultClientId: STANDARD_CLIENT }))
      .toEqual({ clientId: OTHER_CLIENT, source: 'runtime-env' });
    expect(auth.resolveCompanyClient(prodTarget(), { env: {}, prodDefaultClientId: COMPANY_CLIENT }))
      .toEqual({ clientId: COMPANY_CLIENT, source: 'default-prod' });
  });

  test('the PROD constant is never used for another directory or with --tenant-* flags', () => {
    expect(auth.resolveCompanyClient(devTarget(), { env: {}, prodDefaultClientId: COMPANY_CLIENT })).toBeNull();
    expect(auth.resolveCompanyClient(prodTarget(), { env: {}, prodDefaultClientId: COMPANY_CLIENT, tenantFlagsGiven: true }))
      .toBeNull();
    // A runtime override of the PROD scope is an override away from the public defaults, as in validateResolvedAuthConfig.
    expect(auth.resolveCompanyClient({ ...prodTarget(), authScope: 'openid', source: 'runtime-env' }, {
      env: {}, prodDefaultClientId: COMPANY_CLIENT,
    })).toBeNull();
    // Explicit settings still apply with flags.
    expect(auth.resolveCompanyClient(devTarget(), { env: { EAI_CLI_COMPANY_CLIENT_ID: COMPANY_CLIENT }, tenantFlagsGiven: true }))
      .toEqual({ clientId: COMPANY_CLIENT, source: 'runtime-env' });
  });

  test('a non-GUID EAI_CLI_COMPANY_CLIENT_ID is refused', () => {
    expect(() => auth.resolveCompanyClient(devTarget(), { env: { EAI_CLI_COMPANY_CLIENT_ID: 'company-app' } }))
      .toThrow('EAI_CLI_COMPANY_CLIENT_ID');
    expect(auth.resolveCompanyClient(devTarget(), { env: { EAI_CLI_COMPANY_CLIENT_ID: '  ' } })).toBeNull();
  });
});

describe('company sign-in profile settings', () => {
  const base: ProfileConfig = {
    publicApiUrl: 'https://dev-api.au.myenterprise.ai/public',
    authTenantName: 'fixture-dev',
    authTenantId: DEV_DIRECTORY,
    authClientId: STANDARD_CLIENT,
    authScope: 'openid profile email offline_access api://fixture-dev-api/access_token',
  };

  async function writeProfiles(profiles: Record<string, unknown>): Promise<void> {
    const path = join(fixture.home, '.eai', 'config.json');
    await writeFile(path, JSON.stringify({ profiles }), { mode: 0o600 });
    await chmod(path, 0o600);
  }

  beforeEach(async () => {
    fixture.home = await mkdtemp(join(tmpdir(), 'eai-company-profile-'));
    await chmod(fixture.home, 0o700);
    await mkdir(join(fixture.home, '.eai'), { mode: 0o700 });
    await chmod(join(fixture.home, '.eai'), 0o700);
    for (const key of ['EAI_CLI_COMPANY_CLIENT_ID', 'EAI_AUTH_TENANT_NAME', 'EAI_AUTH_TENANT_ID', 'EAI_AUTH_SCOPE',
      'EAI_PUBLIC_API_SCOPE', 'EAI_CLI_CLIENT_ID', 'EAI_AUTH_CLIENT_ID']) vi.stubEnv(key, undefined);
    setActiveProfile('default');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const name of ['default', 'dev']) {
      setActiveProfile(name);
      await auth.clearTokens();
    }
    setActiveProfile('default');
    await rm(fixture.home, { recursive: true, force: true });
  });

  test('authCompanyClientId and portalUrl survive a profile rewrite', async () => {
    await writeProfiles({ dev: { ...base, authCompanyClientId: COMPANY_CLIENT, portalUrl: 'http://localhost:3010', note: 'kept' } });
    const captured = captureProfileConfig('dev');
    expect(captured?.authCompanyClientId).toBe(COMPANY_CLIENT);
    expect(captured?.portalUrl).toBe('http://localhost:3010');

    await saveProfileConfig('dev', { ...captured! });
    const saved = JSON.parse(await readFile(join(fixture.home, '.eai', 'config.json'), 'utf8')) as {
      profiles: Record<string, Record<string, unknown>>;
    };
    expect(saved.profiles.dev).toMatchObject({ authCompanyClientId: COMPANY_CLIENT, portalUrl: 'http://localhost:3010', note: 'kept' });

    // Both are known fields: a writer that leaves them out removes them, as for authScope.
    await saveProfileConfig('dev', base);
    const rewritten = JSON.parse(await readFile(join(fixture.home, '.eai', 'config.json'), 'utf8')) as {
      profiles: Record<string, Record<string, unknown>>;
    };
    expect(rewritten.profiles.dev.authCompanyClientId).toBeUndefined();
    expect(rewritten.profiles.dev.portalUrl).toBeUndefined();
    expect(rewritten.profiles.dev.note).toBe('kept');
  });

  test.each([
    ['a non-GUID authCompanyClientId', { authCompanyClientId: 'company-app' }],
    ['a non-string authCompanyClientId', { authCompanyClientId: 42 }],
    ['an http portalUrl off localhost', { portalUrl: 'http://portal.example.test' }],
    ['a portalUrl with a path', { portalUrl: 'https://portal.example.test/login' }],
  ])('%s is refused', async (_name, extra) => {
    await writeProfiles({ dev: { ...base, ...extra } });
    expect(() => captureProfileConfig('dev')).toThrow('invalid public auth/API configuration');
  });

  test('a named profile carries its company client and Portal override into the auth config', async () => {
    await writeProfiles({ dev: { ...base, authCompanyClientId: COMPANY_CLIENT, portalUrl: 'https://portal.example.test' } });
    const config = await auth.resolveAuthConfig(undefined, 'dev');
    expect(config.authCompanyClientId).toBe(COMPANY_CLIENT);
    expect(config.portalUrl).toBe('https://portal.example.test');
    expect(auth.resolveCompanyClient(config, { env: {} })).toEqual({ clientId: COMPANY_CLIENT, source: 'profile' });
  });

  test('the stored-login check accepts the company app and still rejects any other client', async () => {
    await writeProfiles({ dev: { ...base, authCompanyClientId: COMPANY_CLIENT } });
    setActiveProfile('dev');
    const stored = (clientId: string): auth.StoredTokens => ({
      accessToken: createJwt({ aud: 'fixture-dev-api', email: 'student@school.example.test' }),
      expiresAt: Date.now() + 600_000,
      tenantName: base.authTenantName,
      tenantId: base.authTenantId,
      clientId,
      authScope: base.authScope,
    });

    expect(await auth.getActiveAuthConfigMismatch(stored(STANDARD_CLIENT))).toBeNull();
    expect(await auth.getActiveAuthConfigMismatch(stored(COMPANY_CLIENT))).toBeNull();
    const mismatch = await auth.getActiveAuthConfigMismatch(stored(OTHER_CLIENT));
    expect(mismatch).toContain(`client id ${OTHER_CLIENT}`);
    expect(mismatch).toContain('Run `eai login` again');
  });

  test('without a company client the stored-login check is unchanged', async () => {
    await writeProfiles({ dev: base });
    setActiveProfile('dev');
    const mismatch = await auth.getActiveAuthConfigMismatch({
      accessToken: createJwt({ aud: 'fixture-dev-api' }),
      expiresAt: Date.now() + 600_000,
      tenantName: base.authTenantName,
      tenantId: base.authTenantId,
      clientId: COMPANY_CLIENT,
      authScope: base.authScope,
    });
    expect(mismatch).toContain(`client id ${COMPANY_CLIENT} != ${STANDARD_CLIENT}`);
  });
});
