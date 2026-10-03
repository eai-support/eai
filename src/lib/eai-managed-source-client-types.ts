import type {
  CliManagedGithubLinkRequest,
  CliManagedGithubLinkSession,
} from "./api.js";

/** All browser and source operations must preserve this user-selected deployment scope. */
export interface CliManagedSourceScope {
  tenantId: string;
  appKey: string;
  targetTenantId: string;
  environment: CliManagedGithubLinkRequest["environment"];
  actorId: string;
}

/** The publisher owns repository identity and reports review separately from observed deployment readiness. */
export interface CliManagedSourceOperation extends CliManagedSourceScope {
  schemaVersion: "eai.cli_managed_source_operation.v1";
  sourceMode: "eai-cli-generated";
  operationId: string;
  status:
    | "accepted"
    | "publishing"
    | "pending_review"
    | "deploying"
    | "handoff_pending"
    | "completed"
    | "failed";
  githubLinkSessionId?: string;
  templateCommitSha: string;
  bundleSha256: string;
  configHash: string;
  verifiedGithubUser: NonNullable<
    CliManagedGithubLinkSession["verifiedGithubUser"]
  >;
  repository: {
    owner: string;
    name: string;
    id?: number;
    nodeId?: string;
    defaultBranch?: string;
    private?: boolean;
  };
  review?: {
    mergedSha?: string;
    pullRequestUrl?: string;
    [key: string]: unknown;
  };
  deployment?: {
    requestId?: string;
    status?: string;
    liveUrl?: string;
    workflowRunId?: string;
    artifactDigest?: string;
    imageDigest?: string;
    runtimeIdentity?: { clientId?: string; principalId?: string };
    latestPointerVersion?: number;
    expectedLatestVersion?: number;
    requiresTenantInfra?: boolean;
    [key: string]: unknown;
  };
  error?: unknown;
  expiresAt: string;
  upload?: { url: string; ticket: string; expiresAt: string; sha256: string };
}
