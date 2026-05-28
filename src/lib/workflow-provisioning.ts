import { toObjectTypeSlug } from './utils.js';

export const SHARED_WORKFLOW_CONFIG_OBJECT_TYPE = 'shared-workflow-config';
export const VERTICAL_PRODUCT_CONFIG_OBJECT_TYPE = 'vertical-product-config';
export const WORKFLOW_VERTICAL_CONFIG_PREFIX = 'workflow:';

export type WorkflowProvisionStatus = 'active' | 'draft';

export interface WorkflowProvisionStage {
  id: string;
  name?: string;
  order?: number;
}

export interface WorkflowProvisionDefinitionInput {
  tenantId: string;
  verticalKey: string;
  workflowKey: string;
  displayName: string;
  stages: WorkflowProvisionStage[];
  usecase?: string;
  scopeKey?: string;
  status?: WorkflowProvisionStatus;
  source?: string;
}

export interface WorkflowProvisionPayloads {
  workflowConfig: Record<string, unknown>;
  verticalConfig: Record<string, unknown>;
  workflowEnvKey: string;
  envValues: Record<string, string>;
}

export function workflowVerticalConfigKey(workflowKey: string): string {
  return `${WORKFLOW_VERTICAL_CONFIG_PREFIX}${workflowKey}`;
}

export function toEnvToken(value: string): string {
  return toObjectTypeSlug(value)
    .replace(/-/g, '_')
    .replace(/[^A-Z0-9_]/gi, '')
    .replace(/_+/g, '_')
    .toUpperCase();
}

export function humanizeSlug(value: string): string {
  return toObjectTypeSlug(value)
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function parseStageSpec(value: string, index: number): WorkflowProvisionStage {
  const [rawId, ...nameParts] = value.split(':');
  const id = rawId?.trim();
  if (!id) {
    throw new Error('Stage id is required. Use --stage <stage-id[:Display Name]>.');
  }
  return {
    id,
    name: nameParts.join(':').trim() || humanizeSlug(id),
    order: index + 1,
  };
}

export function parseEnvMapping(value: string): [string, string] {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error('Stage env mappings must use KEY=stage-id.');
  }
  const key = value.slice(0, separatorIndex).trim();
  const stageId = value.slice(separatorIndex + 1).trim();
  if (!key || !stageId) {
    throw new Error('Stage env mappings must use KEY=stage-id.');
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env key "${key}". Use uppercase A-Z, 0-9, and underscores.`);
  }
  return [key, stageId];
}

export function validateStageEnvMappings(
  stages: WorkflowProvisionStage[],
  stageEnv: Record<string, string>,
): void {
  const validStageIds = new Set(stages.map((stage) => toObjectTypeSlug(stage.id)));
  for (const [key, stageId] of Object.entries(stageEnv)) {
    if (!validStageIds.has(toObjectTypeSlug(stageId))) {
      throw new Error(`${key} points at unknown stage "${stageId}".`);
    }
  }
}

export function buildWorkflowProvisionPayloads(
  input: WorkflowProvisionDefinitionInput,
  options?: {
    workflowEnvKey?: string;
    stageEnv?: Record<string, string>;
  },
): WorkflowProvisionPayloads {
  const workflowKey = toObjectTypeSlug(input.workflowKey);
  const verticalKey = toObjectTypeSlug(input.verticalKey);
  const displayName = input.displayName.trim();
  const status = input.status ?? 'active';
  const usecase = input.usecase?.trim() || 'generic';
  const scopeKey = input.scopeKey?.trim() || `${usecase}:${workflowKey}`;
  const source = input.source?.trim() || 'eai-cli';

  if (!input.tenantId.trim()) {
    throw new Error('Tenant id is required.');
  }
  if (!workflowKey) {
    throw new Error('Workflow key is required.');
  }
  if (!verticalKey) {
    throw new Error('Vertical key is required.');
  }
  if (!displayName) {
    throw new Error('Workflow display name is required.');
  }
  if (input.stages.length === 0) {
    throw new Error('At least one --stage is required.');
  }

  const stages = input.stages.map((stage, index) => {
    const code = toObjectTypeSlug(stage.id);
    if (!code) {
      throw new Error('Stage id is required.');
    }
    return {
      id: code,
      code,
      name: stage.name?.trim() || humanizeSlug(code),
      order: stage.order ?? index + 1,
      steps: [],
      metadata: {
        streaming: true,
      },
    };
  });

  const workflowDefinition = {
    id: `workflow-${workflowKey}`,
    version: 1,
    name: displayName,
    code: workflowKey,
    usecase,
    scopeKey,
    active: status === 'active',
    showInSummary: true,
    order: 0,
    stages,
    targetProfiles: [],
    metricDefinitions: [],
    status,
    targetsEnabled: false,
    consumedBy: [verticalKey],
    source,
    metadata: {
      provisionedBy: 'eai-cli',
      verticalKey,
    },
  };

  const workflowConfig = {
    tenantId: input.tenantId,
    workflowKey,
    usecase,
    scopeKey,
    displayName,
    status,
    consumedBy: [verticalKey],
    source,
    definition: {
      workflowDefinition,
    },
    metadata: {
      storage: 'resourceapi',
      normalized: true,
      provisionedBy: 'eai-cli',
    },
  };

  const verticalConfig = {
    tenantId: input.tenantId,
    verticalKey,
    configKey: workflowVerticalConfigKey(workflowKey),
    displayName: `${displayName} workflow setup`,
    status,
    sourceSurface: 'eai-cli',
    migrationStatus: 'ready',
    config: {
      workflowKey,
      setupStatus: 'completed',
      setup: {
        stageIds: Object.fromEntries(stages.map((stage) => [stage.code, stage.id])),
      },
    },
    metadata: {
      storage: 'resourceapi',
      sourceWorkflowScope: scopeKey,
      provisionedBy: 'eai-cli',
    },
  };

  const workflowEnvKey = options?.workflowEnvKey?.trim()
    || `WORKFLOW_${toEnvToken(workflowKey)}_ID`;
  const envValues: Record<string, string> = {
    [workflowEnvKey]: workflowKey,
    ...(options?.stageEnv ?? {}),
  };

  return {
    workflowConfig,
    verticalConfig,
    workflowEnvKey,
    envValues,
  };
}
