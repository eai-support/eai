import { describe, expect, test } from 'vitest';
import { customerCommitRequest, customerCommitFailure, createCustomerCommitCommand } from '../../src/commands/eai-managed-source-authorize-commit.js';
import { ManagedDeployFailure } from '../../src/commands/eai-managed-deploy-contract.js';
import { validateCliManagedSourceOperation } from '../../src/lib/eai-managed-source-operation-client.js';
import type { CliManagedSourceOperation, CliManagedSourceScope } from '../../src/lib/eai-managed-source-client-types.js';

const scope: CliManagedSourceScope = { tenantId: 'parent', targetTenantId: 'child', appKey: 'app', environment: 'preview', actorId: 'actor' };
const options = { tenantId: 'parent', targetTenantId: 'child', environment: 'preview',
  githubLinkSession: '11111111-2222-3333-4444-555555555555', predecessorOperation: `cli-managed-${'a'.repeat(32)}`,
  predecessorIntegrity: `sha256:${'a'.repeat(64)}`, predecessorCommit: 'a'.repeat(40),
  pullRequest: '7', commit: 'b'.repeat(40), authorizeExactCommit: true, format: 'json' };

function operation(): CliManagedSourceOperation {
  return { ...scope, schemaVersion: 'eai.cli_managed_source_operation.v1', sourceMode: 'eai-cli-generated',
    operationId: `cli-managed-${'b'.repeat(32)}`, status: 'deploying', repositoryAuthority: 'customer-owned',
    templateCommitSha: 'e'.repeat(40), configHash: `sha256:${'e'.repeat(64)}`, githubLinkSessionId: options.githubLinkSession,
    verifiedGithubUser: { id: 42, login: 'customer', actorId: 'actor', proofId: 'proof' },
    repository: { owner: 'customer', name: 'app', private: true, id: 101, nodeId: 'R_101', defaultBranch: 'main', installationId: '123' },
    predecessor: { operationId: options.predecessorOperation, integrityHash: options.predecessorIntegrity, mergedCommitSha: options.predecessorCommit },
    review: { number: 7, headBranch: 'customer-edit', headSha: 'c'.repeat(40), baseSha: 'a'.repeat(40), mergedCommitSha: 'b'.repeat(40) },
    sourceProvenance: { kind: 'customer-merged-commit', predecessorReachable: true, commitSha: 'b'.repeat(40),
      treeSha: 'd'.repeat(40), providerProofDigest: `sha256:${'d'.repeat(64)}`,
      pullRequest: { number: 7, headBranch: 'customer-edit', baseBranch: 'main', headSha: 'c'.repeat(40), baseSha: 'a'.repeat(40), mergedCommitSha: 'b'.repeat(40), mergedAt: '2026-10-01T00:00:00Z' },
      checks: [{ name: 'tests', headSha: 'c'.repeat(40), conclusion: 'success', runId: 123 }], providerReviews: [] },
    customerAuthorization: { kind: 'authenticated-exact-commit', actorId: 'actor', githubUserId: 42,
      pullRequestNumber: 7, mergedCommitSha: 'b'.repeat(40), authorizedAt: '2026-10-02T00:00:00Z' }, expiresAt: '2099-01-01T00:00:00Z' };
}

describe('explicit exact-commit customer authority', () => {
  test('a submitted consent failure preserves its error and directs read-only observation rather than replay', () => {
    const original = new ManagedDeployFailure('CUSTOMER_COMMIT_CONFLICT', 'Exact admission conflicts.', 'Retry the same exact command.');
    const failure = customerCommitFailure(original, true) as ManagedDeployFailure;
    expect(failure.code).toBe(original.code);
    expect(failure.message).toBe(original.message);
    expect(failure.nextAction).toContain('operation/status read-only');
    expect(failure.nextAction).toContain('Do not repeat consent or change the idempotency key');
    expect(failure.nextAction).not.toContain('Retry');
  });
  test('pre-request errors keep their original recovery without implying an admission was submitted', () => {
    const failure = new ManagedDeployFailure('CUSTOMER_COMMIT_CONSENT_INVALID', 'Missing explicit consent.', 'Verify the exact scope first.');
    expect(customerCommitFailure(failure, false)).toBe(failure);
  });
  test('an uncertain submitted response never asserts success or invites a new authorization key', () => {
    const failure = customerCommitFailure(new Error('Response interrupted.'), true) as ManagedDeployFailure;
    expect(failure.code).toBe('EAI_MANAGED_DEPLOY_FAILED');
    expect(failure.message).toBe('Response interrupted.');
    expect(failure.nextAction).toContain('existing authorization remains immutable');
    expect(failure.nextAction).not.toContain('authorized successfully');
  });
  test('requires a separate customer action and emits no provider review claim or source bundle', () => {
    const request = customerCommitRequest(options, scope);
    expect(request.customerAuthorization).toEqual({ kind: 'authenticated-exact-commit', pullRequestNumber: 7, mergedCommitSha: options.commit });
    expect(request).not.toHaveProperty('actorId');
    expect(request).not.toHaveProperty('bundleSha256');
    expect(customerCommitRequest(options, scope).idempotencyKey).toBe(request.idempotencyKey);
    expect(customerCommitRequest({ ...options, commit: 'c'.repeat(40) }, scope).idempotencyKey).not.toBe(request.idempotencyKey);
    expect(createCustomerCommitCommand().name()).toBe('authorize-commit');
  });
  test.each([
    { authorizeExactCommit: false }, { authorizeExactCommit: undefined }, { pullRequest: '7.0' },
    { pullRequest: '9007199254740992' }, { commit: options.predecessorCommit }, { predecessorIntegrity: 'wrong' },
    { githubLinkSession: '../other' }, { predecessorOperation: 'source-unknown-other' },
  ])('rejects missing consent, coercion and crossed namespace before requests: %j', patch => {
    expect(() => customerCommitRequest({ ...options, ...patch }, scope)).toThrow();
  });
  test('accepts truthful zero provider reviews only with exact authenticated consent and provenance', () => {
    expect(validateCliManagedSourceOperation(operation(), scope).sourceProvenance?.providerReviews).toEqual([]);
  });
  test.each(['bundle', 'actor', 'commit', 'predecessor', 'botWorkflow', 'checks', 'main', 'providerProof', 'consent'])('rejects malformed/crossed customer readback %s', mutation => {
    const value = operation();
    if (mutation === 'bundle') value.bundleSha256 = `sha256:${'a'.repeat(64)}`;
    if (mutation === 'actor') value.customerAuthorization!.actorId = 'other';
    if (mutation === 'commit') value.customerAuthorization!.mergedCommitSha = 'f'.repeat(40);
    if (mutation === 'predecessor') value.predecessor!.mergedCommitSha = options.commit;
    if (mutation === 'botWorkflow') value.review!.workflowRunId = 123;
    if (mutation === 'checks') value.sourceProvenance!.checks = [];
    if (mutation === 'main') value.sourceProvenance!.pullRequest.baseBranch = 'other';
    if (mutation === 'providerProof') value.sourceProvenance!.providerProofDigest = 'caller-asserted';
    if (mutation === 'consent') delete value.customerAuthorization;
    expect(() => validateCliManagedSourceOperation(value, scope)).toThrow();
  });
  test('ordinary publication still requires its original bundle, and cannot reuse customer consent', () => {
    const value = operation();
    delete value.sourceProvenance;
    delete value.customerAuthorization;
    expect(() => validateCliManagedSourceOperation(value, scope)).toThrow();
  });
});
