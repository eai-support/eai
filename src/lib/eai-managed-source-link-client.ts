import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { PlatformAPIClient, readManagedPublicResponseText, type CliManagedGithubLinkSession } from "./api.js";
import { getBrowserOpenCommand } from "./auth.js";
import { ManagedSourceError } from "./eai-managed-source.js";
import type { CliManagedSourceScope } from "./eai-managed-source-client-types.js";

const exec = promisify(execFile);
const MANAGED_PORTAL_ORIGIN =
  /^https:\/\/(?:(?:dev|test)-admin-portal|admin-portal(?:\.(?:ca|eu))?)\.myenterprise\.ai$/;
const GITHUB_LINK_PATH = "/api/platform/generated-apps/github-user";

/** Local E2E may use only the explicitly pinned loopback Portal; release origins stay fixed. */
export function isApprovedManagedPortalOrigin(url: URL): boolean {
  if (url.protocol === "https:" && MANAGED_PORTAL_ORIGIN.test(url.origin)) return true;
  if (
    process.env.E2E_3503_LOCAL_RUN !== "1" ||
    process.env.E2E_3503_EXTERNAL_MUTATIONS !== "1" ||
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) return false;
  try {
    const configured = new URL(process.env.EAI_MANAGED_SOURCE_LOCAL_PORTAL_ORIGIN || "");
    return (
      configured.origin === url.origin &&
      configured.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(configured.hostname) &&
      !configured.username &&
      !configured.password &&
      configured.pathname === "/" &&
      !configured.search &&
      !configured.hash
    );
  } catch {
    return false;
  }
}

/** Compare server proof to the actual EAI token identity, never caller-supplied email text. */
export function validateCliGithubLinkSession(
  value: CliManagedGithubLinkSession,
  scope: CliManagedSourceScope,
  expectedSessionId?: string,
  allowExpiredVerifiedForUploadRetry = false,
): CliManagedGithubLinkSession {
  if (
    !value ||
    value.schemaVersion !== "eai.cli_managed_github_link_session.v1" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId) ||
    (expectedSessionId && value.sessionId !== expectedSessionId) ||
    !scope.actorId ||
    value.actorId !== scope.actorId ||
    value.tenantId !== scope.tenantId ||
    value.appKey !== scope.appKey ||
    value.targetTenantId !== scope.targetTenantId ||
    value.environment !== scope.environment ||
    !["pending", "verified", "expired", "failed"].includes(value.status)
  ) {
    throw new ManagedSourceError(
      "GITHUB_LINK_BINDING_MISMATCH",
      "GitHub linking response does not match the signed-in EAI actor, tenant, app and deployment scope.",
    );
  }
  if (
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    (Date.parse(value.expiresAt) <= Date.now() &&
      !(allowExpiredVerifiedForUploadRetry && value.status === "verified")) ||
    value.status === "expired"
  ) {
    throw new ManagedSourceError(
      "GITHUB_LINK_EXPIRED",
      "The GitHub linking operation expired. Start the deployment again to obtain a new browser handoff.",
    );
  }
  if (value.status === "failed") {
    throw new ManagedSourceError(
      "GITHUB_LINK_FAILED",
      "GitHub account linking failed. Start the deployment again and complete the verified browser handoff.",
    );
  }
  if (value.status === "verified") {
    const user = value.verifiedGithubUser;
    if (
      !user ||
      !Number.isSafeInteger(user.id) ||
      user.id < 1 ||
      typeof user.login !== "string" ||
      !/^[a-z\d][a-z\d-]{0,38}$/i.test(user.login) ||
      typeof user.proofId !== "string" ||
      !user.proofId ||
      user.actorId !== scope.actorId
    ) {
      throw new ManagedSourceError(
        "GITHUB_LINK_PROOF_INVALID",
        "The platform has not returned a valid GitHub identity proof for this EAI actor.",
      );
    }
  }
  cliManagedPortalOrigin(value);
  return value;
}

/** The authenticated linking response pins the Portal origin used for the later one-use upload. */
export function cliManagedPortalOrigin(
  session: CliManagedGithubLinkSession,
): string {
  let url: URL;
  try {
    url = new URL(session.browserUrl || "");
  } catch {
    throw new ManagedSourceError(
      "GITHUB_LINK_URL_INVALID",
      "The platform did not return a valid GitHub linking browser URL.",
    );
  }
  const queryKeys = [...new Set([...url.searchParams.keys()])];
  if (
    !isApprovedManagedPortalOrigin(url) ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== GITHUB_LINK_PATH ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== "ticket" ||
    url.searchParams.getAll("ticket").length !== 1 ||
    !url.searchParams.get("ticket")
  ) {
    throw new ManagedSourceError(
      "GITHUB_LINK_URL_INVALID",
      "GitHub linking requires an approved EAI Portal origin and exact one-use handoff URL.",
    );
  }
  return url.origin;
}

/** Do not validate a partial identity response after its managed HTTP deadline. */
export async function responseSession(
  response: Response,
): Promise<CliManagedGithubLinkSession> {
  if (!response.ok) {
    throw new ManagedSourceError(
      "GITHUB_LINK_UNAVAILABLE",
      `GitHub identity verification is unavailable (${response.status}). Repair EAI sign-in, app access or the platform linking service before publishing.`,
    );
  }
  return JSON.parse(await readManagedPublicResponseText(response)) as CliManagedGithubLinkSession;
}

/** Browser linking carries no platform GitHub credential and never authorizes a client repository mutation. */
export async function verifyCliGithubIdentity(
  client: PlatformAPIClient,
  scope: CliManagedSourceScope,
  options: { sessionId?: string; interactive: boolean; timeoutMs: number },
  dependencies: {
    openBrowser?: (url: string) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<CliManagedGithubLinkSession> {
  if (!scope.actorId) {
    throw new ManagedSourceError(
      "EAI_ACTOR_REQUIRED",
      "Sign in again with eai login so the platform can bind GitHub verification to your EAI identity.",
    );
  }
  let session = validateCliGithubLinkSession(
    await responseSession(
      options.sessionId
        ? await client.getCliManagedGithubLinkSession(
            scope.tenantId,
            scope.appKey,
            options.sessionId,
            scope.targetTenantId,
            scope.environment,
            options.timeoutMs,
          )
        : await client.createCliManagedGithubLinkSession(
            scope.tenantId,
            scope.appKey,
            {
              schemaVersion: "eai.cli_managed_github_link.v1",
              targetTenantId: scope.targetTenantId,
              environment: scope.environment,
              idempotencyKey: randomUUID(),
            },
            options.timeoutMs,
          ),
    ),
    scope,
    options.sessionId,
  );
  if (session.status === "verified") return session;
  const url = new URL(session.browserUrl!);
  const nextAction = `Open ${url.href} to link or create your GitHub account, then rerun this command with --github-link-session ${session.sessionId}.`;
  if (!options.interactive)
    throw new ManagedSourceError("GITHUB_LINK_REQUIRED", nextAction);
  const openBrowser =
    dependencies.openBrowser ||
    (async (browserUrl: string): Promise<void> => {
      const opener = getBrowserOpenCommand(browserUrl);
      await exec(opener.command, opener.args);
    });
  try {
    await openBrowser(url.href);
  } catch {
    throw new ManagedSourceError("GITHUB_LINK_BROWSER_REQUIRED", nextAction);
  }
  const sleep =
    dependencies.sleep ||
    (async (ms: number): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  const startedAt = Date.now();
  const deadline = startedAt + Math.min(options.timeoutMs, 10 * 60 * 1000);
  while (Date.now() < deadline) {
    const interval = Date.now() - startedAt < 30_000 ? 2_000 : 5_000;
    await sleep(Math.min(interval, deadline - Date.now()));
    if (Date.now() >= deadline) break;
    session = validateCliGithubLinkSession(
      await responseSession(
        await client.getCliManagedGithubLinkSession(
          scope.tenantId,
          scope.appKey,
          session.sessionId,
          scope.targetTenantId,
          scope.environment,
          Math.max(1, deadline - Date.now()),
        ),
      ),
      scope,
      session.sessionId,
    );
    if (session.status === "verified") return session;
  }
  throw new ManagedSourceError("GITHUB_LINK_PENDING", nextAction);
}
