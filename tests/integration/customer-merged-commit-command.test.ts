import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { PlatformAPIClient } from '../../src/lib/api.js';
import * as context from '../../src/lib/context.js';
import * as output from '../../src/lib/output.js';
import { setActiveProfile } from '../../src/lib/profile.js';
import { createCustomerCommitCommand, createCustomerCommitAnchorCommand, validateCustomerCommitPreAction } from '../../src/commands/eai-managed-source-authorize-commit.js';
import { printManagedSourceCompletion } from '../../src/commands/eai-managed-deploy-output.js';
import { pollExactOperation } from '../../src/commands/eai-managed-deploy-operation.js';
import type { CliManagedSourceOperation } from '../../src/lib/eai-managed-source-client-types.js';

vi.mock('../../src/commands/eai-managed-deploy-operation.js', async original => ({
  ...await original<typeof import('../../src/commands/eai-managed-deploy-operation.js')>(), pollExactOperation: vi.fn(),
}));
const exec = promisify(execFile);
const cli = resolve('dist/index.js');
const scope = { tenantId: 'parent', targetTenantId: 'child', appKey: 'app', environment: 'preview' as const, actorId: 'actor' };
const sessionId = '11111111-2222-3333-4444-555555555555';
const predecessor = { operationId: `cli-managed-${'a'.repeat(32)}`, integrityHash: `sha256:${'a'.repeat(64)}`, mergedCommitSha: 'a'.repeat(40) };
const user = { id: 42, login: 'customer', actorId: 'actor', proofId: 'proof' };
const repository = { owner: 'customer', name: 'app', private: true, id: 101, nodeId: 'R_101', defaultBranch: 'main', installationId: '123' };
const provenance = { kind: 'customer-merged-commit' as const, predecessorReachable: true as const,
  commitSha: 'b'.repeat(40), treeSha: 'd'.repeat(40), providerProofDigest: `sha256:${'d'.repeat(64)}`,
  pullRequest: { number: 7, headBranch: 'customer-edit', baseBranch: 'main', headSha: 'c'.repeat(40), baseSha: 'a'.repeat(40), mergedCommitSha: 'b'.repeat(40), mergedAt: '2026-10-01T00:00:00Z' },
  checks: [{ name: 'tests', headSha: 'c'.repeat(40), conclusion: 'success' as const, runId: 123 }], providerReviews: [] };
function operation(): CliManagedSourceOperation {
  const { baseBranch: _baseBranch, mergedAt: _mergedAt, ...review } = provenance.pullRequest;
  return { ...scope, schemaVersion: 'eai.cli_managed_source_operation.v1', sourceMode: 'eai-cli-generated',
    operationId: `cli-managed-${'b'.repeat(32)}`, status: 'deploying', repositoryAuthority: 'customer-owned',
    templateCommitSha: 'e'.repeat(40), configHash: `sha256:${'e'.repeat(64)}`, githubLinkSessionId: sessionId,
    verifiedGithubUser: user, repository, predecessor, review, sourceProvenance: provenance,
    customerAuthorization: { kind: 'authenticated-exact-commit', actorId: 'actor', githubUserId: 42,
      pullRequestNumber: 7, mergedCommitSha: provenance.commitSha, authorizedAt: '2026-10-02T00:00:00Z' }, expiresAt: '2099-01-01T00:00:00Z' };
}
const anchor = { ...scope, ...predecessor, schemaVersion: 'eai.cli_managed_source_anchor.v1',
  status: 'completed', sourceMode: 'eai-cli-generated', repositoryAuthority: 'customer-owned', repository,
  verifiedGithubUser: user, configHash: `sha256:${'a'.repeat(64)}` };
const base = ['app', '--tenant-id', 'parent', '--target-tenant-id', 'child', '--environment', 'preview', '--format', 'json'];
const args = [...base, '--github-link-session', sessionId, '--predecessor-operation', predecessor.operationId,
  '--predecessor-integrity', predecessor.integrityHash, '--predecessor-commit', predecessor.mergedCommitSha,
  '--pull-request', '7', '--commit', provenance.commitSha, '--authorize-exact-commit'];
function json(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }

describe('exact-commit command execution', () => {
  let anchorRead: ReturnType<typeof vi.spyOn>;
  let linkRead: ReturnType<typeof vi.spyOn>;
  let admission: ReturnType<typeof vi.spyOn>;
  let printed: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.exitCode = 0; setActiveProfile('default');
    vi.spyOn(context, 'resolveCommandContext').mockResolvedValue({ tenantId: 'parent', tokens: { oid: 'actor' }, publicApiUrl: 'https://test-api.au.myenterprise.ai/public' } as context.CommandContext);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No unmocked provider call is allowed'); }));
    printed = vi.spyOn(output, 'json').mockImplementation(() => {});
    anchorRead = vi.spyOn(PlatformAPIClient.prototype, 'getCliManagedSourceAnchor').mockResolvedValue(json(anchor));
    linkRead = vi.spyOn(PlatformAPIClient.prototype, 'getCliManagedGithubLinkSession').mockResolvedValue(json({ ...scope,
      schemaVersion: 'eai.cli_managed_github_link_session.v1', sessionId, status: 'verified', verifiedGithubUser: user,
      browserUrl: 'https://test-admin-portal.myenterprise.ai/api/platform/generated-apps/github-user?ticket=fixture',
      expiresAt: '2099-01-01T00:00:00Z' }));
    admission = vi.spyOn(PlatformAPIClient.prototype, 'authorizeCliCustomerCommit').mockResolvedValue(json(operation()));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); process.exitCode = 0; });

  test.each(['missing', 'malformed'])('root profile hook rejects %s consent before profile/context/API access', async kind => {
    const root = new Command('eai'); const deploy = root.command('deploy'); const source = deploy.command('source');
    source.addCommand(createCustomerCommitCommand());
    const activateProfile = vi.fn(); root.hook('preAction', (_root, command) => { validateCustomerCommitPreAction(command); activateProfile(); });
    const invalid = kind === 'missing' ? args.slice(0, -1) : args.map(value => value === '7' ? '7.0' : value);
    await expect(root.parseAsync(['deploy', 'source', 'authorize-commit', ...invalid], { from: 'user' })).rejects.toThrow();
    expect(activateProfile).not.toHaveBeenCalled(); expect(context.resolveCommandContext).not.toHaveBeenCalled();
    expect(anchorRead).not.toHaveBeenCalled(); expect(linkRead).not.toHaveBeenCalled(); expect(admission).not.toHaveBeenCalled();
  });
  test('the built root rejects missing consent before an unavailable named profile can be loaded', async () => {
    const home = await mkdtemp(join(tmpdir(), 'eai-consent-root-'));
    try {
      await expect(exec(process.execPath, [cli, '--profile', 'missing-profile', 'deploy', 'source', 'authorize-commit', ...args.slice(0, -1)],
        { cwd: home, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home }, timeout: 15_000 })).rejects.toMatchObject({
        code: 1, stdout: expect.stringContaining('CUSTOMER_COMMIT_CONSENT_INVALID'),
      });
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test('real command verifies current anchor/link and POSTs exact consent once; publication is not deployment', async () => {
    await createCustomerCommitCommand().parseAsync(args, { from: 'user' });
    expect(anchorRead).toHaveBeenCalledWith('parent', 'app', 'child', 'preview');
    expect(admission).toHaveBeenCalledTimes(1);
    const request = admission.mock.calls[0][2];
    expect(request).toMatchObject({ predecessor, githubLinkSessionId: sessionId, pullRequestNumber: 7, expectedMergedCommitSha: provenance.commitSha,
      customerAuthorization: { kind: 'authenticated-exact-commit', pullRequestNumber: 7, mergedCommitSha: provenance.commitSha } });
    expect(request).not.toHaveProperty('actorId'); expect(request).not.toHaveProperty('sourceProvenance');
    expect(printed).toHaveBeenLastCalledWith(expect.objectContaining({ publicationStatus: 'deploying', githubApprovedReviewClaim: false }));
    expect(printed.mock.calls.at(-1)?.[0]).not.toHaveProperty('deploymentStatus');
  });
  test.each(['actor', 'tenant', 'anchor', 'link'])('crossed %s proof prevents consent POST', async kind => {
    if (kind === 'actor') vi.mocked(context.resolveCommandContext).mockResolvedValue({ tenantId: 'other', tokens: { oid: 'actor' } } as context.CommandContext);
    if (kind === 'tenant') anchorRead.mockResolvedValue(json({ ...anchor, targetTenantId: 'other' }));
    if (kind === 'anchor') anchorRead.mockResolvedValue(json({ ...anchor, integrityHash: `sha256:${'f'.repeat(64)}` }));
    if (kind === 'link') linkRead.mockResolvedValue(json({ ...scope, schemaVersion: 'eai.cli_managed_github_link_session.v1', sessionId, status: 'verified', actorId: 'other', expiresAt: '2099-01-01T00:00:00Z', verifiedGithubUser: user }));
    await createCustomerCommitCommand().parseAsync(args, { from: 'user' });
    expect(process.exitCode).toBe(1); expect(admission).not.toHaveBeenCalled();
  });
  test('an exact failed operation stays failed with its ID instead of a generic mismatch', async () => {
    admission.mockResolvedValue(json({ ...operation(), status: 'failed', error: { code: 'EXACT_DEPLOYMENT_FAILED' } }));
    await createCustomerCommitCommand().parseAsync(args, { from: 'user' });
    expect(printed).toHaveBeenLastCalledWith(expect.objectContaining({ operationId: operation().operationId, publicationStatus: 'failed', classification: 'failed', error: { code: 'EXACT_DEPLOYMENT_FAILED' } }));
    expect(process.exitCode).toBe(1);
  });
  test.each(['mismatch', 'repository', 'ambiguous'])('a submitted %s response never retries authorization', async kind => {
    if (kind === 'mismatch') admission.mockResolvedValue(json({ ...operation(), predecessor: { ...predecessor, integrityHash: `sha256:${'f'.repeat(64)}` } }));
    else if (kind === 'repository') admission.mockResolvedValue(json({ ...operation(), repository: { ...repository, id: 202 } }));
    else admission.mockRejectedValue(new Error('Response interrupted'));
    await createCustomerCommitCommand().parseAsync(args, { from: 'user' });
    expect(admission).toHaveBeenCalledTimes(1); expect(process.exitCode).toBe(1);
    expect(printed).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: expect.objectContaining({ nextAction: expect.stringContaining('Observe the current operation/status read-only') }) }));
  });
  test('source anchor observation is exact-scope GET only and exposes usable predecessor fields', async () => {
    await createCustomerCommitAnchorCommand().parseAsync(base, { from: 'user' });
    expect(printed).toHaveBeenLastCalledWith(expect.objectContaining(predecessor));
    expect(anchorRead).toHaveBeenCalledTimes(1); expect(linkRead).not.toHaveBeenCalled(); expect(admission).not.toHaveBeenCalled();
  });
  test('completed deployment output retains original consent/provenance without claiming provider APPROVED', async () => {
    const publication = { ...operation(), status: 'completed' as const };
    vi.mocked(pollExactOperation).mockResolvedValue({ environment: 'preview', configHash: publication.configHash,
      sourceMode: 'eai-cli-generated', status: 'active', sourceRevision: { repoOwner: 'customer', repoName: 'app', commitSha: provenance.commitSha } } as Awaited<ReturnType<typeof pollExactOperation>>);
    await printManagedSourceCompletion(new PlatformAPIClient('https://test-api.au.myenterprise.ai/public', 'parent'), scope, publication, false, 10, 'json');
    expect(printed).toHaveBeenLastCalledWith(expect.objectContaining({ sourceProvenance: provenance,
      customerAuthorization: publication.customerAuthorization, githubApprovedReviewClaim: false }));
  });
});
