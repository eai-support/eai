/**
 * eai workflow — provision vertical workflow configs and inspect runtime bindings.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadEnvFile, patchEnvFile } from '../lib/config.js';
import { normalizeFormat, resolveCommandContext } from '../lib/context.js';
import { setCloudEnvValues } from '../lib/cloud-env.js';
import {
  PlatformAPIRequestError,
  type BuilderReadinessResult,
  type RuntimeWorkflowRequestResult,
  type RuntimeWorkflowStatusResult,
} from '../lib/api.js';
import {
  buildWorkflowAiRuntimeBindingPayloads,
  buildWorkflowProvisionPayloads,
  parseEnvMapping,
  parseStagePrompt,
  parseStageSpec,
  SHARED_AI_PROFILE_OBJECT_TYPE,
  SHARED_CHATBOT_CONFIG_OBJECT_TYPE,
  SHARED_WORKFLOW_CONFIG_OBJECT_TYPE,
  validateStageEnvMappings,
  validateStagePromptMappings,
  VERTICAL_PRODUCT_CONFIG_OBJECT_TYPE,
  workflowVerticalConfigKey,
  type WorkflowProvisionStatus,
} from '../lib/workflow-provisioning.js';
import { isRecord } from '../lib/utils.js';
import * as out from '../lib/output.js';

export const workflowCommand = new Command('workflow')
  .description('Provision vertical workflow configs and inspect AI runtime workflow bindings');

interface ResourceDoc {
  id?: string;
  data?: Record<string, unknown>;
  version?: number;
}

interface WorkflowProvisionOptions {
  tenant?: string;
  vertical: string;
  displayName?: string;
  usecase?: string;
  scopeKey?: string;
  stage?: string[];
  stageEnv?: string[];
  workflowEnvKey?: string;
  bindAiRuntime?: boolean;
  aiProvider?: string;
  aiModel?: string;
  aiProfileKey?: string;
  stagePrompt?: string[];
  status?: WorkflowProvisionStatus;
  writeLocalEnv?: boolean;
  writeAppConfig?: boolean;
  env?: string;
  label?: string;
  format?: string;
  json?: boolean;
}

function readDocs(payload: unknown): ResourceDoc[] {
  if (!isRecord(payload)) return [];
  const docs = Array.isArray(payload.docs) ? payload.docs : Array.isArray(payload.items) ? payload.items : [];
  return docs.filter(isRecord).map((doc) => ({
    id: typeof doc.id === 'string' ? doc.id : undefined,
    data: isRecord(doc.data) ? doc.data : undefined,
    version: typeof doc.version === 'number' ? doc.version : undefined,
  }));
}

async function readResponsePayload(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function readResourceId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.id === 'string') return payload.id;
  if (isRecord(payload.doc) && typeof payload.doc.id === 'string') return payload.doc.id;
  if (isRecord(payload.resource) && typeof payload.resource.id === 'string') return payload.resource.id;
  return undefined;
}

function fail(message: string): never {
  out.error(message);
  process.exit(1);
}

async function upsertWorkflowResource(
  context: Awaited<ReturnType<typeof resolveCommandContext>>,
  objectType: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<{ id?: string; action: 'created' | 'updated' }> {
  const listRes = await context.client.listResources(objectType, { limit: 1, where });
  const listPayload = await readResponsePayload(listRes);
  if (!listRes.ok) {
    throw new Error(`Failed to find ${objectType}: ${listRes.status} ${listRes.statusText}`);
  }

  const existing = readDocs(listPayload)[0];
  if (existing?.id) {
    if (typeof existing.version !== 'number') {
      throw new Error(`Existing ${objectType} ${existing.id} did not include a version.`);
    }
    const updateRes = await context.client.updateResource(objectType, existing.id, data, existing.version);
    const updatePayload = await readResponsePayload(updateRes);
    if (!updateRes.ok) {
      throw new Error(`Failed to update ${objectType}: ${updateRes.status} ${updateRes.statusText}`);
    }
    return { id: readResourceId(updatePayload) ?? existing.id, action: 'updated' };
  }

  const createRes = await context.client.createResource(objectType, data);
  const createPayload = await readResponsePayload(createRes);
  if (!createRes.ok) {
    throw new Error(`Failed to create ${objectType}: ${createRes.status} ${createRes.statusText}`);
  }
  return { id: readResourceId(createPayload), action: 'created' };
}

function printWorkflowStatus(result: RuntimeWorkflowStatusResult): void {
  out.heading(`Workflow: ${result.workflowKey}`);
  out.table([
    ['Tenant', chalk.dim(result.tenantId || 'unknown')],
    ['Status', result.status === 'available' ? chalk.green(result.status) : chalk.yellow(result.status)],
    ['Reason', result.reasonCode],
  ]);
  out.info(result.reasonMessage);
  if (result.runtimeWorkflowRef) {
    out.success(`Runtime workflow ref: ${chalk.dim(result.runtimeWorkflowRef)}`);
  }
  if (result.nextAction) {
    out.warn(result.nextAction);
  }
}

function printWorkflowRequest(result: RuntimeWorkflowRequestResult): void {
  out.heading(`Workflow request: ${result.workflowKey}`);
  out.table([
    ['Request ID', chalk.dim(result.requestId)],
    ['Tenant', chalk.dim(result.tenantId)],
    ['Status', result.status === 'available' ? chalk.green(result.status) : chalk.yellow(result.status)],
    ['Reason', result.reasonCode],
  ]);
  out.info(result.reasonMessage);
  if (result.runtimeWorkflowRef) {
    out.success(`Runtime workflow ref: ${chalk.dim(result.runtimeWorkflowRef)}`);
  }
  if (result.nextAction) {
    out.warn(result.nextAction);
  }
}

function printBuilderReadiness(result: BuilderReadinessResult): void {
  out.heading(`Builder readiness: ${result.tenantId}`);
  out.table([
    ['Status', result.status === 'available' ? chalk.green(result.status) : chalk.yellow(result.status)],
    ['Checks', String(result.checks.length)],
  ]);
  for (const check of result.checks) {
    const status = check.status === 'available' ? chalk.green(check.status) : chalk.yellow(check.status);
    out.info(`${check.key}: ${status} — ${check.reasonMessage}`);
    if (check.nextAction) {
      out.warn(check.nextAction);
    }
  }
}

function handleWorkflowError(err: unknown): never {
  if (err instanceof PlatformAPIRequestError) {
    out.error(err.serverMessage || err.message);
    if (err.requestId) {
      out.info(`Request ID: ${err.requestId}`);
    }
    process.exit(1);
  }
  out.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

workflowCommand
  .command('provision <workflow-key>')
  .description('Provision a usecase-agnostic workflow config and bind it to a tenant vertical')
  .requiredOption('--vertical <key>', 'Tenant vertical/app key that consumes this workflow')
  .option('--tenant <id>', 'Tenant id to provision against (defaults to active tenant)')
  .option('--display-name <name>', 'Workflow display name (defaults to humanized workflow key)')
  .option('--usecase <usecase>', 'Workflow usecase namespace', 'generic')
  .option('--scope-key <scopeKey>', 'Explicit workflow scope key (defaults to <usecase>:<workflow-key>)')
  .option('--stage <stage>', 'Stage id, optionally id:Display Name. Repeat for multiple stages.', collect, [])
  .option('--stage-env <mapping>', 'Env mapping KEY=stage-id. Repeat for stage env vars.', collect, [])
  .option('--workflow-env-key <key>', 'Env key for the workflow id')
  .option('--bind-ai-runtime', 'Also create shared-ai-profile and shared-chatbot-config records for the stages', false)
  .option('--ai-provider <integrationKey>', 'Tenant integration key for the AI provider')
  .option('--ai-model <model>', 'AI model/deployment name for the workflow runtime')
  .option('--ai-profile-key <key>', 'Reusable shared-ai-profile key (defaults to <workflow>-default-model)')
  .option('--stage-prompt <stage=prompt>', 'Prompt content for a stage. Repeat for multiple stages.', collect, [])
  .option('--status <status>', 'active or draft', 'active')
  .option('--write-local-env', 'Patch .env.local with generated env values', false)
  .option('--write-app-config', 'Write generated env values to Azure App Configuration', false)
  .option('--env <environment>', 'Azure App Configuration environment', 'dev')
  .option('--label <label>', 'Azure App Configuration label (defaults to NEXT_PUBLIC_APP_NAME or vertical key)')
  .option('--format <format>', 'Output format: text or json', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai workflow provision configurator --vertical no-code-builder \\
      --workflow-env-key NEXT_PUBLIC_WORKFLOW_CONFIGURATOR_ID \\
      --stage analyze-process:"Analyze process" \\
      --stage generate-workflow:"Generate workflow" \\
      --stage suggest-improvements:"Suggest improvements" \\
      --stage-env WORKFLOW_ANALYZE_STAGE=analyze-process \\
      --stage-env WORKFLOW_GENERATE_STAGE=generate-workflow \\
      --stage-env WORKFLOW_SUGGESTIONS_STAGE=suggest-improvements
      --bind-ai-runtime --ai-provider azure-openai --ai-model gpt-5.1-chat

  $ eai workflow provision onboarding --vertical hr-helper --stage intake --stage review --write-local-env
  `)
  .action(async (workflowKey: string, options: WorkflowProvisionOptions) => {
    const format = normalizeFormat(options);
    try {
      const context = await resolveCommandContext({ tenantId: options.tenant, interactive: !options.tenant });
      const stages = (options.stage ?? []).map((stage, index) => parseStageSpec(stage, index));
      const stageEnv = Object.fromEntries((options.stageEnv ?? []).map(parseEnvMapping));
      validateStageEnvMappings(stages, stageEnv);

      if (options.status !== 'active' && options.status !== 'draft') {
        throw new Error('--status must be active or draft.');
      }

      const displayName = options.displayName?.trim() || parseStageSpec(workflowKey, 0).name || workflowKey;
      const payloads = buildWorkflowProvisionPayloads({
        tenantId: context.tenantId,
        verticalKey: options.vertical,
        workflowKey,
        displayName,
        stages,
        usecase: options.usecase,
        scopeKey: options.scopeKey,
        status: options.status,
      }, {
        workflowEnvKey: options.workflowEnvKey,
        stageEnv,
      });

      const normalizedWorkflowKey = String(payloads.workflowConfig.workflowKey);
      const normalizedVerticalKey = String(payloads.verticalConfig.verticalKey);
      const shouldBindAiRuntime = Boolean(
        options.bindAiRuntime ||
        options.aiProvider ||
        options.aiModel ||
        (options.stagePrompt ?? []).length,
      );
      let runtimePayloads: ReturnType<typeof buildWorkflowAiRuntimeBindingPayloads> | undefined;
      if (shouldBindAiRuntime) {
        if (!options.aiProvider || !options.aiModel) {
          throw new Error('--bind-ai-runtime requires --ai-provider and --ai-model.');
        }
        const stagePrompts = Object.fromEntries((options.stagePrompt ?? []).map(parseStagePrompt));
        validateStagePromptMappings(stages, stagePrompts);
        runtimePayloads = buildWorkflowAiRuntimeBindingPayloads({
          tenantId: context.tenantId,
          verticalKey: options.vertical,
          workflowKey,
          displayName,
          stages,
          usecase: options.usecase,
          scopeKey: options.scopeKey,
          status: options.status,
          providerIntegrationKey: options.aiProvider,
          model: options.aiModel,
          profileKey: options.aiProfileKey,
          stagePrompts,
        });
      }

      const workflow = await upsertWorkflowResource(
        context,
        SHARED_WORKFLOW_CONFIG_OBJECT_TYPE,
        {
          tenantId: context.tenantId,
          workflowKey: normalizedWorkflowKey,
        },
        payloads.workflowConfig,
      );
      const vertical = await upsertWorkflowResource(
        context,
        VERTICAL_PRODUCT_CONFIG_OBJECT_TYPE,
        {
          tenantId: context.tenantId,
          verticalKey: normalizedVerticalKey,
          configKey: workflowVerticalConfigKey(normalizedWorkflowKey),
        },
        payloads.verticalConfig,
      );
      const aiRuntime: Array<{ objectType: string; key: string; id?: string; action: string }> = [];

      if (runtimePayloads) {
        const profileKey = String(runtimePayloads.aiProfile.profileKey);
        const profile = await upsertWorkflowResource(
          context,
          SHARED_AI_PROFILE_OBJECT_TYPE,
          {
            tenantId: context.tenantId,
            profileKey,
          },
          runtimePayloads.aiProfile,
        );
        aiRuntime.push({
          objectType: SHARED_AI_PROFILE_OBJECT_TYPE,
          key: profileKey,
          id: profile.id,
          action: profile.action,
        });
        for (const chatbotConfig of runtimePayloads.chatbotConfigs) {
          const configKey = String(chatbotConfig.configKey);
          const config = await upsertWorkflowResource(
            context,
            SHARED_CHATBOT_CONFIG_OBJECT_TYPE,
            {
              tenantId: context.tenantId,
              configKey,
            },
            chatbotConfig,
          );
          aiRuntime.push({
            objectType: SHARED_CHATBOT_CONFIG_OBJECT_TYPE,
            key: configKey,
            id: config.id,
            action: config.action,
          });
        }
      }

      const envValues = {
        ...payloads.envValues,
        [payloads.workflowEnvKey]: workflow.id ?? normalizedWorkflowKey,
      };

      if (options.writeLocalEnv) {
        await patchEnvFile(context.root, envValues);
      }

      let appConfig: { store: string; count: number; label: string } | undefined;
      if (options.writeAppConfig) {
        const projectEnv = await loadEnvFile(context.root);
        const label = options.label || projectEnv.NEXT_PUBLIC_APP_NAME || normalizedVerticalKey;
        const result = await setCloudEnvValues({
          environment: options.env,
          label,
          values: envValues,
        });
        appConfig = { ...result, label };
      }

      const result = {
        tenantId: context.tenantId,
        workflow: {
          id: workflow.id ?? null,
          action: workflow.action,
          objectType: SHARED_WORKFLOW_CONFIG_OBJECT_TYPE,
          workflowKey: normalizedWorkflowKey,
        },
        vertical: {
          id: vertical.id ?? null,
          action: vertical.action,
          objectType: VERTICAL_PRODUCT_CONFIG_OBJECT_TYPE,
          verticalKey: normalizedVerticalKey,
          configKey: workflowVerticalConfigKey(normalizedWorkflowKey),
        },
        aiRuntime,
        env: envValues,
        appConfig: appConfig ?? null,
      };

      if (format === 'json') {
        out.json(result);
        return;
      }

      out.success(`${workflow.action === 'created' ? 'Created' : 'Updated'} ${SHARED_WORKFLOW_CONFIG_OBJECT_TYPE} ${chalk.cyan(normalizedWorkflowKey)}`);
      out.success(`${vertical.action === 'created' ? 'Created' : 'Updated'} ${VERTICAL_PRODUCT_CONFIG_OBJECT_TYPE} ${chalk.cyan(String(result.vertical.configKey))}`);
      for (const runtimeRecord of aiRuntime) {
        out.success(`${runtimeRecord.action === 'created' ? 'Created' : 'Updated'} ${runtimeRecord.objectType} ${chalk.cyan(runtimeRecord.key)}`);
      }
      if (options.writeLocalEnv) {
        out.success('Patched .env.local');
      }
      if (appConfig) {
        out.success(`Wrote ${appConfig.count} App Configuration value(s) to ${appConfig.store} (label: ${appConfig.label})`);
      }
      out.blank();
      out.heading('Env values');
      for (const [key, value] of Object.entries(envValues)) {
        out.info(`${key}=${chalk.dim(value)}`);
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

workflowCommand
  .command('readiness')
  .description('Check tenant, plan, and workflow readiness for building a vertical')
  .argument('[workflow-keys...]', 'Optional public workflow keys to include in readiness checks')
  .option('--tenant <id>', 'Tenant id to check (defaults to active tenant)')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (workflowKeys: string[], options: { tenant?: string; format?: string }) => {
    const context = await resolveCommandContext({ tenantId: options.tenant });
    const result = await context.client.getBuilderReadiness({
      tenantId: context.tenantId,
      workflowKeys,
    }).catch(handleWorkflowError);

    if (options.format === 'json') {
      out.json(result);
      return;
    }
    printBuilderReadiness(result);
  });

function collect(value: string, previous: string[]): string[] {
  return [...(previous ?? []), value];
}

workflowCommand
  .command('status')
  .description('Check whether a workflow key has an executable runtime binding')
  .argument('<workflow-key>', 'Public workflow key, for example strategy-monitor')
  .option('--tenant <id>', 'Tenant id to check (defaults to active tenant)')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (workflowKey: string, options: { tenant?: string; format?: string }) => {
    const context = await resolveCommandContext({ tenantId: options.tenant });
    const result = await context.client.getRuntimeWorkflowStatus(workflowKey, context.tenantId)
      .catch(handleWorkflowError);

    if (options.format === 'json') {
      out.json(result);
      return;
    }
    printWorkflowStatus(result);
  });

workflowCommand
  .command('request')
  .description('Request an operator-assisted runtime workflow binding')
  .argument('<workflow-key>', 'Public workflow key, for example strategy-monitor')
  .option('--tenant <id>', 'Tenant id to request for (defaults to active tenant)')
  .option('--display-name <name>', 'Human-readable workflow display name')
  .option('--reason <reason>', 'Short reason to include for the platform operator')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (
    workflowKey: string,
    options: { tenant?: string; displayName?: string; reason?: string; format?: string },
  ) => {
    const context = await resolveCommandContext({ tenantId: options.tenant });
    const result = await context.client.requestRuntimeWorkflow({
      tenantId: context.tenantId,
      workflowKey,
      displayName: options.displayName,
      reason: options.reason,
    }).catch(handleWorkflowError);

    if (options.format === 'json') {
      out.json(result);
      return;
    }
    printWorkflowRequest(result);
  });
