import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import inquirer from 'inquirer';
import * as out from '../lib/output.js';
import {
  AI_SURFACES,
  buildAiLaunchPlan,
  companionCliForSurface,
  detectAiSurfaces,
  executeAiLaunchPlan,
  getAiSurface,
  openExternalUrl,
  rememberAiSurface,
  serializeAiSurfaceInventory,
  type AiSurfaceContractVersion,
  type AiSurfaceId,
  type AiSurfaceInventory,
} from '../lib/ai-surfaces.js';
import {
  installAndVerifyCompanionCli,
  runCompanionCliInstaller,
} from '../lib/ai-surface-installer.js';
import { assessLocalIsolation } from '../lib/local-isolation.js';

interface StartOptions {
  check?: boolean;
  surface?: string;
  install?: boolean;
  dryRun?: boolean;
  remember?: boolean;
  format?: string;
  contractVersion?: string;
  isolationCheck?: boolean;
}

function parseContractVersion(value: string | undefined): AiSurfaceContractVersion {
  if (value === undefined || value === 'v1') return 'v1';
  if (value === 'v2') return 'v2';
  throw new Error(`Unsupported AI surface contract version: ${value}. Use v1 or v2.`);
}

function isSurfaceId(value: string): value is AiSurfaceId {
  return AI_SURFACES.some((surface) => surface.id === value);
}

interface SurfaceInstallDependencies {
  readonly runInstaller: typeof runCompanionCliInstaller;
  readonly detect: typeof detectAiSurfaces;
  readonly openUrl: typeof openExternalUrl;
}

const defaultSurfaceInstallDependencies: SurfaceInstallDependencies = {
  runInstaller: runCompanionCliInstaller,
  detect: detectAiSurfaces,
  openUrl: openExternalUrl,
};

export async function performAiSurfaceInstall(options: {
  readonly surfaceId: AiSurfaceId;
  readonly inventory: AiSurfaceInventory;
  readonly projectDirectory: string;
  readonly dryRun: boolean;
  readonly dependencies?: SurfaceInstallDependencies;
}): Promise<Record<string, unknown>> {
  const dependencies = options.dependencies ?? defaultSurfaceInstallDependencies;
  const surface = getAiSurface(options.inventory, options.surfaceId);
  const companionCli = companionCliForSurface(options.surfaceId);
  if (!companionCli) throw new Error(`${surface.name} does not define a companion CLI.`);
  const companionSurface = getAiSurface(options.inventory, companionCli);
  const desktopNeedsInstall = surface.kind !== 'cli' && !surface.installed;
  if (options.dryRun) {
    return {
      ok: true, action: 'install-ai-surface', surfaceId: options.surfaceId,
      surfaceName: surface.name, companionCli,
      companionCliInstalled: companionSurface.installed, companionCliStatus: 'planned',
      companionCliError: null, desktopInstallPageOpened: false,
      companionInstallPageOpened: false, desktopUserActionRequired: desktopNeedsInstall,
      userActionRequired: desktopNeedsInstall,
      url: desktopNeedsInstall ? surface.installUrl : companionSurface.installUrl,
      message: `EAI will install or update ${companionSurface.name}, then verify it.`,
    };
  }
  const companionResult = await installAndVerifyCompanionCli({
    companionCli,
    wasInstalled: companionSurface.installed,
    runInstaller: async () => dependencies.runInstaller({
      platform: options.inventory.platform,
      workspacePath: options.projectDirectory,
      companionCli,
    }),
    verifyInstalled: async () => {
      const refreshed = await dependencies.detect({ projectDirectory: options.projectDirectory });
      return getAiSurface(refreshed, companionCli).installed;
    },
  });
  let desktopInstallPageOpened = false;
  if (desktopNeedsInstall) {
    desktopInstallPageOpened = await dependencies.openUrl(surface.installUrl, options.inventory.platform)
      .then(() => true).catch(() => false);
  }
  let companionInstallPageOpened = false;
  if (companionResult.userActionRequired) {
    companionInstallPageOpened = await dependencies.openUrl(companionSurface.installUrl, options.inventory.platform)
      .then(() => true).catch(() => false);
  }
  const userActionRequired = companionResult.userActionRequired || desktopNeedsInstall;
  return {
    ok: !userActionRequired, action: 'install-ai-surface', surfaceId: options.surfaceId,
    surfaceName: surface.name, companionCli,
    companionCliInstalled: companionResult.installed, companionCliStatus: companionResult.status,
    companionCliError: companionResult.userActionRequired
      ? 'Complete the official installation step, then run detection again.' : null,
    desktopInstallPageOpened, companionInstallPageOpened,
    desktopUserActionRequired: desktopNeedsInstall, userActionRequired,
    url: desktopNeedsInstall ? surface.installUrl : companionSurface.installUrl,
    message: userActionRequired
      ? 'User action is required. Use the official URL for any password, consent, terms, or sign-in step, then run this command again.'
      : `${companionSurface.name} is installed and verified.`,
  };
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
  .option('--isolation-check', 'Report local-only worktree and sandbox readiness without opening a provider', false)
  .option('--surface <id>', `Use a specific surface (${AI_SURFACES.map((surface) => surface.id).join('|')})`)
  .option('--install', 'Install or update the required companion CLI and verify it')
  .option('--dry-run', 'Show the launch plan without starting the provider', false)
  .option('--no-remember', 'Do not remember this dispatched workspace choice')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--contract-version <version>', 'AI surface JSON contract (v1|v2); defaults to v1 for installer compatibility')
  .addHelpText('after', `
Examples:
  $ eai start --check
  $ eai start --check --format json
  $ eai start --check --format json --contract-version v2
  $ eai start --isolation-check --surface codex-cli --format json
  $ eai start . --surface vscode-copilot
  $ eai start . --surface claude-desktop --dry-run
  $ eai start --surface copilot-desktop --install

Privacy:
  Detection checks filesystem, package, signature, and application metadata;
  it never runs provider binaries or reads provider accounts or project files.
  Starting a surface is your confirmation
  that the provider may read this project and use your provider account.
  `)
  .action(async (directory: string, options: StartOptions) => {
    const projectDirectory = resolve(directory);
    const contractVersion = parseContractVersion(options.contractVersion);
    await access(projectDirectory).catch(() => {
      throw new Error(`Project folder does not exist: ${projectDirectory}`);
    });
    const inventory = await detectAiSurfaces({ projectDirectory });

    if (options.isolationCheck) {
      const surfaceIds = options.surface
        ? [isSurfaceId(options.surface) ? options.surface : (() => { throw new Error(`Unknown AI surface: ${options.surface}`); })()]
        : inventory.surfaces.map((surface) => surface.id);
      const report = assessLocalIsolation({ projectDirectory, platform: inventory.platform, surfaceIds });
      if (options.format === 'json') out.json(report);
      else {
        out.heading('Local isolation readiness');
        for (const assessment of report.assessments) {
          console.log(`- ${assessment.surfaceId}: ${assessment.status} — ${assessment.reason}`);
        }
      }
      if (report.assessments.length === 0 || report.assessments.some((assessment) => assessment.status !== 'ready')) {
        process.exitCode = 1;
      }
      return;
    }

    if (options.check) {
      if (options.format === 'json') out.json(serializeAiSurfaceInventory(inventory, contractVersion));
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
      const payload = await performAiSurfaceInstall({
        surfaceId, inventory, projectDirectory, dryRun: options.dryRun === true,
      });
      if (options.format === 'json') out.json(payload);
      else if (payload.userActionRequired) out.warn(String(payload.message));
      else out.success(String(payload.message));
      return;
    }

    const plan = buildAiLaunchPlan(inventory, surfaceId);
    if (options.dryRun) {
      if (options.format === 'json') {
        out.json({
          action: 'launch',
          launched: false,
          dispatched: false,
          confirmed: false,
          launchState: 'planned',
          plan,
        });
      }
      else console.log(`${plan.userMessage}\nCommand: ${plan.command} ${plan.args.join(' ')}`);
      return;
    }

    const dispatch = await executeAiLaunchPlan(plan, inventory.platform);
    let remembered = false;
    if (options.remember !== false) {
      remembered = await rememberAiSurface(surfaceId).then(() => true).catch(() => false);
    }
    const payload = {
      action: 'launch',
      // `launched` is retained for Setup v0.3.19 compatibility. It means that
      // the operating system accepted the dispatch, not that provider startup,
      // authentication, or project handoff has been confirmed.
      launched: dispatch.dispatched,
      ...dispatch,
      launchState: 'dispatched',
      remembered,
      surfaceId,
      surfaceName: surface.name,
      projectDirectory,
      preparedPrompt: plan.preparedPrompt,
      message: plan.userMessage,
    };
    if (options.format === 'json') out.json(payload);
    else {
      out.success(`Sent the launch request to ${surface.name}.`);
      out.info(plan.userMessage);
      out.info('The provider confirms application startup, sign-in, and project access after it opens.');
      if (options.remember !== false && !remembered) {
        out.warn('The launch request was sent, but EAI could not remember this choice.');
      }
    }
  });
