import type { CliManagedGithubLinkSession } from "../lib/api.js";
import {
  buildCliManagedSourceBundle,
  writeCliManagedSourceReceipt,
} from "../lib/eai-managed-source.js";
import {
  pollCliManagedSource,
  resumeCliManagedSourceUpload,
  submitCliManagedSource,
} from "../lib/eai-managed-source-client.js";
import type { ManagedDeployExecutionContext } from "./eai-managed-deploy-contract.js";
import { printManagedSourceCompletion } from "./eai-managed-deploy-output.js";

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
  } = execution;
  let current = await pollCliManagedSource(client, managedScope, operationId, {
    wait: false,
    timeoutMs: timeoutSeconds * 1_000,
  });
  if (
    (current.status === "accepted" || current.status === "publishing") &&
    current.upload
  ) {
    const { bundle } = await buildCliManagedSourceBundle(context.root);
    current = await resumeCliManagedSourceUpload(
      client,
      managedScope,
      current,
      bundle,
    );
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
