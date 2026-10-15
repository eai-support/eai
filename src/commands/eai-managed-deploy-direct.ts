import {
  DirectSourceClient,
  directSourceTransitionLine,
  isDirectSourceTerminal,
  pollDirectSourceOperation,
  type DirectSourceOperation,
  type DirectSourceScope,
} from "../lib/eai-direct-source-client.js";
import { buildCliManagedSourceBundle } from "../lib/eai-managed-source.js";
import * as out from "../lib/output.js";
import type { ManagedDeployExecutionContext } from "./eai-managed-deploy-contract.js";

/** Injected only by tests; production polling keeps the contract cadence. */
export const directSourcePollDependencies: {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
} = {};

function resumeCommand(scope: DirectSourceScope, operation: DirectSourceOperation): string {
  return `eai deploy app ${scope.appKey} --target eai --tenant-id ${scope.tenantId} --target-tenant-id ${scope.targetTenantId} --environment ${operation.environment} --source direct --resume ${operation.operationId}`;
}

function nextAction(scope: DirectSourceScope, operation: DirectSourceOperation): string {
  if (operation.status === "ready") return `Open ${operation.activeUrl}. Rerun the same deploy after local edits; unchanged source reuses this operation.`;
  if (operation.status === "failed") return `Fix the reported ${operation.failure?.reason ?? "failure"}, then rerun the same deploy. Quote operation ${operation.operationId} to EAI support if the failure is not in your source.`;
  return `Continue observing the exact operation with: ${resumeCommand(scope, operation)}`;
}

/** Text mode prints one line per transition; JSON mode emits a single object after the terminal read. */
async function observeDirectSource(
  transport: DirectSourceClient,
  execution: ManagedDeployExecutionContext,
  scope: DirectSourceScope,
  operationId: string,
  initial: DirectSourceOperation | undefined,
): Promise<void> {
  const { options, timeoutSeconds, format } = execution;
  const transitions: Array<{ line: string; status: DirectSourceOperation["status"]; observedAt: string }> = [];
  const operation = await pollDirectSourceOperation(transport, scope, operationId, {
    wait: options.wait,
    timeoutMs: timeoutSeconds * 1_000,
    sleep: directSourcePollDependencies.sleep,
    random: directSourcePollDependencies.random,
    onTransition: (line, current) => {
      transitions.push({ line, status: current.status, observedAt: new Date().toISOString() });
      if (format !== "json") out.info(line);
    },
  }, initial);
  if (format !== "json" && !transitions.length) out.info(directSourceTransitionLine(operation));
  const action = nextAction(scope, operation);
  if (format === "json") {
    out.json({
      ok: operation.status === "ready",
      source: "direct",
      sourceMode: operation.sourceMode,
      tenantId: operation.tenantId,
      targetTenantId: operation.targetTenantId,
      appKey: operation.appKey,
      environment: operation.environment,
      operationId: operation.operationId,
      status: operation.status,
      bundleSha256: operation.bundleSha256,
      templateCommitSha: operation.templateCommitSha,
      configHash: operation.configHash,
      build: operation.build,
      imageDigest: operation.imageDigest,
      deploymentId: operation.deploymentId,
      activeUrl: operation.activeUrl,
      failure: operation.failure,
      transitions,
      nextAction: action,
    });
  } else {
    if (operation.status === "failed" && operation.build?.logTail) {
      out.info("Build log tail:");
      out.info(operation.build.logTail);
    }
    if (!isDirectSourceTerminal(operation) || operation.status === "failed") out.info(action);
  }
  if (operation.status === "failed") process.exitCode = 1;
}

/** Direct mode never links GitHub: bundle, POST contract §3 under its idempotency key, then observe. */
export async function startDirectSource(execution: ManagedDeployExecutionContext): Promise<void> {
  const { client, managedScope, context, spinner } = execution;
  const { bundle } = await buildCliManagedSourceBundle(context.root);
  const transport = new DirectSourceClient(client, context.publicApiUrl, managedScope.tenantId);
  const submitted = await transport.submit(managedScope, bundle, { timeoutMs: execution.timeoutSeconds * 1_000 });
  spinner?.stop();
  await observeDirectSource(transport, execution, managedScope, submitted.operationId, submitted);
}

/** Resume observes only; the sealed operation supplies its environment unless the caller pinned one. */
export async function resumeDirectSource(
  execution: ManagedDeployExecutionContext,
  operationId: string,
  environmentExplicit: boolean,
): Promise<void> {
  const { client, managedScope, context, spinner } = execution;
  const transport = new DirectSourceClient(client, context.publicApiUrl, managedScope.tenantId);
  const scope: DirectSourceScope = environmentExplicit
    ? managedScope
    : { tenantId: managedScope.tenantId, appKey: managedScope.appKey, targetTenantId: managedScope.targetTenantId, actorId: managedScope.actorId };
  spinner?.stop();
  await observeDirectSource(transport, execution, scope, operationId, undefined);
}
