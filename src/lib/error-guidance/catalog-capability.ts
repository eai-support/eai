import type { ErrorGuidance } from './types.js';

/** INVARIANT: Server-code aliases preserve lookup of the upper-case codes emitted by platform refusals. */
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
] satisfies ErrorGuidance[];
