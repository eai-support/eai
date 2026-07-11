/**
 * eai tenant — manage tenants on the platform.
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import inquirer from "inquirer";
import { findProjectRoot } from "../lib/config.js";
import {
  PlatformAPIClient,
  parseApiError,
  type ChildTenantBootstrapResult,
  type TenantHomeRegion,
  type ParsedApiError,
} from "../lib/api.js";
import { loadTokens } from "../lib/auth.js";
import {
  buildPublicApiEnvSyncNotice,
  fetchTenantAdminMemberships,
  normalizeHomeRegion,
  refreshTenantUsabilityStatus,
  resolveActiveTenantContext,
  resolvePublicApiUrl,
  type TenantUsabilityStatus,
} from "../lib/tenant-context.js";
import {
  buildTenantHierarchyTreeLines,
  flattenTenantHierarchy,
  loadTenantHierarchy,
  promptForTenantFromHierarchy,
  tenantHierarchyJson,
} from "../lib/tenant-hierarchy.js";
import * as out from "../lib/output.js";
import { ErrorCode, exitWithError } from "../lib/error-codes.js";

export {
  filterTenantAdminEntries,
  tenantEntryHasTenantAdminRole,
  type TenantEntry,
  type TenantRoleAssignment,
} from "../lib/tenant-context.js";
export {
  buildTenantHierarchy,
  buildTenantHierarchyTreeLines,
  loadTenantHierarchy,
  tenantMatchesParent,
  type TenantHierarchyItem,
} from "../lib/tenant-hierarchy.js";

export interface TenantListZeroState {
  headline: string;
  tenantContext?: string;
  hint: string;
}

export interface TenantCreateOutcome {
  tenant: Record<string, unknown>;
  bootstrap?: ChildTenantBootstrapResult;
  bootstrapError?: ParsedApiError;
  usability: TenantUsabilityStatus;
}

const HOME_REGION_CHOICES: Array<{ name: string; value: TenantHomeRegion }> = [
  { name: "Australia / New Zealand (au)", value: "au" },
  { name: "Canada / Americas (ca)", value: "ca" },
  { name: "Europe / UK (eu)", value: "eu" },
];

interface TenantBootstrapAdminCommandOptions {
  parent: string;
  child: string;
  userOid?: string;
  userEmail?: string;
  format: string;
  json?: boolean;
}


export function extractCreatedTenantRecord(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const nestedDoc = payload.doc;
  if (nestedDoc && typeof nestedDoc === "object" && !Array.isArray(nestedDoc)) {
    return nestedDoc as Record<string, unknown>;
  }

  return payload;
}

function normalizeTenantCreateHomeRegion(
  value: unknown,
): TenantHomeRegion | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const region = normalizeHomeRegion(String(value));
  if (!region) {
    throw new Error("home-region must be one of au, ca, or eu.");
  }
  return region;
}

async function resolveChildTenantHomeRegion(options: {
  requested?: unknown;
  parentHomeRegion?: string | null;
  interactive: boolean;
}): Promise<TenantHomeRegion | undefined> {
  const requested = normalizeTenantCreateHomeRegion(options.requested);
  if (requested) return requested;

  const parentRegion = normalizeHomeRegion(options.parentHomeRegion);
  if (!options.interactive) return parentRegion || undefined;

  const answer = await inquirer.prompt([
    {
      type: "select",
      name: "homeRegion",
      message: "Child tenant home region:",
      default: parentRegion || undefined,
      choices: HOME_REGION_CHOICES,
    },
  ]);
  return normalizeTenantCreateHomeRegion(answer.homeRegion);
}

export function buildTenantListZeroState(tokens: {
  tenantName?: string;
  tenantId?: string;
}): TenantListZeroState {
  const zeroState: TenantListZeroState = {
    headline: "No active tenant-admin memberships found for the current login.",
    hint: "Use `eai whoami` to inspect the authenticated tenant context.",
  };

  if (tokens.tenantName || tokens.tenantId) {
    const tenantName = tokens.tenantName || "current authenticated tenant";
    const tenantId = tokens.tenantId ? ` (${tokens.tenantId})` : "";
    zeroState.tenantContext = `Authenticated tenant context: ${tenantName}${tenantId}`;
  }

  return zeroState;
}

export function buildTenantCreateStatusMessages(
  outcome: TenantCreateOutcome,
): string[] {
  const messages: string[] = [];

  if (outcome.bootstrap) {
    if (outcome.bootstrap.status === "bootstrapped") {
      messages.push(
        "Bootstrap: first tenant admin was provisioned for the current login.",
      );
    } else if (outcome.bootstrap.status === "already-usable") {
      messages.push(
        "Bootstrap: the current login already had direct tenant-admin on the child tenant.",
      );
    }
  } else if (outcome.bootstrapError) {
    const prefix = outcome.bootstrapError.code
      ? `${outcome.bootstrapError.code}: `
      : "";
    messages.push(
      `Bootstrap not confirmed: ${prefix}${outcome.bootstrapError.message}`,
    );
  }

  if (outcome.usability.usable) {
    messages.push(
      outcome.usability.autoSelected
        ? "Usable: direct tenant-admin confirmed and the new tenant was selected."
        : "Usable: direct tenant-admin confirmed.",
    );
  } else {
    messages.push(
      "Usable: not yet confirmed. The tenant exists, but direct tenant-admin membership is not visible yet.",
    );
  }

  return messages;
}

function reportPublicApiEnvSync(
  result: Awaited<
    ReturnType<typeof resolveActiveTenantContext>
  >["publicApiEnvSync"],
): void {
  const notice = buildPublicApiEnvSyncNotice(result);
  if (!notice) return;

  if (notice.level === "warn") {
    out.warn(notice.message);
  } else {
    out.success(notice.message);
  }
}

export function buildTenantBootstrapAdminStatusMessages(
  result: ChildTenantBootstrapResult,
): string[] {
  const messages: string[] = [];

  if (result.status === "bootstrapped") {
    messages.push(
      "Bootstrap: tenant-admin access was provisioned for the target user.",
    );
  } else if (result.status === "already-usable") {
    messages.push(
      "Bootstrap: the target user already had direct tenant-admin on the child tenant.",
    );
  }

  messages.push(
    result.membershipCreated
      ? "Membership: child tenant membership was created."
      : "Membership: child tenant membership already existed or did not need creation.",
  );
  messages.push(
    result.adminAssigned
      ? "Role: tenant-admin was assigned on the child tenant."
      : "Role: tenant-admin was already assigned or did not need assignment.",
  );
  messages.push(
    result.usable
      ? "Usable: direct tenant-admin confirmed for the child tenant."
      : "Usable: not yet confirmed. Re-run `eai tenant list` or `eai whoami` after membership propagation.",
  );

  return messages;
}

export const tenantCommand = new Command("tenant").description(
  "Manage tenants on the platform",
);

const tenantStorageCommand = new Command("storage").description(
  "Inspect tenant storage configuration",
);

tenantStorageCommand
  .command("list")
  .description(
    "List published storage bindings and operational connections for the active tenant",
  )
  .option("--format <format>", "Output format (text|json)", "text")
  .action(async (options) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const context = await resolveActiveTenantContext({
      projectRoot: root || undefined,
      publicApiUrl,
      interactive: true,
    });

    const client = new PlatformAPIClient(publicApiUrl, context.activeTenant.id);
    const response = await client.getStorageStatus();
    if (!response.ok) {
      out.error(
        `Failed to fetch storage status: ${response.status} ${response.statusText}`,
      );
      process.exit(1);
    }

    const payload = (await response.json()) as {
      objectTypes: Array<{
        objectType: string;
        backend: string;
        metadataStatus: string;
        routeSource: string;
        isReady: boolean;
      }>;
      connections: Array<{
        storage_backend: string;
        endpoint?: string;
        database_name?: string;
        container_name?: string;
        index_name?: string;
      }>;
    };

    if (options.format === "json") {
      out.json(payload);
      return;
    }

    out.success(
      `${payload.objectTypes.length} object type${payload.objectTypes.length === 1 ? "" : "s"} with storage metadata`,
    );
    for (const item of payload.objectTypes) {
      const readiness = item.isReady
        ? chalk.green("ready")
        : chalk.yellow("pending");
      out.info(
        `${chalk.cyan(item.objectType)} [${item.backend}] ${readiness} ${chalk.dim(`(${item.routeSource})`)}`,
      );
    }

    if (payload.connections.length > 0) {
      out.blank();
      out.info(chalk.bold("Operational connections"));
      for (const connection of payload.connections) {
        const target =
          connection.index_name ||
          connection.container_name ||
          connection.database_name ||
          connection.endpoint ||
          "configured";
        out.info(
          `${chalk.cyan(connection.storage_backend)} — ${chalk.dim(target)}`,
        );
      }
    }
  });

tenantStorageCommand
  .command("verify")
  .description("Check tenant storage readiness across published Object Types")
  .option("--format <format>", "Output format (text|json)", "text")
  .action(async (options) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const context = await resolveActiveTenantContext({
      projectRoot: root || undefined,
      publicApiUrl,
      interactive: true,
    });

    const client = new PlatformAPIClient(publicApiUrl, context.activeTenant.id);
    const response = await client.getStorageDoctor();
    if (!response.ok) {
      out.error(
        `Storage verification failed: ${response.status} ${response.statusText}`,
      );
      process.exit(1);
    }

    const payload = (await response.json()) as {
      healthy: boolean;
      checks: Array<{
        objectType: string;
        backend: string;
        healthy: boolean;
        issues?: string[];
      }>;
    };

    if (options.format === "json") {
      out.json(payload);
      return;
    }

    out[payload.healthy ? "success" : "warn"](
      payload.healthy
        ? "Tenant storage is healthy."
        : "Tenant storage needs attention.",
    );
    for (const check of payload.checks) {
      const status = check.healthy
        ? chalk.green("healthy")
        : chalk.yellow("needs-attention");
      const issues = check.issues?.length
        ? chalk.dim(` — ${check.issues.join("; ")}`)
        : "";
      out.info(
        `${chalk.cyan(check.objectType)} [${check.backend}] ${status}${issues}`,
      );
    }
  });

tenantCommand.addCommand(tenantStorageCommand);

// ─── eai tenant list ──────────────────────────────────────────────────────

tenantCommand
  .command("list")
  .description(
    "List tenants where the current user is a tenant-admin (default) or all roles with --all",
  )
  .option("--parent <id>", "Parent tenant ID")
  .option(
    "--all",
    "Include tenants where the user holds non-admin roles (e.g. tenant-viewer)",
    false,
  )
  .option("--debug", "Show debug diagnostics for tenant lookup", false)
  .option("--raw-user", "Print raw membership payload in debug mode", false)
  .option("--format <format>", "Output format (text|json)", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .addHelpText(
    "after",
    `
Examples:
  $ eai tenant list
  $ eai tenant list --parent <tenant-id> # show the child hierarchy for a parent
  $ eai tenant list --all              # include tenant-viewer / tenant-builder memberships
  $ eai tenant list --debug
  $ eai tenant list --debug --raw-user
  $ eai tenant list --format json | jq '.tenants[] | .name'
  `,
  )
  .action(async (options) => {
    if (options.json) options.format = "json";
    const debugEnabled = Boolean(options.debug);
    const debug = (message: string, data?: unknown): void => {
      if (!debugEnabled) return;
      if (data === undefined) {
        console.error(`[debug] ${message}`);
        return;
      }
      const value = out.redactSensitiveText(
        typeof data === "string" ? data : JSON.stringify(data, null, 2),
      );
      console.error(`[debug] ${message}: ${value}`);
    };

    const tokens = await loadTokens();
    if (!tokens?.oid) {
      exitWithError(ErrorCode.E101);
      return;
    }
    debug("Authenticated token loaded", {
      oid: tokens.oid ? "[present]" : "[missing]",
      upn: tokens.upn ? "[present]" : "[missing]",
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    });

    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    debug("Project root", root || "(none)");
    debug("Using Public API URL", publicApiUrl);

    const spinner =
      options.format === "json" ? null : ora("Fetching tenants...").start();

    try {
      const membershipsResponse =
        await fetchTenantAdminMemberships(publicApiUrl);
      debug("Membership lookup status", "ok");

      if (debugEnabled && options.rawUser) {
        debug("Raw membership payload", membershipsResponse);
      }

      const tenants = options.all
        ? membershipsResponse.memberships.filter(
            (membership) => membership.isActive !== false,
          )
        : membershipsResponse.memberships;
      debug(
        options.all
          ? "Tenant entries (all roles, active only)"
          : "Tenant entries after tenant-admin filtering",
        tenants.length,
      );

      const hierarchy = await loadTenantHierarchy({
        publicApiUrl: membershipsResponse.publicApiUrl,
        memberships: tenants,
        parentId: options.parent,
        debug,
      });
      const visible = flattenTenantHierarchy(hierarchy.roots);
      const selectable = visible.filter((tenant) => tenant.directMembership);
      debug("Tenant hierarchy entries after filtering", visible.length);

      if (options.format === "json") {
        out.json({
          tenants: visible.map((tenant) => ({
            id: tenant.id,
            displayName: tenant.displayName,
            slug: tenant.slug,
            domain: tenant.domain,
            isActive: tenant.isActive,
            roles: tenant.roles,
            homeRegion: tenant.homeRegion,
            hqCountryCode: tenant.hqCountryCode,
            parentId: tenant.parentId,
            directMembership: tenant.directMembership,
            active: tokens.activeTenantId === tenant.id,
          })),
          hierarchy: hierarchy.roots.map(tenantHierarchyJson),
          count: visible.length,
          selectableCount: selectable.length,
        });
        return;
      }

      const countLabel =
        visible.length === selectable.length
          ? `${visible.length} tenant-admin membership${visible.length !== 1 ? "s" : ""}`
          : `${visible.length} visible tenant${visible.length !== 1 ? "s" : ""} (${selectable.length} selectable tenant-admin membership${selectable.length !== 1 ? "s" : ""})`;
      spinner!.succeed(countLabel);

      for (const warning of hierarchy.warnings) {
        out.warn(warning);
      }

      if (visible.length === 0) {
        const zeroState = buildTenantListZeroState(tokens);
        out.info(zeroState.headline);
        if (zeroState.tenantContext) {
          out.info(
            `Authenticated tenant context: ${chalk.cyan(tokens.tenantName || "current authenticated tenant")}${tokens.tenantId ? chalk.dim(` (${tokens.tenantId})`) : ""}`,
          );
        }
        out.info(
          `Use ${chalk.cyan("eai whoami")} to inspect the authenticated tenant context.`,
        );
        return;
      }

      for (const line of buildTenantHierarchyTreeLines(hierarchy.roots, {
        activeTenantId: tokens.activeTenantId,
      })) {
        out.info(line);
      }
    } catch (err) {
      if (spinner)
        spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai tenant select ───────────────────────────────────────────────────

tenantCommand
  .command("select [tenant]")
  .description("Select the active tenant to work with")
  .action(async (tenant) => {
    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);

    try {
      let tenantId = tenant;
      if (!tenantId) {
        const fetched = await fetchTenantAdminMemberships(publicApiUrl);
        const hierarchy = await loadTenantHierarchy({
          publicApiUrl: fetched.publicApiUrl,
          memberships: fetched.memberships,
        });
        for (const warning of hierarchy.warnings) {
          out.warn(warning);
        }

        const selectable = flattenTenantHierarchy(hierarchy.roots).filter(
          (item) => item.directMembership,
        );
        if (selectable.length === 0) {
          throw new Error(
            "No active tenant-admin memberships found for the current login. Run `eai tenant list` to inspect your access.",
          );
        }
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          if (selectable.length !== 1) {
            throw new Error(
              "Multiple active tenant-admin memberships found. Run `eai tenant select <tenant>` to choose one.",
            );
          }
          tenantId = selectable[0]!.id;
        } else {
          tenantId = await promptForTenantFromHierarchy(hierarchy.roots);
        }
      }

      const context = await resolveActiveTenantContext({
        projectRoot: root || undefined,
        publicApiUrl,
        interactive: false,
        forcePrompt: false,
        tenantId,
      });

      out.success(
        `Active tenant set to ${chalk.cyan(context.activeTenant.slug)} (${chalk.dim(context.activeTenant.id)})`,
      );
      reportPublicApiEnvSync(context.publicApiEnvSync);
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai tenant info <id> ─────────────────────────────────────────────────

tenantCommand
  .command("info <id>")
  .description("Show tenant details")
  .option("--format <format>", "Output format (text|json)", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .action(async (id, options) => {
    if (options.json) options.format = "json";

    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const spinner =
      options.format === "json" ? null : ora("Fetching tenant...").start();

    try {
      const memberships = await fetchTenantAdminMemberships(publicApiUrl);
      const tenant = memberships.memberships.find(
        (entry) => entry.id === id || entry.slug === id,
      );

      if (!tenant) {
        if (spinner) spinner.fail("404 Not Found");
        process.exit(1);
      }

      if (options.format === "json") {
        out.json(tenant);
      } else {
        spinner!.succeed(`Tenant: ${chalk.cyan(tenant.displayName)}`);
      }
    } catch (err) {
      if (spinner)
        spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai tenant create ───────────────────────────────────────────────────

tenantCommand
  .command("create")
  .description("Create a new tenant")
  .requiredOption("--name <name>", "Tenant name")
  .requiredOption("--slug <slug>", "Tenant slug (kebab-case)")
  .option("--parent <id>", "Parent tenant ID")
  .option("--domain <domains>", "Comma-separated domain list")
  .option(
    "--usecase <usecase>",
    "Tenant usecase: council|retail|healthcare|finance|manufacturing|generic",
    "generic",
  )
  .option("--industry <industry>", "Signup/onboarding industry segment")
  .option(
    "--starter-template <key>",
    "Starter application template key",
    "eai-app-template",
  )
  .option("--home-region <region>", "Tenant home region: au|ca|eu")
  .option(
    "--allow-root",
    "Allow root tenant creation for administrative backfills",
    false,
  )
  .option("--format <format>", "Output format (text|json)", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .action(async (options) => {
    if (options.json) options.format = "json";
    if (!options.parent && !options.allowRoot) {
      out.error(
        "Root tenant creation is guarded. Complete onboarding for the main company tenant, then use `eai init --parent-tenant <id>` or pass --parent for child tenants.",
      );
      process.exit(1);
    }

    let rootHomeRegion: TenantHomeRegion | undefined;
    if (!options.parent) {
      try {
        rootHomeRegion = normalizeTenantCreateHomeRegion(options.homeRegion);
      } catch (err) {
        out.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      if (!rootHomeRegion) {
        out.error(
          "--home-region au|ca|eu is required with --allow-root because root tenants cannot inherit a parent region.",
        );
        process.exit(1);
      }
    }

    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    let spinner: ReturnType<typeof ora> | null = null;

    try {
      const context = await resolveActiveTenantContext({
        projectRoot: root || undefined,
        publicApiUrl,
        interactive: true,
        tenantId: options.parent || undefined,
      });
      const client = new PlatformAPIClient(
        publicApiUrl,
        context.activeTenant.id,
      );
      const tenantHomeRegion = options.parent
        ? await resolveChildTenantHomeRegion({
            requested: options.homeRegion,
            parentHomeRegion: context.activeTenant.homeRegion,
            interactive:
              options.format !== "json" &&
              Boolean(process.stdin.isTTY && process.stdout.isTTY),
          })
        : rootHomeRegion;

      spinner =
        options.format === "json"
          ? null
          : ora(`Creating tenant "${options.name}"...`).start();

      const res = await client.createTenant({
        name: options.name,
        slug: options.slug,
        parent: options.parent,
        domain: options.domain?.split(",").map((d: string) => d.trim()),
        usecase: options.usecase,
        industry: options.industry,
        starterTemplate: options.starterTemplate,
        homeRegion: tenantHomeRegion,
      });

      if (!res.ok) {
        const body = await res.text();
        if (spinner) {
          spinner.fail(`${res.status}: ${body}`);
        } else {
          process.stderr.write(`${body || res.statusText}\n`);
        }
        process.exit(1);
      }

      const tenant = (await res.json()) as Record<string, unknown>;
      const createdTenant = extractCreatedTenantRecord(tenant);
      const tenantId = String(createdTenant.id || "");
      let bootstrap: ChildTenantBootstrapResult | undefined;
      let bootstrapError: ParsedApiError | undefined;
      let bootstrapped = false;
      const refreshStatus = async (
        bootstrappedFlag: boolean,
      ): Promise<{ status: TenantUsabilityStatus }> => {
        if (!tenantId) {
          return {
            status: {
              tenantId,
              created: true,
              bootstrapped: bootstrappedFlag,
              membershipConfirmed: false,
              adminConfirmed: false,
              usable: false,
              autoSelected: false,
            },
          };
        }

        try {
          return await refreshTenantUsabilityStatus(tenantId, {
            publicApiUrl,
            created: true,
            bootstrapped: bootstrappedFlag,
            autoSelect: Boolean(options.parent),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          bootstrapError ??= {
            status: 0,
            code: "MEMBERSHIP_REFRESH_FAILED",
            message,
          };
          return {
            status: {
              tenantId,
              created: true,
              bootstrapped: bootstrappedFlag,
              membershipConfirmed: false,
              adminConfirmed: false,
              usable: false,
              autoSelected: false,
            },
          };
        }
      };

      let refreshed = await refreshStatus(bootstrapped);

      if (options.parent && tenantId && !refreshed.status.usable) {
        const tokens = await loadTokens();
        if (tokens?.oid) {
          const bootstrapResponse = await client.bootstrapChildTenantAdmin(
            options.parent,
            tenantId,
            {
              userOid: tokens.oid,
              userEmail: tokens.upn,
            },
          );

          if (bootstrapResponse.ok) {
            bootstrap =
              (await bootstrapResponse.json()) as ChildTenantBootstrapResult;
            bootstrapped =
              bootstrap.status === "bootstrapped" ||
              bootstrap.status === "already-usable";
          } else {
            bootstrapError = await parseApiError(bootstrapResponse);
          }
        } else {
          bootstrapError = {
            status: 0,
            code: "OID_MISSING",
            message:
              "The current login is missing an oid claim, so child bootstrap was not attempted.",
          };
        }

        refreshed = await refreshStatus(bootstrapped);
      }

      const outcome: TenantCreateOutcome = {
        tenant,
        bootstrap,
        bootstrapError,
        usability: refreshed.status,
      };

      if (options.format === "json") {
        out.json({
          tenant,
          bootstrap: bootstrap || null,
          bootstrapError: bootstrapError || null,
          usability: outcome.usability,
        });
      } else {
        spinner!.succeed(
          `Created tenant ${chalk.cyan(String(createdTenant.slug || options.slug))} (${chalk.dim(String(createdTenant.id || tenantId))})`,
        );
        for (const message of buildTenantCreateStatusMessages(outcome)) {
          if (
            message.startsWith("Usable: not yet confirmed") ||
            message.startsWith("Bootstrap not confirmed")
          ) {
            out.warn(message);
          } else if (message.startsWith("Usable:")) {
            out.success(message);
          } else {
            out.info(message);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (spinner) {
        spinner.fail(message);
      } else {
        out.error(message);
      }
      process.exit(1);
    }
  });

// ─── eai tenant bootstrap-admin ──────────────────────────────────────────

tenantCommand
  .command("bootstrap-admin")
  .description(
    "Bootstrap first tenant-admin access for an existing child tenant",
  )
  .requiredOption("--parent <id>", "Direct parent tenant ID")
  .requiredOption("--child <id>", "Immediate child tenant ID")
  .option(
    "--user-oid <oid>",
    "Target user object ID (defaults to the current login)",
  )
  .option(
    "--user-email <email>",
    "Target user email (defaults to the current login email when available)",
  )
  .option("--format <format>", "Output format (text|json)", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .addHelpText(
    "after",
    `
Examples:
  $ eai tenant bootstrap-admin --parent <parent-tenant-id> --child <child-tenant-id>
  $ eai tenant bootstrap-admin --parent <parent-tenant-id> --child <child-tenant-id> --user-oid <entra-user-oid> --user-email user@example.com
`,
  )
  .action(async (options: TenantBootstrapAdminCommandOptions) => {
    if (options.json) options.format = "json";
    if (!["text", "json"].includes(options.format)) {
      out.error("Unsupported format. Use text or json.");
      process.exit(1);
    }

    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const tokens = await loadTokens();
    const userOid = options.userOid || tokens?.oid;
    const userEmail = options.userEmail || tokens?.upn;

    if (!userOid) {
      const message =
        "The current login is missing an oid claim. Pass --user-oid <entra-user-oid> or run `eai login` again.";
      if (options.format === "json") {
        out.json({
          parentTenantId: options.parent,
          childTenantId: options.child,
          bootstrapped: false,
          error: {
            code: "OID_MISSING",
            message,
          },
        });
      } else {
        out.error(message);
      }
      process.exit(1);
    }

    const spinner =
      options.format === "json"
        ? null
        : ora(
            `Bootstrapping tenant-admin for ${userEmail || userOid} on child tenant ${options.child}...`,
          ).start();

    try {
      await resolveActiveTenantContext({
        projectRoot: root || undefined,
        publicApiUrl,
        interactive: true,
        tenantId: options.parent,
      });
      const client = new PlatformAPIClient(publicApiUrl, options.parent);
      const response = await client.bootstrapChildTenantAdmin(
        options.parent,
        options.child,
        {
          userOid,
          userEmail,
        },
      );

      if (!response.ok) {
        const error = await parseApiError(response);
        if (options.format === "json") {
          out.json({
            parentTenantId: options.parent,
            childTenantId: options.child,
            userOid,
            userEmail,
            bootstrapped: false,
            error,
          });
        } else if (spinner) {
          const prefix = error.code ? `${error.code}: ` : "";
          spinner.fail(`${error.status}: ${prefix}${error.message}`);
        }
        process.exit(1);
      }

      const result = (await response.json()) as ChildTenantBootstrapResult;
      if (options.format === "json") {
        out.json(result);
      } else {
        spinner!.succeed(
          `Checked child tenant admin access for ${chalk.cyan(userEmail || userOid)}`,
        );
        for (const message of buildTenantBootstrapAdminStatusMessages(result)) {
          if (message.startsWith("Usable: not yet confirmed")) {
            out.warn(message);
          } else if (message.startsWith("Usable:")) {
            out.success(message);
          } else {
            out.info(message);
          }
        }
      }
    } catch (err) {
      if (spinner)
        spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

tenantCommand
  .command("delete <id>")
  .description("Delete a tenant")
  .option("--force", "Skip confirmation", false)
  .option("--force-hard-purge", "Permanently purge the tenant and all child tenants", false)
  .option("--format <format>", "Output format (text|json)", "text")
  .option("--json", "Output raw JSON (deprecated, use --format json)", false)
  .action(async (id, options) => {
    if (options.json) options.format = "json";

    if (!options.force) {
      const { default: inquirer } = await import("inquirer");
      const promptMessage = options.forceHardPurge
        ? `Permanently hard purge tenant ${id} and all child tenants? This cannot be undone.`
        : `Delete tenant ${id}?`;
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: promptMessage,
          default: false,
        },
      ]);
      if (!confirm) {
        if (options.format === "json") {
          out.json({ cancelled: true });
        } else {
          out.info("Cancelled.");
        }
        return;
      }
    }

    const root = await findProjectRoot();
    const publicApiUrl = await resolvePublicApiUrl(root || undefined);
    const context = await resolveActiveTenantContext({
      projectRoot: root || undefined,
      publicApiUrl,
      interactive: true,
    });
    const client = new PlatformAPIClient(publicApiUrl, context.activeTenant.id);
    const spinner =
      options.format === "json"
        ? null
        : ora(`${options.forceHardPurge ? "Hard purging" : "Deleting"} tenant "${id}"...`).start();

    try {
      const res = await client.deleteTenant(id, {
        forceHardPurge: Boolean(options.forceHardPurge),
      });
      if (!res.ok) {
        const body = await res.text();
        if (options.format === "json") {
          out.json({
            id,
            deleted: false,
            status: res.status,
            error: body || res.statusText,
          });
        } else if (spinner) {
          spinner.fail(`${res.status}: ${body}`);
        }
        process.exit(1);
      }

      const responseBody = await res.json().catch(() => null);
      if (options.format === "json") {
        out.json({
          id,
          deleted: true,
          hardPurged: Boolean(options.forceHardPurge),
          response: responseBody,
        });
      } else {
        spinner!.succeed(
          `${options.forceHardPurge ? "Hard purged" : "Deleted"} tenant ${chalk.cyan(id)}`,
        );
      }
    } catch (err) {
      if (spinner)
        spinner.fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
