/**
 * Action DSL Functions (Act)
 *
 * Functions that execute CLI commands and simulate user interactions.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestContext } from './setup-dsl.js';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Execute a CLI command
 */
export async function runCommand(ctx: TestContext, cmd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const [command, ...args] = cmd.split(' ');
    const cliEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
    const executable = command === 'eai' ? process.execPath : command;
    const executableArgs = command === 'eai' ? [cliEntry, ...args] : args;

    const child = spawn(executable, executableArgs, {
      cwd: ctx.workingDir,
      env: { ...process.env, ...ctx.env },
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout, stderr, error });
    });

    child.on('close', (code) => {
      resolve({ exitCode: code || 0, stdout, stderr });
    });

    // Handle prompts
    if (ctx.prompts.length > 0) {
      const prompts = [...ctx.prompts];
      ctx.prompts.length = 0;
      prompts.forEach((prompt, index) => {
        if (child.stdin) {
          setTimeout(() => {
            child.stdin?.write(prompt.answer + '\n');
          }, 100 * (index + 1));
        }
      });
    }
  });
}

/**
 * Register response to interactive prompt
 */
export function respondToPrompt(ctx: TestContext, question: string, answer: string): void {
  ctx.prompts.push({ question, answer });
}

/**
 * Simulate browser-based authentication
 */
export async function waitForUserAuth(ctx: TestContext): Promise<void> {
  // Simulate user completing browser sign-in
  await new Promise(resolve => setTimeout(resolve, 100));
  ctx.env.__AUTH_COMPLETED = 'true';
}

/**
 * Advance time in test
 */
export async function waitSeconds(seconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
