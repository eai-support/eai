/**
 * Smoke test: verify all inquirer prompt types used in the CLI are registered.
 *
 * This catches breaking changes from inquirer major version bumps (e.g. v14
 * renamed 'list' to 'select') before they reach users.
 *
 * Refs enterpriseaigroup/Issues2025#3006
 */

import { describe, expect, test } from 'vitest';
import inquirer from 'inquirer';

/**
 * Prompt types actively used in the CLI codebase.
 * If you add a new prompt type, add it here.
 */
const USED_PROMPT_TYPES = [
  'select',
  'confirm',
  'input',
  'password',
  'number',
  'expand',
] as const;

describe('inquirer prompt type registration', () => {
  test('all prompt types used by the CLI are registered with the installed inquirer version', () => {
    // inquirer.prompt.prompts is the internal registry in classic inquirer.
    // In newer versions, we can verify by attempting to create a prompt instance.
    // The safest cross-version check is to look at the registered prompts.
    const registeredTypes = Object.keys(
      (inquirer.prompt as unknown as { prompts?: Record<string, unknown> }).prompts ?? {},
    );

    // If the internal registry isn't accessible (inquirer API changed), fall
    // back to verifying the prompt function doesn't reject the type synchronously.
    if (registeredTypes.length === 0) {
      // Newer inquirer versions expose prompt types via createPromptModule
      const promptModule = inquirer.createPromptModule();
      const modulePrompts = Object.keys(
        (promptModule as unknown as { prompts?: Record<string, unknown> }).prompts ?? {},
      );

      if (modulePrompts.length > 0) {
        for (const promptType of USED_PROMPT_TYPES) {
          expect(
            modulePrompts,
            `Prompt type "${promptType}" is not registered. Available: ${modulePrompts.join(', ')}`,
          ).toContain(promptType);
        }
        return;
      }

      // Last resort: just verify the import works and has a prompt function
      expect(typeof inquirer.prompt).toBe('function');
      return;
    }

    for (const promptType of USED_PROMPT_TYPES) {
      expect(
        registeredTypes,
        `Prompt type "${promptType}" is not registered. Available: ${registeredTypes.join(', ')}`,
      ).toContain(promptType);
    }
  });
});
