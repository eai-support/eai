/**
 * Schema builder for --describe flag
 * Introspects Commander.js commands to generate JSON schema
 */

import type { Command, Option } from 'commander';

export interface CommandSchema {
  command: string;
  description: string;
  options: OptionSchema[];
  subcommands?: CommandSchema[];
}

export interface OptionSchema {
  name: string;
  type: string;
  default?: unknown;
  description: string;
  values?: string[];
}

/**
 * Infer option type from Commander.js Option object
 */
function inferOptionType(option: Option): string {
  const flags = option.flags;

  // Check if it's a boolean flag (no argument)
  if (!flags.includes('<') && !flags.includes('[')) {
    return 'boolean';
  }

  // Check if it has choices (enum type)
  if (option.argChoices && option.argChoices.length > 0) {
    return 'enum';
  }

  // Default to string for arguments
  return 'string';
}

/**
 * Build schema for a single command
 */
export function buildCommandSchema(command: Command): CommandSchema {
  const name = command.name();
  const description = command.description();

  const options: OptionSchema[] = command.options.map((opt) => {
    const type = inferOptionType(opt);
    const schema: OptionSchema = {
      name: opt.flags.split(' ')[0],
      type,
      description: opt.description,
    };

    // Add default value if present
    if (opt.defaultValue !== undefined) {
      schema.default = opt.defaultValue;
    }

    // Add enum values if present
    if (type === 'enum' && opt.argChoices) {
      schema.values = opt.argChoices;
    }

    return schema;
  });

  const schema: CommandSchema = {
    command: name,
    description,
    options,
  };

  // Recursively process subcommands
  const subcommands = command.commands;
  if (subcommands && subcommands.length > 0) {
    schema.subcommands = subcommands
      .filter(cmd => !cmd.name().includes('help'))  // Exclude help commands
      .map(cmd => buildCommandSchema(cmd));
  }

  return schema;
}

/**
 * Build schema for entire CLI program
 */
export function describeProgram(program: Command): object {
  return buildCommandSchema(program);
}
