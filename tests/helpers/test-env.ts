/**
 * Test Environment Setup
 *
 * Provides utilities for creating isolated test environments,
 * managing temp directories, and cleaning up after tests.
 */

import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const activeTestRoots = new Map<string, string>();

function isWithin(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

/** Fail closed before token helpers can act on an ambient or linked user home. */
export async function resolveIsolatedTestHome(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Auth fixtures require an absolute disposable test home.');
  const candidate = resolve(path);
  const roots = [...activeTestRoots].filter(([root, canonical]) => isWithin(root, candidate) || isWithin(canonical, candidate));
  if (roots.length === 0) throw new Error('Auth fixtures require a home inside an active disposable test environment.');
  const canonical = await realpath(candidate);
  if (!roots.some(([, root]) => isWithin(root, canonical))) {
    throw new Error('Auth fixture home must not link outside its disposable test environment.');
  }
  return path;
}

export interface TestEnvironment {
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated test environment with temp directory
 */
export async function createTestEnvironment(): Promise<TestEnvironment> {
  const dir = await mkdtemp(join(tmpdir(), 'eai-test-'));
  activeTestRoots.set(resolve(dir), await realpath(dir));

  return {
    dir,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to cleanup test directory ${dir}:`, error);
      } finally {
        activeTestRoots.delete(resolve(dir));
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
