#!/usr/bin/env node
/**
 * generate-commands.mjs
 * Generates surface-specific command/skill files from canonical stage definitions.
 *
 * Usage:
 *   node generate-commands.mjs [--dry-run] [--surfaces <comma-list>] [--root <path>]
 *
 * Surfaces: claude, claude-mirror, copilot, github-prompts, github-agents,
 *           github-skills, claude-skills, agents-skills, system-skills,
 *           grok-skills, gemini, agents-md, codex-config
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { validateDescriptions } from './canonical-descriptions.mjs';
import { SUPPORTED_HOSTS } from './gofer-surface-update.mjs';
import { parseStageCommand } from './parse-stage-command.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Legacy compatibility export. Gofer now emits every command/helper to every
 * supported surface when the stage frontmatter lists that surface.
 */
export const CLAUDE_ONLY_STAGES = [];

const ALL_SURFACES = [
  'claude',
  'claude-mirror',
  'claude-skills',
  'copilot',
  'github-prompts',
  'github-agents',
  'github-skills',
  'agents-skills',
  'system-skills',
  'grok-skills',
  'gemini',
  'agents-md',
  'codex-config',
];

const PUBLIC_SITE_URL = 'https://eai-support.github.io/eai-gofer';
const PUBLIC_RELEASES_URL = `${PUBLIC_SITE_URL}/releases`;
const PUBLIC_PLUGIN_URL = `${PUBLIC_RELEASES_URL}/plugins/eai-gofer`;
const PUBLIC_ENTRYPOINTS = [
  {
    stem: 'eai',
    name: 'eai',
    title: 'Eai',
    description: 'Start or continue the EAI delivery pipeline.',
  },
  {
    stem: 'eai-update',
    name: 'eai-update',
    title: 'Eai Update',
    description: 'Install or update EAI Gofer for this AI coding app.',
  },
];
const SURFACE_WORKSPACE_HOSTS = {
  'claude': 'claude',
  'claude-mirror': 'claude',
  'claude-skills': 'claude',
  'copilot': 'copilot',
  'github-prompts': 'copilot',
  'github-agents': 'copilot',
  'github-skills': 'copilot',
  'agents-skills': 'codex-or-antigravity',
  'system-skills': 'codex',
  'grok-skills': 'grok',
  'gemini': 'gemini',
};
const WORKSPACE_PREFLIGHT_EXCLUDED_COMMANDS = new Set([
  'gofer:plan',
  'gofer:side',
  'gofer:personality',
  'gofer:check-workspace',
  'gofer:bootstrap-workspace',
  'gofer:eai-first-run',
]);

const LEGACY_HELPER_COMMAND_FILES = new Set([
  'gofer_bootstrap_workspace.md',
  'gofer_check_workspace.md',
  'gofer_eai_first_run.md',
  'gofer_personality.md',
  'gofer_plan.md',
  'gofer_side.md',
]);
const LEGACY_STAGE_STEMS = new Map([
  ['0_gofer_start', ['0_business_scenario']],
]);

// ---------------------------------------------------------------------------
// Exclusion logic
// ---------------------------------------------------------------------------

/**
 * Returns true if the given stage should be excluded from the given surface.
 * Gofer keeps this function for older tests/imports, but no stages are
 * excluded by name anymore. Surface availability is controlled by stage
 * frontmatter so all current semantic hosts and the legacy Gemini file format
 * stay in parity.
 *
 * @param {string} stageName
 * @param {string} surface
 * @returns {boolean}
 */
export function shouldExclude(stageName, surface) {
  void stageName;
  void surface;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensures a directory exists, creating it (and parents) if needed.
 * @param {string} dirPath
 */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function detectPackageVersion(root) {
  const candidates = [
    path.join(root, 'package.json'),
    path.join(root, 'extension', 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, 'utf8'));
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return '1.0.0';
}

function buildGeminiExtensionManifest(version) {
  return {
    name: 'eai-gofer',
    version,
    description: 'Legacy Gemini CLI file-format compatibility for EAI Gofer',
    license: 'Apache-2.0',
    commands: '.gemini/commands/gofer/',
    gofer: {
      bundle_url: PUBLIC_PLUGIN_URL,
      manifest_url: `${PUBLIC_PLUGIN_URL}/gemini-extension.json`,
      commands_manifest_url: `${PUBLIC_PLUGIN_URL}/gemini-commands-manifest.json`,
      download_url: `${PUBLIC_RELEASES_URL}/eai-gofer-agent-plugin-${version}.zip`,
      latest_download_url: `${PUBLIC_RELEASES_URL}/eai-gofer-agent-plugin-latest.zip`,
      vsix_url: `${PUBLIC_RELEASES_URL}/eai-gofer-${version}.vsix`,
      latest_vsix_url: `${PUBLIC_RELEASES_URL}/eai-gofer-latest.vsix`,
    },
  };
}

/**
 * Loads and parses all stage command files from .specify/commands/.
 * Skips .gitkeep and any non-.md files.
 *
 * @param {string} root Absolute path to project root
 * @returns {Promise<Array<{ filePath: string, frontmatter: Record<string, unknown>, body: string }>>}
 */
async function loadStages(root) {
  const commandsDir = path.join(root, '.specify', 'commands');
  let entries;
  try {
    entries = await fs.readdir(commandsDir);
  } catch {
    throw new Error(`.specify/commands/ not found at ${commandsDir}`);
  }

  const stages = [];
  const parseErrors = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === '.gitkeep') continue;
    const filePath = path.join(commandsDir, entry);
    try {
      const parsed = await parseStageCommand(filePath);
      stages.push({ filePath, ...parsed });
    } catch (err) {
      parseErrors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (parseErrors.length > 0) {
    throw new Error(
      `Failed to parse ${parseErrors.length} command file(s):\n${parseErrors.join('\n')}`
    );
  }

  return stages;
}

function getStageOutputStem(stage) {
  return path.basename(stage.filePath, '.md');
}

function getLegacyStageStems(stage) {
  return LEGACY_STAGE_STEMS.get(getStageOutputStem(stage)) ?? [];
}

async function removeLegacyGeneratedPath(outPath, legacyPath) {
  if (outPath === legacyPath) {
    return;
  }

  await fs.rm(legacyPath, { recursive: true, force: true });
}

async function removeLegacyGeneratedPaths(outPath, legacyPaths) {
  for (const legacyPath of legacyPaths) {
    await removeLegacyGeneratedPath(outPath, legacyPath);
  }
}

async function clearDirectoryEntries(dirPath, predicate, dryRun, label) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!predicate(entry)) {
      continue;
    }

    const target = path.join(dirPath, entry.name);
    if (dryRun) {
      console.log(`[dry-run] ${label}: would remove ${target}`);
    } else {
      await fs.rm(target, { recursive: true, force: true });
      console.log(`${label}: removed ${target}`);
    }
  }
}

function getCodexLegacySkillDirs(root, surfaceRoot, stageStem, stageName) {
  return [
    path.join(root, surfaceRoot, stageName),
    path.join(root, surfaceRoot, 'gofer', stageStem),
    path.join(root, surfaceRoot, 'gofer', stageName),
  ];
}

function buildInternalStageList(stages) {
  return stages
    .map((stage) => `- \`${getStageOutputStem(stage)}\` - ${stage.frontmatter.description}`)
    .join('\n');
}

function buildAlwaysEaiSection() {
  return `## Always-On EAI Contract
<!-- gofer:always-on-eai:start -->

Apply this contract to every request after Gofer is installed for this repo or AI coding app. The user does not need to type \`/eai\` or \`$eai\`.

1. Preserve the user's request. Do not rewrite it or add a visible command prefix.
2. Treat an explicit \`/eai\` (Claude, Copilot, Antigravity, Grok, or VS Code) or \`$eai\` (Codex) prefix as an idempotent request for the same contract.
3. Apply the Controlled English Contract to every Gofer-authored message and artifact.
4. Keep the reply short unless the user asks for detail.
5. Explain the business effect first.
6. Put technical evidence in durable artifacts.
7. Do not make the user choose pipeline stages. Select the next internal stage yourself.
8. Do not repeat workspace setup on every message. Check it before meaningful repo work, tool use, or a pipeline stage.
9. Keep the update and installation path separate. When the user explicitly asks to update Gofer, run only its maintenance contract.
<!-- gofer:always-on-eai:end -->`;
}

function buildUserFacingResponseGateSection() {
  return `## User-Facing Response Gate

Before each user-facing reply, check the draft against these rules:

1. Lead with the business outcome, effect, risk, or decision.
2. Use concise, simple language.
3. Include technical detail only when it supports a decision or the user asks for it.
4. If any check fails, rewrite the reply before sending it.

${buildDeliveryDisciplineContract()}`;
}

export function buildDeliveryDisciplineContract() {
  return `**Business Updates And Goal Checks**

Use \`.specify/references/business-updates-and-goal-checks.md\`. Before each reply, explain the result, business effect, and next action in plain language. For progress, use two or three short sentences. Run \`node .specify/scripts/node/gofer-response-check.mjs --input <private-draft-file>\` before sending a drafted progress update; rewrite failed drafts. Use \`--kind answer\` for answers and \`--technical\` only when technical detail was requested. Do not repeat unchanged progress. This helper cannot intercept messages that the host sends directly.

Before each work batch, read the current goal, specification, tasks, and latest findings. After new knowledge or an approved change, update affected feature documents and explain the effect. Never weaken acceptance criteria to match failing code or invent user approval. Mark a task complete only after its linked checks pass; reopen affected tasks when evidence is stale. For app and non-app features with a spec and tasks, enable \`requireDeliveryCheckpoint\` in \`loop-contract.json\` and run \`node .specify/scripts/node/gofer-delivery-check.mjs --feature-dir <feature-dir>\` before advancing or claiming completion. Follow the reference to capture a reviewed checkpoint, not merely to clear a failure. Keep existing MVP exemptions, reviews, loops, and release gates. Conversation-only requests need no feature files.

**Priority And Outcome Protection**

Follow \`.specify/references/priority-outcome-protection.md\`. Before implementing a task, record the latest material user direction in decisions.md and maintain priority-plan.json with ordered tasks, dependencies, allowedEditScope and the current outcome. Enable requirePriorityPlan for new feature contracts. Run \`node .specify/scripts/node/gofer-priority-check.mjs --feature-dir <feature-dir> --task T001\` before the action, and include --workspace <repo-root> plus --changed-file for each proposed or actual changed repo-relative path. Follow its nextTask; only recorded prerequisites and approved parallel work may precede the current priority. Do not switch to unrelated work when blocked. On resume, state the agreed outcome and next task in plain language after reading the last recorded direction. Keep routine conversation free of feature paperwork.

Before technical escalation, attach fresh diagnosis through the blocker helper's ask event verification field. Check the exact command, route, environment, own mistake and existing authority. Do not invent a tenant, ask for login without checking it, require an unsafe alternative, or equate administrator access with permission. Business decisions need no failing command. At completion, run the priority checker with --finish; a missing or stale outcome receipt means unverified, regardless of test scores. Use --completion for the final gofer-closed-loop-audit.mjs run; a routine drift audit alone does not prove completion. Preserve detailed test results, early local MVP scope, non-app work, independent approved tasks and all release/security checks.`;
}

function buildJourneyStateSection() {
  return `## Journey State

Before routing work, decide where the user is now.

1. Read current feature state from \`.specify/specs/\`, \`goal-ledger.json\`, \`eai-preflight.md\`, \`research.md\`, \`spec.md\`, \`plan.md\`, \`tasks.md\`, validation reports, loop evidence, and handoff notes when they exist.
2. Classify the request as conversation, research/docs/audit, EAI app delivery, or ambiguous.
3. For conversation or research/docs/audit, continue the non-app Gofer path after the one required non-app confirmation.
4. For EAI app delivery or ambiguous app work, continue directly into EAI readiness.
5. Find the earliest missing pipeline artifact or blocked EAI gate.
6. Run that internal stage next, then continue forward.
7. Keep the user-facing explanation at the business level.`;
}

function buildMvpCapabilityValidationSection() {
  return `## MVP Capability-Based Validation

Use \`.specify/references/mvp-capability-validation.md\` as the source of
truth. Validate the work that the active feature specification requires now.
Do not apply later delivery requirements to an early MVP.

1. Create \`.specify/specs/{feature}/\` before app or operator-tool source work.
2. Keep \`spec.md\`, \`plan.md\`, \`tasks.md\`, \`traceability.md\`, and the validation scope aligned.
3. Mark each relevant capability as \`not_applicable\`, \`planned\`, \`implemented\`, \`verified\`, or \`blocked\`.
4. Require evidence only for an implemented capability or a capability required by the current delivery decision.
5. Treat \`run.sh\`, \`run.bat\`, and \`run.ps1\` as launch evidence only. They do not prove authentication, sessions, EAI access, or deployment readiness.
6. For a user-facing change, store the local HTTP check, screenshot, and review outcome in the feature validation report.
7. If browser validation is blocked, mark that user journey \`unverified\`. Do not call it complete.
8. If the user changes scope, update the feature artifacts before continuing. Explain what changed, what remains valid, and what now needs evidence.
9. Use truthful completion language. For example: \`The server runs. Authentication is not in the current MVP scope.\`
10. When the feature claims a release or deployed outcome, create \`release-capability-ledger.md\` from \`.specify/templates/release-capability-ledger-template.md\`.
11. Do not report a release complete or score 100% when a required capability is missing from traceability, remains on an open PR, is absent from the release branch, or lacks required deployed evidence.`;
}

function buildVerifiedEaiCliCommandContract() {
  return `## Verified EAI CLI Command Contract

Do not invent, guess, or complete EAI CLI commands from memory.

1. Before you suggest or run an \`eai ...\` command, verify the exact command from the installed CLI.
2. Start with \`eai --describe\` and use its command map as the source of truth.
3. For a specific command, run \`eai <command> --help\` or the CLI-described equivalent before using flags, subcommands, or examples.
4. Use \`eai agent guide --format json\` when the CLI advertises it.
5. Use \`eai errors explain <code-or-reason> --format json\` after errors when the CLI advertises it.
6. If the command is not listed or help fails, do not run it. Say the installed EAI CLI does not expose that command, then choose a safe listed command or ask the user to update EAI CLI.
7. Record the verified command and source in \`eai-preflight.md\`, \`service-fit-matrix.md\`, or the active feature notes before the command changes files or external systems.
8. For commands that create, deploy, publish, mutate tenants, change Entra, or spend money, confirm with the user after verification and before execution.`;
}

function buildEaiPlatformDecisionSection() {
  return `## EAI Platform Decision Contract

For app delivery, make EAI Platform choices for the business user.

1. Read \`.specify/references/platform/eai-service-patterns.md\`, \`.specify/references/platform/eai-repo-contract.md\`, and \`.specify/references/platform/eai.md\` before architecture or storage decisions.
2. Run \`eai --describe\` before assuming current CLI syntax.
3. Run \`eai agent guide --format json\` when the CLI advertises it.
4. Run \`eai resources schema --format json\` and \`eai workflow readiness --format json\` when advertised and relevant.
5. Create or update \`.specify/specs/{feature}/service-fit-matrix.md\`.
6. Prefer the EAI app template, PublicAPI, ResourceAPI, object types, workflows, goals, targets, platform AI services, and tenant identity.
7. Prefer PostgreSQL for relational, transactional, reporting, and workflow state.
8. Prefer DocumentDB for flexible JSON documents, nested records, and high-change document models.
9. Prefer Blob Storage for large files and binary content behind API-mediated access.
10. Prefer AI Search as a derived search projection, not as the source of record.
11. Prefer EAI content understanding and document services for classification, extraction, summarization, and Retrieval-Augmented Generation.
12. Prefer EAI workflows, goals, and targets for approvals, long-running work, service goals, operating targets, and auditable process state.
13. Use Azure second when the EAI Platform does not yet expose the needed capability.
14. Use any other platform only as an explicit exception with rationale, owner, expiry, and validation evidence.
15. Ask the user only for material business, security, cost, deployment, destructive, or external-system decisions.`;
}

function buildPublicEntrypointMarkdown(entry, stages, host) {
  if (entry.name === 'eai-update') {
    return buildEaiUpdateEntrypointMarkdown(host);
  }

  const legacyCompatibilityNotice =
    host === 'gemini'
      ? '> Legacy compatibility: this generated Gemini file remains for existing repositories only. Gemini is not a current Gofer host. Use Google Antigravity and `agy` for the current Google surface.\n\n'
      : '';
  const sharedAgentsHost = host === 'codex-or-antigravity';
  const workspaceHost =
    sharedAgentsHost ? '<current-host>' : host === 'gemini' ? 'antigravity' : host;
  const workspaceHostSelection = sharedAgentsHost
    ? 'This skill is shared by Codex and Google Antigravity. Replace `<current-host>` with `codex` in Codex or `antigravity` in Antigravity.'
    : '';

  return `# ${entry.title}

${legacyCompatibilityNotice}Use this as the single user-facing Gofer command. Apply its contract to every request after Gofer is installed. Use \`/${entry.name}\` on Claude, Copilot, Antigravity, Grok, or VS Code, and \`$${entry.name}\` on Codex. The prefix is optional. Do not ask users to run numbered stage commands unless they explicitly request low-level internals.

## User-Facing Contract

- Keep the command window simple: expose \`eai\` only.
- Treat \`.specify/commands/*.md\` as internal stage contracts, not user-facing commands.
- Keep all Gofer functions available by routing internally to the right stage contract.
- Explain progress in business language first; provide technical details when the user asks.

## Controlled English Contract

Use ASD-STE100 Simplified Technical English as the target writing standard for all Gofer-authored chat, documents, commands, summaries, PR notes, error guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of ASD; do not bundle the protected ASD dictionary and do not claim ASD certification.

Apply these rules before any user-facing output:

1. Use short sentences. Keep instructions to 20 words or fewer where possible.
2. Use one action per instruction.
3. Use active voice. Use passive voice only when the actor is unknown or not important.
4. Use simple present, simple past, simple future, infinitive, or imperative verb forms.
5. Use approved project terms and necessary technical nouns only. Define acronyms on first use.
6. Use direct words. Avoid idioms, marketing adjectives, vague praise, and hedging.
7. Use vertical lists for complex information.
8. Put one topic in each paragraph.
9. For errors, write: what happened, why it matters, what to do next, and the exact safe command when one exists.
10. Keep raw logs, stack traces, IDs, and secrets out of chat unless the user asks for technical detail.

${buildUserFacingResponseGateSection()}

${buildAlwaysEaiSection()}

## Workspace Preflight

${workspaceHostSelection}

1. Resolve the repository root.
2. Run \`node .specify/scripts/node/gofer-workspace-check.mjs --host ${workspaceHost} --json\` when available.
3. If the repo is missing or stale, ask exactly: **"This repo is missing or stale for Gofer. Initialize/update it now?"**
4. If the user says yes, run \`node .specify/scripts/node/gofer-workspace-bootstrap.mjs --host ${workspaceHost} --include-mirrors\`, then resume this command.
5. If the user says no, stop and explain that Gofer needs the repo scaffold before it can safely continue.

${buildLocalSettingsCleanupContractSection()}

${buildAppPreviewRunnerContractSection()}

${buildJourneyStateSection()}

${buildMvpCapabilityValidationSection()}

${buildAuthAccessDecisionContract()}

## App vs Non-App Routing

1. Classify the request before EAI readiness: EAI app delivery, non-application work, or ambiguous.
2. If the request is EAI app delivery or ambiguous, continue directly into the EAI app delivery path; do not ask for confirmation just because app delivery is inferred.
3. If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**
4. When the user confirms non-app, do not run \`eai whoami\`, tenant selection, \`eai init\`, or first-run setup. Record the decision and continue the appropriate Gofer research, documentation, audit, migration, or planning path.
5. If the user says it is app work, switch to EAI app delivery and run EAI readiness.

## EAI Platform Readiness

1. Run \`eai whoami\` only when the current feature uses EAI Platform services, the user asks for EAI setup, or EAI CLI recovery is needed.
2. Require \`eai-app-template-readiness\`, \`eai verify\`, and \`eai template check --format json\` only when the feature creates, changes, or validates an EAI Platform app integration.
3. Require the authentication journey only when the specification includes sign-in, protected content, user roles, or a deployment target that requires identity.
4. For a local MVP with no EAI or authentication capability, record those states as \`not_applicable\` or \`planned\` and continue with local feature validation.
5. When an EAI capability becomes required, run the first-run/setup path from \`.specify/commands/gofer_eai_first_run.md\`, then require canonical template evidence before that capability can complete.
6. Do not accept copied marker files, a partial scaffold, or a custom template as proof that \`eai init\` completed.
7. After any \`eai\` error, run \`eai errors explain <code-or-reason> --format json\` when available before guessing remediation.
8. Do not write tokens, secrets, private tenant IDs, or local \`.env\` values into artifacts.

${buildVerifiedEaiCliCommandContract()}

${buildEaiPlatformDecisionSection()}

## First Conversation

When this is the first EAI conversation for a new app:

1. Start with the business outcome. Ask what the user needs to achieve, who it is for, and how success will be measured.
2. Explain EAI capabilities only when they help the next decision. Do not begin with platform architecture or a list of tools.
3. Use the repository and EAI CLI as sources of truth. Run \`eai --describe\` before assuming command syntax and explain known errors before recovery.
4. Keep numbered Gofer stages internal. Say what is being learned, designed, built, or checked in business language.
5. Explain why specification-led delivery improves AI quality: it creates a shared, testable statement of the outcome before code changes multiply.
6. Pause once for approval of the business specification. After approval, continue automatically unless a material business, security, cost, deployment, or destructive decision needs approval.
7. Do not create a GitHub repository, deploy, publish, spend money, or change external systems without the relevant user approval.

## Route The Pipeline

1. Read existing feature state from \`.specify/specs/\`, pipeline state files, checkpoints, validation artifacts, and loop evidence.
2. Decide the next internal stage contract needed to move the feature toward completion.
3. If no feature state exists yet, start from \`.specify/commands/0_gofer_start.md\`.
4. Execute the selected stage by following the matching file in \`.specify/commands/\`.
5. Continue through research, specify, plan, tasks, implement, and validate unless a real business, security, release, or user-approval decision blocks progress.
6. When app UI is involved, show the user the working UI as early and as often as practical.
7. Keep stakeholder summaries, build maps, diagrams, loop evidence, tests, and validation artifacts current.

${buildContinuationContractSection()}

## Internal Function Contracts

${buildInternalStageList(stages)}
`;
}

function buildEaiUpdateEntrypointMarkdown(host) {
  if (host === 'gemini') {
    return `## Legacy Gemini File-Format Compatibility

This file remains only so existing Gemini CLI repositories can read the generated Gofer command format. Gemini is not a current Gofer host. Google Antigravity and its \`agy\` CLI are the current Google surface.

## What To Do

1. Install or update EAI Gofer from Google Antigravity with \`agy plugin install https://github.com/eai-support/eai-gofer\`.
2. Use \`--host antigravity\` with \`gofer-surface-update.mjs\`.
3. Start a new Antigravity session after installation.

Existing automation that passes \`--host gemini\` is mapped to \`antigravity\` as a hidden compatibility alias. New commands and documentation must use \`antigravity\`. The updater reports exactly these current hosts: ${SUPPORTED_HOSTS.join(', ')}.
${buildBlockerMediationContract()}
`;
  }

  const sharedAgentsHost = host === 'codex-or-antigravity';
  const selectedHost = sharedAgentsHost ? '<current-host>' : host;
  const hostSelection = sharedAgentsHost
    ? '2. This skill is shared by Codex and Google Antigravity. Set `<current-host>` to `codex` in Codex or `antigravity` in the `agy` CLI.'
    : `2. Use \`${host}\` as the current semantic host.`;

  return `## Update EAI Gofer

Use this command to install or update EAI Gofer for the current AI coding app. This command works without an EAI project, a Gofer scaffold, or EAI sign-in.

## Update Contract

1. Do not run workspace checks, \`eai init\`, \`eai whoami\`, or pipeline stages.
${hostSelection}
3. Check the current host first:
   \`node <plugin-root>/.specify/scripts/node/gofer-surface-update.mjs --action inspect --host ${selectedHost} --json\`
4. If the plugin root is not known, identify the installed plugin bundle before you run the helper.
5. State whether EAI Gofer is installed and whether the host command is available.
6. Explain the planned user-level change and ask for approval before any install or update command.
7. After approval, run one of these commands from the bundled helper:
   - Install: \`node <plugin-root>/.specify/scripts/node/gofer-surface-update.mjs --action install --host ${selectedHost} --execute --json\`
   - Update: \`node <plugin-root>/.specify/scripts/node/gofer-surface-update.mjs --action update --host ${selectedHost} --execute --json\`
8. After an actual install or update, the helper archives stale Gofer command and skill entries. It adds a small managed always-on instruction for Claude, Codex, Copilot, Antigravity, and VS Code. For Grok, it verifies the installed plugin's \`skills/eai/SKILL.md\` always-on contract instead of inventing a separate global instruction file. It keeps the current \`eai\` and \`eai-update\` entries. For Codex, a clean official local marketplace on \`main\` fast-forwards safely. A dirty, non-main, or unrecognised local marketplace remains unchanged and reports that its plugin update is incomplete while it still refreshes the always-on instruction. If the Codex marketplace source is unknown, it stops without changes.
9. Run only the selected host by default. Use \`--host all\` only when the user explicitly asks to install or update every detected host.
10. Show the required reload step from the helper output. Do not claim the command is ready until the host reloads.

## Supported Hosts

- Claude Code: refresh the marketplace and plugin, then run \`/reload-plugins\`.
- Codex: refresh a confirmed Git marketplace and apply the plugin, then start a new task or restart Codex. A clean official local \`main\` checkout fast-forwards and applies the plugin. Other local checkouts keep their work unchanged, refresh the always-on instruction, and report what needs attention. An unknown source stops the update to protect local work.
- GitHub Copilot: refresh the marketplace and plugin, then restart the CLI session or start a new app chat.
- Google Antigravity: install or reinstall the repository plugin with \`agy\`, then start a new Antigravity session.
- Grok Build: install or update the repository plugin with \`grok\`, then start a new Grok Build session.
- VS Code: install or update \`EnterpriseAI.gofer\`, then run **Developer: Reload Window**.

## Limits

- This command updates user-level plugins and extensions. It archives known stale Gofer entries and replaces only Gofer's managed instruction section. It does not remove unrelated user files or host-managed plugin caches. It does not add the repo-owned \`.specify/\` scaffold.
- For a repository scaffold, use \`/eai add or refresh the Gofer scaffold for this repo\` after the host update.
- Gemini files remain only for legacy file-format compatibility. Gemini is not a current updater host.
- Keep the full Gofer delivery pipeline unchanged. This command only manages its host installation.
${buildBlockerMediationContract()}
`;
}

export function buildPublicEntrypointPrompt(entry, stages, host) {
  return [
    '---',
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    'agent: agent',
    // Inherit enabled host tools rather than restricting Copilot to foreign aliases.
    'argument-hint: goal-or-feature-description',
    'gofer:',
    '  workflowProfile: standard',
    '  publicEntrypoint: true',
    '  canonicalSource: .specify/commands/0_gofer_start.md',
    '  metadataSource: scripts/generate-commands.ts',
    '---',
    '',
    buildPublicEntrypointMarkdown(entry, stages, host),
  ].join('\n');
}

function buildPublicEntrypointSkill(entry, version, stages, hostLabel, host) {
  return `---\nname: ${entry.name}\ndescription: "${entry.description}"\n---\n\n# ${entry.title}\n\nVersion: ${version}\nHost: ${hostLabel}\n\n${buildPublicEntrypointMarkdown(entry, stages, host)}`;
}

// ---------------------------------------------------------------------------
// Surface emitters
// ---------------------------------------------------------------------------

/**
 * T037 — claude emitter
 * Emits body to .claude/commands/<name>.md for stages that include 'claude' surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitClaude(stages, root, dryRun) {
  const outDir = path.join(root, '.claude', 'commands');
  let count = 0;
  await clearDirectoryEntries(outDir, (entry) => entry.name.endsWith('.md'), dryRun, 'claude');
  for (const entry of PUBLIC_ENTRYPOINTS) {
    const outPath = path.join(outDir, `${entry.stem}.md`);
    if (dryRun) {
      console.log(`[dry-run] claude: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, buildPublicEntrypointMarkdown(entry, stages, 'claude'), 'utf8');
      console.log(`claude: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`claude: ${count} file(s) emitted`);
  return true;
}

/**
 * T038 — claude-mirror emitter
 * Emits body to extension/resources/claude-commands/<name>.md.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitClaudeMirror(stages, root, dryRun) {
  const outDir = path.join(root, 'extension', 'resources', 'claude-commands');
  let count = 0;
  await clearDirectoryEntries(
    outDir,
    (entry) => entry.name.endsWith('.md'),
    dryRun,
    'claude-mirror'
  );
  for (const entry of PUBLIC_ENTRYPOINTS) {
    const outPath = path.join(outDir, `${entry.stem}.md`);
    if (dryRun) {
      console.log(`[dry-run] claude-mirror: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(
        outPath,
        buildPublicEntrypointMarkdown(entry, stages, 'claude'),
        'utf8'
      );
      console.log(`claude-mirror: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`claude-mirror: ${count} file(s) emitted`);
  return true;
}

/**
 * T039 — copilot emitter
 * Emits body to extension/resources/copilot-prompts/<name>.prompt.md.
 * Emits every stage whose frontmatter includes the Copilot surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitCopilot(stages, root, dryRun) {
  const outDir = path.join(root, 'extension', 'resources', 'copilot-prompts');
  let count = 0;
  await clearDirectoryEntries(outDir, (entry) => entry.name.endsWith('.prompt.md'), dryRun, 'copilot');
  for (const entry of PUBLIC_ENTRYPOINTS) {
    const outPath = path.join(outDir, `${entry.stem}.prompt.md`);
    if (dryRun) {
      console.log(`[dry-run] copilot: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, buildPublicEntrypointPrompt(entry, stages, 'copilot'), 'utf8');
      console.log(`copilot: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`copilot: ${count} file(s) emitted`);
  return true;
}

/**
 * T040 — github-prompts emitter
 * Emits body to .github/prompts/<name>.prompt.md.
 * Emits every stage whose frontmatter includes the GitHub prompts surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitGithubPrompts(stages, root, dryRun) {
  const outDir = path.join(root, '.github', 'prompts');
  let count = 0;
  await clearDirectoryEntries(
    outDir,
    (entry) => entry.name.endsWith('.prompt.md'),
    dryRun,
    'github-prompts'
  );
  for (const entry of PUBLIC_ENTRYPOINTS) {
    const outPath = path.join(outDir, `${entry.stem}.prompt.md`);
    if (dryRun) {
      console.log(`[dry-run] github-prompts: would write ${outPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(outPath, buildPublicEntrypointPrompt(entry, stages, 'copilot'), 'utf8');
      console.log(`github-prompts: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`github-prompts: ${count} file(s) emitted`);
  return true;
}

/**
 * Builds a Copilot prompt using the same metadata and body transform as the
 * runtime CommandGenerator. This keeps .github/prompts and bundled VSIX
 * resources byte-equivalent to generated Copilot mirrors.
 *
 * @param {{ frontmatter: Record<string, unknown>, body: string }} stage
 * @returns {string}
 */
function buildCopilotPromptContent(stage, host = SURFACE_WORKSPACE_HOSTS['copilot']) {
  const stageName = String(stage.frontmatter.name);
  const { frontmatter, body } = splitMarkdownFrontmatter(stage.body);
  const description = readString(frontmatter.description) ?? String(stage.frontmatter.description);
  const transformedBody = injectPipelineContinuation(
    injectTokenCostPolicy(
      injectWorkspacePreflight(transformClaudeContent(body, 'copilot'), stageName, host)
    ),
    'copilot',
    stageName
  );
  const canonicalChecksum = createHash('sha256').update(body, 'utf8').digest('hex');
  const sourceFileName = path.basename(stage.filePath);

  return [
    '---',
    `name: ${stageName}`,
    `description: ${description}`,
    'agent: agent',
    'argument-hint: feature-name-or-description',
    'gofer:',
    '  workflowProfile: standard',
    `  canonicalSource: .specify/commands/${sourceFileName}`,
    `  canonicalChecksum: ${canonicalChecksum}`,
    '  metadataSource: scripts/generate-commands.ts',
    '---',
    '',
    transformedBody,
  ].join('\n');
}

/**
 * @param {string} content
 * @returns {{ frontmatter: Record<string, unknown>, body: string }}
 */
function splitMarkdownFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!fieldMatch) continue;
    frontmatter[fieldMatch[1]] = fieldMatch[2].trim().replace(/^["']|["']$/g, '');
  }

  return { frontmatter, body: match[2] };
}

/**
 * @param {string} content
 * @param {'copilot'} toPlatform
 * @returns {string}
 */
function transformClaudeContent(content, toPlatform) {
  let transformed = content;
  const stageCommandPattern = /(?<![A-Za-z0-9_.])\/(\d+[a-z]?_[a-z0-9_]+)/g;
  const helperCommandPattern = /(?<![A-Za-z0-9_.])\/(gofer_[a-z0-9_]+)/g;

  transformed = transformed.replace(/\*\*AUTO-CHAIN[^]*?(?=\n##|\n---|\n\*\*|$)/g, '');
  transformed = transformed.replace(
    /by calling the Skill tool with skill="[^"]+"/g,
    'by running the next command'
  );
  transformed = transformed.replace(/Skill tool/g, 'next command');

  if (toPlatform === 'copilot') {
    transformed = transformed.replace(stageCommandPattern, '#$1');
    transformed = transformed.replace(helperCommandPattern, '#$1');
    transformed = transformed.replace(/(^SourceCommandId:\s*)#/gm, '$1/');
  }

  return transformed;
}

/**
 * @param {string} content
 * @param {'copilot'} platform
 * @param {string} commandName
 * @returns {string}
 */
export function injectPipelineContinuation(content, platform, commandName) {
  void platform;
  const nextCommand = getNextCommand(commandName);
  if (!nextCommand) return content;

  if (content.includes('<!-- gofer:next-contract:start -->')) return content;
  const autoChainSection = `\n\n## Pipeline Continuation\n<!-- gofer:next-contract:start -->\n\nNext internal contract: \`.specify/commands/${nextCommand}.md\`. Read and follow it in the same conversation after the current stage's required evidence and approval checks pass. Apply the shared continuation contract; do not ask the user to invoke a numbered command. Honor research-only requests, explicit pauses and material/user approval gates. If blocked, report Progress, Stop reason and Next action.\n<!-- gofer:next-contract:end -->\n`;

  if (content.includes('## Key Rules')) {
    return content.replace('## Key Rules', `${autoChainSection}\n## Key Rules`);
  }

  return content + autoChainSection;
}

export function buildAuthAccessDecisionContract() {
  return `**Authentication Access Decision**

When adding or changing authentication, read \`.specify/references/platform/eai-auth-access.md\`. Ask: **"Who should be able to use this app: only members of its EAI workspace (recommended), or any authenticated EAI user?"** Default to \`workspace-only\`. Wait for the answer before changing auth code. An unanswered question must not widen access. Preserve stricter existing rules. Record the answer in the feature spec; do not repeat a confirmed question unless its scope changes.

Confirm the sign-in method separately: EAI sign-in or client SSO through EAI. Verify platform support and CLI syntax; do not invent SSO commands. Enforce trusted server-side workspace membership and app permissions. A session, CIAM directory ID, or email domain alone is not workspace access. Platform-wide sign-in never grants access to another workspace's data. Test allowed and denied users, revoked membership, unavailable membership checks, and cross-tenant requests. These checks apply only when authentication is implemented or required, not to non-app work or an auth-free local MVP.`;
}

function buildEaiPlatformSessionPreflightSection() {
  return `
## Application Classification And EAI Preflight

Before any EAI CLI, login, tenant, template, or app-enrollment action:

1. Classify the request as **EAI app delivery** or **non-application work** using the application signals in \`.specify/commands/0_gofer_start.md\`.
2. Create \`.specify/specs/{feature}/\` and record the active delivery scope before app or operator-tool source work.
3. If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**
4. If the user confirms non-app, record the decision and mark app-only capabilities \`not_applicable\`. Do not run \`eai whoami\`, \`eai tenant select\`, \`eai init\`, or \`/gofer:eai-first-run\`.
5. For local MVP app work, validate the implemented user journey, repo runner, and preview evidence. Do not require EAI setup, authentication, or deployment when the active specification does not require them.
6. When the feature uses EAI Platform services, requires a tenant, or prepares deployment, run \`eai whoami\` and record the EAI readiness evidence in \`eai-preflight.md\`.
7. When the feature creates, changes, or validates an EAI Platform app integration, run \`node .specify/scripts/node/eai-app-template-readiness.mjs --root . --json\`. A missing checker or status other than \`ready\` blocks that EAI capability. It does not block unrelated local MVP work.
8. When authentication is implemented or required, validate provider, callback, sign-in, session, first protected API call, and safe denied access.
9. When deployment is requested or claimed, require the relevant EAI template, security, configuration, and deployment evidence before completion.
10. For durable app delivery, use EAI Platform first, Azure second, and every other stack only by explicit exception.
11. If the user changes scope, update \`spec.md\`, \`plan.md\`, \`tasks.md\`, \`traceability.md\`, and validation scope before continuing. Explain the business effect and evidence change.
12. Do not accept copied marker files, partial scaffolds, or custom templates as readiness evidence for an EAI capability.
13. Do not write tokens, secrets, private tenant IDs, or local \`.env\` values into Gofer artifacts; record only product-safe readiness status and evidence.

${buildAuthAccessDecisionContract()}
`.trim();
}

function injectEaiPlatformSessionPreflight(content) {
  const section = `${buildMvpCapabilityValidationSection()}\n\n${buildEaiPlatformSessionPreflightSection()}`;
  // Remove previous generated copies before replacing the bounded preflight.
  // This makes a workspace refresh idempotent.
  const withoutMvpCapabilitySection = content.replace(
    /\n?## MVP Capability-Based Validation\n[\s\S]*?(?=\n## |\s*$)/g,
    ''
  );
  const existingHeading = withoutMvpCapabilitySection.includes('## Application Classification And EAI Preflight')
    ? '## Application Classification And EAI Preflight'
    : withoutMvpCapabilitySection.includes('## EAI Platform Session Preflight')
      ? '## EAI Platform Session Preflight'
      : null;

  if (existingHeading) {
    const headingIndex = withoutMvpCapabilitySection.indexOf(existingHeading);
    const nextHeadingIndex = withoutMvpCapabilitySection.indexOf('\n## ', headingIndex + existingHeading.length);
    const suffix = nextHeadingIndex === -1 ? '' : withoutMvpCapabilitySection.slice(nextHeadingIndex).replace(/^\n+/, '');
    return suffix
      ? `${withoutMvpCapabilitySection.slice(0, headingIndex).trimEnd()}\n\n${section}\n\n${suffix}`
      : `${withoutMvpCapabilitySection.slice(0, headingIndex).trimEnd()}\n\n${section}\n`;
  }

  const workspaceHeadingIndex = withoutMvpCapabilitySection.indexOf('## Workspace Preflight');
  if (workspaceHeadingIndex !== -1) {
    const nextHeadingIndex = withoutMvpCapabilitySection.indexOf('\n## ', workspaceHeadingIndex + 1);
    if (nextHeadingIndex !== -1) {
      return `${withoutMvpCapabilitySection.slice(0, nextHeadingIndex).trimEnd()}\n\n${section}\n\n${withoutMvpCapabilitySection
        .slice(nextHeadingIndex)
        .replace(/^\n+/, '')}`;
    }
    return `${withoutMvpCapabilitySection.trimEnd()}\n\n${section}\n`;
  }

  return `${section}\n\n${withoutMvpCapabilitySection}`;
}

function buildWorkspacePreflightSection(host = 'auto', includeEaiPreflight = true) {
  const eaiPreflight = includeEaiPreflight
    ? `\n\n${buildEaiPlatformSessionPreflightSection()}`
    : '';

  return `
## Workspace Preflight

Before doing stage/helper work:

1. Resolve the repository root.
2. Check the core Gofer sentinels:
   - \`.specify/.gofer-version\`
   - \`.specify/commands/0_gofer_start.md\`
   - \`.specify/templates/spec-template.md\`
   - \`.specify/templates/build-map-template.md\`
   - \`.specify/templates/loop-contract-template.json\`
   - \`.specify/templates/working-backwards-prfaq-template.md\`
   - \`.specify/templates/business-owner-summary-template.md\`
   - \`.specify/templates/cto-architecture-summary-template.md\`
   - \`.specify/templates/ciso-security-summary-template.md\`
   - \`.specify/templates/stakeholder-review-index-template.md\`
   - \`.specify/scripts/bash/create-new-feature.sh\`
   - \`.specify/scripts/node/parse-stage-command.mjs\`
   - \`.specify/scripts/node/gofer-loop-audit.mjs\`
   - \`.specify/scripts/hooks/post-tool-use.mjs\`
   - \`.specify/scripts/powershell/install-optional-tools.ps1\`
   - \`.specify/templates/gofer-model-policy.yaml\`
   - \`.specify/memory/gofer-model-policy.yaml\`
   - \`.specify/scripts/node/gofer-local-settings-cleanup.mjs\`
   - \`.specify/scripts/node/gofer-ui-preview.mjs\`
   - \`.specify/specs/\`
   - \`.specify/memory/\`
3. Check host-specific repo-owned files when relevant:
   - Claude: \`AGENTS.md\`, \`CLAUDE.md\`, \`.claude/settings.json\`
   - Codex: \`AGENTS.md\`
   - Copilot: \`.github/copilot-instructions.md\`
   - Google Antigravity: \`AGENTS.md\`, \`GEMINI.md\`
   - Grok Build: \`AGENTS.md\`; its installed plugin provides \`skills/eai/SKILL.md\`
   - VS Code: \`.github/copilot-instructions.md\`; the extension manages its packaged resource mirrors
4. If the repo already has the workspace checker script, prefer running:
   - \`node .specify/scripts/node/gofer-workspace-check.mjs --host ${host} --json\`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. After a Gofer install, update, or bootstrap, remove stale local Gofer command entries with:
   - \`node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
8. If the cleanup helper is only available in the downloaded bundle, run:
   - macOS/Linux: \`node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
   - Windows: \`node %USERPROFILE%\\plugins\\eai-gofer\\.specify\\scripts\\node\\gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
9. For EAI app delivery, use the repo runner for local previews:
   - macOS, Linux, and GitHub Codespaces: \`./run.sh dev 3001\`
   - Windows: \`run.bat dev 3001\`
10. Do not start app previews with direct \`npm run dev\` commands when the repo runner exists.
11. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.${eaiPreflight}
`.trim();
}

function injectWorkspacePreflight(content, commandName, host = 'auto') {
  if (WORKSPACE_PREFLIGHT_EXCLUDED_COMMANDS.has(commandName)) {
    return content;
  }

  if (content.includes('## Workspace Preflight')) {
    const updatedContent = content.replace(
      /`node \.specify\/scripts\/node\/gofer-workspace-check\.mjs --host [^`\n]+ --json`/,
      `\`node .specify/scripts/node/gofer-workspace-check.mjs --host ${host} --json\``
    );
    return injectEaiPlatformSessionPreflight(updatedContent);
  }

  const section = buildWorkspacePreflightSection(
    host,
    !content.includes('## Application Classification And EAI Preflight') &&
      !content.includes('## EAI Platform Session Preflight')
  );
  const headingMatch = content.match(/^# [^\n]+\n+/);
  if (!headingMatch) {
    return `${section}\n\n${content}`;
  }

  const insertAt = headingMatch[0].length;
  const prefix = content.slice(0, insertAt);
  const suffix = content.slice(insertAt).replace(/^\n+/, '');
  return `${prefix}${section}\n\n${suffix}`;
}

function buildTokenCostPolicySection() {
  return `
## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat \`.specify/memory/gofer-model-policy.yaml\` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run \`/gofer:bootstrap-workspace\` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Google Antigravity (Gemini models): Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to \`.specify/specs/{feature}/context-bundle.md\`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->
`.trim();
}

function buildBusinessProgressContractSection() {
  return `
## Business-Friendly Progress Contract
<!-- gofer:business-progress:start -->

Default user-facing updates must be concise, business-level, and easy to scan.
Keep the technical work rigorous in artifacts, tests, logs, and code, but do
not lead with implementation jargon unless the user asks for it.

Use ASD-STE100 Simplified Technical English as the target writing standard for
all Gofer-authored chat, documents, commands, summaries, PR notes, error
guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of
ASD; do not bundle the protected ASD dictionary and do not claim ASD
certification.

1. Explain progress as what is being connected, changed, checked, or fixed and
   why it matters to the business outcome.
2. Use the running build map: create or update
   \`.specify/specs/{feature}/build-map.md\` from
   \`.specify/templates/build-map-template.md\` for application delivery, and
   refer to its plain-language areas in progress updates.
3. When there is a problem, translate it into business impact, current status,
   next action, and what input or approval is needed. Keep raw stack traces,
   command logs, IDs, and acronyms out of chat unless asked.
4. If the user asks for technical depth, provide it on request and point to the
   durable artifact that contains the evidence.
5. Prefer a compact update shape:
   - \`Working on\`: the build-map area or stakeholder outcome
   - \`Why it matters\`: user/business impact
   - \`Status\`: done, checking, fixing, blocked, or needs decision
6. Use one action per instruction.
7. Keep instructions to 20 words or fewer where possible.
8. Use active voice unless the actor is unknown or not important.
9. Use simple verb forms: simple present, simple past, simple future,
   infinitive, or imperative.
10. Define acronyms on first use and use approved project terms.
11. Avoid idioms, marketing adjectives, vague praise, and hedging.
12. Use vertical lists for complex information and one topic per paragraph.
13. For errors, state what happened, why it matters, what to do next, and the
    exact safe command when one exists.
14. Do not remove technical validation, security checks, EAI preflights, tests,
   or loop evidence. This contract changes presentation, not engineering
   standards.
15. Before each user-facing reply, check that it leads with the business effect,
    uses concise simple language, and includes only useful technical detail.
16. If any check fails, rewrite the reply before sending it.
${buildDeliveryDisciplineContract()}

<!-- gofer:business-progress:end -->
`.trim();
}

function buildLocalSettingsCleanupContractSection() {
  return `
## Local Settings Cleanup Contract
<!-- gofer:local-settings-cleanup:start -->

After any Gofer install, update, release refresh, or workspace bootstrap:

1. Archive stale Gofer command and skill entries before continuing.
2. Prefer the repo helper:
   - \`node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
3. If the repo helper is missing, use the stable plugin bundle helper:
   - macOS/Linux: \`node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
   - Windows: \`node %USERPROFILE%\\plugins\\eai-gofer\\.specify\\scripts\\node\\gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
4. This cleanup covers old Claude, Codex, Copilot, Gemini, Grok, VS Code, desktop, and CLI command surfaces.
5. Do not remove the current public \`eai\` entrypoint.
6. Ask the user to refresh or restart the host command picker only after cleanup completes.
<!-- gofer:local-settings-cleanup:end -->
`.trim();
}

function injectLocalSettingsCleanupContract(content) {
  if (content.includes('<!-- gofer:local-settings-cleanup:start -->')) {
    return content;
  }

  const workspaceHeadingIndex = content.indexOf('## Workspace Preflight');
  if (workspaceHeadingIndex !== -1) {
    const nextHeadingIndex = content.indexOf('\n## ', workspaceHeadingIndex + 1);
    if (nextHeadingIndex !== -1) {
      return `${content.slice(0, nextHeadingIndex).trimEnd()}\n\n${buildLocalSettingsCleanupContractSection()}\n\n${content
        .slice(nextHeadingIndex)
        .replace(/^\n+/, '')}`;
    }
  }

  return `${content.trimEnd()}\n\n${buildLocalSettingsCleanupContractSection()}`;
}

function buildAppPreviewRunnerContractSection() {
  return `
## App Preview Runner Contract
<!-- gofer:app-preview-runner:start -->

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use \`./run.sh dev 3001\` on macOS, Linux, and GitHub Codespaces.
2. Use \`run.bat dev 3001\` on Windows.
3. Use a different port only when the feature notes record the reason.
4. Restart only this app. Before stopping a process, verify its exact checkout, process ID, start time and command, then recheck immediately before stopping it. Never stop another app, an unknown process, or every process on a port. If ownership is uncertain, leave it running and ask the user. Inspect older runners before use; do not run one that kills by port alone.
5. Do not use direct \`npm run dev\`, \`next dev\`, or package-manager preview commands when \`run.sh\`, \`run.bat\`, or \`run.ps1\` exists.
6. After every UI-facing change, run:
   - \`node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"\`
7. On Windows, use:
   - \`node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"\`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.
9. Check the exact preview page and the current implemented user journey after each change. A running process, open browser, screenshot alone, error page or dry run is not proof that it works. Say ready to view only after those checks pass. Otherwise explain what is unchecked or failing; do not claim readiness. Record fresh browser and test evidence. Local MVP checks cover only implemented behaviour; do not add future auth or deployment gates. Keep showing clearly labelled drafts without adding approval stops.
<!-- gofer:app-preview-runner:end -->
`.trim();
}

function injectAppPreviewRunnerContract(content) {
  if (content.includes('<!-- gofer:app-preview-runner:start -->')) {
    return content.replace(/## App Preview Runner Contract\n<!-- gofer:app-preview-runner:start -->[\s\S]*?<!-- gofer:app-preview-runner:end -->/, buildAppPreviewRunnerContractSection());
  }

  const progressHeadingIndex = content.indexOf('## Business-Friendly Progress Contract');
  if (progressHeadingIndex !== -1) {
    const nextHeadingIndex = content.indexOf('\n## ', progressHeadingIndex + 1);
    if (nextHeadingIndex !== -1) {
      return `${content.slice(0, nextHeadingIndex).trimEnd()}\n\n${buildAppPreviewRunnerContractSection()}\n\n${content
        .slice(nextHeadingIndex)
        .replace(/^\n+/, '')}`;
    }
  }

  return `${content.trimEnd()}\n\n${buildAppPreviewRunnerContractSection()}`;
}

function insertSectionAfterTitle(content, section) {
  const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const prefix = frontmatterMatch ? frontmatterMatch[0].trimEnd() : '';
  const body = frontmatterMatch
    ? content.slice(frontmatterMatch[0].length).replace(/^\n+/, '')
    : content;

  const headingMatch = body.match(/^# [^\n]+\n+/);
  if (!headingMatch) {
    return prefix
      ? `${prefix}\n\n${section}\n\n${body}`
      : `${section}\n\n${body}`;
  }

  const insertAt = headingMatch[0].length;
  const refreshedBody = `${body.slice(0, insertAt)}${section}\n\n${body
    .slice(insertAt)
    .replace(/^\n+/, '')}`;
  return prefix ? `${prefix}\n\n${refreshedBody}` : refreshedBody;
}

function injectBusinessProgressContract(content) {
  const section = buildBusinessProgressContractSection();
  const startMarker = '<!-- gofer:business-progress:start -->';
  const endMarker = '<!-- gofer:business-progress:end -->';

  if (content.includes(startMarker) && content.includes(endMarker)) {
    const headingIndex = content.indexOf('## Business-Friendly Progress Contract');
    const endIndex = content.indexOf(endMarker, headingIndex) + endMarker.length;
    const suffix = content.slice(endIndex).replace(/^\n+/, '');
    return suffix
      ? `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n\n${suffix}`
      : `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n`;
  }

  for (const heading of [
    '## Token And Cost Policy',
    '## Application Classification And EAI Preflight',
    '## EAI Platform Session Preflight',
  ]) {
    const headingIndex = content.indexOf(heading);
    if (headingIndex === -1) continue;
    const nextHeading = content.indexOf('\n## ', headingIndex + 1);
    if (nextHeading !== -1) {
      return `${content.slice(0, nextHeading).trimEnd()}\n\n${section}\n\n${content
        .slice(nextHeading)
        .replace(/^\n+/, '')}`;
    }
  }

  return insertSectionAfterTitle(content, section);
}

export function buildContinuationContractSection() {
  return `## Continuation And Stop Contract
<!-- gofer:continuation:start -->

1. Preserve the requested scope and mode, including read-only, plan-only, research-only and MVP work. Keep the full applicable pipeline, stage functions, artifacts, reviews and validation; do not expand an MVP into an unapproved release.
2. After a stage's required evidence is complete, read and follow the next internal file in .specify/commands/ in the same conversation. Do not require a numbered command or a host-specific skill dispatcher. Optional helpers remain optional; maintenance and control commands do not start delivery work.
3. After explicit business-specification approval, continue routine planning, tasks, implementation and validation within that approved scope. Record the approval source and scope; missing or ambiguous approval is not approval. A proposal or generated status is not user consent.
4. Preserve any explicit plan/task approval requirement unless it is already satisfied by recorded user approval covering that work. Rejected, revoked, changed or unclear approval requires a pause. Never invent approvedBy, approvedAt or a new approval event when reusing an existing approval.
5. Pause for material scope, security, cost, deployment, destructive or protected files/boundary changes and any outstanding user gate. Business approval does not authorize publishing, spending, external changes or bypassing host permissions. Complete safe authorized work without bypassing the blocked gate.
6. A tool proposal is not execution. If host consent is required, wait for it. After the tool result or approved proposal returns, inspect the result and resume the next authorized action within approved scope; do not end with only a plan or a proposed tool call. A denied tool or unavailable capability must not be bypassed through another host or CLI.
7. Use the current agent's available native tools. Optional Gofer/MCP tools are conveniences, not prerequisites. If the current agent lacks a required capability, report that limitation and the safe next action; do not pretend a handoff button transfers control automatically.
8. Stop after research only when research-only work was requested, the user paused, or a real gate blocks progress. Otherwise continue to specification. At validation, report completion only when the requested scope's required evidence passes; failures remain unfinished work.
9. Respect budget, context and retry limits from the existing loop contract. Repair safe within-scope failures only within those limits. Preserve a checkpoint before an orderly context stop; resume by reading its recorded stage and rechecking scope, approvals and evidence. Never claim an abrupt host termination was handled.
10. Report concise Progress during work. At every controlled stop, report Progress, Stop reason and Next action, including the exact missing input or approval and unfinished work. Reasons are requested scope complete, user pause, approval required, material change, missing capability/access, validation blocked, or budget/context/retry limit. Stage completion alone is not pipeline completion.
${buildBlockerMediationContract()}
<!-- gofer:continuation:end -->`;
}

export function buildBlockerMediationContract() {
  return `
**Blocker Mediation**

- Before repeating a failed action or asking for missing input, read .specify/references/blocker-mediation.md and inspect the private blocker register with gofer-blocker-control.mjs. Reuse the same state directory and goal, subject and condition keys across stages, restarts and surfaces. Different wording, models or tools do not create a new blocker.
- Classify the cause first. Missing user decisions, access, external dependencies and unavailable capabilities require a recorded wait. Reserve an ask event before asking; ask once, explain the business impact and required change, then stop affected work. An unanswered question is not new evidence. Do not poll or rephrase it to keep running.
- Technical ask events require a fresh verification file under .specify/references/priority-outcome-protection.md: actual diagnosis, self-cause check and why no authorized repair is available. Business choices need no failed command. For feature tasks, use gofer-priority-check.mjs and the saved direction before switching work; this does not start delivery during maintenance or conversation.
- For AI-solvable or unknown causes, reserve each attempt before execution. Allow one investigation and one different recovery within existing tighter budgets. Record its result even when interrupted or unsuccessful. An unfinished reservation must not launch again. Do not reset the register, change keys or switch surfaces to obtain more attempts.
- Resume only after a real user answer or changed external evidence has been recorded and checked. The helper allows one evidence-backed resumption; exhausted limits need human review. Never invent approval or evidence. Successful model output and a running server do not resolve a blocker without the relevant check.
- Save the blocker, unfinished tasks and next action before stopping. Continue only approved tasks that do not depend on it. Keep the original goal; update specs, plans, tasks and validation for accepted direction changes, and reopen stale checks. Do not quietly drop requirements to make progress.
- Use node .specify/scripts/node/gofer-blocker-control.mjs --state-dir <private-state-directory> --event <private-event.json> before controlled actions; inspect with --state-dir alone, or add --task T001 for an independent task. A denied action, invalid record or missing helper means stop and explain the limitation, not bypass it. Use the installed plugin script path if no repo scaffold exists. Conversation-only work uses a private session state directory and does not require app setup or feature files.
- Strict loop validation checks every recorded feature blocker. Shared instructions guide native chats; this helper cannot intercept calls that a host sends directly. Do not claim native enforcement from package tests alone.`;
}

export function injectContinuationContract(content) {
  const section = buildContinuationContractSection();
  const pattern = /## Continuation And Stop Contract\n<!-- gofer:continuation:start -->[\s\S]*?<!-- gofer:continuation:end -->/;
  if (pattern.test(content)) return content.replace(pattern, section);
  return insertSectionAfterTitle(content, section);
}

function injectTokenCostPolicy(content) {
  return injectContinuationContract(injectAppPreviewRunnerContract(
    injectLocalSettingsCleanupContract(injectBusinessProgressContract(injectTokenCostPolicyOnly(content)))
  ));
}

function injectTokenCostPolicyOnly(content) {
  const section = buildTokenCostPolicySection();
  const startMarker = '<!-- gofer:token-cost-policy:start -->';
  const endMarker = '<!-- gofer:token-cost-policy:end -->';

  if (content.includes(startMarker) && content.includes(endMarker)) {
    const headingIndex = content.indexOf('## Token And Cost Policy');
    const endIndex = content.indexOf(endMarker, headingIndex) + endMarker.length;
    const suffix = content.slice(endIndex).replace(/^\n+/, '');
    return suffix
      ? `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n\n${suffix}`
      : `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n`;
  }

  if (content.includes('## Token And Cost Policy')) {
    const legacyPolicyPattern =
      /## Token And Cost Policy\n\nBefore spawning agents, calling tools, or loading large files:\n\n[\s\S]*?^6\. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality\.\n?/m;
    const legacyMatch = content.match(legacyPolicyPattern);
    if (legacyMatch && legacyMatch.index !== undefined) {
      const suffix = content.slice(legacyMatch.index + legacyMatch[0].length).replace(/^\n+/, '');
      return suffix
        ? `${content.slice(0, legacyMatch.index).trimEnd()}\n\n${section}\n\n${suffix}`
        : `${content.slice(0, legacyMatch.index).trimEnd()}\n\n${section}\n`;
    }

    const headingIndex = content.indexOf('## Token And Cost Policy');
    const nextHeading = content.indexOf('\n## ', headingIndex + 1);
    if (nextHeading !== -1) {
      return `${content.slice(0, headingIndex).trimEnd()}\n\n${section}\n\n${content
        .slice(nextHeading)
        .replace(/^\n+/, '')}`;
    }

    return content;
  }

  if (content.includes('## Workspace Preflight')) {
    const nextHeading = content.indexOf('\n## ', content.indexOf('## Workspace Preflight') + 1);
    if (nextHeading !== -1) {
      return `${content.slice(0, nextHeading).trimEnd()}\n\n${section}\n\n${content
        .slice(nextHeading)
        .replace(/^\n+/, '')}`;
    }
  }

  return insertSectionAfterTitle(content, section);
}

async function refreshCanonicalCommandSources(root, dryRun) {
  const commandsDir = path.join(root, '.specify', 'commands');
  let entries;
  try {
    entries = await fs.readdir(commandsDir);
  } catch {
    throw new Error(`.specify/commands/ not found at ${commandsDir}`);
  }

  let changed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === '.gitkeep') continue;
    const filePath = path.join(commandsDir, entry);
    const source = await fs.readFile(filePath, 'utf8');
    // Emitter tests use intentionally partial command fixtures. Only normalize
    // canonical command files that can be parsed and emitted as real stages.
    if (!source.startsWith('---')) continue;
    let refreshed = LEGACY_HELPER_COMMAND_FILES.has(entry)
      ? injectContinuationContract(source)
      : injectTokenCostPolicy(injectEaiPlatformSessionPreflight(source));
    if (refreshed.includes('<!-- gofer:app-preview-runner:start -->')) {
      refreshed = injectAppPreviewRunnerContract(refreshed);
    }
    if (entry === 'gofer_eai_first_run.md') {
      const withoutAuthScope = refreshed.replace(
        /\n?## Auth Scope Before Setup\n[\s\S]*?(?=\n## |\s*$)/g,
        ''
      );
      refreshed = insertSectionAfterTitle(
        withoutAuthScope,
        `## Auth Scope Before Setup\n\n${buildAuthAccessDecisionContract()}`
      );
    }
    if (refreshed === source) continue;

    changed++;
    if (dryRun) {
      console.log(`[dry-run] canonical commands: would normalize ${path.relative(root, filePath)}`);
      continue;
    }

    await fs.writeFile(filePath, refreshed, 'utf8');
  }

  if (changed > 0) {
    const suffix = dryRun ? ' would change' : ' changed';
    console.log(`Canonical command contracts:${suffix} ${changed} file(s)`);
  }
}

/**
 * @param {string} currentCommand
 * @returns {string | null}
 */
function getNextCommand(currentCommand) {
  if (currentCommand === '0a_problem_validation') return '1_gofer_research';
  const pipeline = [
    '0_gofer_start',
    '1_gofer_research',
    '2_gofer_specify',
    '3_gofer_plan',
    '4_gofer_tasks',
    '5_gofer_implement',
    '6_gofer_validate',
  ];

  const currentIndex = pipeline.indexOf(currentCommand);
  if (currentIndex >= 0 && currentIndex < pipeline.length - 1) {
    return pipeline[currentIndex + 1];
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function readString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Builds a SKILL.md content string.
 * @param {string} stageName
 * @param {string} description
 * @param {string} body
 * @returns {string}
 */
function buildSkillContent(stageName, description, body) {
  return `---\nname: ${stageName}\ndescription: "${description}"\n---\n\n${body}`;
}

async function emitDocumentationSkill(root, baseDir, dryRun, label) {
  const sourcePath = path.join(
    root,
    '.specify',
    'skills',
    'gofer-documentation',
    'SKILL.md'
  );
  const outPath = path.join(baseDir, 'gofer-documentation', 'SKILL.md');
  try {
    await fs.access(sourcePath);
  } catch {
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] ${label}: would write ${outPath}`);
  } else {
    await ensureDir(path.dirname(outPath));
    await fs.copyFile(sourcePath, outPath);
    console.log(`${label}: wrote ${outPath}`);
  }
}

function buildUmbrellaSkillContent(version, stages, hostLabel) {
  const stageList = buildInternalStageList(stages);

  return `---\nname: eai\ndescription: "Use Gofer's repo-owned pipeline, scripts, and validation tools through one clean command surface."\n---\n\n# Eai\n\nVersion: ${version}\nHost: ${hostLabel}\n\nUse this skill when the user asks to install, update, diagnose, run, or understand Gofer from an AI coding app.\n\n## Clean Surface Contract\n\n- User-facing pickers should expose only \`eai\`.\n- Do not ask users to run numbered/helper stage commands such as \`/0_gofer_start\`, \`/1_gofer_research\`, or \`/6_gofer_validate\` unless they explicitly request internal details.\n- Keep the full pipeline available by routing internally through \`.specify/commands/*.md\` stage contracts.\n- Check workspace health before stage work: \`node .specify/scripts/node/gofer-workspace-check.mjs --host auto --json\`.\n- If missing or stale, ask the user before running: \`node .specify/scripts/node/gofer-workspace-bootstrap.mjs --host auto --include-mirrors\`.\n\n## Controlled English Contract\n\nUse ASD-STE100 Simplified Technical English as the target writing standard for all Gofer-authored chat, documents, commands, summaries, PR notes, error guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of ASD; do not bundle the protected ASD dictionary and do not claim ASD certification.\n\nApply these rules before any user-facing output:\n\n1. Use short sentences. Keep instructions to 20 words or fewer where possible.\n2. Use one action per instruction.\n3. Use active voice. Use passive voice only when the actor is unknown or not important.\n4. Use simple present, simple past, simple future, infinitive, or imperative verb forms.\n5. Use approved project terms and necessary technical nouns only. Define acronyms on first use.\n6. Use direct words. Avoid idioms, marketing adjectives, vague praise, and hedging.\n7. Use vertical lists for complex information.\n8. Put one topic in each paragraph.\n9. For errors, write: what happened, why it matters, what to do next, and the exact safe command when one exists.\n10. Keep raw logs, stack traces, IDs, and secrets out of chat unless the user asks for technical detail.\n\n## Light Plugin And Repo Scripts\n\nThe light plugin installs durable Gofer knowledge and app integration metadata. The repository remains the source of truth for executable scripts, commands, templates, specs, and memory. After bootstrap, agents should prefer repo-local scripts over bundled fallback copies because the repo can be updated by \`eai gofer refresh\` or the VS Code extension.\n\n## App vs Non-App Routing\n\n- Classify each request before EAI readiness as EAI app delivery, non-application work, or ambiguous.\n- If the request is EAI app delivery or ambiguous, continue directly into the EAI app delivery path and run EAI readiness.\n- If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**\n- If the user confirms non-app, do not run \`eai whoami\`, tenant selection, \`eai init\`, or first-run setup. Record the decision and continue the appropriate non-app path.\n\n## First EAI Platform App\n\nIf the user is starting a first EAI Platform app, use this public entrypoint and then follow the first-run/setup contract in \`.specify/commands/gofer_eai_first_run.md\` when it is present. That setup path is intentionally allowed before \`.specify/\` exists.\n\n${buildVerifiedEaiCliCommandContract()}\n\n## Internal Pipeline Contracts\n\n${stageList}\n`;
}

export function buildGithubAgentContent({ id, description, tools, handoffs, body }) {
  const frontmatter = [
    '---',
    `description: ${JSON.stringify(description)}`,
    `tools: ${JSON.stringify(tools)}`,
  ];

  if (handoffs.length > 0) {
    frontmatter.push('handoffs:');
    for (const handoff of handoffs) {
      frontmatter.push(`  - agent: ${handoff.agent}`);
      frontmatter.push(`    label: ${JSON.stringify(handoff.label)}`);
      frontmatter.push(`    prompt: ${JSON.stringify(handoff.prompt)}`);
      frontmatter.push(`    send: ${handoff.send ? 'true' : 'false'}`);
    }
  }

  frontmatter.push('---');

  return `${frontmatter.join('\n')}\n\n# ${id}\n\n${buildUserFacingResponseGateSection()}\n\n${buildContinuationContractSection()}\n\n${body.trim()}\n`;
}

export function getGithubAgentSpecs() {
  // Every stage writes artifacts and runs local checks, including intake preflight.
  // Stage instructions constrain usage; tool lists are not permission grants.
  const stageTools = ['read', 'search', 'edit', 'execute'];

  return [
    {
      id: 'gofer-business',
      description: 'Gofer start and setup agent. Use for first-run setup, workspace health, feature intake, and selecting the right pipeline entry point.',
      tools: stageTools,
      handoffs: [
        {
          agent: 'gofer-research',
          label: 'Continue to Research',
          prompt: 'Continue with Gofer research for the confirmed feature. Check workspace health first, then route internally through the 1_gofer_research stage contract.',
          send: false,
        },
      ],
      body: `
You are the Gofer start agent.

Check Gofer workspace health with the available native tools and repo-owned checker. During intake, edit only intake artifacts and execute only authorized workspace checks or approved setup. Ask before bootstrapping. Keep the user-facing surface simple: users see only eai; numbered stages and helpers are internal contracts. Continue into the next authorized internal stage without requiring a custom-agent handoff.

Primary outputs:

- A clear route into the public \`eai\` entrypoint, first-run setup, or standalone research.
- A concise statement of whether the repo has the Gofer scaffold, plugin/app support, and EAI first-run prerequisites.
`,
    },
    {
      id: 'gofer-research',
      description: 'Gofer research agent. Use for codebase and documentation research before specification.',
      tools: stageTools,
      handoffs: [
        {
          agent: 'gofer-plan',
          label: 'Continue to Plan',
          prompt: 'Continue through Gofer specify and plan stages using the research artifacts. Preserve workspace checks and artifact evidence.',
          send: false,
        },
      ],
      body: `
You are the Gofer research agent.

Use \`.specify/commands/1_gofer_research.md\` as the internal stage contract. Keep raw output out of chat when it is large; write durable findings to \`.specify/specs/{feature}/research.md\` and \`context-bundle.md\`.
During research, use execute only for authorized diagnostics and edit only research artifacts. Do not modify application code before the implementation stage and its approval checks. Stop after requested research-only work; otherwise continue internally.
`,
    },
    {
      id: 'gofer-plan',
      description: 'Gofer specification and planning agent. Use after research to produce spec, plan, contracts, and ordered tasks.',
      tools: stageTools,
      handoffs: [
        {
          agent: 'gofer-implement',
          label: 'Implement Tasks',
          prompt: 'Implement the approved Gofer tasks. Check pipeline state first and preserve traceability.',
          send: false,
        },
      ],
      body: `
You are the Gofer planning agent.

Use \`.specify/commands/2_gofer_specify.md\`, \`.specify/commands/3_gofer_plan.md\`, and \`.specify/commands/4_gofer_tasks.md\` as the internal stage contracts. Keep the plan grounded in existing repository scripts, current platform capabilities, and explicit validation obligations.
During planning, edit specifications and task artifacts and execute only authorized discovery/check scripts. Implementation requires the scope and approval checks in the next internal contract.
`,
    },
    {
      id: 'gofer-implement',
      description: 'Gofer implementation agent. Use for task execution, code edits, tests, and repo-script driven changes.',
      tools: stageTools,
      handoffs: [
        {
          agent: 'gofer-validate',
          label: 'Validate Changes',
          prompt: 'Validate this implementation with Gofer. Run the relevant tests and produce validation evidence.',
          send: false,
        },
      ],
      body: `
You are the Gofer implementation agent.

Use \`.specify/commands/5_gofer_implement.md\` as the internal stage contract. Work from \`tasks.md\`, keep changes minimal, run repo tests, and update traceability evidence as tasks complete.
`,
    },
    {
      id: 'gofer-validate',
      description: 'Gofer validation agent. Use for branch validation, security checks, test evidence, and release readiness.',
      tools: stageTools,
      handoffs: [],
      body: `
You are the Gofer validation agent.

Use \`.specify/commands/6_gofer_validate.md\` as the terminal quality gate. Validate functional correctness, integration, security, standards, tests, generated artifacts, and release/public readiness where relevant.
Use edit for validation evidence and execute for authorized tests and checks. If repairs are needed, return internally to the implementation contract within approved scope and retry limits, then revalidate. Do not mark failed checks complete.
`,
    },
  ];
}

/**
 * Escapes a string for a basic TOML double-quoted value.
 * @param {string} value
 * @returns {string}
 */
function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * T041 — agents-skills emitter
 * Emits Codex SKILL.md to .agents/skills/<name>/SKILL.md.
 * Emits every stage whose frontmatter includes the agents-skills surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitAgentsSkills(stages, root, dryRun) {
  const baseDir = path.join(root, '.agents', 'skills');
  let count = 0;
  const version = await detectPackageVersion(root);
  await clearDirectoryEntries(baseDir, (entry) => entry.isDirectory(), dryRun, 'agents-skills');
  for (const entry of PUBLIC_ENTRYPOINTS) {
    const skillDir = path.join(baseDir, entry.stem);
    const outPath = path.join(skillDir, 'SKILL.md');
    const content = buildPublicEntrypointSkill(
      entry,
      version,
      stages,
      'Codex and Google Antigravity',
      SURFACE_WORKSPACE_HOSTS['agents-skills']
    );

    if (dryRun) {
      console.log(`[dry-run] agents-skills: would write ${outPath}`);
    } else {
      await ensureDir(skillDir);
      await fs.writeFile(outPath, content, 'utf8');
      console.log(`agents-skills: wrote ${outPath}`);
    }
    count++;
  }
  await emitDocumentationSkill(root, baseDir, dryRun, 'agents-skills');
  count++;
  console.log(`agents-skills: ${count} file(s) emitted`);
  return true;
}

async function emitGithubAgents(stages, root, dryRun) {
  void stages;
  const outDir = path.join(root, '.github', 'agents');
  const agentSpecs = getGithubAgentSpecs();

  if (dryRun) {
    for (const agent of agentSpecs) {
      console.log(`[dry-run] github-agents: would write ${path.join(outDir, `${agent.id}.agent.md`)}`);
    }
  } else {
    await ensureDir(outDir);
    for (const agent of agentSpecs) {
      const outPath = path.join(outDir, `${agent.id}.agent.md`);
      await fs.writeFile(outPath, buildGithubAgentContent(agent), 'utf8');
      console.log(`github-agents: wrote ${outPath}`);
    }
  }

  console.log(`github-agents: ${agentSpecs.length} file(s) emitted`);
  return true;
}

async function emitGithubSkills(stages, root, dryRun) {
  const version = await detectPackageVersion(root);
  const baseDir = path.join(root, '.github', 'skills');
  await clearDirectoryEntries(baseDir, (entry) => entry.isDirectory(), dryRun, 'github-skills');
  let count = 0;

  for (const entry of PUBLIC_ENTRYPOINTS) {
    const outPath = path.join(baseDir, entry.stem, 'SKILL.md');
    const content = buildPublicEntrypointSkill(entry, version, stages, 'VS Code and GitHub Copilot', 'copilot');
    if (dryRun) {
      console.log(`[dry-run] github-skills: would write ${outPath}`);
    } else {
      await ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, content, 'utf8');
      console.log(`github-skills: wrote ${outPath}`);
    }
    count++;
  }

  await emitDocumentationSkill(root, baseDir, dryRun, 'github-skills');
  count++;

  console.log(`github-skills: ${count} file(s) emitted`);
  return true;
}

async function emitClaudeSkills(stages, root, dryRun) {
  const version = await detectPackageVersion(root);
  const baseDir = path.join(root, '.claude', 'skills');
  await clearDirectoryEntries(baseDir, (entry) => entry.isDirectory(), dryRun, 'claude-skills');
  let count = 0;

  for (const entry of PUBLIC_ENTRYPOINTS) {
    const outPath = path.join(baseDir, entry.stem, 'SKILL.md');
    const content = buildPublicEntrypointSkill(entry, version, stages, 'Claude Code', 'claude');
    if (dryRun) {
      console.log(`[dry-run] claude-skills: would write ${outPath}`);
    } else {
      await ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, content, 'utf8');
      console.log(`claude-skills: wrote ${outPath}`);
    }
    count++;
  }

  await emitDocumentationSkill(root, baseDir, dryRun, 'claude-skills');
  count++;

  console.log(`claude-skills: ${count} file(s) emitted`);
  return true;
}

/**
 * T042 — system-skills emitter
 * Emits SKILL.md to .system/skills/<name>/SKILL.md.
 * Emits every stage whose frontmatter includes the system-skills surface.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitSystemSkills(stages, root, dryRun) {
  const baseDir = path.join(root, '.system', 'skills');
  let count = 0;
  const version = await detectPackageVersion(root);
  await clearDirectoryEntries(baseDir, (entry) => entry.isDirectory(), dryRun, 'system-skills');
  for (const entry of PUBLIC_ENTRYPOINTS) {
    const skillDir = path.join(baseDir, entry.stem);
    const outPath = path.join(skillDir, 'SKILL.md');
    const content = buildPublicEntrypointSkill(
      entry,
      version,
      stages,
      'Codex',
      SURFACE_WORKSPACE_HOSTS['system-skills']
    );

    if (dryRun) {
      console.log(`[dry-run] system-skills: would write ${outPath}`);
    } else {
      await ensureDir(skillDir);
      await fs.writeFile(outPath, content, 'utf8');
      console.log(`system-skills: wrote ${outPath}`);
    }
    count++;
  }
  await emitDocumentationSkill(root, baseDir, dryRun, 'system-skills');
  count++;
  console.log(`system-skills: ${count} file(s) emitted`);
  return true;
}

async function emitGrokSkills(stages, root, dryRun) {
  const baseDir = path.join(root, '.grok', 'skills');
  let count = 0;
  const version = await detectPackageVersion(root);
  await clearDirectoryEntries(baseDir, (entry) => entry.isDirectory(), dryRun, 'grok-skills');
  for (const entry of PUBLIC_ENTRYPOINTS) {
    const skillDir = path.join(baseDir, entry.stem);
    const outPath = path.join(skillDir, 'SKILL.md');
    const content = buildPublicEntrypointSkill(entry, version, stages, 'Grok Build', 'grok');
    if (dryRun) {
      console.log(`[dry-run] grok-skills: would write ${outPath}`);
    } else {
      await ensureDir(skillDir);
      await fs.writeFile(outPath, content, 'utf8');
      console.log(`grok-skills: wrote ${outPath}`);
    }
    count++;
  }
  console.log(`grok-skills: ${count} file(s) emitted`);
  return true;
}

/**
 * T065 — gemini emitter
 * Emits plain markdown body and TOML command wrappers to
 * .gemini/commands/gofer/<name>.md and <name>.toml.
 * T066 — also creates .gemini/commands/gofer/manifest.json listing all emitted stage names.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitGemini(stages, root, dryRun) {
  const outDir = path.join(root, '.gemini', 'commands', 'gofer');
  const extensionPath = path.join(root, '.gemini', 'extension.json');
  const version = await detectPackageVersion(root);
  const emittedNames = [];
  let count = 0;

  await clearDirectoryEntries(
    outDir,
    (entry) => entry.name.endsWith('.md') || entry.name.endsWith('.toml'),
    dryRun,
    'gemini'
  );

  for (const entry of PUBLIC_ENTRYPOINTS) {
    const markdownPath = path.join(outDir, `${entry.stem}.md`);
    const tomlPath = path.join(outDir, `${entry.stem}.toml`);
    const tomlContent = [
      `description = "${escapeTomlString(entry.description)}"`,
      `prompt = "{{include: ./${entry.stem}.md}}"`,
      '',
    ].join('\n');

    if (dryRun) {
      console.log(`[dry-run] gemini: would write ${markdownPath}`);
      console.log(`[dry-run] gemini: would write ${tomlPath}`);
    } else {
      await ensureDir(outDir);
      await fs.writeFile(markdownPath, buildPublicEntrypointMarkdown(entry, stages, 'gemini'), 'utf8');
      await fs.writeFile(tomlPath, tomlContent, 'utf8');
      console.log(`gemini: wrote ${markdownPath}`);
      console.log(`gemini: wrote ${tomlPath}`);
    }
    emittedNames.push(entry.name);
    count++;
  }

  // T066 — write manifest.json
  const manifestPath = path.join(outDir, 'manifest.json');
  const sortedNames = [...emittedNames].sort();
  const manifest = {
    version: '1.0',
    generated: new Date().toISOString(),
    commands: sortedNames,
  };

  if (dryRun) {
    console.log(`[dry-run] gemini: would write manifest ${manifestPath}`);
    console.log(`[dry-run] gemini: would write extension manifest ${extensionPath}`);
  } else {
    await ensureDir(outDir);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    await fs.writeFile(
      extensionPath,
      JSON.stringify(buildGeminiExtensionManifest(version), null, 2) + '\n',
      'utf8'
    );
    console.log(`gemini: wrote manifest ${manifestPath}`);
    console.log(`gemini: wrote extension manifest ${extensionPath}`);
  }

  console.log(`gemini: ${count} file(s) emitted`);
  return true;
}

/**
 * T067 — agents-md emitter
 * Creates .agents/AGENTS.md — a consolidated AGENTS.md for Codex/Antigravity.
 * Includes all stages emitted to portable agent surfaces.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitAgentsMd(stages, root, dryRun) {
  const outPath = path.join(root, '.agents', 'AGENTS.md');
  const timestamp = new Date().toISOString();
  const stageList = buildInternalStageList(stages);

const content = `# Gofer Agent Commands

This file documents the public Gofer command surface and internal pipeline contracts.

Generated: ${timestamp}

## Public Entrypoints

- \`eai\` - Start or continue Gofer from one user-facing command.

Do not expose numbered or helper stage commands in user-facing pickers. They remain available as internal contracts under \`.specify/commands/\`.

${buildUserFacingResponseGateSection()}

${buildAlwaysEaiSection()}

${buildVerifiedEaiCliCommandContract()}

## EAI CLI Discovery And Recovery

- Classify work before EAI readiness: app delivery continues directly; clear non-app work asks once before skipping EAI tenant/app setup.
- Run \`eai update --check\` before first EAI platform work when the CLI may be stale.
- Run \`eai --describe\` before assuming command syntax.
- If advertised, run \`eai agent guide --format json\` before planning or fixing EAI workflows.
- After any \`eai\` error, run \`eai errors explain <code-or-reason> --format json\` before guessing remediation.
- If \`eai errors explain\` is unavailable, match \`.specify/references/platform/eai-error-catalog.yaml\`, run read-only diagnostics before mutating fixes, and stop at the retry or escalation condition.
- For \`eai user invite\` 5xx or \`EXTERNAL_SERVICE_ERROR\`, check existing members with \`eai user list --tenant <tenant-id> --search <email> --format json\`; use \`eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json\` only after verification and user approval, then tell the app user to sign out and sign back in.
- For \`MISSING_TENANT\`, \`app_token_tenant_context_required\`, or "Tenant context required for app tokens" on platform user lookup or membership prerequisites, run \`eai errors explain app_token_tenant_context_required --format json\`, confirm tenant context, and retry \`/v4/platform/tenants/<tenant-id>/...\` routes before changing tenant members, Entra, role definitions, databases, or cloud portals.
- Use \`eai publicapi\` only for authorized PublicAPI \`/v4/...\` routes.

## Commands

${stageList}
`;

  if (dryRun) {
    console.log(`[dry-run] agents-md: would write ${outPath}`);
  } else {
    await ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, content, 'utf8');
    console.log(`agents-md: wrote ${outPath}`);
  }

  console.log(`agents-md: ${PUBLIC_ENTRYPOINTS.length} public entrie(s) emitted`);
  return true;
}

/**
 * T068 — codex-config emitter
 * Generates .specify/outputs/codex-config-fragment.toml containing skill entries
 * for every stage emitted to Codex/agents-skills.
 * Does NOT touch ~/.codex/config.toml.
 *
 * @param {Array} stages
 * @param {string} root
 * @param {boolean} dryRun
 */
async function emitCodexConfig(stages, root, dryRun) {
  void stages;
  const outDir = path.join(root, '.specify', 'outputs');
  const outPath = path.join(outDir, 'codex-config-fragment.toml');
  const timestamp = new Date().toISOString();
  const lines = [
    `# Gofer skill overrides for ~/.codex/config.toml`,
    `# Generated by generate-commands.mjs on ${timestamp}`,
    `# Codex discovers repository-local Gofer skills from .agents/skills automatically.`,
    `# Only use these [[skills.config]] blocks when you need explicit per-skill overrides.`,
    `# Replace /full/path/to/repo with the absolute path to your local checkout.`,
    ``,
  ];

  let count = 0;
  for (const entry of PUBLIC_ENTRYPOINTS) {
    lines.push(`[[skills.config]]`);
    lines.push(`path = "/full/path/to/repo/.agents/skills/${escapeTomlString(entry.stem)}"`);
    lines.push(`enabled = true`);
    lines.push(``);
    count++;
  }

  const content = lines.join('\n');

  if (dryRun) {
    console.log(`[dry-run] codex-config: would write ${outPath}`);
  } else {
    await ensureDir(outDir);
    await fs.writeFile(outPath, content, 'utf8');
    console.log(`codex-config: wrote ${outPath}`);
  }

  console.log(`codex-config: ${count} skill entrie(s) emitted`);
  return true;
}

const EMITTERS = {
  'claude': emitClaude,
  'claude-mirror': emitClaudeMirror,
  'claude-skills': emitClaudeSkills,
  'copilot': emitCopilot,
  'github-prompts': emitGithubPrompts,
  'github-agents': emitGithubAgents,
  'github-skills': emitGithubSkills,
  'agents-skills': emitAgentsSkills,
  'system-skills': emitSystemSkills,
  'grok-skills': emitGrokSkills,
  'gemini': emitGemini,
  'agents-md': emitAgentsMd,
  'codex-config': emitCodexConfig,
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    check: false,
    dryRun: false,
    surfaces: ALL_SURFACES,
    root: process.cwd(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--surfaces' && argv[i + 1]) {
      args.surfaces = argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--root' && argv[i + 1]) {
      args.root = argv[i + 1];
      i++;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// T043 — per-CLI exclusion enforcement (validation)
// ---------------------------------------------------------------------------

/**
 * Validates that no stage is being emitted to a surface it should be excluded from.
 * Logs a warning for any violations found.
 *
 * @param {Array} stages
 * @param {string[]} surfaces
 */
function validateExclusions(stages, surfaces) {
  let violations = 0;
  for (const stage of stages) {
    const stageName = String(stage.frontmatter.name);
    for (const surface of surfaces) {
      if (shouldExclude(stageName, surface) && stage.frontmatter.surfaces.includes(surface)) {
        console.warn(
          `[warn] Exclusion violation: stage '${stageName}' is listed under surface '${surface}' in its frontmatter, but shouldExclude() returns true for this combination. The emitter will skip this stage.`
        );
        violations++;
      }
    }
  }
  if (violations === 0) {
    console.log(`Exclusion validation OK: no violations found`);
  } else {
    console.warn(`Exclusion validation: ${violations} violation(s) found (stages will still be skipped)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const { check, dryRun, surfaces, root } = parseArgs(argv);

  // Validate canonical descriptions first (budget check)
  try {
    const { count, totalBytes } = validateDescriptions();
    console.log(`Canonical descriptions OK: ${count} stages, ${totalBytes} bytes`);
  } catch (err) {
    console.error(`Canonical description validation failed: ${err.message}`);
    process.exit(1);
  }

  // Minimal emitter fixtures do not include the full Gofer reference library.
  // Only a real Gofer workspace may receive automatic contract normalization.
  const commandsDir = path.join(root, '.specify', 'commands');
  try {
    await fs.access(commandsDir);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.error('Canonical command normalization failed: .specify/commands/ not found');
      process.exit(1);
    }
    throw err;
  }
  const capabilityContractPath = path.join(
    root,
    '.specify',
    'references',
    'mvp-capability-validation.md'
  );
  try {
    await fs.access(capabilityContractPath);
    await refreshCanonicalCommandSources(root, dryRun || check);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error(`Canonical command normalization failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  // Load all stage command files from .specify/commands/
  let stages;
  try {
    stages = await loadStages(root);
  } catch (err) {
    console.error(`Stage loading failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (stages.length === 0) {
    console.warn('[warn] No stage command files found in .specify/commands/ — nothing to emit');
  } else {
    console.log(`Loaded ${stages.length} stage(s): ${stages.map((s) => s.frontmatter.name).join(', ')}`);
  }

  // T043: validate exclusions
  validateExclusions(stages, surfaces);

  if (dryRun || check) {
    if (check) console.log('[check] Generation inputs are valid; no files were written.');
    console.log('[dry-run] Would emit to surfaces:', surfaces.join(', '));
    console.log('[dry-run] Stages:', stages.map((s) => s.frontmatter.name).join(', '));
    process.exit(0);
  }

  let allOk = true;
  for (const surface of surfaces) {
    const emitter = EMITTERS[surface];
    if (!emitter) {
      console.warn(`Unknown surface '${surface}' — skipping`);
      continue;
    }

    try {
      const ok = await emitter(stages, root, dryRun);
      if (!ok) {
        console.error(`Emitter for '${surface}' returned false`);
        allOk = false;
      }
    } catch (err) {
      console.error(`Emitter for '${surface}' threw: ${err.message}`);
      allOk = false;
    }
  }

  process.exit(allOk ? 0 : 1);
}

// Only run main when executed directly (not when imported as a module in tests)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('generate-commands.mjs') ||
  process.argv[1] === new URL(import.meta.url).pathname
);

if (isMain) {
  main();
}
