import { Command } from 'commander';
import {
  createCapabilityControlPlaneClient,
  formatControlPlaneError,
  sanitizeControlPlaneValue,
} from '../lib/capability-control-plane.js';
import { normalizeFormat, resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';

interface IntegrationOptions {
  tenant?: string;
  format?: string;
  json?: boolean;
  app?: string;
  as?: string;
  capability?: string;
  environment?: string;
}

async function context(options: IntegrationOptions) {
  const resolved = await resolveCommandContext({ tenantId: options.tenant, interactive: !options.tenant });
  return {
    ...resolved,
    controlPlane: createCapabilityControlPlaneClient(resolved.client, resolved.tenantId),
  };
}

function writeResult(result: unknown, options: IntegrationOptions): void {
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

function common(command: Command): Command {
  return command
    .option('--tenant <id>', 'Tenant id (defaults to active tenant)')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--json', 'Output raw JSON (deprecated, use --format json)', false);
}

export const integrationCommand = new Command('integration')
  .description('Inspect, test, and bind Portal-configured tenant integrations');

common(integrationCommand.command('list').description('List sanitized tenant integration metadata'))
  .action(async (options: IntegrationOptions) => {
    try {
      const ctx = await context(options);
      writeResult(await ctx.controlPlane.listAssets('integration'), options);
    } catch (error) {
      fail(error);
    }
  });

common(integrationCommand.command('show <key>').description('Show sanitized integration readiness and metadata'))
  .action(async (key: string, options: IntegrationOptions) => {
    try {
      const ctx = await context(options);
      writeResult(await ctx.controlPlane.getAsset('integration', key), options);
    } catch (error) {
      fail(error);
    }
  });

common(integrationCommand.command('test <key>').description('Test a configured integration without reading credentials'))
  .action(async (key: string, options: IntegrationOptions) => {
    try {
      const ctx = await context(options);
      writeResult(await ctx.controlPlane.testIntegration(key), options);
    } catch (error) {
      fail(error);
    }
  });

common(integrationCommand.command('use <key>').description('Bind a configured integration to a logical app alias')
  .requiredOption('--app <key>', 'App key')
  .requiredOption('--as <alias>', 'Logical binding alias stored server-side')
  .option('--capability <key>', 'Capability key', 'integrations.ai-provider')
  .option('--environment <name>', 'Optional environment binding'))
  .action(async (key: string, options: IntegrationOptions) => {
    try {
      const ctx = await context(options);
      const binding = await ctx.controlPlane.setBinding(options.app ?? '', {
        bindingKey: options.as ?? '',
        capabilityKey: options.capability ?? 'integrations.ai-provider',
        assetKind: 'integration',
        assetKey: key,
        ...(options.environment ? { environment: options.environment } : {}),
      });
      writeResult(binding, options);
    } catch (error) {
      fail(error);
    }
  });

integrationCommand.addHelpText('after', `
Integration OAuth and secret capture stay in Admin Portal. This command family
only reads redacted metadata, tests configured connections, and stores logical
application bindings.
`);
