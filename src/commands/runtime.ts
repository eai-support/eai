import { Command } from 'commander';
import chalk from 'chalk';
import * as out from '../lib/output.js';
import {
  RUNTIME_CONTRACT_FILE,
  validateRuntimeContract,
  type RuntimeValidationResult,
  type RuntimeValidationFinding,
} from '../lib/runtime-contract.js';

function toRuntimeJsonOutput(result: RuntimeValidationResult): Record<string, unknown> {
  return {
    projectRoot: result.projectRoot,
    contractPath: result.contractPath,
    status: result.status,
    findings: result.findings,
    summary: {
      requiredEnv: result.summary.requiredEnv,
      requiredProtectedEnvNames: result.summary.requiredSecrets,
      optionalProtectedEnvNames: result.summary.optionalSecrets,
      smokeTests: result.summary.smokeTests,
    },
  };
}

function printFinding(finding: RuntimeValidationFinding): void {
  const prefix =
    finding.severity === 'error'
      ? out.symbols.error
      : finding.severity === 'warning'
        ? out.symbols.warning
        : out.symbols.info;
  const label = finding.severity.toUpperCase();
  console.log(`${prefix} ${label} ${finding.code}: ${finding.message}`);
  if (finding.fix) {
    out.info(`Fix: ${finding.fix}`);
  }
}

export const runtimeCommand = new Command('runtime')
  .description('Validate the provider-neutral EAI app runtime contract');

runtimeCommand
  .command('validate')
  .description(`Validate ${RUNTIME_CONTRACT_FILE} and local runtime declarations`)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText(
    'after',
    `
Examples:
  $ eai runtime validate
  $ eai runtime validate --format json
`,
  )
  .action(async (options) => {
    if (options.json) options.format = 'json';

    const result = await validateRuntimeContract();
    if (options.format === 'json') {
      out.json(toRuntimeJsonOutput(result));
      if (result.status === 'fail') process.exit(1);
      return;
    }

    out.heading('EAI Runtime Contract');
    out.table([
      ['Contract', result.contractPath],
      ['Status', result.status === 'pass' ? 'PASS' : 'FAIL'],
      ['Required env', String(result.summary.requiredEnv.length)],
      ['Required secrets', String(result.summary.requiredSecrets.length)],
      ['Smoke tests', String(result.summary.smokeTests.length)],
    ]);

    if (result.findings.length > 0) {
      out.blank();
      for (const finding of result.findings) {
        printFinding(finding);
      }
    }

    out.blank();
    if (result.status === 'pass') {
      out.success(`${RUNTIME_CONTRACT_FILE} is ready for provider-neutral deployment.`);
      out.info(`Next: ${chalk.cyan('eai deploy env --provider generic')}`);
      out.info(`After deployment: ${chalk.cyan('eai deploy doctor --url <deployed-url>')}`);
    } else {
      out.error(`${RUNTIME_CONTRACT_FILE} is not ready for deployment.`);
      process.exit(1);
    }
  });
