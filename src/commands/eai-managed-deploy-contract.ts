import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Ora } from "ora";
import type { PlatformAPIClient } from "../lib/api.js";
import type { CommandContext } from "../lib/context.js";
import type { CliManagedSourceScope } from "../lib/eai-managed-source-client.js";

const exec = promisify(execFile);
export const DEFAULT_TIMEOUT_SECONDS = 1_200;
export const POLL_INTERVALS_MS = [2_000, 3_000, 5_000, 10_000] as const;
export const MANAGED_DEPLOY_ENVIRONMENTS = new Set([
  "preview",
  "dev",
  "test",
  "prod",
]);
export const NEW_SOURCE_OPERATION_ACTION =
  "Start a new EAI managed deployment with --repo and --installation-id, without --resume or --retry, to issue a fresh source operation and nonce.";

export type ManagedDeployCommandRunner = (
  command: string,
  args: string[],
  cwd?: string,
) => Promise<string>;

export interface ManagedDeployOptions {
  target: string;
  tenantId: string;
  targetTenantId?: string;
  repo?: string;
  source?: string;
  githubLinkSession?: string;
  installationId?: string;
  branch: string;
  workflow: string;
  environment: string;
  commit?: string;
  resume?: string;
  retry?: string;
  wait: boolean;
  timeout: string;
  format: string;
  json?: boolean;
}

export interface ManagedDeployExecutionContext {
  context: CommandContext;
  client: PlatformAPIClient;
  managedScope: CliManagedSourceScope;
  options: ManagedDeployOptions;
  appKey: string;
  targetTenantId: string;
  workflowPath: string;
  timeoutSeconds: number;
  format: string;
  spinner: Ora | null;
}

export interface VerifiedGitHubActor {
  id: number;
  login: string;
}

export class ManagedDeployFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextAction: string,
  ) {
    super(message);
  }
}

export function fail(code: string, message: string, nextAction: string): never {
  throw new ManagedDeployFailure(code, message, nextAction);
}

export async function run(
  command: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  try {
    const { stdout } = await exec(command, args, { cwd });
    return stdout.trim();
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr || "").trim()
        : "";
    throw new Error(
      stderr || (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function responsePayload(
  response: Response,
): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : { value };
  } catch {
    return { message: raw };
  }
}

export function apiMessage(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.detail === "string") return payload.detail;
  if (isRecord(payload.detail) && typeof payload.detail.message === "string")
    return payload.detail.message;
  return fallback;
}

export function repositoryNextAction(
  status: number,
  message: string,
  tenantId: string,
  repo: string,
): string {
  const normalized = message.toLowerCase();
  if (status === 401)
    return "Run `eai login`, confirm the account with `eai whoami`, then retry.";
  if (status === 403 && normalized.includes("tenant")) {
    return `Select an account with access to tenant ${tenantId}, then run \`eai whoami\` and retry.`;
  }
  if (
    normalized.includes("github-connection") ||
    normalized.includes("connection")
  ) {
    return `Create or repair the tenant GitHub connection for ${repo}, then retry with its installation ID.`;
  }
  if (normalized.includes("installation")) {
    return `Install the EAI GitHub App for ${repo}, then retry with the exact installation ID.`;
  }
  if (status === 403)
    return "Ask a tenant administrator for app-source permission, then retry.";
  return "Use the returned request ID to inspect PublicAPI and AdminAPI, then retry the same command.";
}

export async function requireApiSuccess(
  response: Response,
  code: string,
  nextAction: (payload: Record<string, unknown>, status: number) => string,
): Promise<Record<string, unknown>> {
  const payload = await responsePayload(response);
  if (!response.ok) {
    fail(
      code,
      apiMessage(payload, `${response.status} ${response.statusText}`),
      nextAction(payload, response.status),
    );
  }
  return payload;
}
