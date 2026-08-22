#!/usr/bin/env node

/**
 * eai — Enterprise AI Platform CLI
 *
 * Scaffold, seed, deploy, and manage applications.
 * Every command wraps platform API calls — developers work with resources,
 * types, tenants, and chat using simple commands.
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import chalk from 'chalk';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

if (process.argv.length === 3 && process.argv[2] === '--version') {
  console.log(pkg.version);
  process.exit(0);
}

// Commands
import { createCommand, initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { loginCommand, logoutCommand } from './commands/login.js';
import { envCommand } from './commands/env.js';
import { typesCommand } from './commands/types.js';
import { tenantCommand } from './commands/tenant.js';
import { userCommand } from './commands/user.js';
import { resourcesCommand } from './commands/resources.js';
import { appCommand } from './commands/vertical.js';
import { chatCommand } from './commands/chat.js';
import { workflowCommand } from './commands/workflow.js';
import { docsCommand } from './commands/docs.js';
import { deployCommand } from './commands/deploy.js';
import { runtimeCommand } from './commands/runtime.js';
import { verifyCommand, doctorCommand } from './commands/verify.js';
import { whoamiCommand } from './commands/whoami.js';
import { updateCommand } from './commands/update.js';
import { provisionCommand } from './commands/provision.js';
import { goferCommand } from './commands/gofer.js';
import { templateCommand } from './commands/template.js';
import { blocksCommand } from './commands/blocks.js';
import { publicApiCommand } from './commands/publicapi.js';
import { errorsCommand } from './commands/errors.js';
import { agentCommand } from './commands/agent.js';
import { startCommand } from './commands/start.js';
import { classifierCommand } from './commands/classifier.js';
import { connectionCommand } from './commands/connection.js';
import {
  checkForUpdate,
  isMachineReadableInvocation,
  notifyIfUpdateAvailable,
  notifyIfUpdateAvailableForDiscovery,
} from './lib/update-check.js';
import { setSimpleMode } from './lib/output.js';
import { resolveCommandProfile, setActiveProfile } from './lib/profile.js';
import { describeProgram } from './lib/schema-builder.js';

const program = new Command();

program
  .name('eai')
  .description('Enterprise AI Platform CLI — scaffold, seed, deploy, and manage applications')
  .version(pkg.version, '-V, --cli-version')
  .option('--simple', 'Plain text output without colors or symbols (for screen readers)')
  .option('--no-color', 'Disable colored output')
  .option('--color', 'Force colored output')
  .option('--profile <name>', 'Use a locally configured private profile')
  .option('--describe', 'Output JSON schema of all commands')
  .hook('preAction', async (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();

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

    // Handle --profile flag or EAI_PROFILE env var. Plain `eai ...`
    // intentionally stays on the public production default profile.
    setActiveProfile(resolveCommandProfile(thisCommand));
  });

// Register all commands
program.addCommand(initCommand);
program.addCommand(createCommand);
program.addCommand(devCommand);
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(envCommand);
program.addCommand(typesCommand);
program.addCommand(tenantCommand);
program.addCommand(userCommand);
program.addCommand(resourcesCommand);
program.addCommand(appCommand);
program.addCommand(chatCommand);
program.addCommand(workflowCommand);
program.addCommand(docsCommand);
program.addCommand(deployCommand);
program.addCommand(runtimeCommand);
program.addCommand(verifyCommand);
program.addCommand(doctorCommand);
program.addCommand(whoamiCommand);
program.addCommand(updateCommand);
program.addCommand(provisionCommand);
program.addCommand(goferCommand);
program.addCommand(templateCommand);
program.addCommand(blocksCommand);
program.addCommand(publicApiCommand);
program.addCommand(errorsCommand);
program.addCommand(agentCommand);
program.addCommand(startCommand);
program.addCommand(classifierCommand);
program.addCommand(connectionCommand);

// Custom help footer
program.addHelpText('after', `
${chalk.bold('Getting Started:')}
  ${chalk.cyan('eai create my-app')}        Scaffold an app with Gofer AI CLI assets
  ${chalk.cyan('eai login')}                Authenticate with Entra CIAM
  ${chalk.cyan('eai provision entra')}      Create Entra app registration for end-user auth
  ${chalk.cyan('eai provision entra --deauthorize --force')} Clean up app auth registration
  ${chalk.cyan('eai env pull')}             Sync app config from cloud
  ${chalk.cyan('eai types seed')}           Publish Object Types to the platform
  ${chalk.cyan('eai dev')}                  Start local development server
  ${chalk.cyan('eai start')}                Open this app in your AI workspace

${chalk.bold('Development Workflows:')}
  ${chalk.dim('# Define your types, validate them, then publish them')}
  ${chalk.cyan('eai types validate && eai types seed')}

  ${chalk.dim('# See what is published for the active tenant')}
  ${chalk.cyan('eai resources schema')}
  ${chalk.cyan('eai app create "My App" --template eai-app-template')}

  ${chalk.dim('# Query resources and inspect data')}
  ${chalk.cyan('eai resources list User --limit 10')}
  ${chalk.cyan('eai resources get User <id>')}

  ${chalk.dim('# Check AI runtime workflow readiness before using chat')}
  ${chalk.cyan('eai workflow readiness strategy-monitor')}
  ${chalk.cyan('eai workflow status strategy-monitor')}
  ${chalk.cyan('eai workflow request strategy-monitor --reason "CEO strategy cockpit"')}

  ${chalk.dim('# Check login, tenant, and API connectivity')}
  ${chalk.cyan('eai verify && eai doctor')}

${chalk.bold('Deployment:')}
  ${chalk.dim('# Validate the host-neutral runtime contract before deploying')}
  ${chalk.cyan('eai runtime validate')}
  ${chalk.cyan('eai deploy env --provider generic')}

  ${chalk.dim('# Set up GitHub Actions deployment')}
  ${chalk.cyan('eai deploy setup --repo org/name')}

  ${chalk.dim('# Trigger deployment, check status, then doctor the deployed runtime')}
  ${chalk.cyan('eai deploy trigger && eai deploy status')}
  ${chalk.cyan('eai deploy doctor --url <deployed-url>')}

${chalk.bold('Machine-Readable Output:')}
  ${chalk.dim('# Get structured JSON output for automation')}
  ${chalk.cyan('eai resources list User --format json')}
  ${chalk.cyan('eai tenant list --format json | jq')}
  ${chalk.cyan('eai verify calls --format json')}
  ${chalk.cyan('eai errors explain E101 --format json')}

  ${chalk.dim('# Discover CLI structure for AI agents')}
  ${chalk.cyan('eai --describe')}
  ${chalk.cyan('eai agent guide --format json')}

${chalk.bold('AI Workspace:')}
  ${chalk.dim('# Detect installed AI workspaces, then start this app with the public EAI skill')}
  ${chalk.cyan('eai start --check')}
  ${chalk.cyan('eai start')}

${chalk.bold('Updates:')}
  ${chalk.dim('# Check/update the CLI, then maintain safe repo-local assets')}
  ${chalk.cyan('eai update --check')}       ${chalk.dim('preview CLI, Gofer, and template status')}
  ${chalk.cyan('eai update')}               ${chalk.dim('update the CLI and refresh safe Gofer assets')}

  ${chalk.dim('# Preview repo-local Gofer asset updates before writing files')}
  ${chalk.cyan('eai gofer refresh --check')} ${chalk.dim('preview managed Gofer asset updates for this repo')}
  ${chalk.cyan('eai gofer refresh')}        ${chalk.dim('apply safe Gofer-managed asset updates with backups')}

  ${chalk.dim('# Preview app-template and UI component drift before copying changes')}
  ${chalk.cyan('eai template check')}       ${chalk.dim('review potential app or UI file updates without overwriting local work')}

  ${chalk.dim('# Discover AI-readable UI blocks for Gofer and apps')}
  ${chalk.cyan('eai blocks list --readiness public-ready')}
                                  ${chalk.dim('list foundation, product, addon, and demo block IDs')}
  ${chalk.cyan('eai blocks describe core.button')}
  ${chalk.cyan('eai blocks readiness')}     ${chalk.dim('summarize public readiness and package-profile compatibility')}

  ${chalk.dim('# Call any authorized PublicAPI V4 interface')}
  ${chalk.cyan('eai publicapi get /v4/identity/me --format json')}
  ${chalk.cyan("eai publicapi post /v4/geo/resolve-location --data '{\"query\":\"Copenhagen\"}'")}

  ${chalk.dim('# Explain known errors for humans and AI agents')}
  ${chalk.cyan('eai errors list')}
  ${chalk.cyan('eai errors explain tenant_authorization_incomplete --format json')}

  ${chalk.dim('# Follow the built-in AI-agent recovery loop')}
  ${chalk.cyan('eai agent guide')}

${chalk.bold('Accessibility:')}
  ${chalk.dim('# Screen reader friendly output')}
  ${chalk.cyan('eai --simple <command>')}
  ${chalk.cyan('eai --no-color <command>')}
`);

function readTopLevelCommandName(args: readonly string[]): string | null {
  const flagsWithValues = new Set(['--profile']);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }

    if (arg === '--') {
      return args[i + 1] ?? null;
    }

    if (arg.startsWith('--profile=')) {
      continue;
    }

    if (flagsWithValues.has(arg)) {
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    return arg;
  }

  return null;
}

function isHelpInvocation(args: readonly string[]): boolean {
  return (
    args.length === 0 ||
    args.includes('--help') ||
    args.includes('-h') ||
    readTopLevelCommandName(args) === 'help'
  );
}

function isUnknownTopLevelCommand(args: readonly string[]): boolean {
  const commandName = readTopLevelCommandName(args);
  if (!commandName || commandName === 'help') {
    return false;
  }

  const knownCommands = new Set<string>();
  for (const command of program.commands) {
    knownCommands.add(command.name());
    for (const alias of command.aliases()) {
      knownCommands.add(alias);
    }
  }

  return !knownCommands.has(commandName);
}

// Handle --describe before parsing (needs to work without command)
const cliArgs = process.argv.slice(2);
if (cliArgs.includes('--describe')) {
  console.log(JSON.stringify(describeProgram(program), null, 2));
} else {
  const topLevelCommandName = readTopLevelCommandName(cliArgs);
  const shouldForegroundCheckForUpdate = isHelpInvocation(cliArgs) || isUnknownTopLevelCommand(cliArgs);
  const shouldSuppressPostCommandNotice =
    topLevelCommandName === 'update' ||
    isMachineReadableInvocation(cliArgs);

  if (shouldForegroundCheckForUpdate) {
    await notifyIfUpdateAvailableForDiscovery(pkg.version);
  } else if (!shouldSuppressPostCommandNotice) {
    checkForUpdate(pkg.version);
  }

  if (cliArgs.length === 0) {
    program.outputHelp();
    process.exit(0);
  }

  await program.parseAsync();

  if (!shouldForegroundCheckForUpdate && !shouldSuppressPostCommandNotice) {
    await notifyIfUpdateAvailable(pkg.version, { args: cliArgs });
  }
}
