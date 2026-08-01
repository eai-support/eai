import { Command } from 'commander';
import {
  createCapabilityControlPlaneClient,
  formatControlPlaneError,
  sanitizeControlPlaneValue,
  type CapabilityAssetKind,
} from '../lib/capability-control-plane.js';
import { resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';
import { isRecord } from '../lib/utils.js';

function fail(error: unknown): never {
  out.error(formatControlPlaneError(error));
  process.exit(1);
}

/** Build the app capability binding command group on the existing app surface. */
export function createAppBindingsCommand(): Command {
  const command = new Command('bindings')
    .description('Manage logical tenant capability bindings for an app');

  command
    .command('list <app-key>')
    .description('List capability bindings for an app')
    .option('--tenant-id <id>', 'Tenant id (defaults to active tenant)')
    .option('--format <format>', 'Output format (text|json)', 'text')
    .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
    .action(async (appKey: string, options) => {
      try {
        const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
        const client = createCapabilityControlPlaneClient(ctx.client, ctx.tenantId);
        out.json(sanitizeControlPlaneValue(await client.listBindings(appKey)));
      } catch (error) {
        fail(error);
      }
    });

  command
    .command('set <app-key>')
    .description('Set one logical app capability binding')
    .requiredOption('--binding-key <alias>', 'Logical alias declared by the app')
    .requiredOption('--capability <key>', 'Capability key')
    .requiredOption('--asset-kind <kind>', 'integration|ai-profile|prompt|workflow')
    .requiredOption('--asset-key <key>', 'Tenant asset key; raw record ids are not required')
    .option('--environment <name>', 'Optional environment binding')
    .option('--tenant-id <id>', 'Tenant id (defaults to active tenant)')
    .option('--format <format>', 'Output format (text|json)', 'text')
    .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
    .action(async (appKey: string, options) => {
      try {
        const allowedKinds: CapabilityAssetKind[] = ['integration', 'ai-profile', 'prompt', 'workflow'];
        if (!allowedKinds.includes(options.assetKind as CapabilityAssetKind)) {
          throw new Error('--asset-kind must be integration, ai-profile, prompt, or workflow.');
        }
        const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
        const client = createCapabilityControlPlaneClient(ctx.client, ctx.tenantId);
        const binding = await client.setBinding(appKey, {
          bindingKey: options.bindingKey,
          capabilityKey: options.capability,
          assetKind: options.assetKind as CapabilityAssetKind,
          assetKey: options.assetKey,
          ...(options.environment ? { environment: options.environment } : {}),
        });
        out.json(sanitizeControlPlaneValue(binding));
      } catch (error) {
        fail(error);
      }
    });

  command
    .command('remove <app-key> <binding-key>')
    .description('Remove one logical app capability binding')
    .option('--tenant-id <id>', 'Tenant id (defaults to active tenant)')
    .option('--force', 'Confirm removal without an interactive prompt', false)
    .option('--format <format>', 'Output format (text|json)', 'text')
    .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
    .action(async (appKey: string, bindingKey: string, options) => {
      try {
        if (!options.force) throw new Error('Binding removal requires --force.');
        const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
        const client = createCapabilityControlPlaneClient(ctx.client, ctx.tenantId);
        const result = await client.removeBinding(appKey, bindingKey);
        out.json(sanitizeControlPlaneValue({ tenantId: ctx.tenantId, appKey, bindingKey, result }));
      } catch (error) {
        fail(error);
      }
    });

  command
    .command('validate <app-key>')
    .description('Validate entitlement, configuration, binding, and runtime readiness')
    .option('--tenant-id <id>', 'Tenant id (defaults to active tenant)')
    .option('--format <format>', 'Output format (text|json)', 'text')
    .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
    .action(async (appKey: string, options) => {
      try {
        const ctx = await resolveCommandContext({ tenantId: options.tenantId, interactive: !options.tenantId });
        const client = createCapabilityControlPlaneClient(ctx.client, ctx.tenantId);
        const validation = await client.validateBindings(appKey);
        out.json(sanitizeControlPlaneValue(validation));
        if (isRecord(validation) && validation.valid === false) process.exitCode = 1;
      } catch (error) {
        fail(error);
      }
    });

  return command;
}
