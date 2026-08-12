import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import inquirer from 'inquirer';
import * as out from '../lib/output.js';
import {
  AI_SURFACES,
  buildAiLaunchPlan,
  detectAiSurfaces,
  executeAiLaunchPlan,
  getAiSurface,
  openExternalUrl,
  rememberAiSurface,
  type AiSurfaceId,
} from '../lib/ai-surfaces.js';

interface StartOptions {
  check?: boolean;
  surface?: string;
  install?: boolean;
  dryRun?: boolean;
  remember?: boolean;
  format?: string;
}

function isSurfaceId(value: string): value is AiSurfaceId {
  return AI_SURFACES.some((surface) => surface.id === value);
}

async function selectSurface(options: StartOptions, inventory: Awaited<ReturnType<typeof detectAiSurfaces>>): Promise<AiSurfaceId> {
  if (options.surface) {
    if (!isSurfaceId(options.surface)) throw new Error(`Unknown AI surface: ${options.surface}`);
    return options.surface;
  }
  if (inventory.preferredSurface) return inventory.preferredSurface;
  const installed = inventory.surfaces.filter((surface) => surface.installed);
  if (installed.length === 1) return installed[0].id;
  if (!process.stdin.isTTY || options.format === 'json') {
    if (!inventory.recommendedSurface) throw new Error('No supported AI workspace is installed. Run `eai start --check` to see official options.');
    return inventory.recommendedSurface;
  }
  const choices = (installed.length > 0 ? installed : inventory.surfaces).map((surface) => ({
    name: `${surface.name}${surface.recommended ? ' (recommended)' : ''}${surface.installed ? '' : ' - not installed'}`,
    value: surface.id,
  }));
  const answer = await inquirer.prompt<{ surface: AiSurfaceId }>([
    { type: 'select', name: 'surface', message: installed.length > 0 ? 'Where should EAI start?' : 'Which AI workspace do you want to get?', choices },
  ]);
  return answer.surface;
}

export const startCommand = new Command('start')
  .description('Detect or start a supported AI workspace for an EAI project')
  .argument('[directory]', 'Project folder to open', '.')
  .option('--check', 'Detect supported AI workspaces without opening or changing anything', false)
  .option('--surface <id>', 'Use a specific surface (vscode-copilot|copilot-cli|copilot-desktop|claude-desktop|claude-cli|codex-desktop|codex-cli|grok-cli)')
  .option('--install', 'Open the selected provider official installation page', false)
  .option('--dry-run', 'Show the launch plan without starting the provider', false)
  .option('--no-remember', 'Do not remember this successful handoff')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .addHelpText('after', `
Examples:
  $ eai start --check
  $ eai start --check --format json
  $ eai start . --surface vscode-copilot
  $ eai start . --surface claude-desktop --dry-run
  $ eai start --surface copilot-desktop --install

Privacy:
  Detection checks installed applications and commands only. It does not read
  provider accounts or project files. Starting a surface is your confirmation
  that the provider may read this project and use your provider account.
  `)
  .action(async (directory: string, options: StartOptions) => {
    const projectDirectory = resolve(directory);
    if (!options.install) {
      await access(projectDirectory).catch(() => {
        throw new Error(`Project folder does not exist: ${projectDirectory}`);
      });
    }
    const inventory = await detectAiSurfaces({ projectDirectory });

    if (options.check) {
      if (options.format === 'json') out.json(inventory);
      else {
        out.heading('AI workspaces');
        for (const surface of inventory.surfaces) {
          const label = surface.installed ? 'Ready' : 'Not installed';
          console.log(`- ${surface.name}: ${label}${surface.recommended ? ' (recommended)' : ''}`);
        }
      }
      return;
    }

    const surfaceId = await selectSurface(options, inventory);
    const surface = getAiSurface(inventory, surfaceId);
    if (options.install) {
      if (options.dryRun) {
        const payload = { action: 'open-install-source', opened: false, surfaceId, surfaceName: surface.name, url: surface.installUrl, officialProvider: surface.provider };
        if (options.format === 'json') out.json(payload);
        else console.log(`${surface.name}: ${surface.installUrl}`);
        return;
      }
      await openExternalUrl(surface.installUrl, inventory.platform);
      const payload = { action: 'open-install-source', opened: true, surfaceId, surfaceName: surface.name, url: surface.installUrl, officialProvider: surface.provider };
      if (options.format === 'json') out.json(payload);
      else out.success(`Opened the official ${surface.provider} page for ${surface.name}.`);
      return;
    }

    const plan = buildAiLaunchPlan(inventory, surfaceId);
    if (options.dryRun) {
      if (options.format === 'json') out.json({ action: 'launch', launched: false, plan });
      else console.log(`${plan.userMessage}\nCommand: ${plan.command} ${plan.args.join(' ')}`);
      return;
    }

    await executeAiLaunchPlan(plan, inventory.platform);
    if (options.remember !== false) await rememberAiSurface(surfaceId);
    const payload = {
      action: 'launch',
      launched: true,
      surfaceId,
      surfaceName: surface.name,
      projectDirectory,
      preparedPrompt: plan.preparedPrompt,
      message: plan.userMessage,
    };
    if (options.format === 'json') out.json(payload);
    else {
      out.success(`Started ${surface.name}.`);
      out.info(plan.userMessage);
    }
  });
