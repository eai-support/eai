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
      purpose: 'Check login status and active tenant before tenant-scoped operations.',
    },
  ],
  operatingRules: [
    'Prefer commands that advertise --format json in eai --describe or command help.',
    'Run read-only diagnostics before mutating fixes.',
    'Use named eai commands before calling eai publicapi directly.',
    'When calling eai publicapi directly, only use /v4 paths.',
    'For normal tenant user/admin addition, use eai user invite --email <email> --tenant <tenant-id> --role <role>; do not use tenant bootstrap-admin.',
    'If user invite fails with a 5xx or EXTERNAL_SERVICE_ERROR, run eai errors explain user_invite_external_service_existing_member --format json, check for an existing member with eai user list, and only then use eai user role set by member ID when approved.',
    'Use eai tenant bootstrap-admin only for first-admin repair on an immediate child tenant.',
    'Do not loop indefinitely; follow retry and stop conditions from eai errors explain.',
    'Do not expose tokens, secrets, local env files, tenant identifiers, or request IDs unless the user explicitly asks to collect escalation evidence.',
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
          purpose: 'Check login and selected tenant.',
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
      instruction: 'Run mutating commands only when they are listed in the guidance entry and fit the current project state.',
    },
    {
      step: 5,
      title: 'Verify and stop',
      instruction: 'Re-run the failed command or a read-only verification command. Stop when guidance stop conditions match or the same failure repeats after the listed retry limit.',
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
        { command: 'eai types seed', mutates: true, purpose: 'Publish object types for the selected tenant.' },
        { command: 'eai dev', mutates: true, purpose: 'Start local development.' },
      ],
    },
    {
      step: 2,
      title: 'Existing project health',
      instruction: 'Check login, tenant, CLI release, project assets, and platform-facing contracts.',
      commands: [
        { command: 'eai whoami', mutates: false, purpose: 'Show current user and tenant context.' },
        { command: 'eai update --check', mutates: false, purpose: 'Check CLI release plus Gofer/template currency.' },
        { command: 'eai doctor --check-updates', mutates: false, purpose: 'Check CLI, Gofer, and template drift.' },
        { command: 'eai verify calls --format json', mutates: false, purpose: 'Audit platform-facing contracts.' },
      ],
    },
    {
      step: 3,
      title: 'Type and resource readiness',
      instruction: 'Validate local type definitions, compare with the selected tenant, and seed only when needed.',
      commands: [
        { command: 'eai types validate', mutates: false, purpose: 'Validate local object type files.' },
        { command: 'eai types diff', mutates: false, purpose: 'Compare local and published object types.' },
        { command: 'eai types seed', mutates: true, purpose: 'Publish object types when validation and diff show it is needed.' },
        { command: 'eai resources schema --format json', mutates: false, purpose: 'Inspect published resource schema.' },
      ],
    },
    {
      step: 4,
      title: 'Tenant member management',
      instruction: 'List available roles, invite or refresh the user by email with the intended role, and verify membership. This is the correct path for "add this person as tenant admin/member" requests.',
      commands: [
        { command: 'eai user roles --tenant <tenant-id> --format json', mutates: false, purpose: 'Discover assignable tenant roles before choosing a role.' },
        { command: 'eai user invite --email <email> --tenant <tenant-id> --role tenant-admin --format json', mutates: true, purpose: 'Add or refresh a user membership and assign tenant-admin.' },
        { command: 'eai user list --tenant <tenant-id> --search <email> --format json', mutates: false, purpose: 'Verify the user membership and role after invite.' },
        { command: 'eai user role set --tenant <tenant-id> --member-id <member-id> --role tenant-admin --format json', mutates: true, purpose: 'Repair the role on an existing direct member when invite/add fails and the member ID has been verified.' },
      ],
    },
    {
      step: 5,
      title: 'App auth cleanup',
      instruction: 'When a smoke or test app created an Entra registration that should be removed, deauthorize it explicitly and verify local credentials are gone.',
      commands: [
        { command: 'eai provision entra --deauthorize --client-id <client-id> --force', mutates: true, purpose: 'Remove tenant authorization, delete the app registration, and remove local Entra credentials.' },
        { command: 'eai env list', mutates: false, purpose: 'Confirm local project env no longer contains the removed Entra credential keys.' },
      ],
    },
  ],
  stopConditions: [
    'The same error repeats after the guidance retry limit.',
    'A command reports a paid plan, tenant role, or platform-side server blocker that the current user cannot change.',
    'A mutating command is not listed in the guidance entry for this error.',
    'The command would require editing secrets or local env files without explicit user approval.',
  ],
};

export function getAgentGuide(): AgentGuide {
  return guide;
}
