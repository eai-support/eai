/**
 * eai workflow — inspect and request AI runtime workflow bindings.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveCommandContext } from '../lib/context.js';
import {
  PlatformAPIRequestError,
  type BuilderReadinessResult,
  type RuntimeWorkflowRequestResult,
  type RuntimeWorkflowStatusResult,
} from '../lib/api.js';
import * as out from '../lib/output.js';

export const workflowCommand = new Command('workflow')
  .description('Inspect and request AI runtime workflow bindings');

function printWorkflowStatus(result: RuntimeWorkflowStatusResult): void {
  out.heading(`Workflow: ${result.workflowKey}`);
  out.table([
    ['Tenant', chalk.dim(result.tenantId || 'unknown')],
    ['Status', result.status === 'available' ? chalk.green(result.status) : chalk.yellow(result.status)],
    ['Reason', result.reasonCode],
  ]);
  out.info(result.reasonMessage);
  if (result.runtimeWorkflowId) {
    out.success(`Runtime workflow id: ${chalk.dim(result.runtimeWorkflowId)}`);
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
  if (result.runtimeWorkflowId) {
    out.success(`Runtime workflow id: ${chalk.dim(result.runtimeWorkflowId)}`);
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
