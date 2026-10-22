import type { ErrorGuidance } from './types.js';

/** INVARIANT: Ownership refusals stop deletion when an app's resource ownership cannot be proven. */
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
] satisfies ErrorGuidance[];
