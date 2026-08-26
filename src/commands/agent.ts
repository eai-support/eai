import { Command } from 'commander';
import chalk from 'chalk';
import { getAgentGuide, type AgentGuideCommand, type AgentGuideStep } from '../lib/agent-guide.js';
import * as out from '../lib/output.js';

function formatCommand(command: AgentGuideCommand): string {
  const marker = command.mutates ? chalk.yellow('[changes state]') : chalk.green('[read-only]');
  const when = command.when ? ` ${chalk.dim(command.when)}` : '';
  return `${chalk.cyan(command.command)} ${marker}\n  ${command.purpose}${when}`;
}

function formatSteps(steps: AgentGuideStep[]): string {
  return steps.map((step) => {
    const lines = [
      `${step.step}. ${chalk.bold(step.title)}`,
      `   ${step.instruction}`,
    ];
    for (const command of step.commands ?? []) {
      lines.push(`   - ${formatCommand(command).replace('\n  ', '\n     ')}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

function printGuideText(): void {
  const guide = getAgentGuide();

  out.heading('EAI agent operating guide');
  console.log(guide.purpose);

  out.heading('Start here');
  for (const command of guide.firstCommands) {
    console.log(`- ${formatCommand(command)}`);
  }

  out.heading('Capabilities');
  for (const capability of guide.capabilities) {
    console.log(`- ${chalk.cyan(capability)}`);
  }

  out.heading('Operating rules');
  for (const rule of guide.operatingRules) {
    console.log(`- ${rule}`);
  }

  out.heading('Recovery loop');
  console.log(formatSteps(guide.recoveryLoop));

  out.heading('Common workflows');
  console.log(formatSteps(guide.commonWorkflows));

  out.heading('Stop conditions');
  for (const condition of guide.stopConditions) {
    console.log(`- ${condition}`);
  }
}

export const agentCommand = new Command('agent')
  .description('Show AI-agent discovery and recovery guidance');

agentCommand
  .command('guide')
  .description('Show the AI-agent operating guide for eai')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai agent guide
  $ eai agent guide --format json
  $ eai --describe

Notes:
  - Use this before improvising eai commands.
  - Prefer read-only diagnostics before commands marked [changes state].
  - On failure, run eai errors explain <code-or-reason> --format json.
  `)
  .action((options: { format?: string; json?: boolean }) => {
    const jsonOutput = options.json || options.format === 'json';

    if (jsonOutput) {
      out.json(getAgentGuide());
      return;
    }

    printGuideText();
  });
