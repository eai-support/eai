import { Command } from "commander";
import {
  makeSpinner,
  normalizeFormat,
  resolveCommandContext,
} from "../lib/context.js";
import {
  EAI_MANAGED_WORKFLOW_PATH,
  requireManagedPublicApiUrl,
} from "../lib/eai-managed-deploy.js";
import { chooseManagedDeploySource } from "../lib/eai-managed-source.js";
import {
  verifyCliGithubIdentity,
  type CliManagedSourceScope,
} from "../lib/eai-managed-source-client.js";
import { startCustomerSource } from "./eai-managed-deploy-customer-source.js";
import {
  DEFAULT_TIMEOUT_SECONDS,
  fail,
  type ManagedDeployExecutionContext,
  type ManagedDeployOptions,
} from "./eai-managed-deploy-contract.js";
import {
  startManagedSource,
  resumeManagedSource,
} from "./eai-managed-deploy-managed-source.js";
import { printFailure } from "./eai-managed-deploy-output.js";
import {
  resumeCustomerSource,
  retryCustomerSource,
} from "./eai-managed-deploy-retry.js";
import { validateManagedDeployInput } from "./eai-managed-deploy-validation.js";

export {
  managedDeployPollDelayMs,
  verifyGitHubAccess,
} from "./eai-managed-deploy-github.js";
export type { VerifiedGitHubActor } from "./eai-managed-deploy-contract.js";

export const eaiManagedDeployCommand = new Command("app")
  .description(
    "Deploy local app source through EAI-maintained or customer-owned GitHub to TenantInfra",
  )
  .argument("<app-key>", "Existing EAI app key")
  .requiredOption("--target <target>", "Hosting target (eai)")
  .requiredOption(
    "--tenant-id <id>",
    "Company tenant that owns the app enrollment",
  )
  .option(
    "--target-tenant-id <id>",
    "Required exact tenant that receives the deployed runtime",
  )
  .option("--repo <owner/name>", "Exact GitHub repository")
  .option(
    "--source <source>",
    "Source ownership (eai-managed|customer-owned); required without an interactive prompt",
  )
  .option(
    "--github-link-session <session-id>",
    "Resume the exact EAI-account GitHub browser verification",
  )
  .option("--installation-id <id>", "Exact EAI GitHub App installation ID")
  .option("--branch <branch>", "Exact branch to bind and dispatch", "main")
  .option(
    "--workflow <path>",
    "Canonical EAI workflow path",
    EAI_MANAGED_WORKFLOW_PATH,
  )
  .option("--environment <environment>", "Deployment environment", "preview")
  .option("--commit <sha>", "Expected exact 40 character commit SHA")
  .option(
    "--resume <operation-id>",
    "Read and wait for one exact existing operation",
  )
  .option(
    "--retry <operation-id>",
    "Retry evidence handoff, resume dispatched work, or start an undispatched operation",
  )
  .option(
    "--wait",
    "Poll the exact operation until it reaches a terminal status",
    true,
  )
  .option(
    "--no-wait",
    "Return after dispatch instead of polling the exact operation",
  )
  .option(
    "--timeout <seconds>",
    "Maximum exact-operation polling time",
    String(DEFAULT_TIMEOUT_SECONDS),
  )
  .option("--format <format>", "Output format (text|json)", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .addHelpText(
    "after",
    `
Examples:
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --source eai-managed
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --source customer-owned --repo org/planning-portal --installation-id 12345
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --environment preview --source eai-managed --resume cli-managed-source-abc123 --format json
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --resume source-unknown-abc123 --wait --format json
  $ eai deploy app planning-portal --target eai --tenant-id tenant-1 --target-tenant-id tenant-1 --retry source-unknown-abc123 --wait
`,
  )
  .action(async (appKeyValue: string, options: ManagedDeployOptions) => {
    const format = normalizeFormat(options);
    const spinner = makeSpinner(format, "Preparing EAI managed deployment...");
    try {
      const { appKey, targetTenantId, workflowPath, timeoutSeconds } =
        validateManagedDeployInput(appKeyValue, options);
      const context = await resolveCommandContext({
        tenantId: options.tenantId,
        interactive: false,
        forceRefresh: true,
        validatePublicApiUrl: requireManagedPublicApiUrl,
      });
      if (context.tenantId !== options.tenantId) {
        fail(
          "TENANT_ACCOUNT_MISMATCH",
          `Active tenant ${context.tenantId} does not match ${options.tenantId}.`,
          `Run \`eai tenant select ${options.tenantId}\`, then confirm with \`eai whoami\`.`,
        );
      }
      const managedScope: CliManagedSourceScope = {
        tenantId: context.tenantId,
        targetTenantId,
        appKey,
        environment:
          options.environment as CliManagedSourceScope["environment"],
        actorId: context.tokens.oid || "",
      };
      const execution: ManagedDeployExecutionContext = {
        context,
        client: context.client,
        managedScope,
        options,
        appKey,
        targetTenantId,
        workflowPath,
        timeoutSeconds,
        format,
        spinner,
      };

      if (
        options.source === "eai-managed" &&
        (options.resume || options.retry)
      ) {
        await resumeManagedSource(
          execution,
          (options.resume || options.retry)!,
        );
        return;
      }
      if (options.resume) {
        await resumeCustomerSource(execution, options.resume);
        return;
      }
      if (options.retry) {
        await retryCustomerSource(execution, options.retry);
        return;
      }

      spinner?.stop();
      const sourceChoice = await chooseManagedDeploySource({
        source: options.source,
        repo: options.repo,
        format,
      });
      if (
        sourceChoice === "eai-managed" &&
        (options.repo ||
          options.installationId ||
          options.commit ||
          options.branch !== "main")
      ) {
        fail(
          "SOURCE_CHOICE_CONFLICT",
          "EAI derives the maintained repository, branch and merged commit.",
          "Omit --repo, --installation-id, --branch and --commit for EAI-maintained local source.",
        );
      }
      if (
        sourceChoice === "customer-owned" &&
        (!options.repo || !options.installationId)
      ) {
        fail(
          "REPOSITORY_AUTHORITY_REQUIRED",
          "--repo and --installation-id are required for a new EAI deployment.",
          "Connect the repository to the tenant, install the EAI GitHub App, then pass both exact values.",
        );
      }
      const link = await verifyCliGithubIdentity(context.client, managedScope, {
        sessionId: options.githubLinkSession,
        interactive: Boolean(
          process.stdin.isTTY && process.stdout.isTTY && format !== "json",
        ),
        timeoutMs: timeoutSeconds * 1_000,
      });
      spinner?.start();
      if (sourceChoice === "eai-managed") {
        await startManagedSource(execution, link);
        return;
      }
      await startCustomerSource(execution, link);
    } catch (error) {
      spinner?.fail("EAI managed deployment stopped");
      printFailure(format, error);
    }
  });
