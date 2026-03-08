#!/usr/bin/env node

/**
 * eai — Enterprise AI Platform CLI
 *
 * Scaffold, seed, deploy, and manage vertical applications.
 * Every command wraps PublicAPI calls — developers never need to know about
 * OBO tokens, OPA policies, single-table JSONB, or the orchestrator.
 */

import { Command } from 'commander';
import chalk from 'chalk';

// Commands
import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { loginCommand, logoutCommand } from './commands/login.js';
import { envCommand } from './commands/env.js';
import { typesCommand } from './commands/types.js';
import { tenantCommand } from './commands/tenant.js';
import { resourcesCommand } from './commands/resources.js';
import { chatCommand } from './commands/chat.js';
import { docsCommand } from './commands/docs.js';
import { deployCommand } from './commands/deploy.js';
import { verifyCommand, doctorCommand } from './commands/verify.js';
import { whoamiCommand } from './commands/whoami.js';

const program = new Command();

program
  .name('eai')
  .description('Enterprise AI Platform CLI — scaffold, seed, deploy, and manage vertical applications')
  .version('0.1.0');

// Register all commands
program.addCommand(initCommand);
program.addCommand(devCommand);
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(envCommand);
program.addCommand(typesCommand);
program.addCommand(tenantCommand);
program.addCommand(resourcesCommand);
program.addCommand(chatCommand);
program.addCommand(docsCommand);
program.addCommand(deployCommand);
program.addCommand(verifyCommand);
program.addCommand(doctorCommand);
program.addCommand(whoamiCommand);

// Custom help footer
program.addHelpText('after', `
${chalk.bold('Getting Started:')}
  ${chalk.cyan('eai init my-vertical')}     Scaffold a new vertical app
  ${chalk.cyan('eai login')}                Authenticate with Entra CIAM
  ${chalk.cyan('eai env pull')}             Sync cloud config to local .env
  ${chalk.cyan('eai types seed')}           Push Object Types to Configurator
  ${chalk.cyan('eai dev')}                  Start local development server

${chalk.bold('Common Workflows:')}
  ${chalk.dim('# Define your data model, validate, and seed')}
  ${chalk.cyan('eai types validate && eai types seed')}

  ${chalk.dim('# Check platform health')}
  ${chalk.cyan('eai verify')}

  ${chalk.dim('# Deploy to Azure')}
  ${chalk.cyan('eai deploy trigger')}
`);

program.parse();
