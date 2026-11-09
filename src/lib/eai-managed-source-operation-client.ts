import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PlatformAPIClient, readManagedPublicResponseText } from "./api.js";
import { CLI_MANAGED_SOURCE_LIMITS, ManagedSourceError, isManagedAppSourcePath } from "./eai-managed-source.js";
import { CLI_MANAGED_SOURCE_OPERATION_ID } from "./eai-managed-identifiers.js";
import type {
  CliManagedSourceOperation,
  CliManagedSourceScope,
} from "./eai-managed-source-client-types.js";

/** Readbacks retain the captured source snapshot and verified GitHub proof. */
export interface ExpectedCliManagedSourceOperation {
  operationId?: string;
  templateCommitSha?: string;
  bundleSha256?: string;
  configHash?: string;
  bundleSchemaVersion?: CliManagedSourceOperation['bundleSchemaVersion'];
  githubLinkSessionId?: string;
  verifiedGithubUser?: CliManagedSourceOperation["verifiedGithubUser"];
  sourceKind?: 'bundle' | 'customer-merged-commit';
  sourceProvenance?: CliManagedSourceOperation['sourceProvenance'];
  customerAuthorization?: CliManagedSourceOperation['customerAuthorization'];
}

/** Repeat submission of the same actor-scoped source snapshot cannot create duplicate bot publications. */
export function cliManagedSourceIdempotencyKey(
  scope: CliManagedSourceScope,
  bundleSha256: string,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "eai-cli-managed-source-v1",
        scope.actorId,
        scope.tenantId,
        scope.appKey,
        scope.targetTenantId,
        scope.environment,
        bundleSha256,
      ]),
    )
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Every readback must retain the original actor, runtime scope and immutable source digest. */
export function validateCliManagedSourceOperation(
  value: CliManagedSourceOperation,
  scope: CliManagedSourceScope,
  expected?: ExpectedCliManagedSourceOperation,
): CliManagedSourceOperation {
  const provenance = value?.sourceProvenance;
  const authorization = value?.customerAuthorization;
  const customerCommit = provenance?.kind === 'customer-merged-commit';
  if (provenance !== undefined || authorization !== undefined) {
    if (!customerCommit || !authorization || authorization.kind !== 'authenticated-exact-commit'
      || !['deploying', 'handoff_pending', 'completed', 'failed'].includes(value.status)
      || value.repositoryAuthority !== 'customer-owned' || !value.predecessor
      || value.bundleSha256 !== undefined || value.bundleSchemaVersion !== undefined
      || value.upload !== undefined || value.reviewRepair !== undefined
      || Object.keys(authorization).sort().join(',') !== 'actorId,authorizedAt,githubUserId,kind,mergedCommitSha,pullRequestNumber'
      || Object.keys(provenance).sort().join(',') !== 'checks,commitSha,kind,predecessorReachable,providerProofDigest,providerReviews,pullRequest,treeSha'
      || typeof provenance.commitSha !== 'string' || typeof provenance.treeSha !== 'string'
      || typeof provenance.providerProofDigest !== 'string' || typeof authorization.authorizedAt !== 'string'
      || !/^[a-f0-9]{40}$/.test(provenance.commitSha) || !/^[a-f0-9]{40}$/.test(provenance.treeSha)
      || !/^sha256:[a-f0-9]{64}$/.test(provenance.providerProofDigest) || provenance.predecessorReachable !== true
      || provenance.commitSha === value.predecessor.mergedCommitSha
      || authorization.actorId !== scope.actorId || authorization.githubUserId !== value.verifiedGithubUser?.id
      || authorization.pullRequestNumber !== provenance.pullRequest?.number
      || authorization.mergedCommitSha !== provenance.commitSha
      || !Number.isFinite(Date.parse(authorization.authorizedAt))
      || !provenance.pullRequest || !Number.isSafeInteger(provenance.pullRequest.number) || provenance.pullRequest.number < 1
      || Object.keys(provenance.pullRequest).sort().join(',') !== 'baseBranch,baseSha,headBranch,headSha,mergedAt,mergedCommitSha,number'
      || typeof provenance.pullRequest.headBranch !== 'string' || !provenance.pullRequest.headBranch
      || typeof provenance.pullRequest.mergedAt !== 'string'
      || provenance.pullRequest.mergedCommitSha !== provenance.commitSha
      || provenance.pullRequest.baseBranch !== value.repository?.defaultBranch
      || !/^[a-f0-9]{40}$/.test(provenance.pullRequest.headSha) || !/^[a-f0-9]{40}$/.test(provenance.pullRequest.baseSha)
      || !Number.isFinite(Date.parse(provenance.pullRequest.mergedAt))
      || value.review?.mergedCommitSha !== provenance.commitSha || value.review?.workflowRunId !== undefined
      || value.review?.number !== provenance.pullRequest.number || value.review?.headSha !== provenance.pullRequest.headSha
      || value.review?.headBranch !== provenance.pullRequest.headBranch || value.review?.baseSha !== provenance.pullRequest.baseSha
      || !Array.isArray(provenance.checks) || provenance.checks.length < 1 || provenance.checks.length > 100
      || new Set(provenance.checks.map(check => check.runId)).size !== provenance.checks.length
      || provenance.checks.some(check => !check || check.headSha !== provenance.pullRequest.headSha
        || Object.keys(check).sort().join(',') !== 'conclusion,headSha,name,runId'
        || check.conclusion !== 'success' || !Number.isSafeInteger(check.runId) || check.runId < 1
        || typeof check.name !== 'string' || !check.name)
      || !Array.isArray(provenance.providerReviews) || provenance.providerReviews.length > 100
      || provenance.providerReviews.some(review => !review || !Number.isSafeInteger(review.id) || review.id < 1
        || Object.keys(review).sort().join(',') !== 'commitSha,id,state,userId'
        || !Number.isSafeInteger(review.userId) || review.userId < 1 || !/^[a-f0-9]{40}$/.test(review.commitSha)
        || !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'].includes(review.state))) {
      throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Customer commit does not retain exact consent and provider provenance.');
    }
  }
  const customerRepository = value?.repositoryAuthority === "customer-owned"
    && value.repository?.private === true
    && /^[a-z\d][a-z\d-]{0,38}$/i.test(value.repository.owner)
    && value.repository.owner.toLowerCase() !== "eai-generated-apps"
    && Number.isSafeInteger(value.repository.id) && (value.repository.id ?? 0) > 0
    && typeof value.repository.nodeId === "string" && value.repository.nodeId.length > 0
    && typeof value.repository.defaultBranch === "string" && value.repository.defaultBranch.length > 0
    && /^[1-9][0-9]*$/.test(value.repository.installationId ?? "")
    && /^cli-managed-[a-f0-9]{32}$/.test(value.predecessor?.operationId ?? "")
    && /^sha256:[a-f0-9]{64}$/.test(value.predecessor?.integrityHash ?? "")
    && /^[a-f0-9]{40}$/.test(value.predecessor?.mergedCommitSha ?? "");
  if (
    !value ||
    value.schemaVersion !== "eai.cli_managed_source_operation.v1" ||
    value.sourceMode !== "eai-cli-generated" ||
    !CLI_MANAGED_SOURCE_OPERATION_ID.test(value.operationId) ||
    (expected?.operationId && value.operationId !== expected.operationId) ||
    (expected?.sourceKind && expected.sourceKind !== (customerCommit ? 'customer-merged-commit' : 'bundle')) ||
    (expected?.sourceProvenance && !isDeepStrictEqual(expected.sourceProvenance, provenance)) ||
    (expected?.customerAuthorization && !isDeepStrictEqual(expected.customerAuthorization, authorization)) ||
    value.actorId !== scope.actorId ||
    !scope.actorId ||
    value.tenantId !== scope.tenantId ||
    value.appKey !== scope.appKey ||
    value.targetTenantId !== scope.targetTenantId ||
    value.environment !== scope.environment ||
    !/^[a-f0-9]{40}$/.test(value.templateCommitSha) ||
    (!customerCommit && !/^sha256:[a-f0-9]{64}$/.test(value.bundleSha256 ?? '')) ||
    !/^sha256:[a-f0-9]{64}$/.test(value.configHash) ||
    (expected?.templateCommitSha &&
      value.templateCommitSha !== expected.templateCommitSha) ||
    (expected?.bundleSha256 && value.bundleSha256 !== expected.bundleSha256) ||
    (expected?.configHash && value.configHash !== expected.configHash) ||
    (value.bundleSchemaVersion !== undefined && !['eai.cli_managed_source_bundle.v1', 'eai.cli_managed_source_bundle.v2'].includes(value.bundleSchemaVersion)) ||
    (expected?.bundleSchemaVersion && (value.bundleSchemaVersion ?? 'eai.cli_managed_source_bundle.v1') !== expected.bundleSchemaVersion) ||
    (expected?.githubLinkSessionId &&
      value.githubLinkSessionId !== expected.githubLinkSessionId) ||
    ![
      "accepted",
      "publishing",
      "pending_review",
      "deploying",
      "handoff_pending",
      "completed",
      "failed",
    ].includes(value.status) ||
    !((value.repositoryAuthority === undefined || value.repositoryAuthority === "eai-managed")
      && value.repository?.owner === "eai-generated-apps") && !customerRepository ||
    !/^[A-Za-z0-9_.-]+$/.test(value.repository?.name || "") ||
    value.verifiedGithubUser?.actorId !== scope.actorId ||
    !Number.isSafeInteger(value.verifiedGithubUser?.id) ||
    value.verifiedGithubUser.id < 1 ||
    typeof value.verifiedGithubUser.login !== "string" ||
    !/^[a-z\d][a-z\d-]{0,38}$/i.test(value.verifiedGithubUser.login) ||
    typeof value.verifiedGithubUser.proofId !== "string" ||
    !value.verifiedGithubUser.proofId ||
    (expected?.verifiedGithubUser && (
      value.verifiedGithubUser.id !== expected.verifiedGithubUser.id ||
      value.verifiedGithubUser.login.toLowerCase() !== expected.verifiedGithubUser.login.toLowerCase() ||
      value.verifiedGithubUser.proofId !== expected.verifiedGithubUser.proofId
    ))
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "Publication response does not match the authenticated actor, exact tenant/app/runtime scope and local-source snapshot.",
    );
  }
  if (value.reviewRepair) {
    const repair = value.reviewRepair;
    const original = repair.originalReview;
    const v1 = repair.schemaVersion === 'eai.cli_managed_source_review_repair.v1';
    const v2 = repair.schemaVersion === 'eai.cli_managed_source_review_repair.v2';
    if ((v1 && ((value.bundleSchemaVersion ?? 'eai.cli_managed_source_bundle.v1') !== 'eai.cli_managed_source_bundle.v1'
      || Object.keys(repair).sort().join(',') !== 'originalDeletedPaths,originalFileChecksumsSha256,originalReview,reason,schemaVersion'
      || repair.reason !== 'legacy-partial-omission-deletions'
      || !Array.isArray(repair.originalDeletedPaths) || repair.originalDeletedPaths.length < 1 || repair.originalDeletedPaths.length > 500
      || repair.originalDeletedPaths.some((path, i, paths) => typeof path !== 'string'
        || !isManagedAppSourcePath(path) || (i > 0 && path <= paths[i - 1]))))
      || (v2 && (value.bundleSchemaVersion !== 'eai.cli_managed_source_bundle.v2'
        || Object.keys(repair).sort().join(',') !== 'originalBundleSha256,originalDeletedPaths,originalFileChecksumsSha256,originalReview,reason,replacementBundleSha256,replacementControlPath,replacementFileCount,replacementPaths,replacementTotalBytes,schemaVersion'
        || repair.reason !== 'reviewed-scaffold-evidence-refresh'
        || repair.originalBundleSha256 === value.bundleSha256
        || !/^sha256:[a-f0-9]{64}$/.test(repair.originalBundleSha256 || '')
        || repair.replacementBundleSha256 !== value.bundleSha256
        || !Number.isSafeInteger(repair.replacementFileCount) || repair.replacementFileCount! < 1 || repair.replacementFileCount! > CLI_MANAGED_SOURCE_LIMITS.maxFiles
        || !Number.isSafeInteger(repair.replacementTotalBytes) || repair.replacementTotalBytes! < 1 || repair.replacementTotalBytes! > CLI_MANAGED_SOURCE_LIMITS.maxTotalBytes
        || !Array.isArray(repair.replacementPaths)
        || repair.replacementPaths.length !== 4
        || repair.replacementPaths.join(',') !== 'run.ps1,run.sh,tests/cross-platform-lifecycle.test.mjs,tests/source-unknown-deployment-evidence.test.mjs'
        || repair.replacementControlPath !== 'scripts/source-unknown-deployment-evidence.mjs'
        || !Array.isArray(repair.originalDeletedPaths) || repair.originalDeletedPaths.length !== 0))
      || (!v1 && !v2)
      || !original || Object.keys(original).sort().join(',') !== 'baseSha,headBranch,headSha,number'
      || !Number.isSafeInteger(original.number) || original.number < 1
      || original.headBranch !== `eai-cli/${value.operationId}`
      || !/^[a-f0-9]{40}$/.test(original.headSha) || !/^[a-f0-9]{40}$/.test(original.baseSha)
      || !/^sha256:[a-f0-9]{64}$/.test(repair.originalFileChecksumsSha256)) {
      throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Review repair does not bind the original review and bounded replacement.');
    }
  }
  if (value.upload?.purpose !== undefined && (value.upload.purpose !== 'review-repair'
    || value.status !== 'pending_review' || !value.reviewRepair || value.deployment)) {
    throw new ManagedSourceError('MANAGED_SOURCE_BINDING_MISMATCH', 'Review repair upload authority is inconsistent with the original operation.');
  }
  return value;
}

/** Publication status cannot prove deployment readiness; the unified operation route owns success. */
export function classifyCliManagedSourceOperation(
  operation: CliManagedSourceOperation,
): "pending" | "failed" | "incomplete" {
  if (operation.status === "failed") return "failed";
  if (operation.status !== "completed") return "pending";
  return "incomplete";
}

/** Publication parsing retains the request deadline through response-body consumption. */
export async function responseOperation(
  response: Response,
): Promise<CliManagedSourceOperation> {
  if (!response.ok) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UNAVAILABLE",
      `Managed source operation is unavailable (${response.status}). Repair the platform operation or app-source access, then retry the exact operation.`,
    );
  }
  return JSON.parse(await readManagedPublicResponseText(response)) as CliManagedSourceOperation;
}

/** Poll one publication and return pending review distinctly from deployed readiness. */
export async function pollCliManagedSource(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  operationId: string,
  options: { wait: boolean; timeoutMs: number },
  initial?: CliManagedSourceOperation,
  dependencies: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<CliManagedSourceOperation> {
  if (!CLI_MANAGED_SOURCE_OPERATION_ID.test(operationId)) {
    throw new ManagedSourceError("MANAGED_SOURCE_BINDING_MISMATCH", "The publication ID does not match the canonical CLI-managed operation namespace.");
  }
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;
  const sleep =
    dependencies.sleep ||
    (async (ms: number): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  let operation =
    initial &&
    validateCliManagedSourceOperation(initial, scope, { operationId });
  const expected: ExpectedCliManagedSourceOperation = {
    operationId,
    templateCommitSha: initial?.templateCommitSha,
    bundleSha256: initial?.bundleSha256,
    configHash: initial?.configHash,
    githubLinkSessionId: initial?.githubLinkSessionId,
    verifiedGithubUser: initial?.verifiedGithubUser,
    sourceKind: initial ? (initial.sourceProvenance ? 'customer-merged-commit' : 'bundle') : undefined,
    sourceProvenance: initial?.sourceProvenance,
    customerAuthorization: initial?.customerAuthorization,
  };
  while (true) {
    if (!operation) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new ManagedSourceError(
          "SOURCE_OPERATION_TIMEOUT",
          `Operation ${operationId} did not finish within the polling deadline. Keep the original recovery receipt and use --retry ${operationId} against its saved gateway; do not dispatch a duplicate workflow.`,
        );
      }
      operation = validateCliManagedSourceOperation(
        await responseOperation(
          await client.getCliManagedSourceOperation(
            scope.tenantId,
            scope.appKey,
            operationId,
            scope.targetTenantId,
            scope.environment,
            remainingMs,
          ),
        ),
        scope,
        expected,
      );
    }
    expected.templateCommitSha = operation.templateCommitSha;
    expected.bundleSha256 = operation.bundleSha256;
    expected.configHash = operation.configHash;
    expected.githubLinkSessionId = operation.githubLinkSessionId;
    expected.verifiedGithubUser = operation.verifiedGithubUser;
    expected.sourceKind = operation.sourceProvenance ? 'customer-merged-commit' : 'bundle';
    expected.sourceProvenance = operation.sourceProvenance;
    expected.customerAuthorization = operation.customerAuthorization;
    if (
      !options.wait ||
      classifyCliManagedSourceOperation(operation) !== "pending" ||
      operation.status === "pending_review" ||
      Date.now() >= deadline
    ) {
      return operation;
    }
    const interval = Date.now() - startedAt < 30_000 ? 2_000 : 5_000;
    await sleep(Math.max(0, Math.min(interval, deadline - Date.now())));
    if (Date.now() >= deadline) return operation;
    operation = undefined;
  }
}
