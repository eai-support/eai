import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import { PlatformAPIClient } from "../lib/api.js";
import { getBrowserOpenCommand } from "../lib/auth.js";
import { normalizeFormat, resolveCommandContext } from "../lib/context.js";
import { classifyManagedOperationStatus, requireManagedPublicApiUrl } from "../lib/eai-managed-deploy.js";
import { CLI_MANAGED_SOURCE_OPERATION_ID, isManagedScopeIdentifier } from "../lib/eai-managed-identifiers.js";
import { cliManagedSourceMovePortalOrigin } from "../lib/eai-managed-source-link-client.js";
import { responseOperation, validateCliManagedSourceOperation } from "../lib/eai-managed-source-operation-client.js";
import type { CliManagedSourceScope } from "../lib/eai-managed-source-client-types.js";
import * as out from "../lib/output.js";
import { fail, MANAGED_DEPLOY_ENVIRONMENTS } from "./eai-managed-deploy-contract.js";
import { readUnifiedExactOperation } from "./eai-managed-deploy-operation.js";
import { printFailure } from "./eai-managed-deploy-output.js";

const exec = promisify(execFile);

interface MoveOptions {
  tenantId: string;
  targetTenantId: string;
  environment: string;
  sourceOperation: string;
  open: boolean;
  format: string;
}

/** The CLI opens a bound Portal handoff; the Portal alone obtains the recipient App user token. */
export const eaiManagedSourceCommand = new Command("source")
  .description("Manage the source of an EAI-hosted app");

eaiManagedSourceCommand.command("move")
  .description("Continue a completed EAI-managed source move in the browser")
  .argument("<app-key>", "Existing EAI app key")
  .requiredOption("--tenant-id <id>", "Company tenant that owns the app")
  .requiredOption("--target-tenant-id <id>", "Exact deployed runtime tenant")
  .requiredOption("--environment <environment>", "Exact deployment environment")
  .requiredOption("--source-operation <id>", "Completed CLI source operation ID")
  .option("--no-open", "Print the verified Portal handoff without opening a browser")
  .option("--format <format>", "Output format (text|json)", "text")
  .action(async (appKey: string, options: MoveOptions) => {
    const format = normalizeFormat(options);
    try {
      if (format !== "text" && format !== "json") {
        fail("FORMAT_INVALID", "Choose text or json output.", "Use --format text or --format json.");
      }
      if (![appKey, options.tenantId, options.targetTenantId].every(isManagedScopeIdentifier)
        || !MANAGED_DEPLOY_ENVIRONMENTS.has(options.environment)
        || !CLI_MANAGED_SOURCE_OPERATION_ID.test(options.sourceOperation)) {
        fail("SOURCE_MOVE_SCOPE_INVALID", "The app, tenants, environment or source operation is invalid.", "Use the exact values from the completed EAI-managed deployment receipt.");
      }
      const context = await resolveCommandContext({
        tenantId: options.tenantId,
        interactive: false,
        forceRefresh: true,
        validatePublicApiUrl: requireManagedPublicApiUrl,
      });
      if (context.tenantId !== options.tenantId || !context.tokens.oid) {
        fail("SOURCE_MOVE_ACTOR_INVALID", "The active EAI actor does not match the requested tenant.", "Select the original app tenant and sign in as the original EAI actor.");
      }
      const scope: CliManagedSourceScope = {
        tenantId: options.tenantId,
        targetTenantId: options.targetTenantId,
        environment: options.environment as CliManagedSourceScope["environment"],
        appKey,
        actorId: context.tokens.oid,
      };
      const client = new PlatformAPIClient(context.publicApiUrl, scope.tenantId);
      const source = validateCliManagedSourceOperation(
        await responseOperation(await client.getCliManagedSourceOperation(
          scope.tenantId, appKey, options.sourceOperation, scope.targetTenantId, scope.environment,
        )),
        scope,
        { operationId: options.sourceOperation },
      );
      if (source.status !== "completed"
        || !Number.isSafeInteger(source.repository.id) || (source.repository.id ?? 0) < 1
        || !source.repository.nodeId || !/^[a-f0-9]{40}$/.test(source.review?.mergedSha || "")) {
        fail("SOURCE_MOVE_NOT_READY", "The exact source operation lacks completed review and immutable repository evidence.", "Finish the original EAI-managed deployment, then retry this exact source operation.");
      }
      const deployment = await readUnifiedExactOperation(
        client, scope.tenantId, scope.targetTenantId, appKey, options.sourceOperation,
      );
      if (deployment.sourceMode !== "eai-cli-generated"
        || deployment.environment !== scope.environment
        || classifyManagedOperationStatus(deployment) !== "succeeded"
        || deployment.sourceRevision?.repositoryId !== source.repository.id
        || deployment.sourceRevision?.sourceCommitSha !== source.review?.mergedSha) {
        fail("SOURCE_MOVE_DEPLOYMENT_MISMATCH", "The exact CLI source is not the observed active deployment.", "Resolve the original deployment and read its current source receipt before moving ownership.");
      }
      const url = new URL(`/platform/apps/${encodeURIComponent(appKey)}/deployment`, cliManagedSourceMovePortalOrigin(context.publicApiUrl));
      url.searchParams.set("sourceChoice", "move");
      url.searchParams.set("sourceOperationId", source.operationId);
      if (options.open) {
        try {
          const opener = getBrowserOpenCommand(url.href);
          await exec(opener.command, opener.args);
        } catch {
          fail("SOURCE_MOVE_BROWSER_REQUIRED", "The verified Portal page could not be opened.", `Open ${url.href} in your existing browser to continue.`);
        }
      }
      const result = {
        status: "browser_handoff",
        appKey,
        sourceOperationId: source.operationId,
        repositoryId: source.repository.id,
        portalUrl: url.href,
        nextAction: "Sign in to the Portal as the original EAI actor, authorize the exact private customer destination, then complete and verify the native GitHub transfer there.",
      };
      if (format === "json") out.json(result);
      else {
        out.success("Source move is ready for customer authorization in the Portal.");
        out.info(`${result.nextAction} ${url.href}`);
      }
    } catch (error) {
      printFailure(format, error);
    }
  });
