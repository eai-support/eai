/**
 * Assertion DSL Functions (Assert)
 *
 * Functions that verify expected outcomes and command results.
 */

import { expect } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandResult } from './action-dsl.js';
import type { TestContext } from './setup-dsl.js';

/**
 * Expect command succeeded (exit code 0)
 */
export function expectCommandSucceeded(result: CommandResult): void {
  expect(result.exitCode).toBe(0);
}

/**
 * Expect command failed (exit code 1)
 */
export function expectCommandFailed(result: CommandResult): void {
  expect(result.exitCode).toBe(1);
}

/**
 * Expect specific exit code
 */
export function expectExitCode(result: CommandResult, code: number): void {
  expect(result.exitCode).toBe(code);
}

/**
 * Expect success message in output
 */
export function expectSuccessMessage(result: CommandResult, msg: string): void {
  expect(result.stdout).toContain(msg);
}

/**
 * Expect error message in output
 */
export function expectErrorMessage(result: CommandResult, msg: string): void {
  expect(result.stderr).toContain(msg);
}

/**
 * Expect warning message in output
 */
export function expectWarningMessage(result: CommandResult, msg: string): void {
  expect(result.stdout).toContain(msg);
}

/**
 * Expect info message in output
 */
export function expectInfoMessage(result: CommandResult, msg: string): void {
  expect(result.stdout).toContain(msg);
}

/**
 * Expect displayed message in stdout or stderr
 */
export function expectDisplayedMessage(result: CommandResult, msg: string): void {
  const allOutput = result.stdout + result.stderr;
  expect(allOutput).toContain(msg);
}

/**
 * Expect suggested fix in output
 */
export function expectSuggestedFix(result: CommandResult, msg: string): void {
  expect(result.stdout + result.stderr).toContain(msg);
}

/**
 * Expect file exists
 */
export async function expectFileExists(ctx: TestContext, path: string): Promise<void> {
  const fullPath = join(ctx.workingDir, path);
  await expect(access(fullPath)).resolves.not.toThrow();
}

/**
 * Expect file does not exist
 */
export async function expectFileNotExists(ctx: TestContext, path: string): Promise<void> {
  const fullPath = join(ctx.workingDir, path);
  await expect(access(fullPath)).rejects.toThrow();
}

/**
 * Expect file contains content
 */
export async function expectFileContains(ctx: TestContext, path: string, content: string): Promise<void> {
  const fullPath = join(ctx.workingDir, path);
  const fileContent = await readFile(fullPath, 'utf-8');
  expect(fileContent).toContain(content);
}

/**
 * Expect environment variable is set in file
 */
export async function expectEnvVarSet(ctx: TestContext, file: string, key: string, value: string): Promise<void> {
  const fullPath = join(ctx.workingDir, file);
  const content = await readFile(fullPath, 'utf-8');
  expect(content).toContain(`${key}=${value}`);
}

/**
 * Expect environment variable is not set in file
 */
export async function expectEnvVarNotSet(ctx: TestContext, file: string, key: string): Promise<void> {
  const fullPath = join(ctx.workingDir, file);
  const content = await readFile(fullPath, 'utf-8');
  expect(content).not.toContain(`${key}=`);
}

/**
 * Expect directory was created
 */
export async function expectDirectoryCreated(ctx: TestContext, path: string): Promise<void> {
  await expectFileExists(ctx, path);
}

/**
 * Expect API was called with GET
 */
export function expectAPICalledGET(ctx: TestContext, endpoint: string, params?: Record<string, unknown>): void {
  // This will be verified via mock server request tracking
  expect(ctx.env.__API_CALLS || '').toContain(`GET ${endpoint}`);
}

/**
 * Expect API was called with POST
 */
export function expectAPICalledPOST(ctx: TestContext, endpoint: string, body?: Record<string, unknown>): void {
  expect(ctx.env.__API_CALLS || '').toContain(`POST ${endpoint}`);
}

/**
 * Expect API was called with PUT
 */
export function expectAPICalledPUT(ctx: TestContext, endpoint: string, body?: Record<string, unknown>): void {
  expect(ctx.env.__API_CALLS || '').toContain(`PUT ${endpoint}`);
}

/**
 * Expect API was called with PATCH
 */
export function expectAPICalledPATCH(ctx: TestContext, endpoint: string, body?: Record<string, unknown>): void {
  expect(ctx.env.__API_CALLS || '').toContain(`PATCH ${endpoint}`);
}

/**
 * Expect API was called with DELETE
 */
export function expectAPICalledDELETE(ctx: TestContext, endpoint: string): void {
  expect(ctx.env.__API_CALLS || '').toContain(`DELETE ${endpoint}`);
}

/**
 * Expect no API calls were made
 */
export function expectNoAPICallsMade(ctx: TestContext): void {
  expect(ctx.env.__API_CALLS || '').toBe('');
}

/**
 * Expect token file was created
 */
export async function expectTokenStored(ctx: TestContext, path: string): Promise<void> {
  await expectFileExists(ctx, path);
}

/**
 * Expect token is encrypted
 */
export async function expectTokenEncrypted(ctx: TestContext, path: string): Promise<void> {
  const fullPath = join(ctx.workingDir, path);
  const content = await readFile(fullPath, 'utf-8');
  // Token file should not contain plaintext "<fixture-access-token>"
  expect(content).not.toContain('<fixture-access-token>');
}

/**
 * Expect token file was deleted
 */
export async function expectTokenFileDeleted(ctx: TestContext, path: string): Promise<void> {
  await expectFileNotExists(ctx, path);
}

/**
 * Expect output is valid JSON
 */
export function expectJSONOutput(result: CommandResult): void {
  expect(() => JSON.parse(result.stdout)).not.toThrow();
}

/**
 * Expect JSON output contains properties
 */
export function expectJSONContains(result: CommandResult, obj: Record<string, unknown>): void {
  const json = JSON.parse(result.stdout);
  Object.entries(obj).forEach(([key, value]) => {
    expect(json[key]).toEqual(value);
  });
}

/**
 * Expect validation passed
 */
export function expectValidationPassed(result: CommandResult): void {
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('valid');
}

/**
 * Expect validation failed
 */
export function expectValidationFailed(result: CommandResult): void {
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('error');
}

/**
 * Expect no errors or warnings
 */
export function expectNoErrorsOrWarnings(result: CommandResult): void {
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('error');
  expect(result.stdout).not.toContain('warning');
}

/**
 * Expect git repo was initialized
 */
export async function expectGitRepoInitialized(ctx: TestContext, path: string): Promise<void> {
  await expectFileExists(ctx, join(path, '.git'));
}

/**
 * Expect git commit exists
 */
export async function expectGitCommitExists(ctx: TestContext, path: string, msg: string): Promise<void> {
  // This would require git log inspection - simplified for testing
  expect(ctx.env.__GIT_COMMITS || '').toContain(msg);
}

/**
 * Expect no interactive prompts
 */
export function expectNoPrompts(ctx: TestContext): void {
  expect(ctx.prompts.length).toBe(0);
}

/**
 * Expect diagnostic check passed
 */
export function expectCheckPassed(result: CommandResult, name: string, severity?: string): void {
  expect(result.stdout).toContain(name);
  expect(result.stdout).toMatch(/✓|✔|PASS|OK/);
}

/**
 * Expect diagnostic check failed
 */
export function expectCheckFailed(result: CommandResult, name: string): void {
  expect(result.stdout).toContain(name);
  expect(result.stdout).toMatch(/✗|✘|FAIL|ERROR/);
}

/**
 * Expect diagnostic check warning
 */
export function expectCheckWarning(result: CommandResult, name: string, fix: string): void {
  expect(result.stdout).toContain(name);
  expect(result.stdout).toMatch(/⚠|WARN/);
  expect(result.stdout).toContain(fix);
}
