export interface V4ResourceContractViolation {
  ruleId: string;
  file: string;
  line: number;
  message: string;
  remediation: string;
  documentation: string;
}

export interface ObjectTypeDirectRouteFinding {
  contractVersion: 'eai.object-type-routing/v1';
  rule: 'OBJECT_TYPE_DIRECT_ROUTE_CONSTRUCTION';
  classification: 'blocking_source_drift';
  severity: 'error';
  location: {
    kind: 'source';
    file: string;
    line: number;
    column: number;
  };
  field: null;
  offendingValue: string;
  expectedValue: string;
  remediation: string;
}

export const OBJECT_TYPE_ROUTING_AUDIT_CONFIG: Readonly<{
  fixedRoots: readonly string[];
  governedRepositoryRoots: readonly string[];
  excludedDirectories: readonly string[];
  soleOwner: string;
  canonicalGuidance: string;
}>;

export function validateSourceContent(
  content: string,
  file?: string
): V4ResourceContractViolation[];

export function validateWorkspace(workspace: string): Promise<{
  valid: boolean;
  filesScanned: number;
  violations: Array<V4ResourceContractViolation | ObjectTypeDirectRouteFinding>;
}>;
