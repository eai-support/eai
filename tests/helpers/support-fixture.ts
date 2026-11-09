import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORT_DRAFT_ID = 'f9f064e2-0fc8-4c08-94e9-9b726ab47ced';
export const SUPPORT_DRAFT_TOKEN = randomBytes(32).toString('base64url');
export const SUPPORT_SESSION_TOKEN = 'opaque-saved-session-fixture';

export interface DraftRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly body: Record<string, unknown>;
}

export interface DraftServer {
  readonly origin: string;
  readonly requests: DraftRequest[];
  readonly close: () => Promise<void>;
}

export type DraftResponder = (response: ServerResponse, origin: string) => void;

export function validDraftResponse(origin: string): Record<string, unknown> {
  return {
    id: SUPPORT_DRAFT_ID,
    token: SUPPORT_DRAFT_TOKEN,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    redeemUrl: `${origin}/support#draft=${SUPPORT_DRAFT_ID}.${SUPPORT_DRAFT_TOKEN}`,
  };
}

/** The website's answer when neither a tenant home region nor an organisation location settles the storage region. */
export const regionRequiredResponder: DraftResponder = (response) => {
  response.writeHead(400, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'region_required' }));
};

export async function startDraftServer(respond?: DraftResponder): Promise<DraftServer> {
  const requests: DraftRequest[] = [];
  let origin = '';
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_draft' }));
      return;
    }
    requests.push({
      method: request.method, url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'], body,
    });
    if (respond) {
      respond(response, origin);
      return;
    }
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify(validDraftResponse(origin)));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Support fixture did not start.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin, requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

export interface SupportSessionOverrides {
  readonly activeTenantId?: string;
  readonly activeTenantName?: string;
}

/** Saves an encrypted login session; pass `{ activeTenantId: undefined }` for a session without an active workspace. */
export async function writeSupportSession(home: string, expiresAt = Date.now() + 60 * 60 * 1000, overrides?: SupportSessionOverrides): Promise<void> {
  const directory = join(home, '.eai');
  await mkdir(directory, { recursive: true });
  const tokens = {
    accessToken: SUPPORT_SESSION_TOKEN,
    refreshToken: 'opaque-refresh-session-fixture',
    expiresAt,
    tenantId: 'authority-tenant-fixture',
    tenantName: 'authority-name-fixture',
    clientId: 'client-fixture',
    activeTenantId: 'workspace-id-fixture',
    activeTenantName: 'Workspace fixture',
    ...overrides,
  };
  const key = createHash('sha256').update(`eai-${home}-token-store`).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  await writeFile(join(directory, 'tokens.json'), `${iv.toString('hex')}:${encrypted.toString('hex')}`, { mode: 0o600 });
}

/** A valid harness session summary in the website's `harness` shape. */
export function harnessContextFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestedByPerson: true,
    request: 'get help',
    goal: 'Seed the Object Types for the new app',
    summary: 'eai types seed failed twice with E001 after the project root could not be found.',
    steps: ['Ran eai types validate', 'Ran eai types seed'],
    commands: [{ command: 'eai types seed', exitCode: 1, errorCode: 'E001', reasonCode: 'not_in_eai_project', at: '2026-10-12T01:02:03.000Z' }],
    errors: [{ code: 'E001', message: 'Not in an EAI project directory', at: '2026-10-12T01:02:04.000Z' }],
    attemptedFixes: ['Checked that eai.config.ts exists'],
    filesTouched: ['src/eai.config/object-types.ts'],
    truncated: false,
    ...overrides,
  };
}

export interface SupportCliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SupportCliInput {
  /** Text piped to the CLI's stdin; stdin is closed either way. */
  readonly input?: string;
}

export function runSupportCli(home: string, args: readonly string[], environment: Record<string, string> = {}, { input }: SupportCliInput = {}): Promise<SupportCliResult> {
  const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [cliEntry, ...args], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        EAI_PROFILE: 'default',
        EAI_ACCESS_TOKEN: '',
        EAI_WEBSITE_URL: '',
        EAI_UPDATE_CHECK_DISABLED: '1',
        NO_UPDATE_NOTIFIER: '1',
        EAI_NON_INTERACTIVE: '1',
        NO_COLOR: '1',
        ...environment,
      },
      encoding: 'utf8', timeout: 10_000,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(error);
        return;
      }
      resolve({ code: error && typeof error.code === 'number' ? error.code : 0, stdout, stderr });
    });
    child.stdin?.end(input ?? '');
  });
}
