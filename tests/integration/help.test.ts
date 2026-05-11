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

  test('top-level help includes the current getting-started workflow', async () => {
    const result = await runCommand(ctx, 'eai --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('eai env pull');
    expect(result.stdout).toContain('eai resources schema');
    expect(result.stdout).toContain('eai verify calls --format json');
  });

  test('login help explains the sign-in and tenant selection flow', async () => {
    const result = await runCommand(ctx, 'eai login --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Examples:');
    expect(result.stdout).toContain('eai login --tenant-name myorg --tenant-id');
    expect(result.stdout).toContain("run 'eai tenant select' to choose the tenant");
  });

  test('docs help includes the simple upload-classify-index workflow', async () => {
    const result = await runCommand(ctx, 'eai docs --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Typical workflow:');
    expect(result.stdout).toContain('eai docs upload ./reports/contract.pdf');
    expect(result.stdout).toContain('eai docs index <documentId>');
  });

  test('--describe outputs valid parseable JSON', async () => {
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
  });

  test('verify, doctor, gofer, and update help include concrete examples', async () => {
    const verifyResult = await runCommand(ctx, 'eai verify --help');
    const doctorResult = await runCommand(ctx, 'eai doctor --help');
    const goferResult = await runCommand(ctx, 'eai gofer --help');
    const updateResult = await runCommand(ctx, 'eai update --help');

    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.stdout).toContain('eai verify --tenant-id <tenantId>');
    expect(verifyResult.stdout).toContain("Use 'eai verify calls' when you need to inspect");

    expect(doctorResult.exitCode).toBe(0);
    expect(doctorResult.stdout).toContain('eai doctor --check-updates');
    expect(doctorResult.stdout).toContain('eai update');

    expect(goferResult.exitCode).toBe(0);
    expect(goferResult.stdout).toContain('refresh');

    expect(updateResult.exitCode).toBe(0);
    expect(updateResult.stdout).toContain('eai update --check');
    expect(updateResult.stdout).toContain('The CLI installs from the scoped EAI static registry on GitHub Pages.');
    expect(updateResult.stdout).toContain('npm config set @eai-tools:registry https://eai-tools.github.io/eai-cli/registry/ --location=user');
    expect(updateResult.stdout).toContain('eai gofer refresh --check');
  });
});
