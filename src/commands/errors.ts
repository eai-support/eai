import { Command } from 'commander';
import chalk from 'chalk';
import { findGuidanceByCodeOrReason, listErrorGuidance } from '../lib/error-guidance/catalog.js';
import { formatGuidanceExplanation, guidanceToJSON } from '../lib/error-guidance/render.js';
import * as out from '../lib/output.js';

export const errorsCommand = new Command('errors')
  .description('Explain EAI CLI errors and agent-safe recovery steps');

errorsCommand
  .command('list')
  .description('List known EAI CLI error guidance entries')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .action((options: { format?: string; json?: boolean }) => {
    const jsonOutput = options.json || options.format === 'json';
    const entries = listErrorGuidance();

    if (jsonOutput) {
      out.json({
        entries: entries.map((entry) => guidanceToJSON(entry)),
      });
      return;
    }

    out.heading('Known EAI error guidance');
    for (const entry of entries) {
      console.log(`${chalk.cyan(entry.code)}  ${entry.reasonCode}  ${entry.title}`);
    }
  });

errorsCommand
  .command('explain <code-or-reason>')
  .description('Explain why an error happens and what eai commands can recover it')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai errors explain E101
  $ eai errors explain tenant_authorization_incomplete
  $ eai errors explain E242 --format json

Notes:
  - Guidance is public-safe and avoids private platform implementation detail.
  - Commands marked [read-only] should run before commands marked [changes state].
  - AI agents should respect retry and stop conditions instead of looping.
  `)
  .action((value: string, options: { format?: string; json?: boolean }) => {
    const jsonOutput = options.json || options.format === 'json';
    const entry = findGuidanceByCodeOrReason(value);

    if (!entry) {
      const message = `Unknown EAI error guidance entry: ${value}`;
      if (jsonOutput) {
        out.json({
          ok: false,
          error: {
            message,
            suggestion: 'Run `eai errors list --format json` to inspect known guidance entries.',
          },
        });
      } else {
        out.error(message);
        out.info('Run `eai errors list` to inspect known guidance entries.');
      }
      process.exit(1);
    }

    if (jsonOutput) {
      out.json({
        ok: true,
        guidance: guidanceToJSON(entry),
      });
      return;
    }

    console.log(formatGuidanceExplanation(entry));
  });

