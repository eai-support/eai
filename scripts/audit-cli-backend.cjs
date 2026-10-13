#!/usr/bin/env node
// Produces an evidence inventory. Planned smoke coverage is never live proof.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const smoke = require('./eai-full-e2e-smoke.cjs');
const qualification = require('./cli-qa-foundation.cjs');
const { sourceBuildVerified, candidateMatches } = require('./cli-qa-build-receipt.cjs');
const ROOT = resolve(__dirname, '..');
const { requiresProtectedScope, observedScopeVerified } = require('./cli-qa-execution-scope.cjs');

const CONTRACTS = {
  workspace: { routes: ['/v4/identity/tenants', '/v4/platform/tenants', '/v4/data/resources'], services: ['PublicAPI', 'Authz', 'AdminAPI', 'Admin Portal provisioning', 'ResourceAPI'] },
  user: { routes: ['/v4/platform/users', '/v4/platform/tenants/{tenantId}/users', '/v4/platform/tenants/{tenantId}/role-definitions'], services: ['PublicAPI', 'Authz', 'AdminAPI', 'CIAM'] },
  app: { routes: ['/v4/platform', '/v4/data/resources'], services: ['PublicAPI', 'Authz', 'AdminAPI', 'Admin Portal provisioning', 'Configurator', 'ResourceAPI', 'TenantInfra'] },
  init: { routes: ['/v4/platform'], services: ['PublicAPI', 'Authz', 'Admin Portal provisioning', 'Configurator', 'app template'] },
  create: { routes: ['/v4/platform'], services: ['PublicAPI', 'Authz', 'Admin Portal provisioning', 'app template'] },
  resources: { routes: ['/v4/data/resources'], services: ['PublicAPI', 'Authz', 'ResourceAPI', 'Configurator', 'storage providers'] },
  types: { routes: ['/v4/data/resources'], services: ['PublicAPI', 'Authz', 'ResourceAPI', 'Configurator'] },
  classifier: { routes: ['/v4/data/resources'], services: ['PublicAPI', 'Authz', 'ResourceAPI', 'Configurator', 'AICore'] },
  chat: { routes: ['/v4/ai'], services: ['PublicAPI', 'Authz', 'AICore', 'workflow providers'] },
  workflow: { routes: ['/v4/integrations', '/v4/workflows', '/v4/platform', '/v4/data/resources'], services: ['PublicAPI', 'Authz', 'AICore', 'Configurator', 'Admin Portal provisioning', 'ResourceAPI'] },
  docs: { routes: ['/v4/data/documents'], services: ['PublicAPI', 'Authz', 'AICore', 'ResourceAPI', 'workflow providers'] },
  deploy: { routes: ['/v4/platform'], services: ['PublicAPI', 'Authz', 'Admin Portal provisioning', 'TenantInfra', 'GitHub', 'Azure'] },
  provision: { routes: ['/v4/platform', '/v4/data/resources'], services: ['PublicAPI', 'Authz', 'AdminAPI', 'AzureAPI', 'ResourceAPI', 'CIAM'] },
  verify: { routes: ['/health', '/v4/identity', '/v4/data/resources', '/v4/ai'], services: ['PublicAPI', 'Authz', 'ResourceAPI', 'AICore'] },
  doctor: { routes: ['/health', '/v4/identity'], services: ['PublicAPI', 'Authz'] },
  publicapi: { routes: ['explicit allowed /v4 path'], services: ['PublicAPI', 'Authz', 'selected route owner'] },
  env: { routes: ['Azure CLI appconfig kv', 'Azure CLI keyvault secret'], services: ['Azure CLI', 'App Configuration', 'Key Vault'] },
  login: { routes: ['CIAM PKCE', '/v4/identity'], services: ['CIAM', 'PublicAPI', 'Authz'] },
  whoami: { routes: ['/v4/identity'], services: ['PublicAPI', 'Authz', 'local token cache'] },
  support: { routes: ['/api/support/drafts'], services: ['EnterpriseAIGroup-Website'] },
};
const LOCAL_GROUPS = new Set(['start', 'dev', 'logout', 'runtime', 'update', 'gofer', 'template', 'blocks', 'errors', 'agent']);
const LOCAL_COMMANDS = new Set(['eai env list', 'eai types validate', 'eai deploy source validate', 'eai deploy setup', 'eai deploy env']);
const UNSUPPORTED = new Map([
  ['eai types define', 'Interactive definition is explicitly unavailable before authentication or network access.'],
  ['eai resources indexes-apply', 'PublicAPI exposes only dry-run index planning; no public index-apply contract exists.'],
]);

function backendContract(command, operation) {
  const group = command.split(' ')[1];
  const local = LOCAL_GROUPS.has(group) || LOCAL_COMMANDS.has(command) || UNSUPPORTED.has(command);
  const contract = CONTRACTS[group];
  if (!local && !contract) throw new Error('Unclassified CLI capability: ' + command);
  return {
    requiresProtectedBackend: requiresProtectedScope(command),
    routeFamilies: local ? [] : contract.routes,
    dependencies: local ? ['local CLI/app files or external tooling'] : contract.services,
    authorization: local ? 'local context' : group === 'env'
      ? 'Azure CLI identity with App Configuration and optional Key Vault permissions'
      : command === 'eai resources cache-refresh'
      ? 'system-admin; signed refresh reason'
      : /create|update|delete/.test(operation) ? 'authorized tenant writer/admin; exact policy enforced by the backend'
        : 'authenticated tenant member; endpoint-specific read permission',
    contractScope: 'Route families and dependencies; exact request contracts are covered by the owning integration tests.',
  };
}
/** Qualified assertions name their exact execution and command/alias/option scope. */
function executionAssertions(item, option) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (typeof item.executionId !== 'string' || !uuid.test(item.executionId)
    || !Array.isArray(item.assertions) || item.assertions.length === 0) return null;
  if (!item.assertions.every(row => row && typeof row === 'object' && !Array.isArray(row)
    && typeof row.name === 'string' && row.name.trim() === row.name && row.name.length > 0 && row.name.length <= 200
    && row.command === item.command && row.executionId === item.executionId
    && ['passed', 'failed', 'blocked', 'incomplete'].includes(row.status)
    && (item.alias ? row.alias === item.alias : row.alias === undefined)
    && (row.option === undefined || (typeof row.option === 'string' && Array.isArray(item.options)
      && item.options.includes(row.option))))) return null;
  return option ? item.assertions.filter(row => row.option === undefined || row.option === option) : item.assertions;
}
function executionStatus(executions, option, malformed = false) {
  if (!executions.length) return malformed ? 'incomplete' : 'not-run';
  if (executions.some(item => item.status === 'failed' || (item.status === 'passed' && !UNSUPPORTED.has(item.command)
    && Number.isInteger(item.exitCode) && item.exitCode !== 0))) return 'failed';
  if (executions.some(item => item.status === 'blocked')) return 'blocked';
  const assertions = executions.map(item => executionAssertions(item, option));
  if (assertions.some(rows => rows?.some(row => row.status === 'failed'))) return 'failed';
  if (assertions.some(rows => rows?.some(row => row.status === 'blocked'))) return 'blocked';
  if (malformed) return 'incomplete';
  return executions.every((item, index) => item.status === 'passed' && item.coverageComplete === true
    && item.exitCode === (UNSUPPORTED.has(item.command) ? 1 : 0)
    && assertions[index]?.length > 0 && assertions[index].every(row => row.status === 'passed')
    && (!option || assertions[index].some(row => row.option === option))) ? 'passed' : 'incomplete';
}

function buildAudit({ schema, candidate, evidence, buildReceipt, deployments = [], environment, publicApiUrl, now = Date.now() }, traceability = smoke.TRACEABILITY || smoke.COMMAND_TRACEABILITY) {
  const entries = (smoke.leafEntries || smoke.collectLeafCommands)(schema);
  const decisions = new Map(traceability.map(row => [row.command, row]));
  const unknown = entries.filter(entry => !decisions.has(entry.command));
  if (unknown.length) throw new Error('Missing command coverage decisions: ' + unknown.map(entry => entry.command).join(', '));
  if (evidence && !candidateMatches(evidence.candidate, candidate)) {
    throw new Error('Live evidence does not identify this exact CLI candidate.');
  }
  const context = { environment: environment || evidence?.environment, publicApiUrl: publicApiUrl || evidence?.expectedPublicApi, now };
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  const authorizationVerified = qualification.authorizationVerified(evidence, candidate, context);
  const foundationEvidenceBound = qualification.foundationEvidenceBound(evidence);
  const roleScopeBound = authorizationVerified && (evidence?.cycleEvidence === undefined || foundationEvidenceBound);
  const retained = evidence?.authorizationEvidence?.tenantIds;
  const ownedTenants = new Set(roleScopeBound && retained && uuid(retained.a) && uuid(retained.b) && retained.a !== retained.b
    ? [retained.a, retained.b] : []);
  if (roleScopeBound && foundationEvidenceBound && qualification.cyclesVerified(evidence, candidate, context))
    for (const cycle of evidence.cycleEvidence.cycles) ownedTenants.add(cycle.tenantId);
  function scopeVerified(row) {
    return qualification.qualificationScopeVerified(context) && row.environment === context.environment
      && row.publicApiUrl === context.publicApiUrl && uuid(row.scopeTenantId) && ownedTenants.has(row.scopeTenantId);
  }
  function scopedStatus(executions, option, malformed, contract) {
    const status = executionStatus(executions, option, malformed);
    if (status !== 'passed' || !contract.requiresProtectedBackend) return status;
    return executions.every(item => observedScopeVerified(item) && scopeVerified(item)
      && executionAssertions(item, option).every(assertion => scopeVerified(assertion)
        && assertion.scopeTenantId === item.scopeTenantId)) ? 'passed' : 'incomplete';
  }
  // Unscoped malformed attempts cannot be discarded to certify another success.
  // Retain bounded collection/index observations, never raw malformed input.
  const malformedAttempts = [], knownCommands = new Set(entries.map(entry => entry.command)), executionIds = new Set();
  function collection(name) {
    const values = evidence?.[name];
    if (values === undefined) return [];
    if (!Array.isArray(values)) { malformedAttempts.push({ collection: name, index: null }); return []; }
    return values.filter((row, index) => {
      const valid = row && typeof row === 'object' && !Array.isArray(row) && knownCommands.has(row.command)
        && ['passed', 'failed', 'blocked', 'running', 'incomplete', 'not-run', 'skipped', 'unsupported'].includes(row.status)
        && (name === 'aliases' || row.alias === undefined)
        && (name !== 'aliases' || entries.some(entry => entry.command === row.command && entry.aliases.includes(row.alias)))
        && (row.options === undefined || (Array.isArray(row.options) && row.options.every(option => typeof option === 'string')));
      const misclassified = valid && name === 'unsupported' && !UNSUPPORTED.has(row.command);
      const wrongInvocation = valid && row.invokedCommand !== (name === 'aliases' ? row.alias : row.command);
      const executionId = valid && uuid(row.executionId) ? row.executionId.toLowerCase() : undefined;
      const duplicateExecution = executionId !== undefined && executionIds.has(executionId);
      if (executionId !== undefined) executionIds.add(executionId);
      if (!valid || misclassified || wrongInvocation || duplicateExecution) malformedAttempts.push({ collection: name, index,
        ...(misclassified ? { reason: 'supported-command-in-unsupported', command: row.command, status: row.status }
          : wrongInvocation ? { reason: 'invoked-spelling-mismatch', command: row.command, status: row.status }
            : duplicateExecution ? { reason: 'duplicate-execution-id', command: row.command, status: row.status } : {}) });
      // Retain known failed attempts even when spelling is inconsistent. The
      // malformed contract prevents all positive qualification independently.
      return Boolean(valid);
    });
  }
  const commandReceipts = collection('commands'), aliasReceipts = collection('aliases'), unsupportedReceipts = collection('unsupported');
  const evidenceValid = malformedAttempts.length === 0;
  const commands = entries.map(entry => {
    const row = decisions.get(entry.command);
    const contract = backendContract(entry.command, row.crud);
    const unsupported = UNSUPPORTED.has(entry.command);
    // Keep known misclassified attempts visible, including failed/blocked status.
    const executions = [...commandReceipts, ...unsupportedReceipts].filter(item => item.command === entry.command);
    const actualExecutionStatus = scopedStatus(executions, undefined, !evidenceValid, contract);
    const status = unsupported && ['passed', 'not-run'].includes(actualExecutionStatus) ? 'unsupported' : actualExecutionStatus;
    return { ...entry, operation: row.crud, ...contract, status, executions: executions.length,
      capability: unsupported ? 'unsupported' : 'available', actualExecutionStatus,
      observedSuccesses: executions.filter(item => item.status === 'passed').length,
      plannedCoverage: row.coverage, prerequisite: row.notes,
      cleanupMechanism: row.cleanupMechanism, cleanupVerification: row.cleanupVerified,
      ...(UNSUPPORTED.has(entry.command) ? { reason: UNSUPPORTED.get(entry.command) } : {}) };
  });
  const summary = Object.fromEntries(['passed', 'failed', 'blocked', 'incomplete', 'unsupported', 'not-run'].map(status => [status, commands.filter(row => row.status === status).length]));
  const backendCommands = commands.filter(row => row.requiresProtectedBackend);
  const parityComplete = qualification.deploymentParity(deployments, { ...context, now,
    requiredServices: [...qualification.SERVICES, ...(backendCommands.some(row => row.command === 'eai support') ? ['Website'] : [])] });
  const candidateVerified = sourceBuildVerified(buildReceipt, candidate, { now });
  const aliasEvidence = commands.flatMap(row => row.aliases.map(alias => {
    const executions = aliasReceipts.filter(item => item.alias === alias && item.command === row.command);
    return { alias, command: row.command, status: scopedStatus(executions, undefined, !evidenceValid, row) };
  }));
  const optionEvidence = commands.flatMap(row => row.options.map(option => ({ command: row.command, option: option.name.replace(/,$/, ''),
    status: scopedStatus((UNSUPPORTED.has(row.command) ? unsupportedReceipts : commandReceipts).filter(item => item.command === row.command
      && Array.isArray(item.options) && item.options.includes(option.name.replace(/,$/, ''))), option.name.replace(/,$/, ''), !evidenceValid, row) })));
  const aliasCoverageComplete = aliasEvidence.every(row => row.status === 'passed');
  const optionCoverageComplete = optionEvidence.every(row => row.status === 'passed');
  const unsupportedVerified = evidenceValid && [...UNSUPPORTED.keys()].filter(command => commands.some(row => row.command === command)).every(command => {
    const executions = unsupportedReceipts.filter(row => row.command === command);
    return commands.find(row => row.command === command).actualExecutionStatus === 'passed'
      && executionStatus(executions) === 'passed' && executions.every(row => row.status === 'passed'
      && row.exitCode === 1 && row.authenticationBypassed === true && row.networkCalls === 0);
  });
  const backendCertified = evidenceValid && backendCommands.length > 0 && backendCommands.every(row => row.status === 'passed')
    && evidence?.cleanupVerified === true && parityComplete && authorizationVerified && candidateVerified
    && optionEvidence.filter(row => backendCommands.some(command => command.command === row.command)).every(row => row.status === 'passed');
  return {
    schemaVersion: 'eai.cli-backend-audit.v2', generatedAt: new Date(now).toISOString(), candidate,
    commands, deployments, summary, environment: context.environment, publicApiUrl: context.publicApiUrl,
    evidenceValidation: { valid: evidenceValid, malformedAttempts },
    aliasEvidence, optionEvidence, aliasCoverageComplete, optionCoverageComplete, unsupportedVerified, candidateVerified,
    cleanupVerified: evidence?.cleanupVerified === true,
    parityComplete, foundationEvidenceBound,
    authorizationVerified,
    backendCertified,
    fullCapabilityQualified: backendCertified && commands.every(row => row.status === 'passed' || row.status === 'unsupported')
      && aliasCoverageComplete && optionCoverageComplete && unsupportedVerified && qualification.cyclesVerified(evidence, candidate, context)
      && foundationEvidenceBound,
    limitations: ['Help, mocked tests and HTTP health do not prove live backend capability.',
      'Omitted evidence remains not-run; attempted unfinished evidence remains incomplete and cannot pass.',
      'Role denial and cross-tenant isolation require separate authenticated role fixtures.',
      'All required service revisions must be observed in the same environment within one hour; partial parity is not complete.',
      'Alias and option execution need their own candidate-bound assertions; planned rows do not satisfy them.',
      'Source qualification requires a fresh canonical Node 24 build receipt joined to this exact source and runtime.',
      'The role probe proves its resource allow/deny matrix; endpoint-specific permissions need their own command assertions.',
      'Evidence files are operator observations, not signed server attestations.'],
  };
}

function commandOutput(args) {
  const result = spawnSync(args[0], args.slice(1), { cwd: ROOT, env: qualification.operationalEnvironment(process.env),
    encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Audit input command failed: ' + args.slice(0, 3).join(' '));
  return result.stdout.trim();
}

function markdown(report) {
  const candidate = report.candidate ? `${report.candidate.version}, ${report.candidate.gitSha}` : 'unverified';
  return `# EAI CLI backend capability evidence\n\nCandidate: ${candidate}; generated ${report.generatedAt}.\n\nBackend certified: **${report.backendCertified ? 'yes' : 'no'}**. Deployment parity complete: ${report.parityComplete}. Verified lifecycle cleanup: ${report.cleanupVerified}.\n\nPlanned coverage is separate from executed evidence. The matrix includes aliases and executable parent commands.\n\n| Command | Aliases | Operation | Actual evidence | Backend / dependencies | Prerequisite |\n| --- | --- | --- | --- | --- | --- |\n${report.commands.map(row => `| ${row.command} | ${row.aliases.join(', ')} | ${row.operation} | ${row.status} | ${row.dependencies.join(', ')} | ${row.prerequisite.replace(/[\\|]/g, '\\$&')} |`).join('\n')}\n\n${report.limitations.map(value => '- ' + value).join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const argument = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const cliPath = resolve(argument('--cli') || join(ROOT, 'dist/index.js'));
  const evidencePath = argument('--evidence');
  const deploymentsPath = argument('--deployments');
  const buildReceiptPath = argument('--build-receipt');
  const output = resolve(argument('--output') || join(ROOT, '.smoke/cli-backend-audit'));
  const jsonPath = join(output, 'capabilities.json'), markdownPath = join(output, 'capabilities.md');
  if ([cliPath, evidencePath, deploymentsPath, buildReceiptPath].filter(Boolean).some(path => [jsonPath, markdownPath].includes(resolve(path)))
    || existsSync(jsonPath) || existsSync(markdownPath)) throw new Error('Use a new private audit output separate from its inputs.');
  qualification.withLease(jsonPath, () => {
    const attempted = { schemaVersion: 'eai.cli-backend-audit.v2', generatedAt: new Date().toISOString(), candidate: null,
      status: 'running', commands: [], summary: {}, backendCertified: false, fullCapabilityQualified: false,
      parityComplete: false, cleanupVerified: false, limitations: ['The attempted audit has not qualified any capability.'] };
    const save = report => { qualification.writePrivate(jsonPath, report); qualification.writePrivateText(markdownPath, markdown(report)); };
    save(attempted);
    try {
      const schema = JSON.parse(commandOutput([process.execPath, cliPath, '--describe']));
      const candidate = smoke.candidateEvidence(cliPath); attempted.candidate = candidate;
      const evidence = evidencePath ? qualification.readPrivate(resolve(evidencePath)) : undefined;
      const deployments = deploymentsPath ? qualification.readPrivate(resolve(deploymentsPath)) : [];
      const buildReceipt = buildReceiptPath ? qualification.readPrivate(resolve(buildReceiptPath)) : undefined;
      const report = buildAudit({ schema, candidate, evidence, deployments, buildReceipt }); save(report);
      console.log(JSON.stringify({ commands: report.commands.length, ...report.summary, backendCertified: report.backendCertified, output }));
    } catch {
      attempted.status = 'blocked'; attempted.reason = 'Required audit input or candidate could not be verified.';
      save(attempted); throw new Error('Audit could not qualify; inspect its private blocked-attempt evidence.');
    }
  });
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { buildAudit, backendContract, markdown };
