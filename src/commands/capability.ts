import { Command } from "commander";
import chalk from "chalk";
import { normalizeFormat, resolveCommandContext } from "../lib/context.js";
import {
  createCapabilityControlPlaneClient,
  formatControlPlaneError,
  sanitizeControlPlaneValue,
  type CapabilityDefinition,
  type TenantCapabilityConnection,
} from "../lib/capability-control-plane.js";
import * as out from "../lib/output.js";

interface CapabilityOptions {
  tenant?: string;
  format?: string;
  json?: boolean;
}

export interface CapabilityDiagnosis {
  gateApplied: boolean;
  ready: boolean | null;
}

export function diagnoseCapabilityConnections(
  connections: TenantCapabilityConnection[],
  gateApplied: boolean,
): CapabilityDiagnosis {
  return {
    gateApplied,
    ready: gateApplied
      ? connections.length > 0 &&
        connections.every(
          (item) =>
            item.entitled && item.configured && item.bound && item.runtimeReady,
        )
      : null,
  };
}

function printConnection(connection: TenantCapabilityConnection): void {
  out.heading(`Capability: ${connection.capabilityKey}`);
  out.table([
    ["Entitled", connection.entitled ? chalk.green("yes") : chalk.red("no")],
    [
      "Configured",
      connection.configured ? chalk.green("yes") : chalk.yellow("no"),
    ],
    ["Bound", connection.bound ? chalk.green("yes") : chalk.yellow("no")],
    [
      "Runtime ready",
      connection.runtimeReady ? chalk.green("yes") : chalk.yellow("no"),
    ],
  ]);
}

function tenantPortalRoute(
  definition: CapabilityDefinition,
  tenantId: string,
): string | null {
  if (!definition.portalRoute) return null;
  return definition.portalRoute
    .replaceAll("{tenantId}", encodeURIComponent(tenantId))
    .replaceAll("{tenant_id}", encodeURIComponent(tenantId));
}

function setupGuidance(
  definition: CapabilityDefinition,
  connection: TenantCapabilityConnection,
  tenantId: string,
) {
  const portalRoute = tenantPortalRoute(definition, tenantId);
  const sharedCommands = definition.cliOperations ?? [];
  let nextAction: string;

  switch (definition.setupMode) {
    case "portal_only":
      nextAction = portalRoute
        ? `Complete governed setup in Admin Portal: ${portalRoute}`
        : "Complete governed setup in Admin Portal.";
      break;
    case "portal_setup_cli_consume":
      nextAction = portalRoute
        ? `Complete OAuth or credential setup in Admin Portal, then return to CLI: ${portalRoute}`
        : "Complete OAuth or credential setup in Admin Portal, then return to CLI to test and bind it.";
      break;
    case "shared_setup":
      nextAction =
        sharedCommands.length > 0
          ? `Use the typed CLI command family: ${sharedCommands.join(", ")}`
          : "Use the typed CLI command family shown in capability documentation.";
      break;
    case "runtime_only":
      nextAction =
        "Bind the required runtime capability to the app, then validate app bindings.";
      break;
    default:
      nextAction =
        "Inspect the capability documentation or ask a platform administrator for setup guidance.";
  }

  return {
    tenantId,
    capabilityKey: definition.key,
    setupMode: definition.setupMode ?? "unknown",
    portalRoute,
    cliOperations: sharedCommands,
    readiness: connection,
    nextAction,
    mutated: false,
  };
}

async function context(options: CapabilityOptions) {
  const resolved = await resolveCommandContext({
    tenantId: options.tenant,
    interactive: !options.tenant,
  });
  return {
    ...resolved,
    controlPlane: createCapabilityControlPlaneClient(
      resolved.client,
      resolved.tenantId,
    ),
  };
}

function fail(error: unknown): never {
  out.error(formatControlPlaneError(error));
  process.exit(1);
}

export const capabilityCommand = new Command("capability").description(
  "Discover tenant capabilities and diagnose control-plane readiness",
);

capabilityCommand
  .command("list")
  .description("List capability definitions with tenant readiness")
  .option("--tenant <id>", "Tenant id (defaults to active tenant)")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .action(async (options: CapabilityOptions) => {
    try {
      const ctx = await context(options);
      const [definitions, connections] = await Promise.all([
        ctx.controlPlane.listDefinitions(),
        ctx.controlPlane.listConnections(),
      ]);
      const byKey = new Map(
        connections.map((connection) => [connection.capabilityKey, connection]),
      );
      const capabilities = definitions.map((definition) => ({
        ...definition,
        connection: byKey.get(definition.key) ?? null,
      }));
      if (normalizeFormat(options) === "json") {
        out.json(
          sanitizeControlPlaneValue({ tenantId: ctx.tenantId, capabilities }),
        );
        return;
      }
      out.heading(`Tenant capabilities: ${ctx.tenantId}`);
      if (capabilities.length === 0) {
        out.info("No capability definitions are available.");
        return;
      }
      for (const capability of capabilities) {
        const readiness = capability.connection;
        const status = readiness?.runtimeReady
          ? chalk.green("ready")
          : chalk.yellow("not ready");
        out.info(
          `${chalk.cyan(capability.key)} — ${capability.setupMode ?? "unknown"} — ${status}`,
        );
      }
    } catch (error) {
      fail(error);
    }
  });

capabilityCommand
  .command("status <key>")
  .description(
    "Show entitlement, configuration, binding, and runtime readiness separately",
  )
  .option("--tenant <id>", "Tenant id (defaults to active tenant)")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .action(async (key: string, options: CapabilityOptions) => {
    try {
      const ctx = await context(options);
      const connection = await ctx.controlPlane.getConnection(key);
      if (normalizeFormat(options) === "json") {
        out.json(
          sanitizeControlPlaneValue({ tenantId: ctx.tenantId, connection }),
        );
        return;
      }
      printConnection(connection);
    } catch (error) {
      fail(error);
    }
  });

capabilityCommand
  .command("setup <key>")
  .description(
    "Show the governed Portal or typed CLI setup path without changing credentials",
  )
  .option("--tenant <id>", "Tenant id (defaults to active tenant)")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .action(async (key: string, options: CapabilityOptions) => {
    try {
      const ctx = await context(options);
      const [definition, connection] = await Promise.all([
        ctx.controlPlane.getDefinition(key),
        ctx.controlPlane.getConnection(key),
      ]);
      if (!definition)
        throw new Error(`Capability definition ${key} was not found.`);
      const guidance = setupGuidance(definition, connection, ctx.tenantId);
      if (normalizeFormat(options) === "json") {
        out.json(sanitizeControlPlaneValue(guidance));
        return;
      }
      printConnection(connection);
      out.info(`Setup mode: ${chalk.cyan(String(guidance.setupMode))}`);
      out.info(guidance.nextAction);
    } catch (error) {
      fail(error);
    }
  });

capabilityCommand
  .command("doctor [key]")
  .description(
    "Diagnose the four independent readiness states for one or all capabilities",
  )
  .option("--tenant <id>", "Tenant id (defaults to active tenant)")
  .option("--format <format>", "Output format: text or json", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .action(async (key: string | undefined, options: CapabilityOptions) => {
    try {
      const ctx = await context(options);
      const connections = key
        ? [await ctx.controlPlane.getConnection(key)]
        : await ctx.controlPlane.listConnections();
      const diagnosis = {
        tenantId: ctx.tenantId,
        ...diagnoseCapabilityConnections(connections, key !== undefined),
        connections,
      };
      if (normalizeFormat(options) === "json") {
        out.json(sanitizeControlPlaneValue(diagnosis));
        if (connections.length === 0 || diagnosis.ready === false)
          process.exitCode = 1;
        return;
      }
      if (connections.length === 0) {
        out.warn("No capability connections are available for this tenant.");
        process.exitCode = 1;
        return;
      }
      for (const connection of connections) printConnection(connection);
      if (!diagnosis.gateApplied) {
        out.info(
          "Tenant capability diagnostics completed. Use a capability key or app bindings validate for a readiness gate.",
        );
      } else if (diagnosis.ready) {
        out.success("All selected capabilities are ready.");
      } else {
        out.warn("One or more readiness states require attention.");
        process.exitCode = 1;
      }
    } catch (error) {
      fail(error);
    }
  });
