import { createHash } from 'node:crypto';
import { Command } from 'commander';
import { PlatformAPIClient, readManagedPublicResponseText, type CliCustomerCommitRequest } from '../lib/api.js';
import { normalizeFormat, resolveCommandContext } from '../lib/context.js';
import { ManagedSourceError } from '../lib/eai-managed-source.js';
import { requireManagedPublicApiUrl } from '../lib/eai-managed-deploy.js';
import { CLI_MANAGED_SOURCE_OPERATION_ID, isManagedScopeIdentifier } from '../lib/eai-managed-identifiers.js';
import { validateCliGithubLinkSession } from '../lib/eai-managed-source-link-client.js';
import { cliManagedSourceIdempotencyKey, responseOperation, validateCliManagedSourceOperation } from '../lib/eai-managed-source-operation-client.js';
import type { CliManagedSourceScope } from '../lib/eai-managed-source-client-types.js';
import * as out from '../lib/output.js';
import { fail, ManagedDeployFailure, MANAGED_DEPLOY_ENVIRONMENTS } from './eai-managed-deploy-contract.js';
import { printFailure } from './eai-managed-deploy-output.js';

interface CommitOptions {
  tenantId: string; targetTenantId: string; environment: string; githubLinkSession: string;
  predecessorOperation: string; predecessorIntegrity: string; predecessorCommit: string;
  pullRequest: string; commit: string; authorizeExactCommit?: boolean; format: string;
}

/** Once consent was submitted, generic same-command retry guidance cannot preserve its one-shot body. */
export function customerCommitFailure(error: unknown, admissionIssued: boolean): unknown {
  if (!admissionIssued) return error;
  const code = error instanceof ManagedDeployFailure || error instanceof ManagedSourceError
    ? error.code : 'EAI_MANAGED_DEPLOY_FAILED';
  return new ManagedDeployFailure(code, error instanceof Error ? error.message : String(error),
    'Observe the current operation/status read-only before another authorization. Do not repeat consent or change the idempotency key after an ambiguous response; an existing authorization remains immutable.');
}

/** This explicit action authorizes already-merged bytes, never supplies a provider review claim. */
export function customerCommitRequest(options: CommitOptions, scope: CliManagedSourceScope): CliCustomerCommitRequest {
  const number = Number(options.pullRequest);
  if (options.authorizeExactCommit !== true
    || typeof options.pullRequest !== 'string'
    || ![scope.tenantId, scope.targetTenantId, scope.appKey].every(isManagedScopeIdentifier)
    || !MANAGED_DEPLOY_ENVIRONMENTS.has(scope.environment)
    || !/^[1-9][0-9]*$/.test(options.pullRequest) || !Number.isSafeInteger(number)
    || !CLI_MANAGED_SOURCE_OPERATION_ID.test(options.predecessorOperation)
    || !/^sha256:[a-f0-9]{64}$/.test(options.predecessorIntegrity)
    || !/^[a-f0-9]{40}$/.test(options.predecessorCommit) || !/^[a-f0-9]{40}$/.test(options.commit)
    || options.commit === options.predecessorCommit
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(options.githubLinkSession)) {
    fail('CUSTOMER_COMMIT_CONSENT_INVALID', 'Exact commit authorization requires explicit consent and canonical scope/PR/predecessor.',
      'Read the current source anchor, verify the merged PR, then supply --authorize-exact-commit with its exact immutable fields.');
  }
  const predecessor = { operationId: options.predecessorOperation, integrityHash: options.predecessorIntegrity, mergedCommitSha: options.predecessorCommit };
  const digest = createHash('sha256').update(JSON.stringify(['customer-exact-commit-v1', predecessor, number, options.commit])).digest('hex');
  return {
    schemaVersion: 'eai.cli_customer_commit_request.v1', targetTenantId: scope.targetTenantId,
    environment: scope.environment, githubLinkSessionId: options.githubLinkSession,
    idempotencyKey: cliManagedSourceIdempotencyKey(scope, digest), predecessor,
    pullRequestNumber: number, expectedMergedCommitSha: options.commit,
    customerAuthorization: { kind: 'authenticated-exact-commit', pullRequestNumber: number, mergedCommitSha: options.commit },
  };
}

export function createCustomerCommitCommand(): Command {
  return new Command('authorize-commit')
    .description('Authorize one exact already-merged customer commit in the retained CLI repository')
    .argument('<app-key>')
    .requiredOption('--tenant-id <id>', 'Exact app-owning tenant')
    .requiredOption('--target-tenant-id <id>', 'Exact runtime tenant')
    .requiredOption('--environment <environment>', 'Exact environment')
    .requiredOption('--github-link-session <id>', 'Fresh verified same-customer GitHub link session')
    .requiredOption('--predecessor-operation <id>', 'Completed current source anchor operation')
    .requiredOption('--predecessor-integrity <digest>', 'Signed current anchor integrity hash')
    .requiredOption('--predecessor-commit <sha>', 'Current signed source anchor commit')
    .requiredOption('--pull-request <number>', 'Exact merged customer PR')
    .requiredOption('--commit <sha>', 'Exact merged commit that must still be current main')
    .option('--authorize-exact-commit', 'Explicitly authorize these exact merged bytes; not a GitHub review approval')
    .option('--format <format>', 'Output format (text|json)', 'text')
    .action(async (appKey: string, options: CommitOptions): Promise<void> => {
      const format = normalizeFormat(options);
      let admissionIssued = false;
      try {
        if (!['text', 'json'].includes(format)) throw new Error('Choose --format text or --format json.');
        // Validate consent before credential/profile access or any provider/customer request.
        const provisional: CliManagedSourceScope = { tenantId: options.tenantId, targetTenantId: options.targetTenantId,
          appKey, environment: options.environment as CliManagedSourceScope['environment'], actorId: '' };
        customerCommitRequest(options, provisional);
        const context = await resolveCommandContext({ tenantId: options.tenantId, interactive: false,
          forceRefresh: true, validatePublicApiUrl: requireManagedPublicApiUrl });
        if (context.tenantId !== options.tenantId || !context.tokens.oid) {
          fail('CUSTOMER_COMMIT_ACTOR_INVALID', 'The active customer does not match the exact app tenant.', 'Sign in as the linked app owner.');
        }
        const scope = { ...provisional, actorId: context.tokens.oid };
        const request = customerCommitRequest(options, scope);
        const client = new PlatformAPIClient(context.publicApiUrl, scope.tenantId);
        const linkResponse = await client.getCliManagedGithubLinkSession(scope.tenantId, appKey,
          options.githubLinkSession, scope.targetTenantId, scope.environment);
        if (!linkResponse.ok) throw new Error('The exact GitHub link session is unavailable.');
        const link = validateCliGithubLinkSession(JSON.parse(await readManagedPublicResponseText(linkResponse)), scope, options.githubLinkSession);
        if (link.status !== 'verified') throw new Error('A verified same-customer GitHub link is required.');
        client.assertProfileAuthority();
        admissionIssued = true;
        const operation = validateCliManagedSourceOperation(await responseOperation(
          await client.authorizeCliCustomerCommit(scope.tenantId, appKey, request)), scope,
        { githubLinkSessionId: options.githubLinkSession, verifiedGithubUser: link.verifiedGithubUser });
        if (operation.sourceProvenance?.commitSha !== options.commit
          || !['deploying', 'handoff_pending', 'completed'].includes(operation.status)
          || operation.sourceProvenance.pullRequest.number !== request.pullRequestNumber
          || operation.predecessor?.operationId !== request.predecessor.operationId
          || operation.predecessor?.integrityHash !== request.predecessor.integrityHash
          || operation.predecessor?.mergedCommitSha !== request.predecessor.mergedCommitSha) {
          throw new Error('Exact customer commit authorization response does not match the requested predecessor and commit.');
        }
        const result = { status: 'customer-commit-authorized', operationId: operation.operationId,
          commitSha: options.commit, pullRequestNumber: request.pullRequestNumber,
          githubApprovedReviewClaim: false, deploymentStatus: operation.status,
          nextAction: `Observe the exact operation with eai deploy app ${appKey} --target eai --tenant-id ${scope.tenantId} --target-tenant-id ${scope.targetTenantId} --environment ${scope.environment} --resume ${operation.operationId} --format json` };
        if (format === 'json') out.json(result);
        else { out.success('Exact merged customer commit authorized. Deployment completion is separate.'); out.info(result.nextAction); }
      } catch (error) { printFailure(format, customerCommitFailure(error, admissionIssued)); }
    });
}
