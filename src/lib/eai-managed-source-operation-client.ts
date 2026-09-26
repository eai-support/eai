import { createHash } from "node:crypto";
import { PlatformAPIClient } from "./api.js";
import { ManagedSourceError } from "./eai-managed-source.js";
import type {
  CliManagedSourceOperation,
  CliManagedSourceScope,
} from "./eai-managed-source-client-types.js";

export interface ExpectedCliManagedSourceOperation {
  operationId?: string;
  templateCommitSha?: string;
  bundleSha256?: string;
  configHash?: string;
  githubLinkSessionId?: string;
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
  if (
    !value ||
    value.schemaVersion !== "eai.cli_managed_source_operation.v1" ||
    value.sourceMode !== "eai-cli-generated" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId) ||
    (expected?.operationId && value.operationId !== expected.operationId) ||
    value.actorId !== scope.actorId ||
    !scope.actorId ||
    value.tenantId !== scope.tenantId ||
    value.appKey !== scope.appKey ||
    value.targetTenantId !== scope.targetTenantId ||
    value.environment !== scope.environment ||
    !/^[a-f0-9]{40}$/.test(value.templateCommitSha) ||
    !/^sha256:[a-f0-9]{64}$/.test(value.bundleSha256) ||
    !/^sha256:[a-f0-9]{64}$/.test(value.configHash) ||
    (expected?.templateCommitSha &&
      value.templateCommitSha !== expected.templateCommitSha) ||
    (expected?.bundleSha256 && value.bundleSha256 !== expected.bundleSha256) ||
    (expected?.configHash && value.configHash !== expected.configHash) ||
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
    value.repository?.owner !== "eai-generated-apps" ||
    !/^[A-Za-z0-9_.-]+$/.test(value.repository?.name || "") ||
    value.verifiedGithubUser?.actorId !== scope.actorId ||
    !Number.isSafeInteger(value.verifiedGithubUser?.id) ||
    value.verifiedGithubUser.id < 1 ||
    typeof value.verifiedGithubUser.proofId !== "string" ||
    !value.verifiedGithubUser.proofId
  ) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_BINDING_MISMATCH",
      "Publication response does not match the authenticated actor, exact tenant/app/runtime scope and local-source snapshot.",
    );
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

export async function responseOperation(
  response: Response,
): Promise<CliManagedSourceOperation> {
  if (!response.ok) {
    throw new ManagedSourceError(
      "MANAGED_SOURCE_UNAVAILABLE",
      `Managed source operation is unavailable (${response.status}). Repair the platform operation or app-source access, then retry the exact operation.`,
    );
  }
  return (await response.json()) as CliManagedSourceOperation;
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
  };
  while (true) {
    operation =
      operation ||
      validateCliManagedSourceOperation(
        await responseOperation(
          await client.getCliManagedSourceOperation(
            scope.tenantId,
            scope.appKey,
            operationId,
            scope.targetTenantId,
            scope.environment,
          ),
        ),
        scope,
        expected,
      );
    expected.templateCommitSha = operation.templateCommitSha;
    expected.bundleSha256 = operation.bundleSha256;
    expected.configHash = operation.configHash;
    expected.githubLinkSessionId = operation.githubLinkSessionId;
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
    operation = undefined;
  }
}
