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

/** Recover an accepted operation whose first gateway response failed before the CLI saved its private receipt. */
export async function recoverAcceptedCliManagedSourceUpload(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  operation: CliManagedSourceOperation,
  bundle: CliManagedSourceBundle,
  onPrepared: (operation: CliManagedSourceOperation) => Promise<void>,
): Promise<CliManagedSourceOperation> {
  const accepted = validateCliManagedSourceOperation(operation, scope, {
    templateCommitSha: bundle.templateCommitSha,
    bundleSha256: bundle.bundleSha256,
    configHash: bundle.configHash,
  });
  if (accepted.status !== "accepted" || !accepted.githubLinkSessionId) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_RECOVERY_UNAVAILABLE",
      "Only the original accepted EAI-managed operation can recover a missing local upload receipt.",
    );
  }
  const link = validateCliGithubLinkSession(
    await responseSession(await client.getCliManagedGithubLinkSession(
      scope.tenantId, scope.appKey, accepted.githubLinkSessionId,
      scope.targetTenantId, scope.environment,
    )),
    scope, accepted.githubLinkSessionId, true,
  );
  if (
    link.status !== "verified" ||
    link.verifiedGithubUser?.id !== accepted.verifiedGithubUser.id ||
    link.verifiedGithubUser?.login.toLowerCase() !== accepted.verifiedGithubUser.login.toLowerCase() ||
    link.verifiedGithubUser?.proofId !== accepted.verifiedGithubUser.proofId
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "Original GitHub proof changed; no source was uploaded.",
    );
  }
  const replayed = validateCliManagedSourceOperation(
    await responseOperation(await client.prepareCliManagedSource(scope.tenantId, scope.appKey, {
      schemaVersion: "eai.cli_managed_source_preparation.v1",
      targetTenantId: scope.targetTenantId,
      environment: scope.environment,
      templateCommitSha: bundle.templateCommitSha,
      bundleSha256: bundle.bundleSha256,
      configHash: bundle.configHash,
      fileCount: bundle.files.length,
      totalBytes: bundle.files.reduce((total, file) => total + file.size, 0),
      idempotencyKey: cliManagedSourceIdempotencyKey(scope, bundle.bundleSha256),
      githubLinkSessionId: accepted.githubLinkSessionId,
    })),
    scope,
    {
      operationId: accepted.operationId,
      templateCommitSha: accepted.templateCommitSha,
      bundleSha256: accepted.bundleSha256,
      configHash: accepted.configHash,
      githubLinkSessionId: accepted.githubLinkSessionId,
      verifiedGithubUser: accepted.verifiedGithubUser,
    },
  );
  await onPrepared(replayed);
  if (replayed.status !== "accepted") return replayed;
  return resumeCliManagedSourceUpload(client, scope, replayed, bundle);
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
  };
  const prepared = validateCliManagedSourceOperation(
    await responseOperation(
      await client.prepareCliManagedSource(scope.tenantId, scope.appKey, {
        schemaVersion: "eai.cli_managed_source_preparation.v1",
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

async function uploadCliManagedSource(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  link: CliManagedGithubLinkSession,
  bundle: CliManagedSourceBundle,
  prepared: CliManagedSourceOperation,
): Promise<CliManagedSourceOperation> {
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
    !upload.ticket ||
    upload.sha256 !== bundle.bundleSha256 ||
    !Number.isFinite(Date.parse(upload.expiresAt)) ||
    Date.parse(upload.expiresAt) <= Date.now()
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_INVALID",
      "The upload URL, expiry or digest is not bound to the verified platform operation. No source or token was sent.",
    );
  }
  const signal = client.managedRequestSignal();
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
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UPLOAD_FAILED",
      `Source upload returned ${response.status}. Use --retry ${prepared.operationId} to load the protected original endpoint and inspect its authoritative status.`,
    );
  }
  return validateCliManagedSourceOperation(
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
      githubLinkSessionId: link.sessionId,
      verifiedGithubUser: link.verifiedGithubUser,
    },
  );
}
