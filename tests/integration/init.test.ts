/**
 * Init Command Integration Tests
 *
 * Tests for: eai init [name] [--from <repo>] [--skip-prompts]
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import inquirer from 'inquirer';
import { describe, test, beforeEach, afterEach, expect, vi } from 'vitest';
import { describeCloneFailure, initCommand } from '../../src/commands/init.js';
import * as auth from '../../src/lib/auth.js';
import * as cloudEnv from '../../src/lib/cloud-env.js';
import * as tenantContext from '../../src/lib/tenant-context.js';
import { createTestEnvironment, captureConsole, type TestEnvironment } from '../helpers/test-env.js';
import { createMockServer, PublicAPIMock } from '../helpers/mock-server.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import {
  workingDirectoryIs,
  gitIsInstalled,
  networkIsAvailable,
  directoryExists,
} from '../helpers/setup-dsl.js';
import { runCommand, respondToPrompt } from '../helpers/action-dsl.js';
import {
  expectCommandSucceeded,
  expectCommandFailed,
  expectDirectoryCreated,
  expectFileExists,
  expectFileNotExists,
  expectFileContains,
  expectErrorMessage,
  expectSuccessMessage,
  expectNoPrompts,
  expectExitCode,
} from '../helpers/assert-dsl.js';

const exec = promisify(execFile);

async function createLocalTemplateRepo(baseDir: string): Promise<string> {
  const templateDir = join(baseDir, 'vertical-template');
  await mkdir(join(templateDir, 'src', 'eai.config'), { recursive: true });
  await writeFile(
    join(templateDir, 'package.json'),
    JSON.stringify({
      name: 'vertical-template',
      version: '0.0.1',
      type: 'module',
    }, null, 2) + '\n',
  );
  await writeFile(join(templateDir, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
  await exec('git', ['init'], { cwd: templateDir });
  await exec('git', ['config', 'user.email', 'tests@example.com'], { cwd: templateDir });
  await exec('git', ['config', 'user.name', 'EAI CLI Tests'], { cwd: templateDir });
  await exec('git', ['add', '.'], { cwd: templateDir });
  await exec('git', ['commit', '-m', 'Initial template'], { cwd: templateDir });
  return templateDir;
}

describe('eai init', () => {
  let env: TestEnvironment;
  let mockServer: ReturnType<typeof createMockServer>;
  let ctx: TestContext;
  let templateRepo: string;

  beforeEach(async () => {
    env = await createTestEnvironment();
    mockServer = createMockServer();
    mockServer.start();

    ctx = {
      workingDir: env.dir,
      mockAPI: new PublicAPIMock('https://test-api.example.com', mockServer),
      env: {},
      prompts: [],
    };

    Object.assign(ctx.env, {
      GIT_AUTHOR_NAME: 'EAI CLI Tests',
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'EAI CLI Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com',
    });

    templateRepo = await createLocalTemplateRepo(env.dir);
  });

  afterEach(async () => {
    mockServer.stop();
    await env.cleanup();
  });

  test('TC001: Initialize new vertical interactively', async () => {
    // TC001: Initialize new vertical interactively
    // Traces to: Init-US1-AC1
    //
    // workingDirectoryIs('/tmp/test-projects')
    // gitIsInstalled()
    // networkIsAvailable()
    //
    // runCommand('eai init my-vertical')
    // respondToPrompt('Display Name', 'My Vertical')
    // respondToPrompt('Description', 'Test vertical app')
    // respondToPrompt('Tenant Structure', 'single')
    // respondToPrompt('Include AI Chat', 'yes')
    // respondToPrompt('Include Docs', 'yes')
    // respondToPrompt('Auth Provider', 'ciam')
    //
    // expectDirectoryCreated('my-vertical')
    // expectFileExists('my-vertical/package.json')
    // expectFileContains('my-vertical/package.json', '"name": "my-vertical"')
    // expectFileExists('my-vertical/.env.local')
    // expectFileExists('my-vertical/src/eai.config/object-types.ts')
    // expectSuccessMessage('Vertical "My Vertical" initialized')

    workingDirectoryIs(ctx, env.dir);
    gitIsInstalled(ctx);
    networkIsAvailable(ctx);

    const promptSpy = vi.spyOn(inquirer, 'prompt').mockResolvedValue({
      name: 'my-vertical',
      displayName: 'My Vertical',
      description: 'My Vertical vertical application',
      tenantStructure: 'single',
      includeChat: true,
      includeDocs: true,
      authProvider: 'ciam',
    });
    const consoleCapture = captureConsole();

    try {
      await initCommand.parseAsync(['my-vertical', '--from', templateRepo], { from: 'user' });
    } finally {
      consoleCapture.restore();
      promptSpy.mockRestore();
    }

    await expectDirectoryCreated(ctx, 'my-vertical');
    await expectFileExists(ctx, 'my-vertical/package.json');
    await expectFileContains(ctx, 'my-vertical/package.json', '"name": "@eai-tools/my-vertical"');
    await expectFileExists(ctx, 'my-vertical/.env.local');
    await expectFileExists(ctx, 'my-vertical/src/eai.config/object-types.ts');
    await expectFileExists(ctx, 'my-vertical/.claude/commands/0_business_scenario.md');
    await expectFileExists(ctx, 'my-vertical/.claude/agents/codebase-analyzer.md');
    await expectFileExists(ctx, 'my-vertical/.specify/scripts/bash/pipeline-state.sh');
    await expectFileExists(ctx, 'my-vertical/.system/skills/0_business_scenario/SKILL.md');
    await expectFileExists(ctx, 'my-vertical/.agents/skills/0_business_scenario/SKILL.md');
    await expectFileExists(ctx, 'my-vertical/.github/prompts/0_business_scenario.prompt.md');
    await expectFileExists(ctx, 'my-vertical/.github/skills/0-business-scenario/SKILL.md');
    await expectFileExists(ctx, 'my-vertical/.github/copilot-instructions.md');
    await expectFileContains(ctx, 'my-vertical/CLAUDE.md', '## Gofer Pipeline');
    expect(consoleCapture.stdout.join('\n')).toContain('Created My Vertical');
  }, 30_000);

  test('TC002: Initialize with --skip-prompts flag', async () => {
    // TC002: Initialize with --skip-prompts flag
    // Traces to: Init-US1-AC2
    //
    // workingDirectoryIs('/tmp/test-projects')
    //
    // runCommand('eai init quick-app --skip-prompts')
    //
    // expectDirectoryCreated('quick-app')
    // expectFileContains('quick-app/package.json', '"name": "quick-app"')
    // expectFileContains('quick-app/package.json', '"displayName": "Quick App"')
    // expectNoPrompts()

    workingDirectoryIs(ctx, env.dir);

    const result = await runCommand(ctx, `eai init quick-app --skip-prompts --from ${templateRepo}`);

    await expectDirectoryCreated(ctx, 'quick-app');
    await expectFileContains(ctx, 'quick-app/package.json', '"name": "@eai-tools/quick-app"');
    await expectFileExists(ctx, 'quick-app/.claude/commands/0_business_scenario.md');
    await expectFileExists(ctx, 'quick-app/.claude/agents/codebase-analyzer.md');
    await expectFileExists(ctx, 'quick-app/.specify/scripts/hooks/post-tool-use.mjs');
    await expectFileExists(ctx, 'quick-app/.agents/skills/0_business_scenario/SKILL.md');
    await expectFileExists(ctx, 'quick-app/.github/skills/0-business-scenario/SKILL.md');
    expectNoPrompts(ctx);
    expectCommandSucceeded(result);
  }, 30_000);

  test('TC002b: Init can skip Gofer asset installation', async () => {
    workingDirectoryIs(ctx, env.dir);

    const result = await runCommand(ctx, `eai init plain-app --skip-prompts --no-gofer --from ${templateRepo}`);

    await expectDirectoryCreated(ctx, 'plain-app');
    await expectFileContains(ctx, 'plain-app/package.json', '"name": "@eai-tools/plain-app"');
    await expectFileNotExists(ctx, 'plain-app/.claude/commands/0_business_scenario.md');
    await expectFileNotExists(ctx, 'plain-app/.agents/skills/0_business_scenario/SKILL.md');
    expectCommandSucceeded(result);
  });

  test('init pre-populates known env values from active profile and tenant context', async () => {
    workingDirectoryIs(ctx, env.dir);

    const authSpy = vi.spyOn(auth, 'isAuthenticated').mockResolvedValue(false);
    const publicApiSpy = vi.spyOn(tenantContext, 'resolvePublicApiUrl').mockResolvedValue('https://test-api.ae.myenterprise.ai/public');
    const tenantSpy = vi.spyOn(tenantContext, 'resolveActiveTenantContext').mockResolvedValue({
      publicApiUrl: 'https://test-api.ae.myenterprise.ai/public',
      tokens: {
        accessToken: 'access',
        expiresAt: Date.now() + 60_000,
        tenantId: 'ciam-guid',
        tenantName: 'enterpriseaitestplatform',
        clientId: 'client-id',
      },
      activeTenant: {
        id: 'tenant-123',
        displayName: 'Test Tenant',
        slug: 'test-tenant',
        domain: 'test.example.com',
        isActive: true,
        roles: ['tenant-admin'],
      },
      memberships: [],
    });
    const loadTokensSpy = vi.spyOn(auth, 'loadTokens').mockResolvedValue({
      accessToken: 'access',
      expiresAt: Date.now() + 60_000,
      tenantId: 'ciam-guid',
      tenantName: 'enterpriseaitestplatform',
      clientId: 'client-id',
    });

    try {
      await initCommand.parseAsync(['prefilled-app', '--skip-prompts', '--from', templateRepo], { from: 'user' });
      const envContent = await readFile(join(env.dir, 'prefilled-app', '.env.local'), 'utf-8');
      expect(envContent).toContain('BASE_URL_PUBLIC_API=https://test-api.ae.myenterprise.ai/public');
      expect(envContent).toContain('ENTRA_TENANT_NAME=enterpriseaitestplatform');
      expect(envContent).toContain('ENTRA_TENANT_ID=ciam-guid');
      expect(envContent).toContain('TENANT_PREFILLED_APP_ID=tenant-123');
    } finally {
      authSpy.mockRestore();
      publicApiSpy.mockRestore();
      tenantSpy.mockRestore();
      loadTokensSpy.mockRestore();
    }
  }, 30_000);

  test('init hydrates ENTRA_CLIENT_SECRET from cloud config when an existing app registration is reused', async () => {
    workingDirectoryIs(ctx, env.dir);

    const promptSpy = vi.spyOn(inquirer, 'prompt')
      .mockResolvedValueOnce({
        name: 'existing-secret-app',
        displayName: 'Existing Secret App',
        description: 'Existing Secret App vertical application',
        tenantStructure: 'single',
        includeChat: true,
        includeDocs: true,
        authProvider: 'ciam',
      })
      .mockResolvedValueOnce({ provision: true });
    const authSpy = vi.spyOn(auth, 'isAuthenticated').mockResolvedValue(true);
    const loadTokensSpy = vi.spyOn(auth, 'loadTokens').mockResolvedValue({
      accessToken: 'access',
      expiresAt: Date.now() + 60_000,
      tenantId: 'ciam-guid',
      tenantName: 'enterpriseaitestplatform',
      clientId: 'client-id',
    });
    const publicApiSpy = vi.spyOn(tenantContext, 'resolvePublicApiUrl').mockResolvedValue('https://test-api.ae.myenterprise.ai/public');
    const tenantSpy = vi.spyOn(tenantContext, 'resolveActiveTenantContext').mockResolvedValue({
      publicApiUrl: 'https://test-api.ae.myenterprise.ai/public',
      tokens: {
        accessToken: 'access',
        expiresAt: Date.now() + 60_000,
        tenantId: 'ciam-guid',
        tenantName: 'enterpriseaitestplatform',
        clientId: 'client-id',
      },
      activeTenant: {
        id: 'tenant-123',
        displayName: 'Test Tenant',
        slug: 'test-tenant',
        domain: 'test.example.com',
        isActive: true,
        roles: ['tenant-admin'],
      },
      memberships: [],
    });
    const provisionSpy = vi.spyOn(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      (await import('../../src/lib/api.js')).PlatformAPIClient.prototype,
      'provisionEntraApp',
    ).mockResolvedValue({
      clientId: 'existing-client-id',
      clientSecret: null,
      existing: true,
    });
    const cloudSpy = vi.spyOn(cloudEnv, 'pullCloudEnvValues').mockResolvedValue({
      store: 'appcs-demo-eai-dev',
      patches: { ENTRA_CLIENT_SECRET: 'secret-from-kv' },
      secretRefs: [{ key: 'ENTRA_CLIENT_SECRET', vaultUri: 'https://vault/secrets/entra' }],
    });

    try {
      await initCommand.parseAsync(['existing-secret-app', '--from', templateRepo], { from: 'user' });
      const envContent = await readFile(join(env.dir, 'existing-secret-app', '.env.local'), 'utf-8');
      expect(envContent).toContain('ENTRA_CLIENT_ID=existing-client-id');
      expect(envContent).toContain('ENTRA_CLIENT_SECRET=secret-from-kv');
    } finally {
      promptSpy.mockRestore();
      authSpy.mockRestore();
      loadTokensSpy.mockRestore();
      publicApiSpy.mockRestore();
      tenantSpy.mockRestore();
      provisionSpy.mockRestore();
      cloudSpy.mockRestore();
    }
  }, 30_000);

  test('TC004: Init fails when directory exists', async () => {
    // TC004: Init fails when directory exists
    // Traces to: Init-US1-ERR1
    //
    // directoryExists('/tmp/test-projects/existing-app')
    //
    // runCommand('eai init existing-app')
    //
    // expectCommandFailed()
    // expectErrorMessage('Directory "existing-app" already exists')
    // expectExitCode(1)

    workingDirectoryIs(ctx, env.dir);
    await directoryExists(ctx, 'existing-app');

    const result = await runCommand(ctx, `eai init existing-app --skip-prompts --from ${templateRepo}`);

    expectCommandFailed(result);
    expectErrorMessage(result, 'Directory "existing-app" already exists.');
    expectExitCode(result, 1);
  });

  // Additional tests would follow the same pattern...
  // TC003: Initialize from custom template repository
  // TC005: Initialize fails when git not installed
  // TC006: Initialize multi-tenant structure
  // TC007: Initialize without AI chat
  // TC008: Generated object-types.ts is valid
  // TC009: Generated deployment workflow is valid
  // TC010: Init creates initial git commit
});

describe('describeCloneFailure', () => {
  test('explains unreachable default template repository failures', () => {
    const message = describeCloneFailure(
      'https://github.com/eai-tools/eai-vertical-template.git',
      new Error('Command failed: git clone ...\nremote: Repository not found.\nfatal: repository not found'),
    );

    expect(message).toContain('default template source');
    expect(message).toContain('--from <repo-or-path>');
    expect(message).toContain('could not be reached');
  });

  test('explains when git is not installed', () => {
    const message = describeCloneFailure(
      'https://github.com/eai-tools/eai-vertical-template.git',
      new Error('spawn git ENOENT'),
    );

    expect(message).toContain('`git` is required');
    expect(message).toContain('winget install --id Git.Git -e');
    expect(message).toContain('eai-tools/eai-vertical-template.git');
  });

  test('passes through unrelated clone errors', () => {
    expect(describeCloneFailure('/tmp/template', new Error('fatal: unable to access repository'))).toBe(
      'fatal: unable to access repository',
    );
  });
});
