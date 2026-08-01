import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { appCommand } from '../../src/commands/vertical.js';
import { loadAppCapabilityRequirements } from '../../src/commands/app-bindings.js';

describe('eai app bindings command schema', () => {
  test('exposes list, set, remove, and readiness validation', () => {
    const bindings = appCommand.commands.find((command) => command.name() === 'bindings');
    expect(bindings?.commands.map((command) => command.name())).toEqual([
      'list', 'set', 'remove', 'validate',
    ]);
  });

  test('auto-discovers the canonical generated requirements manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eai-bindings-'));
    const configDir = join(root, 'src', 'eai.config');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'capabilities.generated.json'), JSON.stringify({
      schemaVersion: 'eai.app_capabilities.v1',
      appKey: 'rates-review',
      requirements: [{
        alias: 'primary-workflow',
        capability: 'workflows.runtime',
        required: true,
        description: 'Workflow executed by the generated application.',
      }],
    }));
    try {
      await expect(loadAppCapabilityRequirements('rates-review', undefined, root)).resolves.toEqual(
        expect.objectContaining({ appKey: 'rates-review' }),
      );
      await expect(loadAppCapabilityRequirements('another-app', undefined, root)).rejects.toThrow(
        /do not match app another-app/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
