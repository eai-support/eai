import { Command, Option } from 'commander';
import {
  createCapabilityControlPlaneClient,
  formatControlPlaneError,
  parseControlPlaneObject,
  sanitizeControlPlaneValue,
  type CapabilityAssetKind,
} from '../lib/capability-control-plane.js';
import { normalizeFormat, resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';

interface AssetCommandOptions {
  tenant?: string;
  format?: string;
  json?: boolean;
  key?: string;
  data?: string;
  displayName?: string;
  status?: string;
  provider?: string;
  model?: string;
  integration?: string;
  temperature?: string;
  content?: string;
  profile?: string;
  scope?: string;
  workflow?: string;
  stage?: string;
  step?: string;
  definition?: string;
  app?: string;
  as?: string;
  capability?: string;
  environment?: string;
}

/** Describes one typed CRUD command family and its PublicAPI natural key. */
export interface AssetCrudRegistration {
  kind: Exclude<CapabilityAssetKind, 'integration'>;
  keyField: 'profileKey' | 'configKey' | 'workflowKey';
  displayName: string;
  defaultCapability: string;
}

function addCommonOptions(command: Command): Command {
  return command
    .option('--tenant <id>', 'Tenant id (defaults to active tenant)')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--json', 'Output raw JSON (deprecated, use --format json)', false);
}

function addMutationOptions(command: Command, kind: AssetCrudRegistration['kind']): Command {
  command
    .option('--display-name <name>', 'Human-readable display name')
    .option('--status <status>', 'Lifecycle status')
    .option('--data <json>', 'Additional typed fields as a JSON object; secret-shaped fields are rejected');

  if (kind === 'ai-profile') {
    command
      .option('--provider <provider>', 'AI provider type')
      .option('--model <model>', 'Model or deployment name')
      .option('--integration <key>', 'Safe tenant integration reference')
      .option('--temperature <number>', 'Model temperature');
  } else if (kind === 'prompt') {
    command
      .option('--content <text>', 'Prompt content')
      .option('--profile <key>', 'AI profile reference')
      .addOption(new Option('--scope <scope>', 'Prompt scope').choices(['application', 'workflow', 'stage', 'step']))
      .option('--app <key>', 'Application key for application-scoped prompts')
      .option('--workflow <key>', 'Workflow key for workflow, stage, or step scope')
      .option('--stage <key>', 'Workflow stage key for stage or step scope')
      .option('--step <key>', 'Workflow step key for step scope');
  } else {
    command.option('--definition <json>', 'Typed workflow definition JSON object');
  }
  return command;
}

function buildPayload(
  registration: AssetCrudRegistration,
  key: string,
  options: AssetCommandOptions,
): Record<string, unknown> {
  const payload = parseControlPlaneObject(options.data, '--data');
  const normalizedKey = key.trim();
  if (!normalizedKey) throw new Error(`${registration.displayName} key is required.`);

  const existingKey = payload[registration.keyField];
  if (typeof existingKey === 'string' && existingKey !== normalizedKey) {
    throw new Error(`--data ${registration.keyField} must match ${normalizedKey}.`);
  }

  payload[registration.keyField] = normalizedKey;
  if (options.displayName) payload.displayName = options.displayName;
  if (options.status) payload.status = options.status;

  if (registration.kind === 'ai-profile') {
    if (options.provider) payload.provider = options.provider;
    if (options.model) payload.model = options.model;
    if (options.integration) payload.providerIntegrationKey = options.integration;
    if (options.temperature !== undefined) {
      const temperature = Number(options.temperature);
      if (!Number.isFinite(temperature)) throw new Error('--temperature must be a number.');
      payload.temperature = temperature;
    }
  } else if (registration.kind === 'prompt') {
    if (options.content) payload.promptContent = options.content;
    if (options.profile) payload.aiProfileKey = options.profile;
    if (options.scope) {
      const promptLevels = {
        application: 'application',
        workflow: 'workflow',
        stage: 'workflow-stage',
        step: 'workflow-step',
      } as const;
      payload.promptLevel = promptLevels[options.scope as keyof typeof promptLevels];
      if (options.scope === 'application') {
        if (!options.app) throw new Error('--scope application requires --app.');
        payload.assignmentRules = {
          ...(typeof payload.assignmentRules === 'object' && payload.assignmentRules !== null
            ? payload.assignmentRules as Record<string, unknown>
            : {}),
          appScope: 'selected',
          verticalKeys: [options.app],
        };
      }
      if (options.scope !== 'application') {
        if (!options.workflow) throw new Error(`--scope ${options.scope} requires --workflow.`);
        payload.workflowKey = options.workflow;
      }
      if (options.scope === 'stage' || options.scope === 'step') {
        if (!options.stage) throw new Error(`--scope ${options.scope} requires --stage.`);
        payload.workflowStageKey = options.stage;
      }
      if (options.scope === 'step') {
        if (!options.step) throw new Error('--scope step requires --step.');
        payload.workflowStepKey = options.step;
      }
    }
  } else if (options.definition) {
    payload.definition = parseControlPlaneObject(options.definition, '--definition');
  }
  return payload;
}

async function controlPlane(options: AssetCommandOptions) {
  const context = await resolveCommandContext({ tenantId: options.tenant, interactive: !options.tenant });
  return {
    context,
    client: createCapabilityControlPlaneClient(context.client, context.tenantId),
  };
}

function writeResult(result: unknown, options: AssetCommandOptions): void {
  const safe = sanitizeControlPlaneValue(result);
  if (normalizeFormat(options) === 'json') {
    out.json(safe);
    return;
  }
  out.json(safe);
}

function fail(error: unknown): never {
  out.error(formatControlPlaneError(error));
  process.exit(1);
}

/** Attach consistent CRUD and logical-binding subcommands to an asset command. */
export function registerAssetCrudCommands(parent: Command, registration: AssetCrudRegistration): void {
  addCommonOptions(parent.command('list').description(`List tenant ${registration.displayName} records`))
    .action(async (options: AssetCommandOptions) => {
      try {
        const { client } = await controlPlane(options);
        writeResult(await client.listAssets(registration.kind), options);
      } catch (error) {
        fail(error);
      }
    });

  addCommonOptions(parent.command('show <key>').description(`Show one ${registration.displayName} record`))
    .action(async (key: string, options: AssetCommandOptions) => {
      try {
        const { client } = await controlPlane(options);
        writeResult(await client.getAsset(registration.kind, key), options);
      } catch (error) {
        fail(error);
      }
    });

  addCommonOptions(addMutationOptions(
    parent.command('create').description(`Create a tenant ${registration.displayName} record`)
      .requiredOption('--key <key>', `Stable ${registration.displayName} key`),
    registration.kind,
  )).action(async (options: AssetCommandOptions) => {
    try {
      const body = buildPayload(registration, options.key ?? '', options);
      const { client } = await controlPlane(options);
      writeResult(await client.createAsset(registration.kind, body), options);
    } catch (error) {
      fail(error);
    }
  });

  addCommonOptions(addMutationOptions(
    parent.command('update <key>').description(`Update a tenant ${registration.displayName} record`),
    registration.kind,
  )).action(async (key: string, options: AssetCommandOptions) => {
    try {
      const body = buildPayload(registration, key, options);
      const { client } = await controlPlane(options);
      writeResult(await client.updateAsset(registration.kind, key, body), options);
    } catch (error) {
      fail(error);
    }
  });

  addCommonOptions(parent.command('delete <key>').description(`Delete a tenant ${registration.displayName} record`)
    .option('--force', 'Confirm deletion without an interactive prompt', false))
    .action(async (key: string, options: AssetCommandOptions & { force?: boolean }) => {
      try {
        if (!options.force) throw new Error('Deletion requires --force.');
        const { context, client } = await controlPlane(options);
        const result = await client.deleteAsset(registration.kind, key);
        writeResult({ tenantId: context.tenantId, key, deleted: true, result }, options);
      } catch (error) {
        fail(error);
      }
    });

  addCommonOptions(parent.command('use <key>').description(`Bind a ${registration.displayName} record to a logical app alias`)
    .requiredOption('--app <key>', 'App key')
    .requiredOption('--as <alias>', 'Logical binding alias stored server-side')
    .option('--capability <key>', 'Capability key', registration.defaultCapability)
    .option('--environment <name>', 'Optional environment binding'))
    .action(async (key: string, options: AssetCommandOptions) => {
      try {
        const { client } = await controlPlane(options);
        const result = await client.setBinding(options.app ?? '', {
          bindingKey: options.as ?? '',
          capabilityKey: options.capability ?? registration.defaultCapability,
          assetKind: registration.kind,
          assetKey: key,
          ...(options.environment ? { environment: options.environment } : {}),
        });
        writeResult(result, options);
      } catch (error) {
        fail(error);
      }
    });
}
