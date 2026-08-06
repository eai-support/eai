import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createTestEnvironment, type TestEnvironment } from '../helpers/test-env.js';
import type { TestContext } from '../helpers/setup-dsl.js';
import { runCommand } from '../helpers/action-dsl.js';

const execFileAsync = promisify(execFile);

describe('CLI help output', () => {
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

  test('top-level help highlights the current update and getting-started workflows', async () => {
    const result = await runCommand(ctx, 'eai --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('eai env pull');
    expect(result.stdout).toContain('eai resources schema');
    expect(result.stdout).toContain('eai verify calls --format json');
    expect(result.stdout).toContain('eai runtime validate');
    expect(result.stdout).toContain('eai deploy doctor --url <deployed-url>');
    expect(result.stdout).toContain('Updates:');
    expect(result.stdout).toContain('eai update --check');
    expect(result.stdout).toContain('eai update');
    expect(result.stdout).toContain('eai gofer refresh --check');
    expect(result.stdout).toContain('eai gofer refresh');
    expect(result.stdout).toContain('eai template check');
    expect(result.stdout).toContain('eai errors explain E101 --format json');
    expect(result.stdout).toContain('eai agent guide --format json');
    expect(result.stdout).toContain('eai publicapi get /v4/identity/me --format json');
  });

  test('login help explains the sign-in and tenant selection flow', async () => {
    const result = await runCommand(ctx, 'eai login --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Examples:');
    expect(result.stdout).toContain('eai login --tenant-name myorg --tenant-id');
    expect(result.stdout).toContain("run 'eai tenant select' to choose the tenant");
  });

  test('create help explains the guided first-run flow', async () => {
    const result = await runCommand(ctx, 'eai create --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Guide a new builder through EAI setup');
    expect(result.stdout).toContain('Check Git, Node.js, and npm');
    expect(result.stdout).toContain('Check builder readiness');
    expect(result.stdout).toContain('--skip-onboarding');
  });

  test('docs help includes the simple upload-classify-index workflow', async () => {
    const result = await runCommand(ctx, 'eai docs --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Typical workflow:');
    expect(result.stdout).toContain('eai docs upload ./reports/contract.pdf');
    expect(result.stdout).toContain('eai docs index <documentId>');
  });

  test('--describe outputs valid parseable JSON with the agent recovery guide', async () => {
    const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [cliEntry, '--describe'], {
      cwd: ctx.workingDir,
      env: {
        ...process.env,
        HOME: ctx.env.HOME || ctx.workingDir,
        USERPROFILE: ctx.env.USERPROFILE || ctx.workingDir,
        ...ctx.env,
      },
    });

    expect(() => JSON.parse(stdout)).not.toThrow();
    const schema = JSON.parse(stdout);
    expect(typeof schema).toBe('object');
    expect(schema.agentGuide.audience).toBe('ai-agents');
    expect(schema.agentGuide.recoveryLoop).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Explain the error',
        }),
      ]),
    );
  });

  test('verify, runtime, deploy, doctor, gofer, template, publicapi, and update help include concrete examples', async () => {
    const verifyResult = await runCommand(ctx, 'eai verify --help');
    const runtimeResult = await runCommand(ctx, 'eai runtime validate --help');
    const deployResult = await runCommand(ctx, 'eai deploy doctor --help');
    const doctorResult = await runCommand(ctx, 'eai doctor --help');
    const goferResult = await runCommand(ctx, 'eai gofer --help');
    const templateResult = await runCommand(ctx, 'eai template --help');
    const publicApiResult = await runCommand(ctx, 'eai publicapi --help');
    const updateResult = await runCommand(ctx, 'eai update --help');
    const errorsResult = await runCommand(ctx, 'eai errors --help');
    const agentResult = await runCommand(ctx, 'eai agent guide --help');

    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.stdout).toContain('eai verify --tenant-id <tenantId>');
    expect(verifyResult.stdout).toContain("Use 'eai verify calls' when you need to inspect");

    expect(runtimeResult.exitCode).toBe(0);
    expect(runtimeResult.stdout).toContain('eai runtime validate --format json');

    expect(deployResult.exitCode).toBe(0);
    expect(deployResult.stdout).toContain('eai deploy doctor --url https://my-app.example.com');

    expect(doctorResult.exitCode).toBe(0);
    expect(doctorResult.stdout).toContain('eai doctor --check-updates');
    expect(doctorResult.stdout).toContain('eai update');

    expect(goferResult.exitCode).toBe(0);
    expect(goferResult.stdout).toContain('refresh');

    expect(templateResult.exitCode).toBe(0);
    expect(templateResult.stdout).toContain('check');

    expect(publicApiResult.exitCode).toBe(0);
    expect(publicApiResult.stdout).toContain('eai publicapi get /v4/identity/me');
    expect(publicApiResult.stdout).toContain('Only /v4 PublicAPI paths are accepted.');

    expect(updateResult.exitCode).toBe(0);
    expect(updateResult.stdout).toContain('eai update --check');
    expect(updateResult.stdout).toContain('The CLI installs from the public npm registry by default.');
    expect(updateResult.stdout).toContain('Recommended install: npm install -g eai-cli');
    expect(updateResult.stdout).toContain('Canonical package install: npm install -g @enterpriseai/cli');
    expect(updateResult.stdout).toContain('Static registry fallback: npm install -g @enterpriseai/cli --@enterpriseai:registry=https://eai-support.github.io/eai/registry/');
    expect(updateResult.stdout).toContain('eai gofer refresh --check');
    expect(updateResult.stdout).toContain('eai template check');

    expect(errorsResult.exitCode).toBe(0);
    expect(errorsResult.stdout).toContain('explain');
    expect(errorsResult.stdout).toContain('list');

    expect(agentResult.exitCode).toBe(0);
    expect(agentResult.stdout).toContain('eai agent guide --format json');
    expect(agentResult.stdout).toContain('eai errors explain <code-or-reason> --format json');
  });
});
