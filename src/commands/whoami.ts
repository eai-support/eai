/**
 * eai whoami — show auth status and tenant info.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadTokens, isAuthenticated } from '../lib/auth.js';
import { findProjectRoot, resolveProjectConfig } from '../lib/config.js';
import * as out from '../lib/output.js';

export const whoamiCommand = new Command('whoami')
  .description('Show auth status and tenant info')
  .action(async () => {
    const tokens = await loadTokens();
    const authenticated = await isAuthenticated();

    out.heading('Authentication');

    if (!tokens) {
      out.error('Not logged in. Run `eai login` to authenticate.');
      process.exit(1);
    }

    if (authenticated) {
      out.success(`Logged in as ${chalk.bold(tokens.upn || 'unknown user')}`);
    } else {
      out.warn(`Token expired. Run \`eai login\` to re-authenticate.`);
    }

    out.table([
      ['Tenant', tokens.tenantName],
      ['Tenant ID', chalk.dim(tokens.tenantId)],
      ['Expires', new Date(tokens.expiresAt).toLocaleString()],
      ['Status', authenticated ? chalk.green('Active') : chalk.red('Expired')],
    ]);

    // Show project context if in a vertical project
    const root = await findProjectRoot();
    if (root) {
      const config = await resolveProjectConfig(root);
      if (config) {
        out.blank();
        out.heading('Project');
        out.table([
          ['App Name', chalk.cyan(config.appName)],
          ['Environment', config.environment],
          ['PublicAPI', config.publicApiUrl || chalk.dim('not set')],
          ['Config Tenant', config.tenantId || chalk.dim('not set')],
          ['Workflow', config.workflowId || chalk.dim('not set')],
        ]);
      }
    }
  });
