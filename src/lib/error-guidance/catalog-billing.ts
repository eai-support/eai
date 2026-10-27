import type { ErrorGuidance } from './types.js';

export const billingGuidance = [
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
