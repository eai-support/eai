/**
 * Action DSL Functions (Act)
 *
 * Functions that execute CLI commands and simulate user interactions.
 */

import { spawn } from 'node:child_process';
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

    const child = spawn(command, args, {
      cwd: ctx.workingDir,
      env: { ...process.env, ...ctx.env },
      shell: true,
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
      const prompt = ctx.prompts.shift();
      if (prompt && child.stdin) {
        setTimeout(() => {
          child.stdin?.write(prompt.answer + '\n');
        }, 100);
      }
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
 * Simulate device code authentication
 */
export async function waitForUserAuth(ctx: TestContext): Promise<void> {
  // Simulate user completing device code flow
  await new Promise(resolve => setTimeout(resolve, 100));
  ctx.env.__AUTH_COMPLETED = 'true';
}

/**
 * Advance time in test
 */
export async function waitSeconds(seconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
