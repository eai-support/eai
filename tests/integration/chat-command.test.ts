import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { chatCommand } from '../../src/commands/chat.js';
import { cleanupTestTokens, userIsLoggedIn, workingDirectoryIs } from '../helpers/setup-dsl.js';
import { createTestEnvironment, createTestProject, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';

const API_BASE = 'https://test-api.example.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function tenantListPayload() {
  return {
    tenants: [
      {
        id: 'tenant-123',
        displayName: 'Tenant 123',
        slug: 'tenant-123',
        isActive: true,
        roles: ['tenant-admin'],
        homeRegion: 'australiaeast',
        hqCountryCode: 'AU',
      },
    ],
  };
}

function createChatFetchMock(chatResponse: Response): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = requestUrl(input);
    const method = String(init?.method || 'GET').toUpperCase();

    if (url === `${API_BASE}/v4/identity/tenants` && method === 'GET') {
      return jsonResponse(tenantListPayload());
    }

    return chatResponse.clone();
  });
}

function findChatRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([input]) => requestUrl(input).includes('/v4/ai/chat/'));
  expect(call).toBeDefined();
  return call!;
}

async function expectRetiredThreadOptionRejected(args: string[]) {
  const fetchMock = vi.fn();
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.stubGlobal('fetch', fetchMock);
  const [commandName, ...commandArgs] = args;
  const command = chatCommand.commands.find((candidate) => candidate.name() === commandName);
  expect(command).toBeDefined();
  command!.exitOverride();

  await expect(command!.parseAsync(commandArgs, { from: 'user' })).rejects.toMatchObject({
    code: 'commander.unknownOption',
    message: expect.stringContaining("--thread"),
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("unknown option '--thread'"));
}

describe('chat command conversation identity', () => {
  let env: TestEnvironment | undefined;
  let ctx: TestContext | undefined;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalAccessToken: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalBaseUrl = process.env.BASE_URL_PUBLIC_API;
    originalAccessToken = process.env.EAI_ACCESS_TOKEN;
    env = await createTestEnvironment();
    const projectDir = await createTestProject(env.dir, {
      name: 'chat-command-project',
      hasObjectTypes: true,
    });
    ctx = {
      workingDir: projectDir,
      mockAPI: {} as TestContext['mockAPI'],
      env: {
        HOME: env.dir,
        USERPROFILE: env.dir,
      },
      prompts: [],
    };
    workingDirectoryIs(ctx, projectDir);
    process.env.HOME = env.dir;
    process.env.USERPROFILE = env.dir;
    process.env.BASE_URL_PUBLIC_API = API_BASE;
    process.env.EAI_ACCESS_TOKEN = '<fixture-access-token>';
    await userIsLoggedIn(ctx, { tenant: 'tenant-123' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await cleanupTestTokens(ctx);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.BASE_URL_PUBLIC_API;
    } else {
      process.env.BASE_URL_PUBLIC_API = originalBaseUrl;
    }
    if (originalAccessToken === undefined) {
      delete process.env.EAI_ACCESS_TOKEN;
    } else {
      process.env.EAI_ACCESS_TOKEN = originalAccessToken;
    }
    await env?.cleanup();
  });

  test('HP001 CHAT-CMD-001: send forwards --conversation-id to the PublicAPI client body', async () => {
    const fetchMock = createChatFetchMock(jsonResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await chatCommand.parseAsync([
      'send',
      'Hello',
      '--workflow',
      'workflow-1',
      '--stage',
      'stage-1',
      '--conversation-id',
      'conv-123',
    ], { from: 'user' });

    const [, init] = findChatRequest(fetchMock);
    const body = JSON.parse(String(init?.body));
    expect(body.conversation_id).toBe('conv-123');
    expect(body.thread_id).toBeUndefined();
    expect(body.threadId).toBeUndefined();
  });

  test('HP002 CHAT-CMD-001: stream forwards --conversation-id to the PublicAPI client body', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = createChatFetchMock(new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await chatCommand.parseAsync([
      'stream',
      'Hello',
      '--workflow',
      'workflow-1',
      '--stage',
      'stage-1',
      '--conversation-id',
      'conv-123',
    ], { from: 'user' });

    expect(stdoutWrite).not.toHaveBeenCalledWith(expect.stringContaining('thread'));
    const [, init] = findChatRequest(fetchMock);
    const body = JSON.parse(String(init?.body));
    expect(body.conversation_id).toBe('conv-123');
    expect(body.thread_id).toBeUndefined();
    expect(body.threadId).toBeUndefined();
  });

  test('HP003 CHAT-CMD-001: send auto-generates a conversation id when omitted', async () => {
    const fetchMock = createChatFetchMock(jsonResponse({ response: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await chatCommand.parseAsync([
      'send',
      'Hello',
      '--workflow',
      'workflow-1',
    ], { from: 'user' });

    const [, init] = findChatRequest(fetchMock);
    const body = JSON.parse(String(init?.body));
    expect(body.conversation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.thread_id).toBeUndefined();
    expect(body.threadId).toBeUndefined();
  });

  test('BP001 CHAT-CMD-001: chat help does not expose retired thread options', () => {
    const help = [
      chatCommand.helpInformation(),
      chatCommand.commands.find((command) => command.name() === 'send')?.helpInformation() ?? '',
      chatCommand.commands.find((command) => command.name() === 'stream')?.helpInformation() ?? '',
    ].join('\n');

    expect(help).toContain('--conversation-id');
    expect(help).not.toContain('--thread');
  });

  test('BP002 CHAT-CMD-001: send rejects retired --thread before making a chat request', async () => {
    await expectRetiredThreadOptionRejected([
      'send',
      'Hello',
      '--workflow',
      'workflow-1',
      '--thread',
      'legacy-thread',
    ]);
  });

  test('BP003 CHAT-CMD-001: stream rejects retired --thread before making a chat request', async () => {
    await expectRetiredThreadOptionRejected([
      'stream',
      'Hello',
      '--workflow',
      'workflow-1',
      '--thread',
      'legacy-thread',
    ]);
  });
});
