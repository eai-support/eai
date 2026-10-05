import type { CliManagedGithubLinkSession } from "../lib/api.js";
import {
  buildCliManagedSourceBundle,
  writeCliManagedSourceReceipt,
} from "../lib/eai-managed-source.js";
import {
  pollCliManagedSource,
  recoverAcceptedCliManagedSourceUpload,
  recoverLegacyCliManagedSourceReview,
  recoverReviewedCliManagedSourceEvidence,
  resumeCliManagedSourceUpload,
  submitCliManagedSource,
} from "../lib/eai-managed-source-client.js";
import {
  NEW_SOURCE_OPERATION_ACTION,
  fail,
  type ManagedDeployExecutionContext,
} from "./eai-managed-deploy-contract.js";
import { saveManagedRecoveryAuthority } from "./eai-managed-deploy-recovery.js";
import { getActiveProfile } from "../lib/profile.js";
import { printManagedSourceCompletion } from "./eai-managed-deploy-output.js";

/** Resume only observes; upload retry requires the orchestrator's protected original receipt. */
export async function resumeManagedSource(
  execution: ManagedDeployExecutionContext,
  operationId: string,
): Promise<void> {
  const {
    client,
    managedScope,
    context,
    options,
    timeoutSeconds,
    spinner,
    format,
    missingCliSourceRetryAuthority,
  } = execution;
  let current = await pollCliManagedSource(client, managedScope, operationId, {
    wait: false,
    timeoutMs: timeoutSeconds * 1_000,
  });
  if (current.status === "failed") {
    fail(
      "SOURCE_OPERATION_INACTIVE",
      `EAI-maintained source operation ${operationId} failed and cannot reuse its publication authority.`,
      NEW_SOURCE_OPERATION_ACTION,
    );
  }
  if (options.retry && current.status === 'pending_review' && current.review
    && current.repository.id && current.repository.nodeId
    && (!current.reviewRepair || current.upload?.purpose === 'review-repair')
    && (current.bundleSchemaVersion ?? 'eai.cli_managed_source_bundle.v1') === 'eai.cli_managed_source_bundle.v1') {
    if (missingCliSourceRetryAuthority) fail('RETRY_AUTHORITY_UNAVAILABLE',
      'The original review has no protected local retry authority.', `Restore its original recovery authority before retrying ${operationId}.`);
    const { bundle } = await buildCliManagedSourceBundle(context.root);
    current = await recoverLegacyCliManagedSourceReview(client, managedScope, current, bundle);
  }
  if (options.retry && current.status === 'pending_review' && current.review
    && current.repository.id && current.repository.nodeId
    && (!current.reviewRepair || current.upload?.purpose === 'review-repair')
    && current.bundleSchemaVersion === 'eai.cli_managed_source_bundle.v2') {
    if (missingCliSourceRetryAuthority) fail('RETRY_AUTHORITY_UNAVAILABLE',
      'The original review has no protected local retry authority.', `Restore its original recovery authority before retrying ${operationId}.`);
    const { bundle } = await buildCliManagedSourceBundle(context.root);
    current = await recoverReviewedCliManagedSourceEvidence(client, managedScope, current, bundle);
  }
  if (
    options.retry &&
    (current.status === "accepted" || current.status === "publishing")
  ) {
    const { bundle } = await buildCliManagedSourceBundle(context.root);
    if (current.status === "publishing" && missingCliSourceRetryAuthority) {
      fail(
        "RETRY_AUTHORITY_UNAVAILABLE",
        "The original publishing operation has no protected local retry authority.",
        `Restore its original recovery authority and retry ${operationId}; do not start another source operation.`,
      );
    }
    const uploadExpiresAt = current.upload && Date.parse(current.upload.expiresAt);
    const uploadExpired = uploadExpiresAt !== undefined &&
      Number.isFinite(uploadExpiresAt) && uploadExpiresAt <= Date.now();
    if ((current.status === "accepted" && (missingCliSourceRetryAuthority || !current.upload || uploadExpired)) ||
        (current.status === "publishing" && (!current.upload || uploadExpired))) {
      client.assertProfileAuthority();
      current = await recoverAcceptedCliManagedSourceUpload(
        client, managedScope, current, bundle,
        async (prepared) => {
          client.assertProfileAuthority();
          await saveManagedRecoveryAuthority({
            schema: "eai.managed-recovery-authority.v1", operationId: prepared.operationId,
            tenantId: managedScope.tenantId, targetTenantId: managedScope.targetTenantId,
            appKey: managedScope.appKey, actorId: managedScope.actorId,
            publicApiUrl: context.publicApiUrl,
            profileName: getActiveProfile(),
          });
        },
      );
    } else if (current.upload) {
      current = await resumeCliManagedSourceUpload(client, managedScope, current, bundle);
    }
  }
  const operation = await pollCliManagedSource(
    client,
    managedScope,
    operationId,
    { wait: options.wait, timeoutMs: timeoutSeconds * 1_000 },
    current,
  );
  spinner?.stop();
  await printManagedSourceCompletion(
    client,
    managedScope,
    operation,
    options.wait,
    timeoutSeconds,
    format,
  );
}

/** SECURITY: save the original profile and actor authority before any managed source upload. */
export async function startManagedSource(
  execution: ManagedDeployExecutionContext,
  link: CliManagedGithubLinkSession,
): Promise<void> {
  const {
    client,
    managedScope,
    context,
    options,
    timeoutSeconds,
    spinner,
    format,
  } = execution;
  const { bundle } = await buildCliManagedSourceBundle(context.root);
  await writeCliManagedSourceReceipt(context.root, bundle);
  const submitted = await submitCliManagedSource(
    client,
    managedScope,
    link,
    bundle,
    async (prepared) => {
      client.assertProfileAuthority();
      await saveManagedRecoveryAuthority({
        schema: "eai.managed-recovery-authority.v1", operationId: prepared.operationId,
        tenantId: managedScope.tenantId, targetTenantId: managedScope.targetTenantId,
        appKey: managedScope.appKey, actorId: managedScope.actorId,
        publicApiUrl: context.publicApiUrl,
        profileName: getActiveProfile(),
      });
    },
  );
  const operation = await pollCliManagedSource(
    client,
    managedScope,
    submitted.operationId,
    { wait: options.wait, timeoutMs: timeoutSeconds * 1_000 },
    submitted,
  );
  spinner?.stop();
  await printManagedSourceCompletion(
    client,
    managedScope,
    operation,
    options.wait,
    timeoutSeconds,
    format,
  );
}
