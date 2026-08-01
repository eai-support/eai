import chalk from 'chalk';
import {
  PlatformAPIRequestError,
  type BuilderReadinessResult,
  type RuntimeWorkflowRequestResult,
  type RuntimeWorkflowStatusResult,
} from '../lib/api.js';
import * as out from '../lib/output.js';

/** Render the runtime binding status without collapsing operator-required states. */
export function printWorkflowStatus(result: RuntimeWorkflowStatusResult): void {
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

/** Render an operator-assisted workflow binding request result. */
export function printWorkflowRequest(result: RuntimeWorkflowRequestResult): void {
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

/** Render every builder readiness check and its actionable next step. */
export function printBuilderReadiness(result: BuilderReadinessResult): void {
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

/** Preserve safe server diagnostics and correlation IDs on workflow failures. */
export function handleWorkflowError(error: unknown): never {
  if (error instanceof PlatformAPIRequestError) {
    out.error(error.serverMessage || error.message);
    if (error.requestId) {
      out.info(`Request ID: ${error.requestId}`);
    }
    process.exit(1);
  }
  out.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
