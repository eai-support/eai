import { Command } from 'commander';
import { resolve } from 'node:path';
import { inspectGeneratedDemoContinuation } from '../lib/generated-demo-continuation.js';
import { planGeneratedDemoReadOnlyBinding } from '../lib/generated-demo-operational.js';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import * as out from '../lib/output.js';

interface ContinueDemoOptions {
  path: string;
  format: string;
  planReadOnly?: boolean;
  tenantId?: string;
  fixtureCollection?: string;
  objectTypeSlug?: string;
  maxRows?: string;
}

export const continueDemoCommand = new Command('continue-demo')
  .description('Inspect a cloned no-code demo before continuing it with CLI and Gofer')
  .option('--path <directory>', 'Generated repository root', '.')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--plan-read-only', 'Inspect one candidate published Object Type binding without changing the app')
  .option('--tenant-id <uuid>', 'Customer tenant for a read-only binding plan')
  .option('--fixture-collection <name>', 'Accepted sample collection to replace with real reads')
  .option('--object-type-slug <slug>', 'Published app-owned Object Type slug')
  .option('--max-rows <count>', 'Maximum records per read, from 1 to 50', '25')
  .action(async (options: ContinueDemoOptions) => {
    try {
      if (options.format !== 'text' && options.format !== 'json') {
        throw new Error('Format must be text or json.');
      }
      if (!options.planReadOnly && (options.tenantId || options.fixtureCollection || options.objectTypeSlug)) {
        throw new Error('Read-only binding options require --plan-read-only.');
      }
      const result = await inspectGeneratedDemoContinuation(options.path);
      let readOnlyPlan: ReturnType<typeof planGeneratedDemoReadOnlyBinding> | null = null;
      if (options.planReadOnly) {
        if (!options.tenantId || !options.fixtureCollection || !options.objectTypeSlug) {
          throw new Error('--plan-read-only requires --tenant-id, --fixture-collection and --object-type-slug.');
        }
        const projectRoot = resolve(options.path);
        const publicApiUrl = await resolvePublicApiUrl(projectRoot);
        const context = await resolveActiveTenantContext({
          projectRoot, publicApiUrl, tenantId: options.tenantId, interactive: false,
        });
        const client = new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id);
        const response = await client.requestPublicApi(
          `/v4/platform/tenants/${encodeURIComponent(context.activeTenant.id)}/apps/${encodeURIComponent(result.appKey)}/object-types/manifest`,
        );
        if (!response.ok) throw new Error(`The app Object Type manifest read failed (HTTP ${response.status}).`);
        const responseText = await response.text();
        if (Buffer.byteLength(responseText, 'utf8') > 1_000_000) {
          throw new Error('The app Object Type manifest is too large to inspect.');
        }
        let manifest: unknown;
        try { manifest = JSON.parse(responseText); } catch { throw new Error('The app Object Type manifest is invalid.'); }
        readOnlyPlan = planGeneratedDemoReadOnlyBinding(result, {
          tenantId: context.activeTenant.id,
          fixtureCollection: options.fixtureCollection,
          objectTypeSlug: options.objectTypeSlug,
          maxRows: Number(options.maxRows),
        }, manifest);
      }
      if (options.format === 'json') {
        out.json(readOnlyPlan ? { ...result, readOnlyPlan } : result);
        return;
      }
      out.success(`Verified local NCB demo source integrity for ${result.appKey}.`);
      out.info(`Repository: ${result.repository} at ${result.commitSha}`);
      out.info(`${result.objectTypeDefinitionCount} Object Type definitions remain in the accepted artifact.`);
      out.warn('Data and actions are still simulated. Review and replace demo adapters with authorized platform bindings before claiming live operations.');
      if (readOnlyPlan) {
        out.info(`Read-only candidate: ${readOnlyPlan.config.readBindings[0].fixtureCollection} → ${readOnlyPlan.config.readBindings[0].objectTypeSlug} (maximum ${readOnlyPlan.config.readBindings[0].maxRows} rows).`);
        out.warn(readOnlyPlan.nextAction);
      }
      out.info('The source, manifest, Object Types, credentials and deployment were not changed.');
    } catch (error) {
      out.error(error instanceof Error ? error.message : 'Unable to inspect generated demo.');
      process.exitCode = 1;
    }
  });
