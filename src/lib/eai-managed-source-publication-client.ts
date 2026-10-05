import { PlatformAPIClient, awaitManagedRequestDeadline, type CliManagedGithubLinkSession } from "./api.js";
import { getAccessToken } from "./auth.js";
import {
  ManagedSourceError,
  type CliManagedSourceBundle,
} from "./eai-managed-source.js";
import type {
  CliManagedSourceOperation,
  CliManagedSourceScope,
} from "./eai-managed-source-client-types.js";
import {
  cliManagedPortalOrigin,
  isApprovedManagedPortalOrigin,
  responseSession,
  validateCliGithubLinkSession,
} from "./eai-managed-source-link-client.js";
import {
  cliManagedSourceIdempotencyKey,
  responseOperation,
  validateCliManagedSourceOperation,
} from "./eai-managed-source-operation-client.js";

/** Replay the exact pre-review operation when its upload ticket expired. */
export async function recoverAcceptedCliManagedSourceUpload(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  operation: CliManagedSourceOperation,
  bundle: CliManagedSourceBundle,
  onPrepared: (operation: CliManagedSourceOperation) => Promise<void>,
): Promise<CliManagedSourceOperation> {
  const original = validateCliManagedSourceOperation(operation, scope, {
    templateCommitSha: bundle.templateCommitSha,
    bundleSha256: bundle.bundleSha256,
    configHash: bundle.configHash,
  });
  if (
    !["accepted", "publishing"].includes(original.status) ||
    !original.githubLinkSessionId ||
    original.repository.private !== true ||
    original.review || original.deployment
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_RECOVERY_UNAVAILABLE",
      "Only the original pre-review EAI-managed operation can recover an expired upload ticket.",
    );
  }
  const link = validateCliGithubLinkSession(
    await responseSession(await client.getCliManagedGithubLinkSession(
      scope.tenantId, scope.appKey, original.githubLinkSessionId,
      scope.targetTenantId, scope.environment,
    )),
    scope, original.githubLinkSessionId, true,
  );
  if (
    link.status !== "verified" ||
    link.verifiedGithubUser?.id !== original.verifiedGithubUser.id ||
    link.verifiedGithubUser?.login.toLowerCase() !== original.verifiedGithubUser.login.toLowerCase() ||
    link.verifiedGithubUser?.proofId !== original.verifiedGithubUser.proofId
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "Original GitHub proof changed; no source was uploaded.",
    );
  }
  if (original.upload) validateUploadAuthority(link, bundle, original, true);
  const replayed = validateCliManagedSourceOperation(
    await responseOperation(await client.prepareCliManagedSource(scope.tenantId, scope.appKey, {
      schemaVersion: "eai.cli_managed_source_preparation.v1",
      ...(bundle.schemaVersion === 'eai.cli_managed_source_bundle.v2' ? { bundleSchemaVersion: bundle.schemaVersion } : {}),
      targetTenantId: scope.targetTenantId,
      environment: scope.environment,
      templateCommitSha: bundle.templateCommitSha,
      bundleSha256: bundle.bundleSha256,
      configHash: bundle.configHash,
      fileCount: bundle.files.length,
      totalBytes: bundle.files.reduce((total, file) => total + file.size, 0),
      idempotencyKey: cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256),
      githubLinkSessionId: original.githubLinkSessionId,
    })),
    scope,
    {
      operationId: original.operationId,
      templateCommitSha: original.templateCommitSha,
      bundleSha256: original.bundleSha256,
      configHash: original.configHash,
      githubLinkSessionId: original.githubLinkSessionId,
      verifiedGithubUser: original.verifiedGithubUser,
    },
  );
  if (
    replayed.repository.owner !== original.repository.owner ||
    replayed.repository.name !== original.repository.name ||
    replayed.repository.private !== true ||
    (original.repository.id && replayed.repository.id !== original.repository.id) ||
    (original.repository.nodeId && replayed.repository.nodeId !== original.repository.nodeId)
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "The original EAI-managed repository changed during upload recovery.",
    );
  }
  await onPrepared(replayed);
  if (replayed.status !== "accepted" && replayed.status !== "publishing") return replayed;
  if (!replayed.upload || replayed.review || replayed.deployment) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_RECOVERY_UNAVAILABLE",
      "The original source operation has no pre-review upload authority to renew.",
    );
  }
  return resumeCliManagedSourceUpload(client, scope, replayed, bundle);
}

/** SECURITY: explicit retry may repair only the same unmerged partial review, never replace accepted source. */
export async function recoverLegacyCliManagedSourceReview(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  operation: CliManagedSourceOperation,
  bundle: CliManagedSourceBundle,
): Promise<CliManagedSourceOperation> {
  const original = validateCliManagedSourceOperation(operation, scope, {
    templateCommitSha: bundle.templateCommitSha, bundleSha256: bundle.bundleSha256,
    configHash: bundle.configHash, bundleSchemaVersion: bundle.schemaVersion,
  });
  if (bundle.schemaVersion !== 'eai.cli_managed_source_bundle.v1' || original.status !== 'pending_review'
    || !original.githubLinkSessionId || !original.review || original.review.mergedSha || original.deployment
    || original.repository.private !== true || !original.repository.id || !original.repository.nodeId) {
    throw new ManagedSourceError('MANAGED_SOURCE_RECOVERY_UNAVAILABLE', 'Only an exact unmerged legacy partial-source review can be repaired.');
  }
  const link = validateCliGithubLinkSession(await responseSession(await client.getCliManagedGithubLinkSession(
    scope.tenantId, scope.appKey, original.githubLinkSessionId, scope.targetTenantId, scope.environment,
  )), scope, original.githubLinkSessionId, true);
  if (link.status !== 'verified') throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Original GitHub identity is unavailable; no source was sent.');
  validateCliManagedSourceOperation(original, scope, { verifiedGithubUser: link.verifiedGithubUser });
  const prepared = validateCliManagedSourceOperation(await responseOperation(await client.prepareCliManagedSource(
    scope.tenantId, scope.appKey, {
      schemaVersion: 'eai.cli_managed_source_preparation.v1', bundleSchemaVersion: bundle.schemaVersion,
      repairReview: true, targetTenantId: scope.targetTenantId, environment: scope.environment,
      templateCommitSha: bundle.templateCommitSha, bundleSha256: bundle.bundleSha256, configHash: bundle.configHash,
      fileCount: bundle.files.length, totalBytes: bundle.files.reduce((total, file) => total + file.size, 0),
      idempotencyKey: cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256), githubLinkSessionId: original.githubLinkSessionId,
    },
  )), scope, { operationId: original.operationId, templateCommitSha: original.templateCommitSha,
    bundleSha256: original.bundleSha256, configHash: original.configHash, bundleSchemaVersion: bundle.schemaVersion,
    githubLinkSessionId: original.githubLinkSessionId, verifiedGithubUser: original.verifiedGithubUser });
  if (prepared.repository.owner !== original.repository.owner || prepared.repository.name !== original.repository.name
    || prepared.repository.id !== original.repository.id || prepared.repository.nodeId !== original.repository.nodeId
    || prepared.repository.private !== true || prepared.status !== 'pending_review' || prepared.deployment
    || !prepared.review || prepared.review.mergedSha) {
    throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'The original review or repository changed during repair preparation.');
  }
  if (!prepared.upload && !prepared.reviewRepair
    && ['number', 'headBranch', 'headSha', 'baseSha'].every(key => prepared.review![key] === original.review![key])) return prepared;
  // Already repaired operations remain observers; the server must never issue another replacement authority.
  if (!prepared.upload && prepared.reviewRepair && original.reviewRepair) return prepared;
  const repair = prepared.reviewRepair;
  if (!repair || prepared.upload?.purpose !== 'review-repair'
    || ['number', 'headBranch', 'headSha', 'baseSha'].some(key => original.review![key] !== repair.originalReview[key as keyof typeof repair.originalReview])
    || (original.reviewRepair && JSON.stringify(original.reviewRepair) !== JSON.stringify(repair))) {
    throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Repair authority does not match the original review; no source was sent.');
  }
  return uploadCliManagedSource(client, scope, link, bundle, prepared);
}

/** Persist original operation recovery authority before submitting bytes to the verified Portal origin. */
export async function submitCliManagedSource(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  link: CliManagedGithubLinkSession,
  bundle: CliManagedSourceBundle,
  onPrepared: (operation: CliManagedSourceOperation) => Promise<void>,
): Promise<CliManagedSourceOperation> {
  validateCliGithubLinkSession(link, scope);
  if (link.status !== "verified") {
    throw new ManagedSourceError(
      "GITHUB_LINK_REQUIRED",
      "Complete verified GitHub linking before source publication.",
    );
  }
  const expected = {
    templateCommitSha: bundle.templateCommitSha,
    bundleSha256: bundle.bundleSha256,
    configHash: bundle.configHash,
    githubLinkSessionId: link.sessionId,
    ...(bundle.schemaVersion === 'eai.cli_managed_source_bundle.v2' ? { bundleSchemaVersion: bundle.schemaVersion } : {}),
  };
  const prepared = validateCliManagedSourceOperation(
    await responseOperation(
      await client.prepareCliManagedSource(scope.tenantId, scope.appKey, {
        schemaVersion: "eai.cli_managed_source_preparation.v1",
        ...(bundle.schemaVersion === 'eai.cli_managed_source_bundle.v2' ? { bundleSchemaVersion: bundle.schemaVersion } : {}),
        ...expected,
        fileCount: bundle.files.length,
        totalBytes: bundle.files.reduce((total, file) => total + file.size, 0),
        idempotencyKey: cliManagedSourceIdempotencyKey(
          scope,
          bundle.bundleSha256,
        ),
        githubLinkSessionId: link.sessionId,
        targetTenantId: scope.targetTenantId,
        environment: scope.environment,
      }),
    ),
    scope,
    { ...expected, verifiedGithubUser: link.verifiedGithubUser },
  );
  try {
    await onPrepared(prepared);
  } catch {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_RECOVERY_UNAVAILABLE",
      `Protected recovery authority could not be saved for ${prepared.operationId}. No source was uploaded; repair the local recovery directory before resubmitting the same exact source.`,
    );
  }
  if (prepared.status !== "accepted" && prepared.status !== "publishing")
    return prepared;
  return uploadCliManagedSource(client, scope, link, bundle, prepared);
}

/** Retry only the original actor-bound upload while its ticket remains valid. */
export async function resumeCliManagedSourceUpload(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  operation: CliManagedSourceOperation,
  bundle: CliManagedSourceBundle,
): Promise<CliManagedSourceOperation> {
  const prepared = validateCliManagedSourceOperation(operation, scope, {
    templateCommitSha: bundle.templateCommitSha,
    bundleSha256: bundle.bundleSha256,
    configHash: bundle.configHash,
  });
  if (!["accepted", "publishing"].includes(prepared.status) || !prepared.upload)
    return prepared;
  if (!prepared.githubLinkSessionId) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "The original verified GitHub link is missing from this operation. EAI must recover this upload.",
    );
  }
  const link = validateCliGithubLinkSession(
    await responseSession(
      await client.getCliManagedGithubLinkSession(
        scope.tenantId,
        scope.appKey,
        prepared.githubLinkSessionId,
        scope.targetTenantId,
        scope.environment,
      ),
    ),
    scope,
    prepared.githubLinkSessionId,
    true,
  );
  if (link.status !== "verified") {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "The original GitHub identity no longer matches this publication. No source was uploaded.",
    );
  }
  validateCliManagedSourceOperation(prepared, scope, {
    verifiedGithubUser: link.verifiedGithubUser,
  });
  return uploadCliManagedSource(client, scope, link, bundle, prepared);
}

/** Renewal may forgive expiration alone; every other original upload binding remains required. */
function validateUploadAuthority(
  link: CliManagedGithubLinkSession,
  bundle: CliManagedSourceBundle,
  prepared: CliManagedSourceOperation,
  permitExpired = false,
): URL {
  const upload = prepared.upload;
  let url: URL;
  try {
    url = new URL(upload?.url || "");
  } catch {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_INVALID",
      "The source operation has no valid upload authority. Resume or retry the same operation.",
    );
  }
  const expiresAt = upload?.expiresAt;
  const expiry = typeof expiresAt === "string" &&
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(expiresAt)
    ? Date.parse(expiresAt) : Number.NaN;
  const calendarDateValid = Number.isFinite(expiry) &&
    new Date(`${expiresAt!.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === expiresAt!.slice(0, 10);
  if (
    !upload ||
    url.origin !== cliManagedPortalOrigin(link) ||
    !isApprovedManagedPortalOrigin(url) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !==
      `/api/platform/generated-apps/cli-managed-source/uploads/${prepared.operationId}` ||
    typeof upload.ticket !== "string" || !upload.ticket ||
    upload.sha256 !== bundle.bundleSha256 ||
    (prepared.status === 'pending_review' && (upload.purpose !== 'review-repair' || !prepared.reviewRepair)) ||
    (prepared.status !== 'pending_review' && upload.purpose !== undefined) ||
    !calendarDateValid ||
    (!permitExpired && expiry <= Date.now())
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_INVALID",
      "The upload URL, expiry or digest is not bound to the verified platform operation. No source or token was sent.",
    );
  }
  return url;
}

async function uploadCliManagedSource(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  link: CliManagedGithubLinkSession,
  bundle: CliManagedSourceBundle,
  prepared: CliManagedSourceOperation,
): Promise<CliManagedSourceOperation> {
  const url = validateUploadAuthority(link, bundle, prepared);
  const upload = prepared.upload!;
  const signal = client.managedSourceUploadSignal();
  let response: Response;
  try {
    client.assertProfileAuthority();
    const token = await awaitManagedRequestDeadline(signal, getAccessToken());
    if (!token) {
      throw new ManagedSourceError("EAI_LOGIN_REQUIRED", "Sign in with eai login before submitting source.");
    }
    signal.throwIfAborted();
    client.assertProfileAuthority();
    response = await fetch(url.href, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EAI-Upload-Ticket": upload.ticket,
      },
      body: JSON.stringify({
        tenantId: scope.tenantId,
        appKey: scope.appKey,
        targetTenantId: scope.targetTenantId,
        environment: scope.environment,
        bundle,
      }),
    });
  } catch (error) {
    if (error instanceof ManagedSourceError && error.code === "EAI_LOGIN_REQUIRED") throw error;
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_UNCERTAIN",
      `Source upload did not return a confirmed result. Use --retry ${prepared.operationId} to load the protected original endpoint and inspect the same publication; do not create a second publication or use a customer GitHub token.`,
    );
  }
  if (!response.ok) {
    let portalMessage: string | undefined;
    if (response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      try {
        const body = await response.text();
        if (body.length <= 512) {
          const parsed: unknown = JSON.parse(body);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const error = parsed as { error?: unknown; message?: unknown };
            if (
              error.error === "cli_managed_source_upload" &&
              typeof error.message === "string" &&
              error.message.length <= 180 &&
              !/\bBearer\b/i.test(error.message) &&
              /^[A-Za-z][A-Za-z0-9 .,;:'()/-]*\.?$/.test(error.message)
            ) portalMessage = error.message;
          }
        }
      } catch {
        portalMessage = undefined;
      }
    }
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_FAILED",
      `Source upload returned ${response.status}${portalMessage ? `: ${portalMessage}` : ""}. Use --retry ${prepared.operationId} to load the protected original endpoint and inspect its authoritative status.`,
    );
  }
  const observed = validateCliManagedSourceOperation(
    await responseOperation(
      await client.getCliManagedSourceOperation(
        scope.tenantId,
        scope.appKey,
        prepared.operationId,
        scope.targetTenantId,
        scope.environment,
      ),
    ),
    scope,
    {
      templateCommitSha: bundle.templateCommitSha,
      bundleSha256: bundle.bundleSha256,
      configHash: bundle.configHash,
      operationId: prepared.operationId,
      ...(bundle.schemaVersion === 'eai.cli_managed_source_bundle.v2' ? { bundleSchemaVersion: bundle.schemaVersion } : {}),
      githubLinkSessionId: link.sessionId,
      verifiedGithubUser: link.verifiedGithubUser,
    },
  );
  if (upload.purpose === 'review-repair' && (observed.status !== 'pending_review' || observed.deployment
    || observed.repository.id !== prepared.repository.id || observed.repository.nodeId !== prepared.repository.nodeId
    || observed.review?.number !== prepared.review?.number || observed.review?.headBranch !== prepared.review?.headBranch
    || !observed.reviewRepair || JSON.stringify(observed.reviewRepair) !== JSON.stringify(prepared.reviewRepair))) {
    throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Repaired review readback lost its original authority.');
  }
  return observed;
}
