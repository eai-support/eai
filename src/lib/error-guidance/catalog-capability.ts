import type { ErrorGuidance } from './types.js';

/**
 * Guidance for plan, subscription, and capacity refusals. Each entry lists the
 * upper-case server code the platform returns as a `match[].serverCode` alias so
 * `eai errors explain` resolves it by the code printed in the error. The
 * lower-case reason codes come from the capability check; a child workspace
 * create request reports the same reason in upper case.
 */
export const capabilityGuidance = [
  {
    code: 'E251',
    reasonCode: 'subscription_inactive',
    title: 'The workspace subscription is not active, so new capabilities cannot be provisioned.',
    category: 'capability',
    severity: 'error',
    appliesTo: ['workspace.create', 'init', 'app.create'],
    publicSafe: true,
    why: [
      'The platform checks the workspace subscription status before it allows a capability to be provisioned or enabled.',
      'Only an active or trialing subscription passes that check; any other status is refused.',
      'For child workspace creation the check applies to the parent workspace, not the new child.',
      'The CLI cannot renew or change a subscription, so retrying the same command does not change the result.',
    ],
    evidenceToCheck: [
      'Active workspace in eai whoami, or the parent workspace passed with --parent.',
      'The HTTP status and code printed with the error.',
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
        purpose: 'Confirm which workspace was the parent or target of the failed command.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'Ask a workspace admin to restore an active subscription for the workspace',
        purpose: 'Billing is managed outside the CLI; the capability check passes again once the subscription is active.',
        mutates: false,
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The code is SUBSCRIPTION_INACTIVE. Retrying does not change the subscription status.'],
    },
    escalation: {
      audience: 'tenant-admin',
      neededWhen: ['The workspace should have an active subscription but the platform still reports it as inactive.'],
      include: ['active workspace slug', 'parent workspace ID if creating a child', 'command', 'request ID if present'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'SUBSCRIPTION_INACTIVE',
      },
      {
        messageIncludes: ['SUBSCRIPTION_INACTIVE', 'subscription is inactive'],
      },
    ],
  },
  {
    code: 'E252',
    reasonCode: 'capability_not_in_plan',
    title: 'This capability is not included in the workspace plan.',
    category: 'capability',
    severity: 'error',
    appliesTo: ['workspace.create', 'init', 'app.create'],
    publicSafe: true,
    why: [
      'The subscription is active, but the workspace plan does not include the feature or add-on the command needs.',
      'This is a plan limit, not a permissions problem: the signed-in user may already be a workspace admin.',
      'Creating a child workspace also reports this code when the plan defines no valid child workspace limit.',
      'The CLI cannot change a workspace plan. If the response includes an upgrade link, a workspace admin can follow it.',
    ],
    evidenceToCheck: [
      'The capability or command named in the error output.',
      'Active workspace in eai whoami, or the parent workspace passed with --parent.',
      'Whether the response included an upgrade link.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
      {
        command: 'eai workspace list --all --format json',
        purpose: 'Confirm which workspace the failed command ran against.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'Ask a workspace admin to add the capability to the workspace plan',
        purpose: 'Plan changes are made outside the CLI; the command can run once the plan includes the capability.',
        mutates: false,
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The code is CAPABILITY_NOT_IN_PLAN. Retrying does not change the workspace plan.'],
    },
    escalation: {
      audience: 'tenant-admin',
      neededWhen: ['The plan should include the capability but the platform still reports it as missing.'],
      include: ['active workspace slug', 'capability or command', 'request ID if present'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'CAPABILITY_NOT_IN_PLAN',
      },
      {
        messageIncludes: ['CAPABILITY_NOT_IN_PLAN', 'not included in the current plan'],
      },
    ],
  },
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
  {
    code: 'E257',
    reasonCode: 'no_subscription',
    title: 'The workspace has no active subscription for this billing action.',
    category: 'capability',
    severity: 'error',
    appliesTo: ['billing'],
    publicSafe: true,
    why: [
      'A billing action such as updating, reducing, or cancelling a subscription needs an active subscription recorded for the workspace, and none was found.',
      'The workspace may never have subscribed, or its subscription may already have ended.',
      'The CLI cannot create or change a subscription, so retrying the same request does not change the result.',
    ],
    evidenceToCheck: [
      'Active workspace in eai whoami.',
      'The billing action that was attempted.',
      'Request ID, if the server returned one.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'Ask a workspace admin to confirm the workspace subscription status',
        purpose: 'Billing is managed outside the CLI; a workspace admin can confirm whether a subscription exists.',
        mutates: false,
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The code is NO_SUBSCRIPTION. Retrying does not create a subscription.'],
    },
    escalation: {
      audience: 'tenant-admin',
      neededWhen: ['The workspace should have an active subscription but the platform reports none.'],
      include: ['active workspace slug', 'billing action attempted', 'request ID if present'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'NO_SUBSCRIPTION',
      },
      {
        messageIncludes: ['NO_SUBSCRIPTION', 'has no active Stripe subscription'],
      },
    ],
  },
  {
    code: 'E258',
    reasonCode: 'workspace_plan_billing_unavailable',
    title: 'Workspace billing could not be verified, so the plan was not changed.',
    category: 'external_service',
    severity: 'error',
    appliesTo: ['billing'],
    publicSafe: true,
    why: [
      'Before changing a workspace plan the platform confirms the workspace billing records with the billing provider.',
      'That confirmation failed or returned data that did not match, so the platform stopped and left the plan unchanged.',
      'The failure can be transient, so one or two bounded retries are reasonable.',
    ],
    evidenceToCheck: [
      'HTTP status 503 and the code WORKSPACE_PLAN_BILLING_UNAVAILABLE.',
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
    fixes: [],
    retry: {
      allowed: true,
      maxAttempts: 2,
      backoffSeconds: [30, 60],
      stopWhen: ['WORKSPACE_PLAN_BILLING_UNAVAILABLE repeats after bounded retry.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The billing check keeps failing for the same workspace.'],
      include: ['request ID', 'HTTP status', 'CLI version', 'active workspace slug', 'plan action attempted'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'WORKSPACE_PLAN_BILLING_UNAVAILABLE',
      },
      {
        messageIncludes: [
          'WORKSPACE_PLAN_BILLING_UNAVAILABLE',
          'billing could not be checked',
          'billing could not be confirmed',
        ],
      },
    ],
  },
] satisfies ErrorGuidance[];
