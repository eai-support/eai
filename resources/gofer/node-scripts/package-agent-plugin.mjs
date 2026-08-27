#!/usr/bin/env node
/**
 * Builds the installable Gofer plugin bundle for supported AI coding apps.
 *
 * Canonical command sources live in `.specify/commands/`. This script stages a
 * portable plugin under `dist/` and, when requested, refreshes the repo-local
 * marketplace plugin under `plugins/eai-gofer/`.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseStageCommand } from './parse-stage-command.mjs';

const execFileAsync = promisify(execFile);

const GENERATED_MARKER = 'generated-by-eai-gofer';
const PLUGIN_NAME = 'eai-gofer';
const PLUGIN_DISPLAY_NAME = 'Gofer';
const UMBRELLA_SKILLS_DIR = 'plugin-skills';
const PLUGIN_ICON_SOURCE = 'extension/icon.png';
const PLUGIN_ICON_TARGET = 'assets/eai-gofer-icon.png';
const REPOSITORY_URL = 'https://github.com/eai-support/eai-gofer';
const PUBLIC_SITE_URL = 'https://eai-support.github.io/eai-gofer';
const PUBLIC_RELEASES_URL = `${PUBLIC_SITE_URL}/releases`;
const PUBLIC_PLUGIN_URL = `${PUBLIC_RELEASES_URL}/plugins/${PLUGIN_NAME}`;
const CLAUDE_MARKETPLACE_URL = `${PUBLIC_PLUGIN_URL}/claude-marketplace.json`;
const CODEX_PLUGIN_MANIFEST_URL = `${PUBLIC_PLUGIN_URL}/codex-plugin.json`;
const COPILOT_MARKETPLACE_URL = `${PUBLIC_PLUGIN_URL}/copilot-marketplace.json`;
const GEMINI_EXTENSION_URL = `${PUBLIC_PLUGIN_URL}/gemini-extension.json`;
const PUBLIC_ENTRYPOINTS = [
  {
    stem: 'eai',
    name: 'eai',
    title: 'Eai',
    description: 'Start or continue the EAI delivery pipeline. Use when the user says Get started with EAI or asks EAI to guide application delivery.',
  },
];
const WINDOWS_FORBIDDEN_SEGMENT_CHARS = new Set(['<', '>', ':', '"', '\\', '|', '?', '*']);
const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_SAFE_RELATIVE_PATH_LIMIT = 240;
const PERSONAL_PATH_PATTERN =
  /(^|[\s"'])(\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Za-z]:\\Users\\[^\\\s"']+)/;
const WORKSPACE_PREFLIGHT_EXCLUDED_COMMANDS = new Set([
  'gofer:plan',
  'gofer:side',
  'gofer:personality',
  'gofer:check-workspace',
  'gofer:bootstrap-workspace',
  'gofer:eai-first-run',
]);

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    outDir: 'dist',
    version: null,
    syncRepo: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) {
      args.root = argv[++i];
    } else if (arg === '--out-dir' && argv[i + 1]) {
      args.outDir = argv[++i];
    } else if (arg === '--version' && argv[i + 1]) {
      args.version = argv[++i].replace(/^v/, '');
    } else if (arg === '--sync-repo') {
      args.syncRepo = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function usage() {
  return [
    'Usage: node .specify/scripts/node/package-agent-plugin.mjs --version <x.y.z>',
    '',
    'Options:',
    '  --version <x.y.z>   Release/package version to stamp into plugin manifests.',
    '  --out-dir <dir>     Output directory for the staged folder and zip. Default: dist',
    '  --root <dir>        Gofer repository root. Default: current working directory',
    '  --sync-repo         Refresh root manifests and plugins/eai-gofer marketplace bundle.',
  ].join('\n');
}

function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
    throw new Error(`Plugin version must look like 3.4.0; got '${version ?? ''}'.`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function loadStages(root) {
  const commandsDir = path.join(root, '.specify', 'commands');
  const entries = (await fs.readdir(commandsDir))
    .filter((entry) => entry.endsWith('.md') && entry !== '.gitkeep')
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const stages = [];
  for (const entry of entries) {
    const filePath = path.join(commandsDir, entry);
    const parsed = await parseStageCommand(filePath);
    stages.push({
      stem: path.basename(entry, '.md'),
      sourceFile: entry,
      filePath,
      ...parsed,
    });
  }

  return stages;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function stageNames(stages) {
  return stages.map((stage) => String(stage.frontmatter.name));
}

function buildPublicVsixUrl(version) {
  return `${PUBLIC_RELEASES_URL}/eai-gofer-${version}.vsix`;
}

function buildPublicAgentPluginZipUrl(version) {
  return `${PUBLIC_RELEASES_URL}/eai-gofer-agent-plugin-${version}.zip`;
}

function buildLatestPublicVsixUrl() {
  return `${PUBLIC_RELEASES_URL}/eai-gofer-latest.vsix`;
}

function buildLatestPublicAgentPluginZipUrl() {
  return `${PUBLIC_RELEASES_URL}/eai-gofer-agent-plugin-latest.zip`;
}

function buildCodexManifest(version, stages, paths = {}) {
  return {
    name: PLUGIN_NAME,
    version,
    description:
      'Gofer single-entry delivery command with internal pipeline routing for Claude, Codex, Copilot, Gemini, and VS Code.',
    author: {
      name: 'EAI Tools',
      url: REPOSITORY_URL,
    },
    homepage: REPOSITORY_URL,
    repository: REPOSITORY_URL,
    license: 'Apache-2.0',
    keywords: [
      'eai-gofer',
      'gofer',
      'codex',
      'claude',
      'copilot',
      'gemini',
      'spec-driven-development',
    ],
    skills: paths.skills ?? './skills/',
    interface: {
      displayName: PLUGIN_DISPLAY_NAME,
      shortDescription: 'Spec-driven delivery workflow for agentic coding',
      longDescription:
        'Run Gofer from one public entrypoint: eai. Gofer routes internally through the full research, specify, plan, tasks, implement, and validate pipeline.',
      developerName: 'EAI Tools',
      category: 'Coding',
      capabilities: ['Interactive', 'Write'],
      websiteURL: REPOSITORY_URL,
      defaultPrompt: [
        'Set up my first EAI Platform app with Gofer',
        'Run Gofer research for this feature',
        'Validate this branch with Gofer',
      ],
      brandColor: '#145DA0',
      composerIcon: paths.icon ?? `./${PLUGIN_ICON_TARGET}`,
      logo: paths.icon ?? `./${PLUGIN_ICON_TARGET}`,
    },
  };
}

function buildGeminiManifest(version, paths = {}) {
  return {
    name: PLUGIN_NAME,
    version,
    description: 'Gofer single-entry delivery command with internal pipeline routing',
    license: 'Apache-2.0',
    commands: paths.commands ?? '.gemini/commands/gofer/',
    gofer: {
      bundle_url: PUBLIC_PLUGIN_URL,
      manifest_url: `${PUBLIC_PLUGIN_URL}/gemini-extension.json`,
      commands_manifest_url: `${PUBLIC_PLUGIN_URL}/gemini-commands-manifest.json`,
      download_url: buildPublicAgentPluginZipUrl(version),
      latest_download_url: buildLatestPublicAgentPluginZipUrl(),
      vsix_url: buildPublicVsixUrl(version),
      latest_vsix_url: buildLatestPublicVsixUrl(),
    },
  };
}

function buildPluginManifest(version, paths = {}) {
  return {
    name: PLUGIN_NAME,
    version,
    description:
      'Gofer single-entry delivery command with internal pipeline routing for Claude, Gemini, Codex, Copilot, and VS Code.',
    author: {
      name: 'EAI Tools',
      url: REPOSITORY_URL,
    },
    homepage: REPOSITORY_URL,
    repository: REPOSITORY_URL,
    license: 'Apache-2.0',
    keywords: [
      'eai-gofer',
      'gofer',
      'claude-code',
      'codex',
      'copilot',
      'gemini',
      'spec-driven-development',
    ],
    skills: paths.skills ?? `./${UMBRELLA_SKILLS_DIR}/`,
    agents: paths.agents ?? './agents/',
    commands: paths.commands ?? './commands/',
  };
}

function buildClaudeManifest(version, paths = {}) {
  return {
    name: PLUGIN_NAME,
    version,
    description:
      'Gofer single-entry delivery command with internal pipeline routing.',
    author: {
      name: 'EAI Tools',
      url: REPOSITORY_URL,
    },
    homepage: REPOSITORY_URL,
    repository: REPOSITORY_URL,
    license: 'Apache-2.0',
    keywords: ['eai-gofer', 'gofer', 'claude-code', 'spec-driven-development'],
    skills: paths.skills ?? './skills/',
  };
}

function buildBundleMarketplace(version) {
  return {
    name: 'eai-gofer',
    owner: {
      name: 'EAI Tools',
      url: REPOSITORY_URL,
    },
    metadata: {
      description:
        'Public Gofer bundle for Claude Code, Gemini CLI, Codex, and Copilot workflows.',
      version,
    },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: './plugins/eai-gofer',
        description:
          'Gofer single-entry delivery command with internal pipeline routing.',
        version,
        author: {
          name: 'EAI Tools',
          url: REPOSITORY_URL,
        },
        homepage: REPOSITORY_URL,
        repository: REPOSITORY_URL,
        category: 'Coding',
        tags: [
          'eai-gofer',
          'gofer',
          'claude',
          'codex',
          'copilot',
          'gemini',
          'spec-driven-development',
        ],
      },
    ],
  };
}

function buildRepoMarketplace(version) {
  return {
    name: 'eai-gofer',
    owner: {
      name: 'EAI Tools',
      url: REPOSITORY_URL,
    },
    metadata: {
      description:
        'Install the Gofer repo marketplace for Claude Code, Gemini CLI, Codex, or Copilot CLI from the public GitHub repository.',
      version,
    },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: './plugins/eai-gofer',
        description:
          'Gofer single-entry delivery command with internal pipeline routing.',
        version,
        author: {
          name: 'EAI Tools',
          url: REPOSITORY_URL,
        },
        homepage: REPOSITORY_URL,
        repository: REPOSITORY_URL,
        license: 'Apache-2.0',
        category: 'Coding',
        tags: [
          'eai-gofer',
          'gofer',
          'claude',
          'codex',
          'copilot',
          'gemini',
          'spec-driven-development',
        ],
      },
    ],
  };
}

function buildRepoCodexMarketplace(version) {
  return {
    name: 'eai-gofer',
    interface: {
      displayName: 'Gofer',
    },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: {
          source: 'local',
          path: './plugins/eai-gofer',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Coding',
        version,
      },
    ],
  };
}

function buildBundleCodexMarketplace(version) {
  return {
    name: 'eai-gofer',
    interface: {
      displayName: 'Gofer',
    },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: {
          source: 'local',
          path: './plugins/eai-gofer',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Coding',
        version,
      },
    ],
  };
}

function buildAlwaysEaiSection() {
  return `## Always-On EAI Contract

Users usually start every request with \`/eai\`, \`$eai\`, \`#eai\`, or \`Get started with EAI\`. Treat that phrase as activation for this contract, not as business content.

1. Apply the Controlled English Contract to every Gofer-authored message and artifact.
2. Keep the reply short unless the user asks for detail.
3. Explain the business effect first.
4. Put technical evidence in durable artifacts.
5. Do not make the user choose pipeline stages. Select the next internal stage yourself.
6. When the user says Get started with EAI in a new app conversation, send the Required First-Run Response before any preflight, tool call, setup question, or stage routing.
7. Resume workspace preflight only after the user answers the first process question.`;
}

function buildUserFacingResponseGateSection() {
  return `## User-Facing Response Gate

Before each user-facing reply, check the draft against these rules:

1. Lead with the business outcome, effect, risk, or decision.
2. Use concise, simple language.
3. Include technical detail only when it supports a decision or the user asks for it.
4. If any check fails, rewrite the reply before sending it.`;
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

function buildLocalSettingsCleanupContract() {
  return `## Local Settings Cleanup Contract

After any Gofer install, update, release refresh, or workspace bootstrap:

1. Archive stale Gofer command and skill entries before continuing.
2. Prefer the repo helper:
   - \`node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
3. If the repo helper is missing, use the stable plugin bundle helper:
   - macOS/Linux: \`node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
   - Windows: \`node %USERPROFILE%\\plugins\\eai-gofer\\.specify\\scripts\\node\\gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
4. This cleanup covers old Claude, Codex, Copilot, Gemini, Grok, VS Code, desktop, and CLI command surfaces.
5. Do not remove the current public \`eai\` entrypoint.
6. Ask the user to refresh or restart the host command picker only after cleanup completes.`;
}

function buildAppPreviewRunnerContract() {
  return `## App Preview Runner Contract

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use \`./run.sh dev 3001\` on macOS, Linux, and GitHub Codespaces.
2. Use \`run.bat dev 3001\` on Windows.
3. Use a different port only when the feature notes record the reason.
4. The runner must stop any process on the selected port before it restarts the app.
5. Do not use direct \`npm run dev\`, \`next dev\`, or package-manager preview commands when \`run.sh\`, \`run.bat\`, or \`run.ps1\` exists.
6. After every UI-facing change, run:
   - \`node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"\`
7. On Windows, use:
   - \`node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"\`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.`;
}

function buildUmbrellaSkill(version, stages, entry = PUBLIC_ENTRYPOINTS[0]) {
  const stageList = stages
    .map((stage) => `- \`${stage.stem}\` - ${stage.frontmatter.description}`)
    .join('\n');

  return `---
name: ${entry.name}
description: "${entry.description}"
---

# ${entry.title}

Version: ${version}

Use this skill when the user says \`Get started with EAI\`, invokes the public EAI entrypoint, or asks EAI to guide application delivery.

## Clean Surface Contract

- User-facing command and skill pickers should expose only \`eai\`.
- Do not ask users to run numbered/helper stage commands such as \`/0_gofer_start\`, \`/1_gofer_research\`, or \`/6_gofer_validate\` unless they explicitly ask for low-level internals.
- Preserve all Gofer functions by routing internally through the stage contracts in \`.specify/commands/*.md\`.

## Workspace First

Before stage work, resolve the repository root and run \`node .specify/scripts/node/gofer-workspace-check.mjs --host auto --json\` when available. If the repo is missing or stale, ask before running \`node .specify/scripts/node/gofer-workspace-bootstrap.mjs --host auto --include-mirrors\`, then resume the original command.

${buildLocalSettingsCleanupContract()}

${buildAppPreviewRunnerContract()}

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

## Business-Friendly Progress

- Keep user-facing progress short and business-level by default.
- Explain what is being connected, changed, checked, or fixed and why it matters.
- Use \`.specify/specs/{feature}/build-map.md\` as the shared picture of the build when app delivery applies.
- Keep technical detail, logs, tests, and security evidence in artifacts; show deeper detail when the user asks.

## App vs Non-App Routing

- Classify each request before EAI readiness as EAI app delivery, non-application work, or ambiguous.
- If the request is EAI app delivery or ambiguous, continue directly into the EAI app delivery path and run EAI readiness.
- If the request is clearly non-app work, confirm once: **"This looks like non-app work, so I will skip EAI tenant/app setup and continue the Gofer research/docs path. Is that right?"**
- If the user confirms non-app, do not run \`eai whoami\`, tenant selection, \`eai init\`, or first-run setup. Record the decision and continue the appropriate non-app path.
- If the user says it is app work, switch to EAI app delivery and run EAI app preflight.

${buildJourneyStateSection()}

## First EAI Platform App

If the user is starting a first EAI Platform app, use the public \`eai\` entrypoint, then follow the first-run/setup contract in \`.specify/commands/gofer_eai_first_run.md\` when it is present. It is allowed before \`.specify/\` exists and checks Git, Node.js, npm, the scoped EAI registry, EAI CLI, login, tenant, \`eai init\`, and Gofer scaffold readiness with user approval gates.

## EAI CLI Discovery And Recovery

- Run \`eai whoami\` only for EAI app delivery work or explicit EAI CLI recovery, not for confirmed non-app research/docs/audit/planning.
- Run \`eai update --check\` before first EAI platform work when the CLI may be stale.
- Run \`eai --describe\` before assuming command syntax.
- If advertised, run \`eai agent guide --format json\` before planning or fixing EAI workflows.
- After any \`eai\` error, run \`eai errors explain <code-or-reason> --format json\` before guessing remediation.
- If \`eai errors explain\` is unavailable, match \`.specify/references/platform/eai-error-catalog.yaml\`, run read-only diagnostics before mutating fixes, and stop at the retry or escalation condition.
- For \`eai user invite\` 5xx or \`EXTERNAL_SERVICE_ERROR\`, check existing members with \`eai user list --tenant <tenant-id> --search <email> --format json\`; use \`eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json\` only after verification and user approval, then tell the app user to sign out and sign back in.
- Use \`eai publicapi\` only for authorized PublicAPI \`/v4/...\` routes.

${buildVerifiedEaiCliCommandContract()}

${buildEaiPlatformDecisionSection()}

## Token And Cost Policy

- Treat \`.specify/memory/gofer-model-policy.yaml\` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. Run the internal bootstrap contract if it is missing.
- Use the cheapest capable model first. Escalate only when a cheaper pass is low-confidence, contradictory, security-sensitive, release-critical, or blocking quality.
- Keep raw search, build, and test output out of the main chat context. Write stable findings to \`.specify/specs/{feature}/context-bundle.md\` and continue from summaries.
- Prefer provider prompt/context caching for stable non-secret prefixes: Gofer scaffold, repository instructions, constitution, repo map, stage contracts, and validation rubric.
- After large research, planning, implementation, or validation bursts, checkpoint artifacts and compact/clear/resume context when the host supports it.

## Internal Pipeline And Helper Contracts

${stageList}

## Stable Local Install Path

Install or update this plugin by replacing the stable local folder:

\`\`\`text
~/plugins/eai-gofer
\`\`\`

The public release feed is available at:

\`\`\`text
${PUBLIC_SITE_URL}/releases.json
\`\`\`

Gemini CLI users can also copy the bundled \`.gemini/\` directory into a repository root to activate the same public command set there.
`;
}

function withTenantContextErrorGuidance(content) {
  const guidance =
    '- For `MISSING_TENANT`, `app_token_tenant_context_required`, or "Tenant context required for app tokens" on platform user lookup or membership prerequisites, run `eai errors explain app_token_tenant_context_required --format json`, confirm tenant context, and retry `/v4/platform/tenants/<tenant-id>/...` routes before changing tenant members, Entra, role definitions, databases, or cloud portals.';

  if (content.includes('app_token_tenant_context_required')) {
    return content;
  }

  return content.replace(
    '- Use `eai publicapi` only for authorized PublicAPI `/v4/...` routes.',
    `${guidance}\n- Use \`eai publicapi\` only for authorized PublicAPI \`/v4/...\` routes.`
  );
}

function withEaiAppTemplateGate(content) {
  if (content.includes('## EAI App Template Gate')) return content;

  const guidance = `## EAI App Template Gate

- Before app research or source changes, run \`node .specify/scripts/node/eai-app-template-readiness.mjs --root . --json\` when available.
- A missing checker or any status other than \`ready\` is a hard stop for app delivery.
- Complete \`eai init\`, enter the created app folder, then rerun the checker, \`eai verify\`, and \`eai template check --format json\`.
- Do not accept copied marker files, partial scaffolds, or custom templates as readiness evidence.
- Confirmed non-app work is exempt.

`;

  return content.replace('## EAI CLI Discovery And Recovery', `${guidance}## EAI CLI Discovery And Recovery`);
}

function withFirstConversationGuidance(content) {
  if (content.includes('## First Conversation')) {
    return content;
  }
  const section = `## First Conversation

When this is the first EAI conversation for a new app:

1. Treat \`Get started with EAI\` as the first-run trigger. Ignore capitalization, punctuation, and decorative emoji around the phrase.
2. Show the following compact orientation once. Do not repeat it after onboarding starts or when existing feature state means the work should resume.

### Required First-Run Response

\`\`\`markdown
## Welcome to Enterprise AI 👋

I’ll help you improve a process and turn it into a secure enterprise application:

1. **Improve** — understand the opportunity and design the solution.
2. **Build** — prepare data, add AI, and connect systems.
3. **Test and deploy** — validate, launch, and share securely.
4. **Run and measure** — monitor results, costs, activity, and value.

The EAI Platform supports every step with secure data, identity, multi-tenancy, and AI models.

I’ll walk you through the whole process and ask short questions as we go. Tell me what you want me to do, or ask **“What’s next?”**, **“What else can you help with?”**, or **“Show me the admin screen.”**

**First question:** What process would you like to improve, or what would you like the application to help people do?
\`\`\`

3. After the first answer, ask one short question at a time about the users, current process, desired value, success measures, and material constraints.
4. Treat \`Show me the admin screen\` as a request for the relevant manual path. Use a verified link from repository or platform context when available. Never invent an admin URL.
5. Use the repository and EAI CLI as sources of truth. Run \`eai --describe\` before assuming command syntax and explain known errors before recovery.
6. Keep numbered Gofer stages internal. Say what is being learned, designed, built, or checked in business language.
7. Explain why specification-led delivery improves AI quality when relevant: it creates a shared, testable outcome before code changes multiply.
8. Pause once for approval of the business specification. After approval, continue automatically unless a material business, security, cost, deployment, or destructive decision needs approval.
9. Do not create a GitHub repository, deploy, publish, spend money, or change external systems without the relevant user approval.`;
  return content.replace('## EAI CLI Discovery And Recovery', `${section}\n\n## EAI CLI Discovery And Recovery`);
}

function buildWorkspacePreflightSection() {
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
   - \`.specify/scripts/node/gofer-local-settings-cleanup.mjs\`
   - \`.specify/scripts/node/gofer-ui-preview.mjs\`
   - \`.specify/scripts/node/gofer-workspace-check.mjs\`
   - \`.specify/scripts/node/gofer-workspace-bootstrap.mjs\`
   - \`.specify/specs/\`
   - \`.specify/memory/\`
3. If the repo has the workspace checker script, prefer running:
   - \`node .specify/scripts/node/gofer-workspace-check.mjs --host auto --json\`
4. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
5. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
6. After a Gofer install, update, or bootstrap, remove stale local Gofer command entries with:
   - \`node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json\`
7. For EAI app delivery, use the repo runner for local previews:
   - macOS, Linux, and GitHub Codespaces: \`./run.sh dev 3001\`
   - Windows: \`run.bat dev 3001\`
8. Do not start app previews with direct \`npm run dev\` commands when the repo runner exists.
9. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.
`.trim();
}

function buildBusinessProgressContractSection() {
  return `
## Business-Friendly Progress Contract

- Keep user-facing updates concise and business-level by default.
- Use ASD-STE100 Simplified Technical English as the target writing standard for all Gofer-authored chat, documents, commands, summaries, PR notes, error guidance, and validation artifacts.
- Do not bundle the protected ASD dictionary and do not claim ASD certification.
- Use one action per instruction and keep instructions to 20 words or fewer where possible.
- Use active voice, simple verb forms, approved project terms, and defined acronyms.
- Avoid idioms, marketing adjectives, vague praise, and hedging.
- Explain what is being connected, changed, checked, or fixed and why it matters.
- For application delivery, create or update \`.specify/specs/{feature}/build-map.md\` from \`.specify/templates/build-map-template.md\` and refer to that map in progress updates.
- Keep technical detail, logs, tests, and security evidence in durable artifacts; provide that detail when the user asks.
- Before each user-facing reply, check the business effect, language, and useful technical detail. If any check fails, rewrite the reply before sending it.
`.trim();
}

function injectBusinessProgressContract(body) {
  if (body.includes('## Business-Friendly Progress Contract')) {
    return body;
  }

  const headingIndex = body.indexOf('## Workspace Preflight');
  if (headingIndex !== -1) {
    const nextHeading = body.indexOf('\n## ', headingIndex + 1);
    if (nextHeading !== -1) {
      return `${body.slice(0, nextHeading).trimEnd()}\n\n${buildBusinessProgressContractSection()}\n\n${body
        .slice(nextHeading)
        .replace(/^\n+/, '')}`;
    }
  }

  const headingMatch = body.match(/^# [^\n]+\n*/);
  if (!headingMatch) {
    return `${buildBusinessProgressContractSection()}\n\n${body}`;
  }

  const insertAt = headingMatch[0].length;
  return `${body.slice(0, insertAt).trimEnd()}\n\n${buildBusinessProgressContractSection()}\n\n${body
    .slice(insertAt)
    .replace(/^\n+/, '')}`;
}

function injectWorkspacePreflight(stage, body) {
  if (WORKSPACE_PREFLIGHT_EXCLUDED_COMMANDS.has(String(stage.frontmatter.name))) {
    return injectBusinessProgressContract(body);
  }
  if (body.includes('## Workspace Preflight')) {
    return injectBusinessProgressContract(body);
  }

  const headingMatch = body.match(/^# [^\n]+\n*/);
  if (!headingMatch) {
    return injectBusinessProgressContract(`${buildWorkspacePreflightSection()}\n\n${body}`);
  }

  const insertAt = headingMatch[0].length;
  return injectBusinessProgressContract(
    `${body.slice(0, insertAt).trimEnd()}\n\n${buildWorkspacePreflightSection()}\n\n${body
      .slice(insertAt)
      .replace(/^\n+/, '')}`
  );
}

function buildStageSkill(stage) {
  const body = injectWorkspacePreflight(stage, stage.body.trim());
  return `---\nname: ${stage.frontmatter.name}\ndescription: ${yamlString(stage.frontmatter.description)}\n---\n\n${body}\n`;
}

function buildPluginReadmeBase(version) {
  return `# Gofer Agent Plugin

Version: ${version}

This package is the portable Claude, Gemini, Codex, and Copilot workflow layer for Gofer. It is released beside the VS Code extension, but it does not replace the VSIX UI, status views, updater, or language-server features.

## Public Sources

Use the public GitHub repository as the install source for Claude Code, Codex, Copilot CLI, and Gemini CLI:

\`\`\`text
${REPOSITORY_URL}
\`\`\`

Use the public release host for downloadable artifacts:

\`\`\`text
${PUBLIC_RELEASES_URL}
\`\`\`

That host publishes:

- Latest VS Code extension: \`${buildLatestPublicVsixUrl()}\`
- Latest agent bundle zip: \`${buildLatestPublicAgentPluginZipUrl()}\`
- This release VS Code extension: \`${buildPublicVsixUrl(version)}\`
- This release agent bundle zip: \`${buildPublicAgentPluginZipUrl(version)}\`
- Claude marketplace manifest: \`${CLAUDE_MARKETPLACE_URL}\`
- Codex manifest: \`${CODEX_PLUGIN_MANIFEST_URL}\`
- Copilot marketplace manifest: \`${COPILOT_MARKETPLACE_URL}\`
- Gemini extension manifest: \`${GEMINI_EXTENSION_URL}\`

## First EAI Platform App

Start with \`/eai\`, \`#eai\`, or \`$eai\` depending on the host. Gofer first classifies the request. If it is EAI app delivery or ambiguous, Gofer continues directly to EAI readiness and routes internally to the first-run setup contract when a new user, machine, repo, tenant, or EAI app template is not ready. If it is clearly non-app work, Gofer asks once before skipping EAI tenant/app setup and continuing the relevant research, documentation, audit, migration, or planning path. The setup path is allowed before \`.specify/\` exists. It checks Git, Node.js, npm, EAI CLI, registry, \`eai update --check\`, \`eai --describe\`, \`eai agent guide --format json\` when advertised, login, tenant, \`eai init <project-name> --skip-prompts --company-tenant <active-tenant-id>\`, Gofer scaffold readiness, and \`eai errors explain <code-or-reason> --format json\` for recovery across macOS, Linux, Windows, and GitHub Codespaces.

Gofer does not invent EAI CLI commands. It verifies command paths and flags with \`eai --describe\` and command-specific \`--help\` before suggesting or running them. If the installed CLI does not list a command, Gofer does not run it.

For EAI errors, Gofer expects agents to run live EAI guidance first, use \`.specify/references/platform/eai-error-catalog.yaml\` as fallback, run read-only diagnostics before mutating fixes, and stop at the retry/escalation condition. For \`eai user invite\` 5xx or \`EXTERNAL_SERVICE_ERROR\`, check existing members with \`eai user list --tenant <tenant-id> --search <email> --format json\`; use \`eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json\` only after verification and user approval. For \`MISSING_TENANT\`, \`app_token_tenant_context_required\`, or "Tenant context required for app tokens" on platform user lookup or membership prerequisites, run \`eai errors explain app_token_tenant_context_required --format json\`, confirm tenant context, and retry \`/v4/platform/tenants/<tenant-id>/...\` routes before changing tenant members, Entra, role definitions, databases, or cloud portals.

If \`/eai\` is unknown in a new repo, install or update this plugin first, then refresh/restart the host command picker.

## App-Native Surfaces And Repo Scripts

Gofer keeps repo-owned scripts and canonical command files as the source of truth. App plugins, skills, agents, and MCP tools are thin entry points that call or explain those repo scripts.

| Surface | Best entry point | Repo-owned files used |
| ------- | ---------------- | --------------------- |
| Codex App / Codex IDE | \`eai\` plugin skill when a workspace is open | \`AGENTS.md\`, \`.agents/skills/\`, \`.specify/scripts/\`, \`.vscode/mcp.json\` |
| GitHub Copilot app / VS Code agent mode | \`#eai\`, plus custom Gofer agents where supported | \`.github/agents/\`, \`.github/skills/\`, \`.github/prompts/\`, \`.github/instructions/\`, \`.vscode/mcp.json\` |
| Claude Code app | \`/eai\` plugin/repo command | \`.claude/skills/\`, \`.claude/commands/\`, \`.claude/agents/\`, \`.specify/scripts/\` |
| Gemini CLI / Gemini Code Assist | \`/eai\` Gemini extension command | \`.gemini/\`, \`.specify/scripts/\`, \`.vscode/mcp.json\` |
| Grok Build | Ask Grok to use the EAI skill | \`.grok/skills/\`, \`.specify/scripts/\` |

The clean UX rule is: users see only \`eai\`; Gofer keeps numbered stages and helpers as internal contracts under \`.specify/commands/\`.

## Update Cleanup

After each install or update, archive stale Gofer commands and settings:

\`\`\`bash
node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json
\`\`\`

If the repo helper is not present yet, run the helper from the stable plugin bundle:

\`\`\`bash
node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json
\`\`\`

Windows:

\`\`\`bat
node %USERPROFILE%\\plugins\\eai-gofer\\.specify\\scripts\\node\\gofer-local-settings-cleanup.mjs --workspace . --apply --json
\`\`\`

Then refresh or restart the host command picker.

## Local App Preview Runner

For EAI app delivery, start previews through the repo runner:

\`\`\`bash
./run.sh dev 3001
\`\`\`

Windows:

\`\`\`bat
run.bat dev 3001
\`\`\`

The runner stops any process on the selected port before it restarts the app.
Agents should not use direct \`npm run dev\` commands when the runner exists.

## Core Pipeline

| Stage | Internal contract | Main output |
| ----- | ------- | ----------- |
| Gofer Start | \`.specify/commands/0_gofer_start.md\` | Full pipeline kickoff |
| Research | \`.specify/commands/1_gofer_research.md\` | \`research.md\` |
| Specify | \`.specify/commands/2_gofer_specify.md\` | \`spec.md\` |
| Plan | \`.specify/commands/3_gofer_plan.md\` | \`plan.md\`, \`data-model.md\`, \`contracts/\` |
| Tasks | \`.specify/commands/4_gofer_tasks.md\` | \`tasks.md\`, \`traceability.md\`, \`issues.md\` |
| Implement | \`.specify/commands/5_gofer_implement.md\` | Code and doc changes |
| Validate | \`.specify/commands/6_gofer_validate.md\` | Validation artifacts and final review evidence |

The internal validation contract is the terminal quality gate. It includes the final engineering review loop and replaces the old standalone review stage in the core pipeline.

Optional helpers like problem validation, save, branding, tests, stakeholder comms, workspace checks, bootstrap, and EAI first-run remain available as internal contracts and can be routed by \`gofer\` when needed.

## Distribution Modes

| Surface | Public install / update path | Stable local path |
| ------- | ---------------------------- | ----------------- |
| Claude Code | \`claude plugin marketplace add ${REPOSITORY_URL} --scope user --sparse .claude-plugin --sparse plugins/eai-gofer\` then \`claude plugin install eai-gofer@eai-gofer --scope user\` | Unzip to \`~/plugins/eai-gofer\`, then \`claude plugin marketplace add ~/plugins/eai-gofer --scope user\` |
| Codex | \`codex plugin marketplace add ${REPOSITORY_URL} --sparse .agents/plugins --sparse plugins/eai-gofer\` then \`codex plugin add eai-gofer@eai-gofer\` | Unzip to \`~/plugins/eai-gofer\`, then \`codex plugin marketplace add ~/plugins/eai-gofer\` |
| GitHub Copilot CLI | \`copilot plugin marketplace add ${REPOSITORY_URL}\` then \`copilot plugin install eai-gofer@eai-gofer\` | Unzip to \`~/plugins/eai-gofer\`, then \`copilot plugin marketplace add ~/plugins/eai-gofer\` |
| Gemini CLI | \`gemini extensions install ${REPOSITORY_URL} --auto-update\` | Unzip to \`~/plugins/eai-gofer\`, then \`gemini extensions install ~/plugins/eai-gofer\` |

## Download And Replace The Local Bundle Folder

Keep the downloaded bundle path stable:

\`\`\`text
~/plugins/eai-gofer
\`\`\`

Download the public release asset, remove the old folder, unzip the package into \`~/plugins\`.

\`\`\`bash
curl -fsSL ${buildLatestPublicAgentPluginZipUrl()} -o /tmp/eai-gofer-agent-plugin-latest.zip

rm -rf ~/plugins/eai-gofer
unzip /tmp/eai-gofer-agent-plugin-latest.zip -d ~/plugins
node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json
\`\`\`

Windows PowerShell:

\`\`\`powershell
Invoke-WebRequest ${buildLatestPublicAgentPluginZipUrl()} -OutFile "$env:TEMP\\eai-gofer-agent-plugin-latest.zip"

Remove-Item "$env:USERPROFILE\\plugins\\eai-gofer" -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive "$env:TEMP\\eai-gofer-agent-plugin-latest.zip" "$env:USERPROFILE\\plugins" -Force
node "$env:USERPROFILE\\plugins\\eai-gofer\\.specify\\scripts\\node\\gofer-local-settings-cleanup.mjs" --workspace . --apply --json
\`\`\`

## Claude Code

Recommended public install:

\`\`\`bash
claude plugin marketplace add ${REPOSITORY_URL} --scope user --sparse .claude-plugin --sparse plugins/eai-gofer
claude plugin install eai-gofer@eai-gofer --scope user
\`\`\`

Downloaded bundle install:

\`\`\`bash
claude plugin marketplace add ~/plugins/eai-gofer --scope user
claude plugin install eai-gofer@eai-gofer --scope user
\`\`\`

## Codex

Recommended public install:

\`\`\`bash
codex plugin marketplace add ${REPOSITORY_URL} --sparse .agents/plugins --sparse plugins/eai-gofer
codex plugin add eai-gofer@eai-gofer
\`\`\`

Downloaded bundle install:

\`\`\`bash
codex plugin marketplace add ~/plugins/eai-gofer
codex plugin add eai-gofer@eai-gofer
\`\`\`

The Codex plugin exposes only \`eai\` as the user-facing skill. The numbered stage contracts remain bundled under \`.specify/commands/\` so the public skill can route through the full pipeline without cluttering the picker.

## Copilot CLI

Recommended public install:

\`\`\`bash
copilot plugin marketplace add ${REPOSITORY_URL}
copilot plugin install eai-gofer@eai-gofer
\`\`\`

Downloaded bundle install:

\`\`\`bash
copilot plugin marketplace add ~/plugins/eai-gofer
copilot plugin install eai-gofer@eai-gofer
\`\`\`

## Gemini CLI

Recommended public install:

\`\`\`bash
gemini extensions install ${REPOSITORY_URL} --auto-update
\`\`\`

Downloaded bundle install:

\`\`\`bash
gemini extensions install ~/plugins/eai-gofer
\`\`\`
`;
}

function buildPluginReadme(version) {
  return `${buildPluginReadmeBase(version).trimEnd()}

## Model Policy

After bootstrap, each repository gets a user-owned model policy at:

\`\`\`text
.specify/memory/gofer-model-policy.yaml
\`\`\`

The shipped default is copied from \`.specify/templates/gofer-model-policy.yaml\`
and is not overwritten by bootstrap. Use it to tune simple, medium, hard, and
arbiter model routes for Claude, Codex/OpenAI, Gemini, and Copilot. Copilot
defaults to \`Auto\` for simple/default work because exact model availability is
controlled by the Copilot client, plan, and organization policy.
`;
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function copyIfExists(root, relativePath, pluginRoot) {
  const source = path.join(root, relativePath);
  const target = path.join(pluginRoot, relativePath);
  try {
    await fs.cp(source, target, { recursive: true, force: true, dereference: false });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function copyIfExistsAs(root, sourceRelativePath, targetRelativePath, pluginRoot) {
  const source = path.join(root, sourceRelativePath);
  const target = path.join(pluginRoot, targetRelativePath);
  try {
    await fs.cp(source, target, { recursive: true, force: true, dereference: false });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function copyPluginAssets(root, pluginRoot) {
  const source = path.join(root, PLUGIN_ICON_SOURCE);
  const target = path.join(pluginRoot, PLUGIN_ICON_TARGET);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function walkFiles(root) {
  const files = [];

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await visit(root);
  return files;
}

async function walkRelativePaths(root) {
  const relativePaths = [];

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      relativePaths.push(path.relative(root, fullPath).split(path.sep).join('/'));
      if (entry.isDirectory()) {
        await visit(fullPath);
      }
    }
  }

  await visit(root);
  return relativePaths;
}

function describeWindowsUnsafePath(relativePath) {
  if (relativePath.length > WINDOWS_SAFE_RELATIVE_PATH_LIMIT) {
    return `longer than ${WINDOWS_SAFE_RELATIVE_PATH_LIMIT} characters`;
  }

  const segments = relativePath.split('/').filter(Boolean);
  for (const segment of segments) {
    if (hasWindowsForbiddenSegmentChar(segment)) {
      return `segment "${segment}" contains a Windows-forbidden character`;
    }
    if (/[ .]$/.test(segment)) {
      return `segment "${segment}" ends with a dot or space`;
    }
    if (WINDOWS_RESERVED_BASENAME.test(segment)) {
      return `segment "${segment}" is a Windows reserved device name`;
    }
  }

  return null;
}

function hasWindowsForbiddenSegmentChar(segment) {
  for (const char of segment) {
    if (WINDOWS_FORBIDDEN_SEGMENT_CHARS.has(char) || char.charCodeAt(0) < 32) {
      return true;
    }
  }

  return false;
}

async function assertWindowsPortablePaths(pluginRoot) {
  const offenders = [];
  for (const relativePath of await walkRelativePaths(pluginRoot)) {
    const reason = describeWindowsUnsafePath(relativePath);
    if (reason) {
      offenders.push(`${relativePath} (${reason})`);
    }
  }

  if (offenders.length > 0) {
    throw new Error(`Plugin package contains Windows-unsafe paths: ${offenders.join(', ')}`);
  }
}

async function assertNoPersonalPaths(pluginRoot) {
  const files = await walkFiles(pluginRoot);
  const offenders = [];
  for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }

    if (PERSONAL_PATH_PATTERN.test(content)) {
      offenders.push(path.relative(pluginRoot, file));
    }
  }

  if (offenders.length > 0) {
    throw new Error(`Plugin package contains personal absolute paths: ${offenders.join(', ')}`);
  }
}

async function writePluginFolder(pluginRoot, root, version, stages) {
  await fs.rm(pluginRoot, { recursive: true, force: true });
  await fs.mkdir(pluginRoot, { recursive: true });

  const pluginManifest = buildPluginManifest(version);
  const claudeManifest = buildClaudeManifest(version);
  const codexManifest = buildCodexManifest(version, stages);
  const geminiManifest = buildGeminiManifest(version);
  const bundleMarketplace = buildBundleMarketplace(version);

  await writeJson(path.join(pluginRoot, 'plugin.json'), pluginManifest);
  await writeJson(path.join(pluginRoot, '.github', 'plugin', 'plugin.json'), pluginManifest);
  await writeJson(
    path.join(pluginRoot, '.github', 'plugin', 'marketplace.json'),
    bundleMarketplace
  );
  await writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), codexManifest);
  await writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), claudeManifest);
  await writeJson(path.join(pluginRoot, '.claude-plugin', 'marketplace.json'), bundleMarketplace);
  await writeJson(path.join(pluginRoot, '.gemini', 'extension.json'), geminiManifest);
  await writeJson(path.join(pluginRoot, 'gemini-extension.json'), geminiManifest);
  await writeJson(
    path.join(pluginRoot, '.agents', 'plugins', 'marketplace.json'),
    buildBundleCodexMarketplace(version)
  );

  for (const entry of PUBLIC_ENTRYPOINTS) {
    const skill = withFirstConversationGuidance(
      withEaiAppTemplateGate(withTenantContextErrorGuidance(buildUmbrellaSkill(version, stages, entry)))
    );
    await writeText(path.join(pluginRoot, 'skills', entry.stem, 'SKILL.md'), skill);
    await writeText(path.join(pluginRoot, UMBRELLA_SKILLS_DIR, entry.stem, 'SKILL.md'), skill);
  }
  await copyIfExistsAs(
    root,
    '.claude/skills/gofer-documentation',
    path.join(UMBRELLA_SKILLS_DIR, 'gofer-documentation'),
    pluginRoot
  );

  await writeText(path.join(pluginRoot, 'README.md'), buildPluginReadme(version));
  await writeText(path.join(pluginRoot, '.eai-gofer-plugin-version'), `${version}\n${GENERATED_MARKER}\n`);

  const copiedResources = [
    '.specify/commands',
    '.specify/config',
    '.specify/contracts',
    '.specify/references',
    '.specify/schemas',
    '.specify/templates',
    '.specify/scripts/bash',
    '.specify/scripts/node',
    '.specify/scripts/hooks',
    '.specify/scripts/powershell',
    '.github/prompts',
    '.github/agents',
    '.github/skills',
    '.claude/skills',
    '.gemini',
    '.vscode/mcp.json',
    'AGENTS.md',
    'LICENSE',
    'NOTICE',
    'TRADEMARKS.md',
    'codex-config.toml',
  ];
  for (const relativePath of copiedResources) {
    await copyIfExists(root, relativePath, pluginRoot);
  }
  await writeJson(path.join(pluginRoot, '.gemini', 'extension.json'), geminiManifest);
  await copyIfExistsAs(root, '.claude/commands', 'commands', pluginRoot);
  await copyIfExistsAs(root, '.claude/agents', 'agents', pluginRoot);
  await copyPluginAssets(root, pluginRoot);

  const nestedPluginRoot = path.join(pluginRoot, 'plugins', PLUGIN_NAME);
  await fs.rm(nestedPluginRoot, { recursive: true, force: true });
  await fs.mkdir(nestedPluginRoot, { recursive: true });
  for (const entry of await fs.readdir(pluginRoot)) {
    if (entry === 'plugins') {
      continue;
    }

    const source = path.join(pluginRoot, entry);
    const target = path.join(nestedPluginRoot, entry);
    await fs.cp(source, target, { recursive: true, force: true, dereference: false });
  }
}

async function syncRepoManifests(root, version, stages, stagedPluginRoot) {
  await writeJson(
    path.join(root, '.codex-plugin', 'plugin.json'),
    buildCodexManifest(version, stages, {
      skills: './skills/',
      icon: './assets/eai-gofer-icon.png',
    })
  );
  await writeJson(
    path.join(root, 'plugin.json'),
    buildPluginManifest(version, {
      skills: `./${UMBRELLA_SKILLS_DIR}/`,
      agents: './.claude/agents/',
      commands: './.claude/commands/',
    })
  );
  await writeJson(
    path.join(root, '.github', 'plugin', 'plugin.json'),
    buildPluginManifest(version, {
      skills: `./${UMBRELLA_SKILLS_DIR}/`,
      agents: './.claude/agents/',
      commands: './.claude/commands/',
    })
  );
  await writeJson(path.join(root, '.github', 'plugin', 'marketplace.json'), buildRepoMarketplace(version));
  await writeJson(
    path.join(root, '.agents', 'plugins', 'marketplace.json'),
    buildRepoCodexMarketplace(version)
  );
  await writeJson(
    path.join(root, '.claude-plugin', 'plugin.json'),
    buildClaudeManifest(version, {
      skills: `./${UMBRELLA_SKILLS_DIR}/`,
    })
  );
  await writeJson(path.join(root, '.claude-plugin', 'marketplace.json'), buildRepoMarketplace(version));
  await writeJson(path.join(root, '.gemini', 'extension.json'), buildGeminiManifest(version));
  await writeJson(path.join(root, 'gemini-extension.json'), buildGeminiManifest(version));
  await fs.rm(path.join(root, UMBRELLA_SKILLS_DIR, 'eai-gofer'), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(root, UMBRELLA_SKILLS_DIR, 'gofer'), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(root, 'skills', 'eai-gofer'), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(root, 'skills', 'gofer'), {
    recursive: true,
    force: true,
  });
  const rootUmbrellaSkill = withFirstConversationGuidance(
    withEaiAppTemplateGate(
      withTenantContextErrorGuidance(buildUmbrellaSkill(version, stages, PUBLIC_ENTRYPOINTS[0]))
    )
  );
  await writeText(
    path.join(root, UMBRELLA_SKILLS_DIR, 'eai', 'SKILL.md'),
    rootUmbrellaSkill
  );
  await writeText(
    path.join(root, 'skills', 'eai', 'SKILL.md'),
    rootUmbrellaSkill
  );

  const iconSource = path.join(root, PLUGIN_ICON_SOURCE);
  const iconTarget = path.join(root, PLUGIN_ICON_TARGET);
  await fs.mkdir(path.dirname(iconTarget), { recursive: true });
  await fs.copyFile(iconSource, iconTarget);

  const repoPluginDir = path.join(root, 'plugins', PLUGIN_NAME);
  await fs.rm(repoPluginDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(repoPluginDir), { recursive: true });
  await fs.cp(stagedPluginRoot, repoPluginDir, { recursive: true, force: true, dereference: false });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const root = path.resolve(args.root);
  const extensionPackage = await readJson(path.join(root, 'extension', 'package.json'));
  const version = args.version ?? extensionPackage.version;
  assertSemver(version);

  const stages = await loadStages(root);
  const outDir = path.resolve(root, args.outDir);
  const packageName = `eai-gofer-agent-plugin-${version}`;
  const stageParent = path.join(outDir, packageName);
  const pluginRoot = path.join(stageParent, PLUGIN_NAME);
  const zipPath = path.join(outDir, `${packageName}.zip`);

  await fs.rm(stageParent, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  await writePluginFolder(pluginRoot, root, version, stages);
  await assertWindowsPortablePaths(pluginRoot);
  await assertNoPersonalPaths(pluginRoot);
  await execFileAsync('zip', ['-qr', zipPath, PLUGIN_NAME], { cwd: stageParent });

  if (args.syncRepo) {
    await syncRepoManifests(root, version, stages, pluginRoot);
  }

  console.log(`plugin: staged ${pluginRoot}`);
  console.log(`plugin: wrote ${zipPath}`);
  if (args.syncRepo) {
    console.log(`plugin: synced ${path.join(root, 'plugins', PLUGIN_NAME)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
