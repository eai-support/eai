/**
 * Test Environment Setup
 *
 * Provides utilities for creating isolated test environments,
 * managing temp directories, and cleaning up after tests.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestEnvironment {
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated test environment with temp directory
 */
export async function createTestEnvironment(): Promise<TestEnvironment> {
  const dir = await mkdtemp(join(tmpdir(), 'eai-cli-test-'));

  return {
    dir,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to cleanup test directory ${dir}:`, error);
      }
    },
  };
}

/**
 * Creates a test project structure
 */
export async function createTestProject(baseDir: string, options: {
  name: string;
  hasEnvFile?: boolean;
  hasObjectTypes?: boolean;
  hasPackageJson?: boolean;
  isGitRepo?: boolean;
}): Promise<string> {
  const projectDir = join(baseDir, options.name);

  await mkdir(projectDir, { recursive: true });

  if (options.hasPackageJson) {
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({
        name: options.name,
        version: '1.0.0',
        type: 'module',
      }, null, 2)
    );
  }

  if (options.hasEnvFile) {
    await mkdir(join(projectDir, '.env'), { recursive: true });
    await writeFile(
      join(projectDir, '.env.local'),
      'BASE_URL_PUBLIC_API=https://test-api.example.com\n' +
      'TENANT_DEFAULT_ID=test-tenant-id\n'
    );
  }

  if (options.hasObjectTypes) {
    await mkdir(join(projectDir, 'src', 'eai.config'), { recursive: true });
    await writeFile(
      join(projectDir, 'src', 'eai.config', 'object-types.ts'),
      'export const objectTypes = {};\n'
    );
  }

  if (options.isGitRepo) {
    await mkdir(join(projectDir, '.git'), { recursive: true });
  }

  return projectDir;
}

/**
 * Mock environment variables for test
 */
export function mockEnvVars(vars: Record<string, string>): () => void {
  const original = { ...process.env };

  Object.assign(process.env, vars);

  return () => {
    process.env = original;
  };
}

/**
 * Capture console output during test
 */
export interface ConsoleCapture {
  stdout: string[];
  stderr: string[];
  restore: () => void;
}

export function captureConsole(): ConsoleCapture {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args) => {
    stdout.push(args.map(String).join(' '));
  };

  console.error = (...args) => {
    stderr.push(args.map(String).join(' '));
  };

  console.warn = (...args) => {
    stderr.push(args.map(String).join(' '));
  };

  return {
    stdout,
    stderr,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}
