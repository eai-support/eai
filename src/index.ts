#!/usr/bin/env node

/**
 * eai — Enterprise AI Platform CLI
 *
 * Scaffold, seed, deploy, and manage vertical applications.
 * Every command wraps platform API calls — developers work with resources,
 * types, tenants, and chat using simple commands.
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import chalk from 'chalk';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// Commands
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { loginCommand, logoutCommand } from './commands/login.js';
import { envCommand } from './commands/env.js';
import { typesCommand } from './commands/types.js';
import { tenantCommand } from './commands/tenant.js';
import { userCommand } from './commands/user.js';
import { resourcesCommand } from './commands/resources.js';
import { chatCommand } from './commands/chat.js';
import { docsCommand } from './commands/docs.js';
import { deployCommand } from './commands/deploy.js';
import { verifyCommand, doctorCommand } from './commands/verify.js';
import { whoamiCommand } from './commands/whoami.js';
import { updateCommand } from './commands/update.js';
import { provisionCommand } from './commands/provision.js';
import { checkForUpdate, notifyIfUpdateAvailable } from './lib/update-check.js';
import { setSimpleMode } from './lib/output.js';
import { describeProgram } from './lib/schema-builder.js';

const program = new Command();

program
  .name('eai')
  .description('Enterprise AI Platform CLI — scaffold, seed, deploy, and manage vertical applications')
  .version(pkg.version)
  .option('--simple', 'Plain text output without colors or symbols (for screen readers)')
  .option('--no-color', 'Disable colored output')
  .option('--color', 'Force colored output')
  .option('--describe', 'Output JSON schema of all commands')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    // Handle --describe flag (output schema and exit)
    if (opts.describe) {
      process.stdout.write(JSON.stringify(describeProgram(program), null, 2) + '\n');
      process.exit(0);
    }

    // Handle --simple flag
    if (opts.simple) {
      setSimpleMode(true);
    }

    // Handle --no-color flag
    if (opts.noColor) {
      process.env.NO_COLOR = '1';
    }

    // Handle --color flag (force colors)
    if (opts.color) {
      process.env.FORCE_COLOR = '1';
    }
  });

// Register all commands
program.addCommand(initCommand);
program.addCommand(devCommand);
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(envCommand);
program.addCommand(typesCommand);
program.addCommand(tenantCommand);
program.addCommand(userCommand);
program.addCommand(resourcesCommand);
program.addCommand(chatCommand);
program.addCommand(docsCommand);
program.addCommand(deployCommand);
program.addCommand(verifyCommand);
program.addCommand(doctorCommand);
program.addCommand(whoamiCommand);
program.addCommand(updateCommand);
program.addCommand(provisionCommand);

// Custom help footer
program.addHelpText('after', `
${chalk.bold('Getting Started:')}
  ${chalk.cyan('eai init my-vertical')}     Scaffold a new vertical app
  ${chalk.cyan('eai login')}                Authenticate with Entra CIAM
  ${chalk.cyan('eai provision entra')}      Create Entra app registration for end-user auth
  ${chalk.cyan('eai env pull')}             Sync app config from cloud
  ${chalk.cyan('eai types seed')}           Publish Object Types to the platform
  ${chalk.cyan('eai dev')}                  Start local development server

${chalk.bold('Development Workflows:')}
  ${chalk.dim('# Define your types, validate them, then publish them')}
  ${chalk.cyan('eai types validate && eai types seed')}

  ${chalk.dim('# See what is published for the active tenant')}
  ${chalk.cyan('eai resources schema')}

  ${chalk.dim('# Query resources and inspect data')}
  ${chalk.cyan('eai resources list User --limit 10')}
  ${chalk.cyan('eai resources get User <id>')}

  ${chalk.dim('# Check login, tenant, and API connectivity')}
  ${chalk.cyan('eai verify && eai doctor')}

${chalk.bold('Deployment:')}
  ${chalk.dim('# Set up GitHub Actions deployment')}
  ${chalk.cyan('eai deploy setup --repo org/name')}

  ${chalk.dim('# Trigger deployment and check status')}
  ${chalk.cyan('eai deploy trigger && eai deploy status')}

${chalk.bold('Machine-Readable Output:')}
  ${chalk.dim('# Get structured JSON output for automation')}
  ${chalk.cyan('eai resources list User --format json')}
  ${chalk.cyan('eai tenant list --format json | jq')}
  ${chalk.cyan('eai verify calls --format json')}

  ${chalk.dim('# Discover CLI structure for AI agents')}
  ${chalk.cyan('eai --describe')}

${chalk.bold('Accessibility:')}
  ${chalk.dim('# Screen reader friendly output')}
  ${chalk.cyan('eai --simple <command>')}
  ${chalk.cyan('eai --no-color <command>')}
`);

// Handle --describe before parsing (needs to work without command)
if (process.argv.includes('--describe')) {
  process.stdout.write(JSON.stringify(describeProgram(program), null, 2) + '\n');
  process.exit(0);
}

checkForUpdate(pkg.version);
await program.parseAsync();
await notifyIfUpdateAvailable(pkg.version);
