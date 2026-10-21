import type { ErrorGuidance } from './types.js';

/**
 * Guidance for app deletion and app ownership registration refusals. Both
 * flows refuse rather than guess when they cannot prove which resources belong
 * to an app, so most of these codes are stop-and-escalate. Each entry lists the
 * server codes it covers as `match[].serverCode` aliases so `eai errors explain`
 * resolves the code printed in the error.
 */
export const appOwnershipGuidance = [
  {
    code: 'E290',
    reasonCode: 'app_ownership_manifest_not_found',
    title: 'No app ownership record was found for this app in the selected workspace.',
    category: 'app_provisioning',
    severity: 'error',
    appliesTo: ['app.delete'],
    publicSafe: true,
    why: [
      'App deletion first reads an ownership manifest that lists everything the app owns, and the platform found no ownership registration for this app key under the selected workspace.',
      'The app key or the workspace may be wrong, the app may be enrolled in a different workspace, or the app and its platform-owned metadata may already have been deleted.',
      'The request that returns this code deletes nothing.',
    ],
    evidenceToCheck: [
      'The app key passed to eai app delete.',
      'The --tenant-id value and whether that workspace owns the app enrollment.',
      'Whether the app appears in eai app list for the owning workspace.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
      {
        command: 'eai app list --tenant-id <owning-workspace-id> --format json',
        purpose: 'List the apps enrolled in the owning workspace and confirm the exact app key.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'eai app delete <app-key> --tenant-id <owning-workspace-id>',
        purpose: 'Plan and confirm the deletion from the workspace that owns the app enrollment.',
        mutates: true,
        deletesData: true,
        when: 'Run only after eai app list shows the app under that workspace.',
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The app key is not listed for the owning workspace, or the app was already deleted.'],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The app is listed for the owning workspace but deletion still reports no ownership record.'],
      include: ['app key', 'owning workspace ID', 'target workspace ID if used', 'CLI version', 'request ID if present'],
    },
    safety: {
      mutatesState: true,
      mayWriteSecrets: false,
      mayDeleteData: true,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'APP_OWNERSHIP_MANIFEST_NOT_FOUND',
      },
      {
        messageIncludes: ['APP_OWNERSHIP_MANIFEST_NOT_FOUND'],
      },
    ],
  },
  {
    code: 'E291',
    reasonCode: 'app_deletion_target_tenant_forbidden',
    title: 'You do not have workspace admin access to the workspace targeted for app deletion.',
    category: 'authorization',
    severity: 'error',
    appliesTo: ['app.delete'],
    publicSafe: true,
    why: [
      'eai app delete --target-tenant-id deletes an app from a runtime child workspace owned by the app enrollment workspace given by --tenant-id.',
      'The platform requires the target to be the --tenant-id workspace itself, or a workspace where the signed-in user is a workspace admin.',
      'You also need workspace admin access to the --tenant-id workspace. The request that returns this code deletes nothing.',
    ],
    evidenceToCheck: [
      'The --tenant-id and --target-tenant-id values passed to eai app delete.',
      'Roles returned by eai workspace list --all --format json for both workspaces.',
      'The signed-in account shown by eai whoami.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm which account the CLI is using.',
        mutates: false,
      },
      {
        command: 'eai workspace list --all --format json',
        purpose: 'Check whether the account is a workspace admin of both the owning and the target workspace.',
        mutates: false,
      },
    ],
    fixes: [
      {
        command: 'eai app delete <app-key> --tenant-id <owning-workspace-id> --target-tenant-id <runtime-child-id>',
        purpose: 'Run the deletion with the owning workspace as --tenant-id and the runtime child as the target.',
        mutates: true,
        deletesData: true,
        when: 'Use an account that is a workspace admin of both workspaces.',
      },
      {
        command: 'Ask a workspace admin of the target workspace to grant your account workspace admin access',
        purpose: 'A workspace admin must update the membership before the target can be deleted from.',
        mutates: false,
      },
    ],
    retry: {
      allowed: false,
      stopWhen: ['The account is not a workspace admin of the target workspace. Retrying does not change authorization.'],
    },
    escalation: {
      audience: 'tenant-admin',
      neededWhen: ['No workspace admin can grant access to the target workspace.'],
      include: ['signed-in email', 'owning workspace ID', 'target workspace ID', 'CLI version', 'request ID if present'],
    },
    safety: {
      mutatesState: true,
      mayWriteSecrets: false,
      mayDeleteData: true,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'APP_DELETION_TARGET_TENANT_FORBIDDEN',
      },
      {
        messageIncludes: ['APP_DELETION_TARGET_TENANT_FORBIDDEN'],
      },
    ],
  },
  {
    code: 'E292',
    reasonCode: 'app_ownership_manifest_unresolved',
    title: 'The platform cannot prove a single, complete ownership manifest for this app.',
    category: 'app_provisioning',
    severity: 'error',
    appliesTo: ['app.delete'],
    publicSafe: true,
    why: [
      'App deletion proceeds only when the platform can list everything the app owns without ambiguity, so it never deletes data it cannot prove belongs to this app.',
      'APP_OWNERSHIP_MANIFEST_INCOMPLETE: a record needed to build the manifest is missing a required identifier.',
      'APP_OWNERSHIP_MANIFEST_CONFLICT: two records for the same install disagree about which apps and Object Types it owns.',
      'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS: the install that owns the app enrollment could not be narrowed to exactly one.',
      'APP_OWNERSHIP_OBJECT_TYPE_AMBIGUOUS, APP_OWNERSHIP_OBJECT_TYPE_NOT_FOUND and APP_OWNERSHIP_OBJECT_TYPE_INVALID: an Object Type the manifest relies on has several matches, cannot be found, or is not shaped as expected.',
      'APP_OWNERSHIP_STORAGE_ROUTE_INVALID: the app enrollment Object Type has no complete storage binding.',
      'These are platform data problems, so changing local files or repeating eai app delete does not fix them.',
    ],
    evidenceToCheck: [
      'The exact code in the response body.',
      'The app key and the owning workspace ID.',
      'Whether eai app delete stopped at its planning step.',
    ],
    diagnostics: [
      {
        command: 'eai whoami',
        purpose: 'Confirm the signed-in user and active workspace.',
        mutates: false,
      },
      {
        command: 'eai app list --tenant-id <owning-workspace-id> --format json',
        purpose: 'Confirm the app is enrolled in the workspace you are deleting from.',
        mutates: false,
      },
    ],
    fixes: [],
    retry: {
      allowed: false,
      stopWhen: [
        'Any of these ownership codes is returned. The ownership data must be repaired by platform support before deletion can be planned.',
      ],
    },
    escalation: {
      audience: 'platform-support',
      neededWhen: ['The app must be deleted but the platform cannot resolve its ownership manifest.'],
      include: ['app key', 'owning workspace ID', 'target workspace ID if used', 'the exact code', 'CLI version', 'request ID if present'],
    },
    safety: {
      mutatesState: false,
      mayWriteSecrets: false,
      mayDeleteData: false,
      publicSafe: true,
    },
    match: [
      {
        serverCode: 'APP_OWNERSHIP_MANIFEST_INCOMPLETE',
      },
      {
        serverCode: 'APP_OWNERSHIP_MANIFEST_CONFLICT',
      },
      {
        serverCode: 'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS',
      },
      {
        serverCode: 'APP_OWNERSHIP_OBJECT_TYPE_AMBIGUOUS',
      },
      {
        serverCode: 'APP_OWNERSHIP_OBJECT_TYPE_NOT_FOUND',
      },
      {
        serverCode: 'APP_OWNERSHIP_OBJECT_TYPE_INVALID',
      },
      {
        serverCode: 'APP_OWNERSHIP_STORAGE_ROUTE_INVALID',
      },
      {
        messageIncludes: [
          'APP_OWNERSHIP_MANIFEST_INCOMPLETE',
          'APP_OWNERSHIP_MANIFEST_CONFLICT',
          'APP_OWNERSHIP_ENROLLMENT_OWNER_AMBIGUOUS',
          'APP_OWNERSHIP_OBJECT_TYPE_AMBIGUOUS',
          'APP_OWNERSHIP_OBJECT_TYPE_NOT_FOUND',
          'APP_OWNERSHIP_OBJECT_TYPE_INVALID',
          'APP_OWNERSHIP_STORAGE_ROUTE_INVALID',
        ],
      },
    ],
  },
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
