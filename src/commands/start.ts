import { stat } from 'node:fs/promises';
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
  type LaunchPlan,
  type PromptInsertionStatus,
} from '../lib/ai-surfaces.js';

interface StartOptions {
  check?: boolean;
  surface?: string;
  install?: boolean;
  dryRun?: boolean;
  remember?: boolean;
  format?: string;
  allowCopilotPromptInsertion?: boolean;
}

function isSurfaceId(value: string): value is AiSurfaceId {
  return AI_SURFACES.some((surface) => surface.id === value);
}

function launchMessage(plan: LaunchPlan, status: PromptInsertionStatus): string {
  if (plan.surfaceId !== 'copilot-desktop' || status === 'not-attempted') return plan.userMessage;
  if (status === 'inserted') {
    return 'GitHub Copilot opened this exact project and put the first EAI message in its message box. Review it, then press Send.';
  }
  const fallback = 'Use the Copy first message button when available, or copy the labelled First message shown by EAI. Paste it into Copilot, then press Send.';
  if (status === 'permission-required') {
    return `GitHub Copilot opened this exact project, but macOS did not allow EAI to fill its message box. In System Settings > Privacy & Security, allow the app you used to launch EAI under Accessibility and Automation, then try again. ${fallback}`;
  }
  if (status === 'focus-lost') {
    return `GitHub Copilot opened this exact project, but EAI stopped before inserting text because Copilot was no longer the active app. ${fallback}`;
  }
  if (status === 'draft-not-empty') {
    return `GitHub Copilot opened this exact project, but its message box already contained text, so EAI left it untouched. ${fallback}`;
  }
  if (status === 'app-not-ready') {
    return `GitHub Copilot opened this exact project, but its message box was not ready before EAI stopped waiting. ${fallback}`;
  }
  if (status === 'unsafe-target') {
    return `GitHub Copilot opened this exact project, but EAI could not verify one empty Copilot message box, so it typed nothing. ${fallback}`;
  }
  return `GitHub Copilot opened this exact project, but EAI could not fill its message box. ${fallback}`;
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

function applyCopilotPromptAuthorization(plan: LaunchPlan, options: StartOptions): LaunchPlan {
  const explicitlyAuthorized = options.allowCopilotPromptInsertion
    && options.surface === 'copilot-desktop';
  if (plan.postLaunchAction !== 'macos-copilot-insert-prompt' || explicitlyAuthorized) {
    return plan;
  }

  const safePlan: LaunchPlan = { ...plan };
  delete safePlan.postLaunchAction;
  delete safePlan.postLaunchApplication;
  safePlan.userMessage = 'GitHub Copilot will ask you to confirm this exact project. EAI will not press Allow or fill the message box unless you explicitly use --allow-copilot-prompt-insertion. Check the folder, press Allow, paste the labelled First message, then press Send.';
  return safePlan;
}

async function runStart(directory: string, options: StartOptions): Promise<void> {
  const format = options.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new Error('Unsupported format. Use text or json.');
  }
  if (options.allowCopilotPromptInsertion && options.surface !== 'copilot-desktop') {
    throw new Error('--allow-copilot-prompt-insertion requires --surface copilot-desktop.');
  }

  const projectDirectory = resolve(directory);
  if (!options.install) {
    const projectStat = await stat(projectDirectory).catch(() => null);
    if (!projectStat) {
      throw new Error(`Project folder does not exist: ${projectDirectory}`);
    }
    if (!projectStat.isDirectory()) {
      throw new Error(`Project path is not a folder: ${projectDirectory}`);
    }
  }
  const inventory = await detectAiSurfaces({ projectDirectory });

  if (options.check) {
    if (format === 'json') out.json(inventory);
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
      if (format === 'json') out.json(payload);
      else console.log(`${surface.name}: ${surface.installUrl}`);
      return;
    }
    await openExternalUrl(surface.installUrl, inventory.platform);
    const payload = { action: 'open-install-source', opened: true, surfaceId, surfaceName: surface.name, url: surface.installUrl, officialProvider: surface.provider };
    if (format === 'json') out.json(payload);
    else out.success(`Opened the official ${surface.provider} page for ${surface.name}.`);
    return;
  }

  const plan = applyCopilotPromptAuthorization(buildAiLaunchPlan(inventory, surfaceId), options);
  if (options.dryRun) {
    if (format === 'json') out.json({ action: 'launch', launched: false, plan });
    else console.log(`${plan.userMessage}${plan.promptToCopy ? `\nFirst message:\n${plan.promptToCopy}` : ''}\nCommand: ${plan.command} ${plan.args.join(' ')}`);
    return;
  }

  const execution = await executeAiLaunchPlan(plan, inventory.platform);
  const preparedPrompt = plan.preparedPrompt || execution.promptInsertionStatus === 'inserted';
  const promptToCopy = preparedPrompt ? null : plan.promptToCopy ?? null;
  const message = launchMessage(plan, execution.promptInsertionStatus);
  let remembered = false;
  if (options.remember !== false) {
    remembered = await rememberAiSurface(surfaceId).then(() => true).catch(() => false);
  }
  const payload = {
    action: 'launch',
    launched: true,
    remembered,
    surfaceId,
    surfaceName: surface.name,
    projectDirectory,
    preparedPrompt,
    promptToCopy,
    promptInsertionStatus: execution.promptInsertionStatus,
    message,
  };
  if (format === 'json') out.json(payload);
  else {
    out.success(`Started ${surface.name}.`);
    out.info(message);
    if (promptToCopy) {
      out.info(`First message:\n${promptToCopy}`);
    }
    if (options.remember !== false && !remembered) {
      out.warn('The workspace opened, but EAI could not remember this choice.');
    }
  }
}

export const startCommand = new Command('start')
  .description('Detect or start a supported AI workspace for an EAI project')
  .argument('[directory]', 'Project folder to open', '.')
  .option('--check', 'Detect supported AI workspaces without opening or changing anything', false)
  .option('--surface <id>', 'Use a specific surface (vscode-copilot|copilot-cli|copilot-desktop|claude-desktop|claude-cli|codex-desktop|codex-cli|grok-cli)')
  .option('--install', 'Open the selected provider official installation page', false)
  .option('--dry-run', 'Show the launch plan without starting the provider', false)
  .option('--allow-copilot-prompt-insertion', 'Allow EAI to confirm the exact Copilot folder and fill one verified empty message box on macOS', false)
  .option('--no-remember', 'Do not remember this successful handoff')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .addHelpText('after', `
Examples:
  $ eai start --check
  $ eai start --check --format json
  $ eai start . --surface vscode-copilot
  $ eai start . --surface claude-desktop --dry-run
  $ eai start . --surface copilot-desktop --allow-copilot-prompt-insertion
  $ eai start --surface copilot-desktop --install

Privacy:
  Detection checks installed applications and commands plus the selected
  project's Git root and origin URL. It does not read provider accounts or
  source files. Starting a surface is your confirmation that the provider may
  read this project and use your provider account. The Copilot insertion flag
  additionally allows EAI to verify and confirm Copilot's exact-folder prompt
  and fill one empty message box. EAI never presses Send.
  `)
  .action(async (directory: string, options: StartOptions) => {
    try {
      await runStart(directory, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.format === 'json') {
        out.json({ action: 'start', ok: false, error: { message } });
      } else {
        out.error(message);
      }
      process.exitCode = 1;
    }
  });
