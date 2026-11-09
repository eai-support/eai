import type { ErrorGuidance } from './types.js';

export const capacityGuidance = [
  {
    code: 'E253',
    reasonCode: 'tenant_limit_reached',
    title: 'The parent workspace has reached its child workspace limit.',
    category: 'capability',
    severity: 'error',
    appliesTo: ['workspace.create', 'init'],
    publicSafe: true,
    why: [
      'The workspace plan sets how many child workspaces a parent may have, and the parent has used that allowance.',
      'The platform checks usage before the new child workspace is created.',
      'The child workspace create request reports this as TENANT_QUOTA_EXCEEDED; the capability check reports it as tenant_limit_reached.',
      'Retrying does not free capacity. A workspace admin must remove an unused child workspace or change the plan.',
    ],
    evidenceToCheck: [
      'The parent workspace passed with --parent.',
      'Existing child workspaces shown by eai workspace list --all --format json.',
      'Request ID, if the server returned one.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
      {
        command: 'eai workspace list --all --format json',
        purpose: 'List workspaces under the parent to find any that are no longer needed.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'Ask a workspace admin to remove an unused child workspace or raise the child workspace limit',
        purpose: 'The limit comes from the workspace plan and is changed outside this command.',
        mutates: false,
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The code is TENANT_QUOTA_EXCEEDED or tenant_limit_reached. Retrying does not change the limit or usage.'],
    },
    escalation: {
      audience: 'tenant-admin',
      neededWhen: ['The parent workspace is below its expected limit but creation is still refused.'],
      include: ['parent workspace ID', 'active workspace slug', 'command', 'request ID if present'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'TENANT_LIMIT_REACHED',
      },
      {
        serverCode: 'TENANT_QUOTA_EXCEEDED',
      },
      {
        messageIncludes: [
          'TENANT_LIMIT_REACHED',
          'TENANT_QUOTA_EXCEEDED',
          'Child tenant limit reached',
          'child tenants and the one additional child',
        ],
      },
    ],
  },
  {
    code: 'E254',
    reasonCode: 'tenant_limit_unconfigured',
    title: 'The plan has no valid child workspace limit configured.',
    category: 'capability',
    severity: 'error',
    appliesTo: ['workspace.create', 'init'],
    publicSafe: true,
    why: [
      'Creating a child workspace requires the parent plan to define a numeric child workspace limit of zero or more.',
      'This plan has no such limit, or the stored value is not a valid number, so the platform refuses to create a child rather than allow unlimited children.',
      'Platform-level administrator accounts see this code directly; other accounts see capability_not_in_plan for the same condition.',
      'The CLI cannot set a plan limit, so the plan configuration must be corrected by platform support.',
    ],
    evidenceToCheck: [
      'The parent workspace passed with --parent.',
      'The HTTP status and code printed with the error.',
      'Request ID, if the server returned one.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
    ],
    fixes: [],
    retry: {
      allowed: false,
      stopWhen: ['The code is TENANT_LIMIT_UNCONFIGURED. Retrying does not configure the plan limit.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['A child workspace is refused because the parent plan has no valid child workspace limit.'],
      include: ['parent workspace ID', 'active workspace slug', 'command', 'request ID if present'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'TENANT_LIMIT_UNCONFIGURED',
      },
      {
        messageIncludes: ['TENANT_LIMIT_UNCONFIGURED', 'valid child tenant limit'],
      },
    ],
  },
  {
    code: 'E255',
    reasonCode: 'capability_unavailable',
    title: 'This capability is not available for the workspace.',
    category: 'capability',
    severity: 'error',
    appliesTo: ['workspace.create', 'init', 'app.create'],
    publicSafe: true,
    why: [
      'The capability check found no rule that allows this capability for the workspace and operation, so it returned its default denial.',
      'This differs from capability_not_in_plan, which names a plan gap, and tenant_admin_required, which names a missing role.',
      'The cause cannot be told from this code alone, so confirm the active workspace and the command first.',
    ],
    evidenceToCheck: [
      'The capability or command named in the error output.',
      'Active workspace in eai whoami.',
      'Request ID, if the server returned one.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
      {
        command: 'eai workspace list --all --format json',
        purpose: 'Confirm the intended workspace is visible to the user.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'eai workspace select <workspace>',
        purpose: 'Select the workspace the capability should be used in.',
        mutates: true,
        when: 'Run only when the active workspace is not the one you intended.',
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The intended workspace is selected and the code is still CAPABILITY_UNAVAILABLE.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The intended workspace is selected and the capability is still reported as unavailable.'],
      include: ['active workspace slug', 'capability or command', 'CLI version', 'request ID if present'],
    },
    safety: {
      mutatesState: true,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'CAPABILITY_UNAVAILABLE',
      },
      {
        messageIncludes: ['CAPABILITY_UNAVAILABLE', 'capability is not available for the current'],
      },
    ],
  },
  {
    code: 'E256',
    reasonCode: 'child_capacity_unavailable',
    title: 'Child workspace capacity could not be confirmed.',
    category: 'platform',
    severity: 'error',
    appliesTo: ['workspace.create', 'init'],
    publicSafe: true,
    why: [
      'Before creating a child workspace the platform asks the capability check whether the parent has room for another child.',
      'That check returned no usable answer, so the platform refused the request instead of guessing.',
      'This is not a plan limit; a plan limit is reported as TENANT_QUOTA_EXCEEDED.',
      'The check can fail transiently, so one bounded retry is reasonable.',
    ],
    evidenceToCheck: [
      'HTTP status 503 and the code CHILD_CAPACITY_UNAVAILABLE.',
      'Whether the same code repeats after a short wait.',
      'Request ID, if the server returned one.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the active workspace and profile are still correct.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'eai workspace create --name <name> --slug <slug> --parent <parent-id>',
        purpose: 'Repeat the child workspace creation once.',
        mutates: true,
        when: 'Run after the backoff in the retry policy; stop if the same code returns.',
      },
    ],
    retry: {
      allowed: true,
      maxAttempts: 2,
      backoffSeconds: [15, 60],
      stopWhen: ['CHILD_CAPACITY_UNAVAILABLE repeats after bounded retry.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The capacity check keeps failing for the same parent workspace.'],
      include: ['request ID', 'HTTP status', 'CLI version', 'parent workspace ID', 'command'],
    },
    safety: {
      mutatesState: true,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'CHILD_CAPACITY_UNAVAILABLE',
      },
      {
        messageIncludes: ['CHILD_CAPACITY_UNAVAILABLE', 'capacity could not be confirmed'],
      },
    ],
  },
] satisfies ErrorGuidance[];
