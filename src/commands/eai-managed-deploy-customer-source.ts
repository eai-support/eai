import { bindManagedProjectRoot } from "../lib/eai-managed-root-binding.js";
import { getActiveProfile } from "../lib/profile.js";
import type { CliManagedGithubLinkSession } from "../lib/api.js";
import {
  assertManagedDeployStateMatchesOperation,
  buildManagedDeployConfigHash,
  classifyManagedOperationStatus,
  installCanonicalManagedDeployFiles,
  parseGitHubRepository,
  requireInstallationId,
  saveManagedDeployState,
  type ManagedDeployState,
} from "../lib/eai-managed-deploy.js";
import {
  apiMessage,
  fail,
  repositoryNextAction,
  requireApiSuccess,
  type ManagedDeployExecutionContext,
} from "./eai-managed-deploy-contract.js";
import {
  dispatchWorkflow,
  verifyGitHubAccess,
  verifyLocalSource,
} from "./eai-managed-deploy-github.js";
import {
  pollExactOperation,
  prepareRuntime,
  printOperation,
  readExactOperation,
} from "./eai-managed-deploy-operation.js";

/** SECURITY: bind reviewed customer source, its original profile and one-use nonce before dispatch. */
export async function startCustomerSource(
  execution: ManagedDeployExecutionContext,
  link: CliManagedGithubLinkSession,
): Promise<void> {
  const {
    context,
    client,
    options,
    appKey,
    targetTenantId,
    workflowPath,
    timeoutSeconds,
    format,
    spinner,
  } = execution;
  if (!options.repo || !options.installationId) {
    fail(
      "REPOSITORY_AUTHORITY_REQUIRED",
      "--repo and --installation-id are required for a new EAI deployment.",
      "Connect the repository to the tenant, install the EAI GitHub App, then pass both exact values.",
    );
  }
  const rootBinding = await bindManagedProjectRoot(context.root);
  const repository = parseGitHubRepository(options.repo);
  const installationId = requireInstallationId(options.installationId);
  const install = await installCanonicalManagedDeployFiles(
    context.root,
    workflowPath,
    rootBinding,
  );
  if (install.changed.length > 0 || install.pendingUpdates.length > 0) {
    const installed =
      install.changed.length > 0
        ? `Installed: ${install.changed.join(", ")}.`
        : "";
    const pending =
      install.pendingUpdates.length > 0
        ? ` Review candidates: ${install.pendingUpdates.join(", ")}.`
        : "";
    fail(
      "CANONICAL_WORKFLOW_UPDATE_REQUIRED",
      `${installed}${pending}`.trim(),
      "Review each candidate without losing local edits. Apply it to the canonical path, remove the candidate, then commit and push through the repository branch rules before retrying.",
    );
  }
  const source = await verifyLocalSource(
    context.root,
    repository.slug,
    options.branch,
    options.commit,
    rootBinding,
  );
  const verifiedGithubUser = link.verifiedGithubUser;
  if (!verifiedGithubUser) {
    fail(
      "GITHUB_LINK_PROOF_INVALID",
      "The verified browser handoff did not include a GitHub actor.",
      "Start the deployment again and complete GitHub browser linking.",
    );
  }
  await verifyGitHubAccess(
    repository.slug,
    source.branch,
    source.commitSha,
    undefined,
    verifiedGithubUser,
  );
  const configHash = await buildManagedDeployConfigHash(context.root, rootBinding);
  const ref = `refs/heads/${source.branch}`;
  const localE2eTunnel = /^https:\/\/[a-z0-9-]+-8000\.[a-z0-9-]+\.devtunnels\.ms$/.test(context.publicApiUrl);
  if (localE2eTunnel && !["dev", "preview"].includes(options.environment)) {
    fail("LOCAL_SOURCE_UNKNOWN_ENVIRONMENT_INVALID", "A local callback requires DEV or preview.", "Select an authorized DEV profile.");
  }

  await rootBinding.assert();
  await requireApiSuccess(
    await client.registerSourceUnknownApp(context.tenantId, appKey, {
      repoOwner: repository.owner,
      repoName: repository.name,
      repoUrl: `https://github.com/${repository.slug}`,
      defaultBranch: source.branch,
      workflowPath,
      ref,
      commitSha: source.commitSha,
      configPath: "src/eai.config",
      runtimePath: "eai.runtime.json",
      sourceMode: "source-unknown",
      adoptionMode: "connect-existing",
      installationId,
      githubLinkSessionId: link.sessionId,
      targetTenantId,
    }),
    "REPOSITORY_REGISTRATION_FAILED",
    (payload, status) =>
      repositoryNextAction(
        status,
        apiMessage(payload, ""),
        context.tenantId,
        repository.slug,
      ),
  );

  const setup = await requireApiSuccess(
    await client.setupSourceUnknownWorkflow(context.tenantId, appKey, {
      environment: options.environment,
      workflowPath,
      ref,
      commitSha: source.commitSha,
      configHash,
      targetTenantId,
      deployOnSuccess: true,
      localE2eTunnel,
      githubLinkSessionId: link.sessionId,
    }),
    "WORKFLOW_SETUP_FAILED",
    () =>
      "Confirm the app enrollment, repository authority, exact commit, and target tenant binding, then retry.",
  );
  const operationId =
    typeof setup.operationId === "string" ? setup.operationId : "";
  const nonce = typeof setup.nonce === "string" ? setup.nonce : "";
  if (!operationId || !nonce) {
    fail(
      "WORKFLOW_SETUP_INVALID",
      "PublicAPI did not return an operation ID and one-time nonce.",
      "Stop and inspect the PublicAPI/AdminAPI setup response.",
    );
  }
  client.assertProfileAuthority();
  const state: ManagedDeployState = {
    schema: "eai.managed-deploy-state.v1",
    tenantId: context.tenantId,
    targetTenantId,
    appKey,
    operationId,
    nonce,
    repo: repository.slug,
    branch: source.branch,
    ref,
    commitSha: source.commitSha,
    workflowPath,
    configHash,
    environment: options.environment,
    installationId,
    actorId: context.tokens.oid,
    githubLinkSessionId: link.sessionId,
    githubUserId: verifiedGithubUser.id,
    githubLogin: verifiedGithubUser.login,
    githubProofId: verifiedGithubUser.proofId,
    publicApiUrl: context.publicApiUrl,
    profileName: getActiveProfile(),
  };
  const setupBinding = setup.setup && typeof setup.setup === "object" ? setup.setup as Record<string, unknown> : {};
  const localBinding = setupBinding.localE2e && typeof setupBinding.localE2e === "object"
    ? setupBinding.localE2e as Record<string, unknown> : null;
  if (localE2eTunnel) {
    if (!localBinding || localBinding.mode !== "source-unknown-local-v1"
      || localBinding.origin !== context.publicApiUrl
      || typeof localBinding.expiresAt !== "string"
      || typeof localBinding.nonceDigest !== "string"
      || typeof localBinding.audience !== "string") {
      fail("LOCAL_SOURCE_UNKNOWN_SETUP_INVALID", "Server setup did not bind the exact local callback.", "Start a fresh source operation after the local DEV configuration is repaired.");
    }
    state.localE2eOrigin = localBinding.origin;
    state.localE2eExpiresAt = localBinding.expiresAt;
    state.localE2eNonceDigest = localBinding.nonceDigest;
    state.localE2eAudience = localBinding.audience;
  } else if (localBinding !== null) {
    fail("LOCAL_SOURCE_UNKNOWN_SETUP_UNEXPECTED", "Regional setup unexpectedly contains a local callback.", "Do not dispatch this operation.");
  }
  await saveManagedDeployState(state);
  const issuedOperation = await readExactOperation(
    client,
    state.tenantId,
    state.targetTenantId,
    state.appKey,
    state.operationId,
  );
  try {
    assertManagedDeployStateMatchesOperation(state, issuedOperation);
  } catch (error) {
    fail(
      "WORKFLOW_SETUP_BINDING_MISMATCH",
      error instanceof Error ? error.message : String(error),
      "Do not dispatch this operation. Start a fresh deployment only after PublicAPI returns the exact actor, tenant, repository, commit, configuration and nonce binding.",
    );
  }
  await rootBinding.assert();
  await prepareRuntime(client, state);
  await rootBinding.assert();
  await dispatchWorkflow(state, context.publicApiUrl, context.root);

  const operation = await pollExactOperation(
    client,
    state,
    options.wait,
    timeoutSeconds,
  );
  spinner?.stop();
  printOperation(format, operation, {
    repo: state.repo,
    ref: state.ref,
    commitSha: state.commitSha,
    configHash: state.configHash,
  });
  if (classifyManagedOperationStatus(operation) === "failed")
    process.exitCode = 1;
}
