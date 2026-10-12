import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { buildCommandSchema } from '../../src/lib/schema-builder.js';

describe('command schema action coverage', () => {
  it('includes executable parents without invoking their action', () => {
    const action = vi.fn();
    const program = new Command('eai');
    const verify = program.command('verify').action(action);
    verify.command('calls').action(action);
    program.command('workspace').alias('tenant').command('list').action(action);

    const schema = buildCommandSchema(program);
    expect(schema.subcommands?.find(command => command.command === 'verify')).toMatchObject({
      hasAction: true,
      subcommands: [{ command: 'calls' }],
    });
    expect(schema.subcommands?.find(command => command.command === 'workspace')).toMatchObject({
      aliases: ['tenant'],
    });
    expect(schema.subcommands?.find(command => command.command === 'workspace')).not.toHaveProperty('hasAction');
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps leaf option and alias contracts intact', () => {
    const command = new Command('status').alias('info').option('--json', 'JSON output').action(() => {});
    expect(buildCommandSchema(command)).toMatchObject({
      command: 'status', aliases: ['info'], options: [{ name: '--json', type: 'boolean' }],
    });
  });
});
