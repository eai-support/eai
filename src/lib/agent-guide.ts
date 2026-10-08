export interface AgentGuideCommand {
  command: string;
  mutates: boolean;
  purpose: string;
  when?: string;
}

export interface AgentGuideStep {
  step: number;
  title: string;
  instruction: string;
  commands?: AgentGuideCommand[];
}

export interface AgentGuide {
  schemaVersion: 1;
  audience: 'ai-agents';
  purpose: string;
  capabilities: string[];
  firstCommands: AgentGuideCommand[];
  operatingRules: string[];
  recoveryLoop: AgentGuideStep[];
  commonWorkflows: AgentGuideStep[];
  stopConditions: string[];
}

const guide: AgentGuide = {
  schemaVersion: 1,
  audience: 'ai-agents',
  purpose: 'Help an AI agent discover EAI CLI capabilities, prefer structured output, and recover from known errors without private platform knowledge.',
  capabilities: ['app-manifest-name-slug-negotiation-v1'],
  firstCommands: [
    {
      command: 'eai --describe',
      mutates: false,
      purpose: 'Discover commands, options, and the built-in agent operating guide.',
    },
    {
      command: 'eai agent guide --format json',
      mutates: false,
      purpose: 'Read the agent operating guide directly as JSON.',
    },
    {
      command: 'eai update --check',
      mutates: false,
      purpose: 'Check whether the installed CLI, Gofer assets, or app-template snapshot need attention.',
    },
    {
      command: 'eai whoami',
      mutates: false,
      purpose: 'Check login status and active workspace before workspace-scoped operations.',
    },
  ],
  operatingRules: [
    'Prefer commands that advertise --format json in eai --describe or command help.',
    'Run read-only diagnostics before mutating fixes.',
    'Use named eai commands before calling eai publicapi directly.',
    'Before Object Type publication, require app-manifest-name-slug-negotiation-v1. The CLI preserves source slugs and selects a safe deployed request shape. A dry-run preferred shape does not prove that the deployed platform accepts that shape.',
    'When calling eai publicapi directly, only use /v4 paths.',
    'If a platform user lookup or membership prerequisite returns MISSING_TENANT or "Tenant context required for app tokens", run eai errors explain app_token_tenant_context_required --format json and retry through /v4/platform/tenants/<tenant-id>/... routes before changing workspace members, Entra, or role definitions.',
    'For normal workspace user/admin addition, use eai user invite --email <email> --workspace <workspace-id> --role <role>; use workspace bootstrap-admin only for first-admin repair on an immediate child workspace.',
    'If user invite fails with a 5xx or EXTERNAL_SERVICE_ERROR, run eai errors explain user_invite_external_service_existing_member --format json, check for an existing member with eai user list, and only then use eai user role set by member ID when approved.',
    'For files, use eai docs when the file is a document to process, classify, index, or expose to AI context. Use eai resources file only when the file is attached to a typed resource object file property.',
    'Do not invent standalone PublicAPI v4 blob-upload flows. Ask whether the user needs a document workflow or a resource file property.',
    'Use eai workspace bootstrap-admin only for first-admin repair on an immediate child workspace.',
    'Do not loop indefinitely; follow retry and stop conditions from eai errors explain.',
    'For unresolved EAI errors or a request to get help, preview a locally redacted report with eai support --source harness --tool <current-tool> --format json. Show the bundle summary and ask the person for explicit consent.',
    'Only after the person approves that bundle, repeat the support command with --yes --no-open and give them the returned Support link. Ask for fresh consent if the bundle changes. Never send the report directly to an API, assume consent, or paste secrets into the chat.',
    'Do not expose tokens, secrets, local env files, workspace identifiers, or request IDs unless the user explicitly asks to collect escalation evidence.',
  ],
  recoveryLoop: [
    {
      step: 1,
      title: 'Capture the failure',
      instruction: 'Read the exit code, stderr, stdout, and any EAI error code such as E101 or reasonCode such as not_logged_in.',
    },
    {
      step: 2,
      title: 'Explain the error',
      instruction: 'If an EAI code or reasonCode is present, query the release-aligned guidance catalog.',
      commands: [
        {
          command: 'eai errors explain <code-or-reason> --format json',
          mutates: false,
          purpose: 'Return structured why, diagnostics, fixes, retry guidance, and stop conditions.',
        },
      ],
    },
    {
      step: 3,
      title: 'Run diagnostics first',
      instruction: 'Execute only read-only diagnostic commands from the guidance entry before changing state.',
      commands: [
        {
          command: 'eai whoami',
          mutates: false,
          purpose: 'Check login and selected workspace.',
        },
        {
          command: 'eai verify calls --format json',
          mutates: false,
          purpose: 'Check platform-facing API contracts used by the CLI.',
        },
        {
          command: 'eai doctor --check-updates',
          mutates: false,
          purpose: 'Check CLI, Gofer, and template drift without changing files.',
        },
      ],
    },
    {
      step: 4,
      title: 'Apply listed fixes only',
      instruction: 'Apply each listed fix once when it fits the current project state and its approval requirements are met. Run mutating commands only when the guidance lists them.',
    },
    {
      step: 5,
      title: 'Verify and stop',
      instruction: 'Re-run the failed command or a read-only verification command. Stop remediation when guidance stop conditions match or the same failure repeats after the listed retry limit, then offer the support preview.',
    },
    {
      step: 6,
      title: 'Prepare support with consent',
      instruction: 'If the failure remains unresolved, show the locally redacted bundle summary and ask for explicit consent. Send only the approved bundle through eai support, then give the person its link. If the session is unavailable, give the plain Support link. Report text never goes in the URL; only the draft id and one-time token appear in its fragment.',
      commands: [
        {
          command: 'eai support --source harness --tool <current-tool> --format json',
          mutates: false,
          purpose: 'Preview the redacted report without sending it; use codex, claude, vscode, grok, or antigravity for the current tool.',
        },
        {
          command: 'eai support --source harness --tool <current-tool> --format json --yes --no-open',
          mutates: true,
          purpose: 'Create the draft only after the person explicitly approves the previewed bundle.',
          when: 'The person approved this exact bundle; repeat the preview and consent if any report fields changed.',
        },
      ],
    },
  ],
  commonWorkflows: [
    {
      step: 1,
      title: 'New project',
      instruction: 'Initialize, authenticate, provision app auth, seed types, then start development.',
      commands: [
        { command: 'eai init', mutates: true, purpose: 'Scaffold a new app.' },
        { command: 'eai login', mutates: true, purpose: 'Authenticate with the EAI identity flow.' },
        { command: 'eai provision entra', mutates: true, purpose: 'Provision app sign-in configuration.' },
        { command: 'eai types seed', mutates: true, purpose: 'Publish object types for the selected workspace.' },
        { command: 'eai dev', mutates: true, purpose: 'Start local development.' },
      ],
    },
    {
      step: 2,
      title: 'Existing project health',
      instruction: 'Check login, workspace, CLI release, project assets, and platform-facing contracts.',
      commands: [
        { command: 'eai whoami', mutates: false, purpose: 'Show current user and workspace context.' },
        { command: 'eai update --check', mutates: false, purpose: 'Check CLI release plus Gofer/template currency.' },
        { command: 'eai doctor --check-updates', mutates: false, purpose: 'Check CLI, Gofer, and template drift.' },
        { command: 'eai verify calls --format json', mutates: false, purpose: 'Audit platform-facing contracts.' },
      ],
    },
    {
      step: 3,
      title: 'Type and resource readiness',
      instruction: 'Validate local type definitions, compare with the selected workspace, and seed only when needed.',
      commands: [
        { command: 'eai types validate', mutates: false, purpose: 'Validate local object type files.' },
        { command: 'eai types diff', mutates: false, purpose: 'Compare local and published object types.' },
        { command: 'eai types seed', mutates: true, purpose: 'Publish object types when validation and diff show it is needed.' },
        { command: 'eai resources schema --format json', mutates: false, purpose: 'Inspect published resource schema.' },
      ],
    },
    {
      step: 4,
      title: 'Workspace member management',
      instruction: 'List available roles, invite or refresh the user by email with the intended role, and verify membership. This is the correct path for "add this person as workspace admin/member" requests. If prerequisite platform user lookups fail with MISSING_TENANT, first confirm workspace-scoped /v4/platform/tenants/<tenant-id>/... routes and deployed API versions.',
      commands: [
        { command: 'eai user roles --workspace <workspace-id> --format json', mutates: false, purpose: 'Discover assignable workspace roles before choosing a role.' },
        { command: 'eai user invite --email <email> --workspace <workspace-id> --role tenant-admin --format json', mutates: true, purpose: 'Add or refresh a user membership and assign workspace admin access (platform role ID tenant-admin).' },
        { command: 'eai user list --workspace <workspace-id> --search <email> --format json', mutates: false, purpose: 'Verify the user membership and role after invite.' },
        { command: 'eai user role set --workspace <workspace-id> --member-id <member-id> --role tenant-admin --format json', mutates: true, purpose: 'Repair workspace admin access for an existing direct member after verifying the member ID.' },
      ],
    },
    {
      step: 5,
      title: 'Documents, files, and AI context',
      instruction: 'Choose the public v4 file model before writing code. Use document workflow commands for upload, classification, and RAG; use resource file commands for attachments to typed business records.',
      commands: [
        { command: 'eai docs upload <file>', mutates: true, purpose: 'Submit once for full processing with authorised app/workflow or project context; poll the returned job.' },
        { command: 'eai docs classify <file>', mutates: true, purpose: 'Submit once for classification with paired --vertical-key and --workflow-key or authorised project context; do not upload the file first.' },
        { command: 'eai docs index <document-id>', mutates: true, purpose: 'Index a document so AI/RAG workflows can answer from it.' },
        { command: 'eai resources file upload <type> <id> <property> <path> --tenant-id <workspace-id>', mutates: true, purpose: 'Attach a file to an existing typed resource object file property.' },
      ],
    },
    {
      step: 6,
      title: 'App auth cleanup',
      instruction: 'When a smoke or test app created an Entra registration that should be removed, deauthorize it explicitly and verify local credentials are gone.',
      commands: [
        { command: 'eai provision entra --deauthorize --client-id <client-id> --force', mutates: true, purpose: 'Remove workspace authorization, delete the app registration, and remove local Entra credentials.' },
        { command: 'eai env list', mutates: false, purpose: 'Confirm local project env no longer contains the removed Entra credential keys.' },
      ],
    },
  ],
  stopConditions: [
    'The same error repeats after the guidance retry limit; stop remediation and offer a support preview.',
    'A command reports a paid plan, workspace role, or platform-side server blocker that the current user cannot change.',
    'A mutating remediation command is not listed in the guidance entry for this error.',
    'The command would require editing secrets or local env files without explicit user approval.',
    'The person declines support consent or the report changes after approval; create no draft until the current bundle is approved.',
  ],
};

export function getAgentGuide(): AgentGuide {
  return guide;
}
