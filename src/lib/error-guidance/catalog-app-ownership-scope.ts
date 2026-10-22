import type { ErrorGuidance } from './types.js';

export const appOwnershipScopeGuidance = [
  {
    code: 'E293',
    reasonCode: 'app_ownership_scope_request_invalid',
    title: 'The app ownership registration request is invalid.',
    category: 'app_provisioning',
    severity: 'error',
    appliesTo: ['app.create', 'app.provision'],
    publicSafe: true,
    why: [
      'When an app is created or provisioned the platform registers which Object Types the app owns. This request was rejected before any ownership was recorded.',
      'APP_OWNERSHIP_SCOPE_INVALID_APP_KEY: the app key is not a lowercase identifier of letters, digits and hyphens that starts and ends with a letter or digit.',
      'APP_OWNERSHIP_SCOPE_INVALID_OBJECT_TYPES: the Object Type list is not a list, or contains a slug that is not a lowercase identifier.',
      'APP_OWNERSHIP_SCOPE_INVALID_BODY: the request is missing the Object Type list or carries other fields.',
      'Well-formed input is normally checked before this step, so check the app key and Object Type slugs first and confirm the CLI is current.',
    ],
    evidenceToCheck: [
      'The app key and Object Type slugs used by the failed command.',
      'The installed CLI version from eai --version.',
      'The exact code in the response body.',
    ],
    diagnostics: [
      {
        command: 'eai update --check',
        purpose: 'Confirm the installed CLI is current.',
        mutates: false,
      },
      {
        command: 'eai app list --format json',
        purpose: 'Confirm the app key exactly as it is enrolled.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'eai update',
        purpose: 'Install the current CLI before one retry of the failed command.',
        mutates: true,
        when: 'Run when eai update --check reports a newer version.',
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The same code is returned after the app key and Object Type slugs are canonical and the CLI is current.'],
    },
    escalation: {
      audience: 'eai-maintainer',
      neededWhen: ['The app key and Object Type slugs are canonical and the CLI is current, but the request is still rejected.'],
      include: ['app key', 'Object Type slugs', 'CLI version', 'command', 'request ID if present'],
    },
    safety: {
      mutatesState: true,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_INVALID_APP_KEY',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_INVALID_OBJECT_TYPES',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_INVALID_BODY',
      },
      {
        messageIncludes: [
          'APP_OWNERSHIP_SCOPE_INVALID_APP_KEY',
          'APP_OWNERSHIP_SCOPE_INVALID_OBJECT_TYPES',
          'APP_OWNERSHIP_SCOPE_INVALID_BODY',
        ],
      },
    ],
  },
  {
    code: 'E294',
    reasonCode: 'app_ownership_scope_unsafe',
    title: 'The platform cannot safely register ownership of this app.',
    category: 'app_provisioning',
    severity: 'error',
    appliesTo: ['app.create', 'app.provision'],
    publicSafe: true,
    why: [
      'When an app is created or provisioned the platform adds the app and its Object Types to the workspace install record. It refuses when it cannot prove the addition is safe, so it never claims data that belongs to another app.',
      'APP_OWNERSHIP_SCOPE_INSTALL_NOT_FOUND: the workspace has no active data/schema install to register against. This is a workspace setup gap, like tenant_data_install_no_match.',
      'APP_OWNERSHIP_SCOPE_INSTALL_INCOMPLETE, APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS and APP_OWNERSHIP_SCOPE_INSTALL_CONFLICT: the workspace install record is missing required identity fields, appears more than once, or disagrees with its stored copy.',
      'APP_OWNERSHIP_SCOPE_AMBIGUOUS and APP_OWNERSHIP_SCOPE_EXISTING_SCOPE_INVALID: an install already holds more than one scope for this app key, or a scope without a valid app key.',
      'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_NOT_EXCLUSIVE: a requested Object Type is not published as a workspace-owned type, or does not match exactly one definition.',
      'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_CONFLICT: a requested Object Type is already owned by a different app in the same workspace.',
      'Retrying does not change any of these results.',
    ],
    evidenceToCheck: [
      'The exact code in the response body.',
      'The app key, the workspace ID and the Object Type slugs the app uses.',
      'Whether eai types diff shows the app Object Types as published.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
      {
        command: 'eai verify',
        purpose: 'Confirm whether the data/schema service can resolve an install for this workspace.',
        mutates: false,
      },
      {
        command: 'eai types diff',
        purpose: 'Compare local Object Types with the published workspace state.',
        mutates: false,
      },
    ],
    fixes: [],
    retry: {
      allowed: false,
      stopWhen: ['Any of these ownership codes is returned. Retrying does not change the stored install or Object Type state.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The workspace install or Object Type state must be repaired before the app can be registered.'],
      include: ['app key', 'workspace ID', 'the exact code', 'CLI version', 'command', 'request ID if present'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_INSTALL_NOT_FOUND',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_INSTALL_INCOMPLETE',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_INSTALL_CONFLICT',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_AMBIGUOUS',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_EXISTING_SCOPE_INVALID',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_NOT_EXCLUSIVE',
      },
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_CONFLICT',
      },
      {
        messageIncludes: [
          'APP_OWNERSHIP_SCOPE_INSTALL_NOT_FOUND',
          'APP_OWNERSHIP_SCOPE_INSTALL_INCOMPLETE',
          'APP_OWNERSHIP_SCOPE_INSTALL_AMBIGUOUS',
          'APP_OWNERSHIP_SCOPE_INSTALL_CONFLICT',
          'APP_OWNERSHIP_SCOPE_AMBIGUOUS',
          'APP_OWNERSHIP_SCOPE_EXISTING_SCOPE_INVALID',
          'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_NOT_EXCLUSIVE',
          'APP_OWNERSHIP_SCOPE_OBJECT_TYPE_CONFLICT',
        ],
      },
    ],
  },
  {
    code: 'E295',
    reasonCode: 'app_ownership_scope_concurrent_change',
    title: 'The app ownership record changed while it was being updated.',
    category: 'app_provisioning',
    severity: 'warning',
    appliesTo: ['app.create', 'app.provision'],
    publicSafe: true,
    why: [
      'The platform checks that the workspace install record is unchanged before it writes, so two changes cannot overwrite each other, and another change landed between the read and the write.',
      'The ownership registration is idempotent, so repeating the same request once the competing change finishes is safe.',
      'Creating or provisioning more than one app in the same workspace at the same time can cause this.',
    ],
    evidenceToCheck: [
      'Other CLI runs, pipelines or admins changing apps in the same workspace.',
      'Whether the code repeats after a short wait.',
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
        command: 'Re-run the command that returned this code',
        purpose: 'The ownership registration is idempotent, so a repeat after the competing change finishes is safe.',
        mutates: true,
        when: 'Wait for other app work in the workspace to finish first.',
      },
    ],
    retry: {
      allowed: true,
      maxAttempts: 2,
      backoffSeconds: [5, 15],
      stopWhen: ['APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE repeats after bounded retry.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The code repeats although no other app work is running in the workspace.'],
      include: ['app key', 'workspace ID', 'command', 'CLI version', 'request ID if present'],
    },
    safety: {
      mutatesState: true,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE',
      },
      {
        messageIncludes: ['APP_OWNERSHIP_SCOPE_CONCURRENT_CHANGE', 'ownership scope changed concurrently'],
      },
    ],
  },
  {
    code: 'E296',
    reasonCode: 'app_ownership_scope_failed',
    title: 'App ownership registration failed unexpectedly.',
    category: 'platform',
    severity: 'error',
    appliesTo: ['app.create', 'app.provision'],
    publicSafe: true,
    why: [
      'The platform returned a server-side failure while registering which Object Types the app owns, and it did not identify a more specific cause.',
      'Problems with the request itself return their own codes, so this points at the platform rather than at the app key or Object Types you supplied.',
      'Registration only adds ownership and never removes it, so one later bounded retry is safe.',
    ],
    evidenceToCheck: [
      'HTTP status 500 and the code APP_OWNERSHIP_SCOPE_FAILED.',
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
      stopWhen: ['APP_OWNERSHIP_SCOPE_FAILED repeats after bounded retry.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The registration keeps failing for the same app and workspace.'],
      include: ['request ID', 'HTTP status', 'app key', 'workspace ID', 'CLI version', 'command'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'APP_OWNERSHIP_SCOPE_FAILED',
      },
      {
        messageIncludes: ['APP_OWNERSHIP_SCOPE_FAILED', 'Ownership scope registration failed'],
      },
    ],
  },
] satisfies ErrorGuidance[];
