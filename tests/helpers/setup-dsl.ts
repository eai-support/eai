/**
 * Setup DSL Functions (Arrange)
 *
 * Functions that create test state and preconditions.
 * Used to set up the environment before executing commands.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PublicAPIMock } from './mock-server.js';

export interface TestContext {
  workingDir: string;
  mockAPI: PublicAPIMock;
  env: Record<string, string>;
  prompts: Array<{ question: string; answer: string }>;
}

function resolveTestHome(ctx?: TestContext): string {
  return ctx?.env.HOME || ctx?.workingDir || requireCurrentHome();
}

function requireCurrentHome(): string {
  return process.env.HOME || process.env.USERPROFILE || (process.platform === 'win32' ? 'C:\\Users\\Default' : '/tmp');
}

/**
 * Set working directory for test
 */
export function workingDirectoryIs(ctx: TestContext, path: string): void {
  ctx.workingDir = path;
  process.chdir(path);
}

/**
 * Create auth tokens for logged-in user
 */
export async function userIsLoggedIn(ctx: TestContext, opts?: {
  email?: string;
  tenant?: string;
  expired?: boolean;
}): Promise<void> {
  // Use environment variable approach for testing - CLI checks this first
  ctx.env.EAI_ACCESS_TOKEN = 'test-access-token';
  ctx.env.HOME ||= ctx.workingDir;

  // Also write tokens file to home directory for full integration
  const homedir = resolveTestHome(ctx);
  const tokensDir = join(homedir, '.eai');
  await mkdir(tokensDir, { recursive: true });

  const tokens = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: opts?.expired ? Date.now() - 1000 : Date.now() + 3600000,
    upn: opts?.email || 'test@example.com',
    oid: 'test-user-oid',
    tenantId: opts?.tenant || 'test-tenant-id',
    tenantName: opts?.tenant || 'test-tenant',
    clientId: 'test-client-id',
    activeTenantId: opts?.tenant || 'test-tenant-id',
    activeTenantName: opts?.tenant || 'test-tenant',
    activeTenantSlug: opts?.tenant || 'test-tenant',
    publicApiUrl: 'https://test-api.example.com',
  };

  // Encrypt and write (mimicking the CLI's storeTokens function)
  const { createHash, createCipheriv, randomBytes } = await import('node:crypto');
  const key = createHash('sha256').update(`eai-cli-${homedir}-token-store`).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(JSON.stringify(tokens), 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const encryptedData = `${iv.toString('hex')}:${encrypted}`;

  await writeFile(
    join(tokensDir, 'tokens.json'),
    encryptedData,
    { encoding: 'utf-8', mode: 0o600 }
  );
}

/**
 * Clear auth tokens
 */
export async function userIsNotLoggedIn(ctx: TestContext): Promise<void> {
  // Clear environment variable
  delete ctx.env.EAI_ACCESS_TOKEN;
  ctx.env.HOME ||= ctx.workingDir;

  // Remove tokens file if it exists
  const homedir = resolveTestHome(ctx);
  const tokensFile = join(homedir, '.eai', 'tokens.json');
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(tokensFile);
  } catch {
    // File may not exist, that's fine
  }
}

/**
 * Clean up test tokens (call in afterEach)
 */
export async function cleanupTestTokens(ctx?: TestContext): Promise<void> {
  const homedir = resolveTestHome(ctx);
  const tokensFile = join(homedir, '.eai', 'tokens.json');
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(tokensFile);
  } catch {
    // File may not exist, that's fine
  }
  // Clear the module-level token cache so it doesn't leak between tests
  const { clearTokens } = await import('../../src/lib/auth.js');
  await clearTokens();
}

/**
 * Set token as expired
 */
export async function tokenExpired(ctx: TestContext): Promise<void> {
  await userIsLoggedIn(ctx, { expired: true });
}

/**
 * Set token as not expired
 */
export async function tokenNotExpired(ctx: TestContext): Promise<void> {
  await userIsLoggedIn(ctx, { expired: false });
}

/**
 * Create .env.local file with variables
 */
export async function projectHasEnvFile(ctx: TestContext, vars: Record<string, string>): Promise<void> {
  const envContent = Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await writeFile(join(ctx.workingDir, '.env.local'), envContent);
}

/**
 * Create valid object-types.ts file
 */
export async function projectHasValidObjectTypes(ctx: TestContext, types: Array<{
  name: string;
  displayName: string;
  status?: string;
}>): Promise<void> {
  const configDir = join(ctx.workingDir, 'src', 'eai.config');
  await mkdir(configDir, { recursive: true });

  const typesContent = `export const objectTypes = {
  'default': ${JSON.stringify(types.map(t => ({
    name: t.name,
    displayName: t.displayName,
    status: t.status || 'published',
    properties: [],
    linkTypes: [],
    actions: [],
  })), null, 2)}
};
`;

  await writeFile(join(configDir, 'object-types.ts'), typesContent);
}

/**
 * Add single object type
 */
export async function projectHasObjectType(
  ctx: TestContext,
  name: string,
  def: Record<string, unknown>
): Promise<void> {
  await projectHasValidObjectTypes(ctx, [{ name, displayName: name, ...def } as any]);
}

/**
 * Set multi-tenant configuration
 */
export async function projectHasMultiTenantConfig(ctx: TestContext, keys: string[]): Promise<void> {
  const envVars: Record<string, string> = {
    TENANT_KEYS: keys.join(','),
  };

  keys.forEach((key, index) => {
    const envKey = key.toUpperCase().replace(/-/g, '_');
    envVars[`TENANT_${envKey}_ID`] = `tenant-${index}`;
  });

  await projectHasEnvFile(ctx, envVars);
}

/**
 * Mock PublicAPI as reachable
 */
export function publicAPIReachable(ctx: TestContext): void {
  ctx.mockAPI.mockHealth(true);
}

/**
 * Mock PublicAPI as unreachable
 */
export function publicAPIUnreachable(ctx: TestContext): void {
  ctx.mockAPI.mockHealth(false);
}

/**
 * Mock PublicAPI 400 error
 */
export function publicAPIReturns400(ctx: TestContext, err: { error: string }): void {
  // Will be used in specific test contexts
  ctx.env.__MOCK_ERROR_400 = JSON.stringify(err);
}

/**
 * Mock PublicAPI 404 error
 */
export function publicAPIReturns404(ctx: TestContext, err: { error: string }): void {
  ctx.env.__MOCK_ERROR_404 = JSON.stringify(err);
}

/**
 * Mock PublicAPI 409 error
 */
export function publicAPIReturns409(ctx: TestContext, err: { error: string }): void {
  ctx.env.__MOCK_ERROR_409 = JSON.stringify(err);
}

/**
 * Mock object type exists on platform
 */
export function typeExistsOnPlatform(
  ctx: TestContext,
  name: string,
  id: string,
  def: Record<string, unknown>
): void {
  ctx.mockAPI.mockObjectTypesList([{ id, name, tenant: 'default', ...def } as any]);
}

/**
 * Mock resource exists
 */
export function resourceExists(
  ctx: TestContext,
  type: string,
  id: string,
  data: Record<string, unknown>
): void {
  ctx.mockAPI.mockResourceGet('test-tenant-id', type, id, data);
}

/**
 * Mock tenant has N resources
 */
export function tenantHasResources(ctx: TestContext, type: string, count: number): void {
  const resources = Array.from({ length: count }, (_, i) => ({
    id: `resource-${i}`,
    data: { name: `Resource ${i}` },
  }));

  ctx.mockAPI.mockResourcesList('test-tenant-id', type, resources);
}

/**
 * Mock tenant exists
 */
export function tenantExists(ctx: TestContext, id: string, def?: Record<string, unknown>): void {
  // Will be implemented with tenant mock
  ctx.env.__TENANT_EXISTS = JSON.stringify({ id, ...def });
}

/**
 * Mock platform has tenants
 */
export function platformHasTenants(ctx: TestContext, tenants: Array<Record<string, unknown>>): void {
  ctx.env.__PLATFORM_TENANTS = JSON.stringify(tenants);
}

/**
 * Set workflow ID
 */
export async function workflowExists(ctx: TestContext, id: string): Promise<void> {
  ctx.env.WORKFLOW_DEFAULT_ID = id;
  await projectHasEnvFile(ctx, { WORKFLOW_DEFAULT_ID: id });
}

/**
 * Create temp file
 */
export async function fileExists(ctx: TestContext, path: string, content?: string): Promise<void> {
  await writeFile(join(ctx.workingDir, path), content || '');
}

/**
 * Mark file as not existing
 */
export function fileNotExists(ctx: TestContext, path: string): void {
  ctx.env.__FILE_NOT_EXISTS = path;
}

/**
 * Create directory
 */
export async function directoryExists(ctx: TestContext, path: string): Promise<void> {
  await mkdir(join(ctx.workingDir, path), { recursive: true });
}

/**
 * Mock git installed
 */
export function gitIsInstalled(ctx: TestContext): void {
  ctx.env.__GIT_INSTALLED = 'true';
}

/**
 * Mock git not installed
 */
export function gitNotInstalled(ctx: TestContext): void {
  ctx.env.__GIT_INSTALLED = 'false';
}

/**
 * Mock Azure CLI installed
 */
export function azureCLIInstalled(ctx: TestContext): void {
  ctx.env.__AZ_INSTALLED = 'true';
}

/**
 * Mock Azure CLI not installed
 */
export function azureCLINotInstalled(ctx: TestContext): void {
  ctx.env.__AZ_INSTALLED = 'false';
}

/**
 * Mock GitHub CLI installed
 */
export function gitHubCLIInstalled(ctx: TestContext): void {
  ctx.env.__GH_INSTALLED = 'true';
}

/**
 * Mock GitHub CLI not installed
 */
export function gitHubCLINotInstalled(ctx: TestContext): void {
  ctx.env.__GH_INSTALLED = 'false';
}

/**
 * Mock network available
 */
export function networkIsAvailable(ctx: TestContext): void {
  ctx.env.__NETWORK_AVAILABLE = 'true';
}

/**
 * Mock network unreachable
 */
export function networkIsUnreachable(ctx: TestContext): void {
  ctx.env.__NETWORK_AVAILABLE = 'false';
}
