export type ErrorGuidanceCategory =
  | 'project'
  | 'local_environment'
  | 'authentication'
  | 'tenant_context'
  | 'authorization'
  | 'capability'
  | 'app_provisioning'
  | 'schema'
  | 'resource_data'
  | 'workflow'
  | 'platform'
  | 'external_service';

export type ErrorGuidanceSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface GuidanceCommand {
  command: string;
  purpose: string;
  mutates: boolean;
  writesSecrets?: boolean;
  deletesData?: boolean;
  requires?: string[];
  when?: string;
}

export interface ErrorGuidanceRetryPolicy {
  allowed: boolean;
  maxAttempts?: number;
  backoffSeconds?: number[];
  stopWhen: string[];
}

export interface ErrorGuidanceEscalation {
  neededWhen: string[];
  include: string[];
  audience: 'tenant-admin' | 'platform-support' | 'eai-maintainer';
}

export interface ErrorGuidanceSafety {
  mutatesState: boolean;
  mayWriteSecrets: boolean;
  mayDeleteData: boolean;
  publicSafe: boolean;
}

export interface ErrorGuidanceMatch {
  status?: number;
  operation?: string;
  serverCode?: string;
  messageIncludes?: string[];
}

export interface ErrorGuidance {
  code: string;
  reasonCode: string;
  title: string;
  category: ErrorGuidanceCategory;
  severity: ErrorGuidanceSeverity;
  appliesTo: string[];
  publicSafe: boolean;
  why: string[];
  evidenceToCheck: string[];
  diagnostics: GuidanceCommand[];
  fixes: GuidanceCommand[];
  retry: ErrorGuidanceRetryPolicy;
  escalation: ErrorGuidanceEscalation;
  safety: ErrorGuidanceSafety;
  match?: ErrorGuidanceMatch[];
  releaseNotes?: string;
  learnedFrom?: string[];
}

export interface GuidanceLookupInput {
  code?: string;
  reasonCode?: string;
  operation?: string;
  status?: number;
  serverCode?: string;
  message?: string;
}

export interface ErrorGuidanceJson {
  code: string;
  reasonCode: string;
  title: string;
  category: ErrorGuidanceCategory;
  severity: ErrorGuidanceSeverity;
  why: string[];
  evidenceToCheck: string[];
  diagnostics: GuidanceCommand[];
  fixes: GuidanceCommand[];
  retry: ErrorGuidanceRetryPolicy;
  escalation: ErrorGuidanceEscalation;
  safety: ErrorGuidanceSafety;
}

