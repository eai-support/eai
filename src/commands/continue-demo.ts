import { Command } from 'commander';
import { resolve } from 'node:path';
import { inspectGeneratedDemoContinuation, readAcceptedObjectTypeDefinition } from '../lib/generated-demo-continuation.js';
import { planGeneratedDemoReadOnlyBinding, planGeneratedDemoSelectedCreateBinding } from '../lib/generated-demo-operational.js';
import { importGeneratedDemoData } from '../lib/generated-demo-operational-import.js';
import {
  completeGeneratedDemoOperationalReview,
  prepareGeneratedDemoOperationalReview,
} from '../lib/generated-demo-operational-pr.js';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import * as out from '../lib/output.js';

interface ContinueDemoOptions {
  path: string;
  format: string;
  planReadOnly?: boolean;
  prepareOperationalPr?: boolean;
  completeOperationalPr?: boolean;
  environment?: 'preview' | 'dev' | 'test' | 'prod';
  operationId?: string;
  prNumber?: string;
  tenantId?: string;
  fixtureCollection?: string;
  objectTypeSlug?: string;
  maxRows?: string;
  enableSelectedCreate?: boolean;
  createFields?: string;
  importFile?: string;
  applyImport?: boolean;
}

export const continueDemoCommand = new Command('continue-demo')
  .description('Inspect a cloned no-code demo before continuing it with CLI and Gofer')
  .option('--path <directory>', 'Generated repository root', '.')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--plan-read-only', 'Inspect one candidate published Object Type binding without changing the app')
  .option('--prepare-operational-pr', 'Reserve one bounded read and open a draft source review PR (release-gated)')
  .option('--complete-operational-pr', 'Verify a merged review reached the same ACTIVE app and complete its signed source receipt')
  .option('--operation-id <id>', 'Reserved operational source operation to complete')
  .option('--pr-number <number>', 'Merged customer review pull request number')
  .option('--environment <environment>', 'Exact active deployment environment (preview|dev|test|prod)')
  .option('--tenant-id <uuid>', 'Customer tenant for a read-only binding plan')
  .option('--fixture-collection <name>', 'Accepted sample collection to replace with real reads')
  .option('--object-type-slug <slug>', 'Published app-owned Object Type slug')
  .option('--max-rows <count>', 'Maximum records per read, from 1 to 50', '25')
  .option('--enable-selected-create', 'Prepare a reviewed host-owned create form for the same Object Type (release-gated)')
  .option('--create-fields <names>', 'Comma-separated allowlisted scalar property names for selected create')
  .option('--import-file <path>', 'Plan a bounded JSON or CSV import into the selected app Object Type')
  .option('--apply-import', 'Execute the planned import through the scoped platform create route with per-record idempotency and readback')
  .action(async (options: ContinueDemoOptions) => {
    try {
      if (options.format !== 'text' && options.format !== 'json') {
        throw new Error('Format must be text or json.');
      }
      if (Number(Boolean(options.planReadOnly)) + Number(Boolean(options.prepareOperationalPr)) +
        Number(Boolean(options.completeOperationalPr)) + Number(Boolean(options.importFile)) > 1) {
        throw new Error('Choose only one continuation action.');
      }
      if (!options.planReadOnly && !options.prepareOperationalPr &&
        !options.completeOperationalPr && !options.importFile &&
        (options.tenantId || options.fixtureCollection || options.objectTypeSlug || options.environment)) {
        throw new Error('Binding options require a read-only plan or operational PR preparation.');
      }
      if (options.applyImport && !options.importFile) throw new Error('--apply-import requires --import-file.');
      if (options.importFile &&
        (!options.tenantId || options.environment || options.fixtureCollection || options.objectTypeSlug ||
          options.enableSelectedCreate || options.createFields || options.operationId || options.prNumber)) {
        throw new Error('Import requires only --tenant-id, --import-file and optional --apply-import.');
      }
      if ((options.prepareOperationalPr || options.completeOperationalPr) &&
        !['preview', 'dev', 'test', 'prod'].includes(options.environment || '')) {
        throw new Error('Operational source review requires an explicit --environment.');
      }
      if (!options.completeOperationalPr && (options.operationId || options.prNumber)) {
        throw new Error('--operation-id and --pr-number require --complete-operational-pr.');
      }
      if (options.completeOperationalPr && (options.fixtureCollection || options.objectTypeSlug)) {
        throw new Error('Completion uses the previously reviewed binding; do not supply a new one.');
      }
      if ((options.enableSelectedCreate || options.createFields) &&
        (!options.prepareOperationalPr || !options.enableSelectedCreate || !options.createFields)) {
        throw new Error('Selected create requires --prepare-operational-pr, --enable-selected-create and --create-fields together.');
      }
      if (options.importFile) {
        const projectRoot = resolve(options.path);
        const publicApiUrl = await resolvePublicApiUrl(projectRoot);
        const context = await resolveActiveTenantContext({
          projectRoot, publicApiUrl, tenantId: options.tenantId!, interactive: false,
        });
        const client = new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id);
        const receipt = await importGeneratedDemoData({
          projectPath: options.path, filePath: options.importFile,
          tenantId: context.activeTenant.id, apply: Boolean(options.applyImport), client,
        });
        if (options.format === 'json') out.json(receipt);
        else {
          out.info(`${receipt.status}: ${receipt.records.length}/${receipt.rowCount} rows for ${receipt.objectTypeSlug}.`);
          out.info(`Input digest: ${receipt.fileDigest}`);
          if (receipt.failure) out.warn(`Stopped at row ${receipt.failure.row} (HTTP ${receipt.failure.status}); exact retry is safe.`);
        }
        if (receipt.status === 'partial') process.exitCode = 1;
        return;
      }
      const result = await inspectGeneratedDemoContinuation(options.path);
      if (options.completeOperationalPr) {
        if (!options.tenantId || !options.operationId || !options.prNumber) {
          throw new Error('--complete-operational-pr requires --tenant-id, --operation-id and --pr-number.');
        }
        const projectRoot = resolve(options.path);
        const publicApiUrl = await resolvePublicApiUrl(projectRoot);
        const context = await resolveActiveTenantContext({
          projectRoot, publicApiUrl, tenantId: options.tenantId, interactive: false,
        });
        const client = new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id);
        const receipt = await completeGeneratedDemoOperationalReview({
          projectPath: options.path,
          environment: options.environment!,
          tenantId: context.activeTenant.id,
          operationId: options.operationId,
          pullRequestNumber: Number(options.prNumber),
          inspection: result,
          client,
        });
        if (options.format === 'json') out.json(receipt);
        else {
          out.success(`Reviewed operational source is ACTIVE at ${receipt.activeUrl}.`);
          out.info(`Same container: ${receipt.containerAppName}; deployment: ${receipt.activeDeploymentId}`);
        }
        return;
      }
      let readOnlyPlan: ReturnType<typeof planGeneratedDemoReadOnlyBinding> | null = null;
      if (options.planReadOnly || options.prepareOperationalPr) {
        if (!options.tenantId || !options.fixtureCollection || !options.objectTypeSlug) {
          throw new Error('A binding requires --tenant-id, --fixture-collection and --object-type-slug.');
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
        const bindingRequest = {
          tenantId: context.activeTenant.id,
          fixtureCollection: options.fixtureCollection,
          objectTypeSlug: options.objectTypeSlug,
          maxRows: Number(options.maxRows),
        };
        const acceptedDefinition = await readAcceptedObjectTypeDefinition(
          options.path, result, options.objectTypeSlug,
        );
        readOnlyPlan = options.enableSelectedCreate
          ? planGeneratedDemoSelectedCreateBinding(
            result, bindingRequest, manifest, acceptedDefinition,
            options.createFields!.split(',').map(field => field.trim()),
          )
          : planGeneratedDemoReadOnlyBinding(result, bindingRequest, manifest, acceptedDefinition);
        if (options.prepareOperationalPr) {
          const review = await prepareGeneratedDemoOperationalReview({
            projectPath: options.path,
            environment: options.environment!,
            inspection: result,
            operationalBinding: readOnlyPlan.config,
            client,
          });
          if (options.format === 'json') out.json(review);
          else {
            out.success(`Draft source review PR prepared: ${review.pullRequestUrl}`);
            out.info(`Operation: ${review.operationId}; source head: ${review.headSha}`);
            out.warn('Review and merge are separate. This command did not deploy or enable real-data reads.');
          }
          return;
        }
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
