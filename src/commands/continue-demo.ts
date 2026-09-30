import { Command } from 'commander';
import { inspectGeneratedDemoContinuation } from '../lib/generated-demo-continuation.js';
import * as out from '../lib/output.js';

export const continueDemoCommand = new Command('continue-demo')
  .description('Inspect a cloned no-code demo before continuing it with CLI and Gofer')
  .option('--path <directory>', 'Generated repository root', '.')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options: { path: string; format: string }) => {
    try {
      const result = await inspectGeneratedDemoContinuation(options.path);
      if (options.format === 'json') {
        out.json(result);
        return;
      }
      if (options.format !== 'text') throw new Error('Format must be text or json.');
      out.success(`Verified local NCB demo source integrity for ${result.appKey}.`);
      out.info(`Repository: ${result.repository} at ${result.commitSha}`);
      out.info(`${result.objectTypeDefinitionCount} Object Type definitions remain in the accepted artifact.`);
      out.warn('Data and actions are still simulated. Review and replace demo adapters with authorized platform bindings before claiming live operations.');
      out.info('The source, manifest, Object Types, credentials and deployment were not changed.');
    } catch (error) {
      out.error(error instanceof Error ? error.message : 'Unable to inspect generated demo.');
      process.exitCode = 1;
    }
  });
