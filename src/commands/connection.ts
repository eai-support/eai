/** Tenant-admin lifecycle for non-human PublicAPI connections. */

import { Command, Option } from "commander";
import { findProjectRoot } from "../lib/config.js";
import {
  PlatformAPIClient,
  parseApiError,
  type PlatformMethod,
} from "../lib/api.js";
import { normalizeFormat } from "../lib/context.js";
import {
  resolveActiveTenantContext,
  resolvePublicApiUrl,
} from "../lib/tenant-context.js";
import * as out from "../lib/output.js";

interface CommonOptions {
  tenantId?: string;
  format?: string;
  json?: boolean;
  revealKey?: boolean;
  wait?: boolean;
  waitTimeoutSeconds?: string;
}

interface CreateOptions extends CommonOptions {
  name: string;
  description?: string;
  ownerName: string;
  ownerEmail: string;
  model: "api-key" | "advanced";
  accessMode?: "tenant-admin" | "tenant-member" | "custom";
  confirmTenantAdmin?: boolean;
  action: string[];
  objectType: string[];
  expiresAt?: string;
  allowedCidr: string[];
  requestsPerMinute?: string;
  directoryTenantId?: string;
  clientId?: string;
}

interface ListOptions extends CommonOptions {
  page: string;
  limit: string;
}

interface UpdateOptions extends CommonOptions {
  expectedVersion: string;
  name?: string;
  description?: string;
  ownerName?: string;
  ownerEmail?: string;
  action?: string[];
  objectType?: string[];
  expiresAt?: string;
  allowedCidr?: string[];
  requestsPerMinute?: string;
  clearDescription?: boolean;
  clearExpiry?: boolean;
  clearRateLimit?: boolean;
}

interface ActionOptions extends CommonOptions {
  expectedVersion: string;
}

interface ConnectionContext {
  client: PlatformAPIClient;
  tenantId: string;
}

/** Closed transport states for applying one saved target across all regions. */
export type RegionalActivationState = "saved" | "activating" | "active";

/** Safe regional progress returned separately from connection lifecycle. */
export interface RegionalActivation {
  state: RegionalActivationState;
  targetGrantVersion?: number;
  targetProjectionVersion?: number;
  securityEpoch?: number;
  requiredRegionCount?: number;
  confirmedRegionCount?: number;
  startedAt?: string;
  deadlineAt?: string;
  failClosed?: boolean;
  reasonCode?: string;
  pollAfterSeconds?: number;
}

interface RegionalActivationWaitDependencies {
  initialResult?: Record<string, unknown> | unknown[];
  poll: () => Promise<Record<string, unknown> | unknown[]>;
  timeoutMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function repeated(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function common(command: Command): Command {
  return command
    .option(
      "--tenant-id <tenantId>",
      "Use a specific tenant instead of the active tenant",
    )
    .option("--format <format>", "Output format (text|json)", "text")
    .option("--json", "Shortcut for --format json");
}

function withRegionalActivationWait(command: Command): Command {
  return command
    .option(
      "--wait",
      "Wait until every required serving region confirms this saved change",
    )
    .option(
      "--wait-timeout-seconds <seconds>",
      "Maximum wait before returning an incomplete, non-zero result (1-600)",
    );
}

async function context(options: CommonOptions): Promise<ConnectionContext> {
  const root = await findProjectRoot();
  const publicApiUrl = await resolvePublicApiUrl(root ?? undefined);
  const active = await resolveActiveTenantContext({
    projectRoot: root ?? undefined,
    publicApiUrl,
    tenantId: options.tenantId,
    interactive: !options.tenantId,
  });
  return {
    client: new PlatformAPIClient(active.publicApiUrl, active.activeTenant.id),
    tenantId: active.activeTenant.id,
  };
}

function path(tenantId: string, suffix = ""): string {
  return `/v4/platform/tenants/${encodeURIComponent(tenantId)}/connections${suffix}`;
}

function positiveVersion(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error("--expected-version must be a positive integer.");
  return parsed;
}

function positiveRate(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error(
      "--requests-per-minute must be an integer from 1 to 100000.",
    );
  }
  return parsed;
}

/** Enforces the CLI's finite 1-600 second regional confirmation window. */
export function boundedWaitTimeoutMs(value?: string): number {
  if (value === undefined) return 60_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) {
    throw new Error("--wait-timeout-seconds must be an integer from 1 to 600.");
  }
  return parsed * 1_000;
}

function boundedListNumber(
  value: string,
  flag: "--page" | "--limit",
  maximum?: number,
): number {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    (maximum !== undefined && parsed > maximum)
  ) {
    const range =
      maximum === undefined
        ? "a positive integer"
        : `an integer from 1 to ${maximum}`;
    throw new Error(`${flag} must be ${range}.`);
  }
  return parsed;
}

export function buildConnectionListSuffix(
  options: Pick<ListOptions, "page" | "limit">,
): string {
  const page = boundedListNumber(options.page, "--page");
  const limit = boundedListNumber(options.limit, "--limit", 100);
  return `?page=${page}&limit=${limit}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads direct or wrapped activation responses without treating a legacy
 * response as proof; unknown states fail closed.
 */
export function regionalActivationFromResult(
  result: Record<string, unknown> | unknown[],
): RegionalActivation | null {
  if (Array.isArray(result)) return null;
  const connection = isRecord(result.connection) ? result.connection : result;
  const candidate = connection.regionalActivation ?? result.regionalActivation;
  if (!isRecord(candidate)) return null;
  if (!["saved", "activating", "active"].includes(String(candidate.state))) {
    throw new Error("Regional activation returned an unsupported state.");
  }
  return candidate as unknown as RegionalActivation;
}

function regionalActivationLabel(
  activation: RegionalActivation | null,
): "Saved" | "Activating" | "Active" | "Not yet reported" {
  if (activation === null) return "Not yet reported";
  if (activation.state === "saved") return "Saved";
  if (activation.state === "activating") return "Activating";
  return "Active";
}

function connectionIdFromResult(
  result: Record<string, unknown> | unknown[],
): string | null {
  if (Array.isArray(result)) return null;
  const connection = isRecord(result.connection) ? result.connection : result;
  return typeof connection.id === "string" && connection.id.length > 0
    ? connection.id
    : null;
}

function resultWithRegionalActivation(
  result: Record<string, unknown> | unknown[],
  activation: RegionalActivation,
): Record<string, unknown> | unknown[] {
  if (Array.isArray(result)) return result;
  if (isRecord(result.connection)) {
    return {
      ...result,
      regionalActivation: activation,
      connection: { ...result.connection, regionalActivation: activation },
    };
  }
  return { ...result, regionalActivation: activation };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Wait for explicit regional proof. Elapsed time, lifecycle status and a
 * successful save never count as regional activation.
 */
export async function waitForRegionalActivation({
  initialResult,
  poll,
  timeoutMs,
  now = Date.now,
  sleep = defaultSleep,
}: RegionalActivationWaitDependencies): Promise<RegionalActivation> {
  const startedAt = now();
  let activation = initialResult
    ? regionalActivationFromResult(initialResult)
    : null;

  while (true) {
    if (activation?.state === "active") return activation;
    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(
        `Regional activation is incomplete after ${Math.ceil(timeoutMs / 1_000)} seconds. The change is saved, but not confirmed active in every required region.`,
      );
    }
    if (activation !== null) {
      const pollAfterMs = Math.min(
        Math.max(activation.pollAfterSeconds ?? 2, 1) * 1_000,
        10_000,
        remainingMs,
      );
      await sleep(pollAfterMs);
    }
    let polled: Record<string, unknown> | unknown[];
    try {
      polled = await poll();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Regional activation could not be confirmed: ${detail}. The change may be saved, but regional readiness is incomplete.`,
        { cause: error },
      );
    }
    activation = regionalActivationFromResult(polled);
    if (activation === null) {
      throw new Error(
        "Regional activation status was not reported. The change may be saved, but it cannot be confirmed active.",
      );
    }
  }
}

export function buildConnectionCreatePayload(
  options: CreateOptions,
): Record<string, unknown> {
  if (options.model === "api-key" && options.revealKey !== true) {
    throw new Error(
      "Standard API Key creation requires --reveal-key so the credential is not lost.",
    );
  }
  const objectTypes = unique(options.objectType);
  const accessMode = options.accessMode ?? (objectTypes.length > 0 ? "custom" : undefined);
  if (!accessMode) {
    throw new Error(
      "Choose --access-mode tenant-admin|tenant-member, or provide --object-type for a legacy Custom grant.",
    );
  }
  if (accessMode === "tenant-admin" && options.confirmTenantAdmin !== true) {
    throw new Error(
      "Tenant Administrator requires --confirm-tenant-admin because it enables everything available in the tenant.",
    );
  }
  const actions = unique(options.action);
  if (
    accessMode === "custom" &&
    (actions.length === 0 ||
      actions.some((action) => !["read", "query"].includes(action)) ||
      objectTypes.length === 0)
  ) {
    throw new Error("Custom access requires --action read|query and at least one --object-type.");
  }
  if (
    options.model === "advanced" &&
    (!options.directoryTenantId || !options.clientId)
  ) {
    throw new Error(
      "Advanced Security requires --directory-tenant-id and --client-id.",
    );
  }
  return {
    name: options.name,
    ...(options.description ? { description: options.description } : {}),
    securityModel: options.model,
    accessMode,
    owner: { name: options.ownerName, email: options.ownerEmail },
    ...(accessMode === "custom"
      ? { capabilities: { actions, objectTypes } }
      : {
          tenantRoleGrant: {
            role: accessMode,
            roleContractVersion: 1,
          },
        }),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    allowedCidrs: unique(options.allowedCidr),
    ...(positiveRate(options.requestsPerMinute)
      ? { requestsPerMinute: positiveRate(options.requestsPerMinute) }
      : {}),
    ...(options.model === "advanced"
      ? {
          advanced: {
            directoryTenantId: options.directoryTenantId,
            clientId: options.clientId,
          },
        }
      : {}),
  };
}

function buildConnectionUpdatePayload(
  options: UpdateOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    expectedGrantVersion: positiveVersion(options.expectedVersion),
  };
  if (options.name) body.name = options.name;
  if (options.clearDescription) body.description = null;
  else if (options.description !== undefined)
    body.description = options.description;
  if (options.ownerName || options.ownerEmail) {
    if (!options.ownerName || !options.ownerEmail)
      throw new Error("Update both --owner-name and --owner-email together.");
    body.owner = { name: options.ownerName, email: options.ownerEmail };
  }
  if (options.action || options.objectType) {
    if (!options.action?.length || !options.objectType?.length) {
      throw new Error("Update --action and --object-type together.");
    }
    body.capabilities = {
      actions: unique(options.action),
      objectTypes: unique(options.objectType),
    };
  }
  if (options.clearExpiry) body.expiresAt = null;
  else if (options.expiresAt) body.expiresAt = options.expiresAt;
  if (options.allowedCidr) body.allowedCidrs = unique(options.allowedCidr);
  if (options.clearRateLimit) body.requestsPerMinute = null;
  else {
    const rate = positiveRate(options.requestsPerMinute);
    if (rate) body.requestsPerMinute = rate;
  }
  return body;
}

async function requestWithContext(
  ctx: ConnectionContext,
  method: PlatformMethod,
  suffix: string,
  body: unknown,
): Promise<Record<string, unknown> | unknown[]> {
  const response = await ctx.client.requestPublicApi(
    path(ctx.tenantId, suffix),
    { method, body },
  );
  if (!response.ok) {
    const error = await parseApiError(response);
    throw new Error(`${error.status} ${error.message}`);
  }
  return (await response.json()) as Record<string, unknown> | unknown[];
}

async function request(
  method: PlatformMethod,
  suffix: string,
  body: unknown,
  options: CommonOptions,
): Promise<Record<string, unknown> | unknown[]> {
  return requestWithContext(await context(options), method, suffix, body);
}

async function requestAndMaybeWait(
  method: PlatformMethod,
  suffix: string,
  body: unknown,
  options: CommonOptions,
  knownConnectionId?: string,
): Promise<Record<string, unknown> | unknown[]> {
  if (!options.wait && options.waitTimeoutSeconds !== undefined) {
    throw new Error("--wait-timeout-seconds requires --wait.");
  }
  const ctx = await context(options);
  const result = await requestWithContext(ctx, method, suffix, body);
  if (!options.wait) return result;
  const connectionId = knownConnectionId ?? connectionIdFromResult(result);
  if (!connectionId) {
    throw new Error(
      "Regional activation cannot be confirmed because the response did not include a connection ID.",
    );
  }
  const activation = await waitForRegionalActivation({
    initialResult: result,
    timeoutMs: boundedWaitTimeoutMs(options.waitTimeoutSeconds),
    poll: () =>
      requestWithContext(
        ctx,
        "GET",
        `/${encodeURIComponent(connectionId)}/regional-activation`,
        undefined,
      ),
  });
  return resultWithRegionalActivation(result, activation);
}

export function resultForOutput(
  result: Record<string, unknown> | unknown[],
  revealKey = false,
): Record<string, unknown> | unknown[] {
  if (Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  if (revealKey || !("oneTimeCredential" in record)) return record;
  const { oneTimeCredential: _oneTimeCredential, ...safe } = record;
  return safe;
}

export function connectionRowsForOutput(
  result: Record<string, unknown> | unknown[],
): unknown[] | null {
  if (Array.isArray(result)) return result;
  return Array.isArray(result.connections) ? result.connections : null;
}

function printResult(
  result: Record<string, unknown> | unknown[],
  options: CommonOptions,
): void {
  const visibleResult = resultForOutput(result, options.revealKey === true);
  if (normalizeFormat(options) === "json") {
    process.stdout.write(`${JSON.stringify(visibleResult, null, 2)}\n`);
    return;
  }
  const connectionRows = connectionRowsForOutput(visibleResult);
  if (connectionRows !== null) {
    out.table(
      connectionRows.map((item) => {
        const record = item as Record<string, unknown>;
        const activation = regionalActivationFromResult(record);
        return [
          String(record.name ?? record.id ?? ""),
          `${record.securityModel ?? ""} · access ${record.accessMode ?? "custom"} · lifecycle ${record.status ?? ""} · regional ${regionalActivationLabel(activation)}`,
        ];
      }),
    );
    return;
  }
  const visibleRecord = visibleResult as Record<string, unknown>;
  const connection = (visibleRecord.connection ?? visibleRecord) as Record<
    string,
    unknown
  >;
  const activation = regionalActivationFromResult(visibleRecord);
  out.table([
    ["Connection", String(connection.name ?? connection.id ?? "")],
    ["ID", String(connection.id ?? "")],
    ["Security", String(connection.securityModel ?? "")],
    ["Access", String(connection.accessMode ?? "custom")],
    ["Lifecycle", String(connection.status ?? "")],
    ["Regional activation", regionalActivationLabel(activation)],
    [
      "Regional progress",
      activation?.requiredRegionCount !== undefined
        ? `${activation.confirmedRegionCount ?? 0}/${activation.requiredRegionCount}`
        : "not reported",
    ],
    ["Regional reason", activation?.reasonCode ?? ""],
    ["Grant version", String(connection.grantVersion ?? "")],
  ]);
  const oneTime = (result as Record<string, unknown>).oneTimeCredential as
    { apiKey?: unknown } | undefined;
  if (typeof oneTime?.apiKey === "string" && options.revealKey === true) {
    out.warn("Store this API key now. It will not be shown again.");
    process.stdout.write(`${oneTime.apiKey}\n`);
  } else if (typeof oneTime?.apiKey === "string") {
    out.warn(
      "An unexpected API key was withheld. Rotate it with --reveal-key before use.",
    );
  }
}

async function run(
  operation: () => Promise<Record<string, unknown> | unknown[]>,
  options: CommonOptions,
) {
  try {
    printResult(await operation(), options);
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export const connectionCommand = new Command("connection")
  .alias("connections")
  .description(
    "Manage tenant API connections for apps, agents, services, jobs, and device gateways",
  );

connectionCommand.addCommand(
  common(
    new Command("list")
      .description("List tenant API connections")
      .option("--page <number>", "Page number", "1")
      .option("--limit <number>", "Connections per page (1-100)", "50"),
  ).action((options: ListOptions) =>
    run(
      () =>
        request("GET", buildConnectionListSuffix(options), undefined, options),
      options,
    ),
  ),
);

connectionCommand.addCommand(
  withRegionalActivationWait(
    common(
      new Command("get")
        .description("Get one tenant API connection")
        .argument("<connectionId>"),
    ),
  ).action((connectionId: string, options: CommonOptions) =>
    run(
      () =>
        requestAndMaybeWait(
          "GET",
          `/${encodeURIComponent(connectionId)}`,
          undefined,
          options,
          connectionId,
        ),
      options,
    ),
  ),
);

const create = withRegionalActivationWait(
  common(
    new Command("create")
      .description("Create a Standard API Key or Advanced Security connection")
      .requiredOption("--name <name>", "Connection name")
      .requiredOption("--owner-name <name>", "Named business owner")
      .requiredOption("--owner-email <email>", "Business owner email")
      .addOption(
        new Option("--model <model>", "Security model")
          .choices(["api-key", "advanced"])
          .default("api-key"),
      )
      .addOption(
        new Option(
          "--access-mode <mode>",
          "Tenant role: tenant-admin or tenant-member; custom is retained for existing bounded grants",
        ).choices(["tenant-admin", "tenant-member", "custom"]),
      )
      .option(
        "--confirm-tenant-admin",
        "Confirm that Tenant Administrator enables everything available in this tenant",
      )
      .option("--description <description>", "Business purpose")
      .option(
        "--action <action>",
        "Allowed action: read or query (repeatable)",
        repeated,
        ["read"],
      )
      .option(
        "--object-type <slug>",
        "Exact Object Type slug for a Custom grant (repeatable)",
        repeated,
        [],
      )
      .option("--expires-at <isoDate>", "Optional UTC expiry")
      .option(
        "--allowed-cidr <cidr>",
        "Allowed IP network (repeatable)",
        repeated,
        [],
      )
      .option("--requests-per-minute <number>", "Recorded request-rate limit")
      .option(
        "--directory-tenant-id <uuid>",
        "Customer Entra directory tenant ID",
      )
      .option("--client-id <uuid>", "Customer Entra application client ID")
      .option(
        "--reveal-key",
        "Print the one-time Standard API key to this terminal",
      ),
  ),
);
create.action((options: CreateOptions) =>
  run(
    () =>
      requestAndMaybeWait(
        "POST",
        "",
        buildConnectionCreatePayload(options),
        options,
      ),
    options,
  ),
);
connectionCommand.addCommand(create);

const update = withRegionalActivationWait(
  common(
    new Command("update")
      .description(
        "Update a connection owner, permission grant, expiry, or network restriction",
      )
      .argument("<connectionId>")
      .requiredOption("--expected-version <number>", "Current grant version")
      .option("--name <name>", "Connection name")
      .option("--description <description>", "Business purpose")
      .option("--clear-description", "Remove the current business purpose")
      .option("--owner-name <name>", "Named business owner")
      .option("--owner-email <email>", "Business owner email")
      .option("--action <action>", "Allowed action (repeatable)", repeated)
      .option(
        "--object-type <slug>",
        "Exact Object Type slug (repeatable)",
        repeated,
      )
      .option("--expires-at <isoDate>", "UTC expiry")
      .option("--clear-expiry", "Remove the current expiry")
      .option(
        "--allowed-cidr <cidr>",
        "Allowed IP network (repeatable)",
        repeated,
      )
      .option("--requests-per-minute <number>", "Recorded request-rate limit")
      .option("--clear-rate-limit", "Remove the recorded request-rate limit"),
  ),
);
update.action((connectionId: string, options: UpdateOptions) =>
  run(
    () =>
      requestAndMaybeWait(
        "PATCH",
        `/${encodeURIComponent(connectionId)}`,
        buildConnectionUpdatePayload(options),
        options,
        connectionId,
      ),
    options,
  ),
);
connectionCommand.addCommand(update);

for (const action of ["activate", "suspend", "revoke", "rotate-key"] as const) {
  let actionCommand = common(
    new Command(action)
      .description(`${action} a tenant API connection`)
      .argument("<connectionId>")
      .requiredOption("--expected-version <number>", "Current grant version"),
  );
  if (action === "rotate-key") {
    actionCommand = actionCommand.option(
      "--reveal-key",
      "Print the one-time replacement API key to this terminal",
    );
  }
  actionCommand = withRegionalActivationWait(actionCommand);
  actionCommand.action((connectionId: string, options: ActionOptions) =>
    run(
      () =>
        action === "rotate-key" && options.revealKey !== true
          ? Promise.reject(
              new Error(
                "API key rotation requires --reveal-key so the replacement is not lost.",
              ),
            )
          : requestAndMaybeWait(
              "POST",
              `/${encodeURIComponent(connectionId)}/${action}`,
              {
                expectedGrantVersion: positiveVersion(options.expectedVersion),
              },
              options,
              connectionId,
            ),
      options,
    ),
  );
  connectionCommand.addCommand(actionCommand);
}
