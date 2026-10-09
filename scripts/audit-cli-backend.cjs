#!/usr/bin/env node
// Produces an evidence inventory. Planned smoke coverage is never live proof.
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const smoke = require('./eai-full-e2e-smoke.cjs');
const qualification = require('./cli-qa-foundation.cjs');
const { sourceBuildVerified } = require('./cli-qa-build-receipt.cjs');
const ROOT = resolve(__dirname, '..');

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
const LOCAL_COMMANDS = new Set(['eai env list', 'eai types validate', 'eai deploy source validate', 'eai deploy setup', 'eai deploy env', 'eai provision resourceapi-bundle']);
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
    requiresProtectedBackend: !local,
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

function buildAudit({ schema, candidate, evidence, buildReceipt, deployments = [], environment, publicApiUrl, now = Date.now() }, traceability = smoke.TRACEABILITY || smoke.COMMAND_TRACEABILITY) {
  const entries = (smoke.leafEntries || smoke.collectLeafCommands)(schema);
  const decisions = new Map(traceability.map(row => [row.command, row]));
  const unknown = entries.filter(entry => !decisions.has(entry.command));
  if (unknown.length) throw new Error('Missing command coverage decisions: ' + unknown.map(entry => entry.command).join(', '));
  if (evidence && (evidence.candidate?.gitSha !== candidate.gitSha || evidence.candidate?.binarySha256 !== candidate.binarySha256
    || !candidate.runtimeSha256 || evidence.candidate?.runtimeSha256 !== candidate.runtimeSha256)) {
    throw new Error('Live evidence does not identify this exact CLI candidate.');
  }
  const commands = entries.map(entry => {
    const row = decisions.get(entry.command);
    const contract = backendContract(entry.command, row.crud);
    const executions = (evidence?.commands || []).filter(item => item.command === entry.command);
    const status = UNSUPPORTED.has(entry.command) ? 'unsupported'
      : executions.some(item => item.status === 'failed') ? 'failed'
        : executions.some(item => item.status === 'blocked') ? 'blocked'
          : executions.length && executions.every(item => item.status === 'passed' && item.coverageComplete === true
            && Array.isArray(item.assertions) && item.assertions.length > 0) ? 'passed' : 'not-run';
    return { ...entry, operation: row.crud, ...contract, status, executions: executions.length,
      observedSuccesses: executions.filter(item => item.status === 'passed').length,
      plannedCoverage: row.coverage, prerequisite: row.notes,
      cleanupMechanism: row.cleanupMechanism, cleanupVerification: row.cleanupVerified,
      ...(UNSUPPORTED.has(entry.command) ? { reason: UNSUPPORTED.get(entry.command) } : {}) };
  });
  const summary = Object.fromEntries(['passed', 'failed', 'blocked', 'unsupported', 'not-run'].map(status => [status, commands.filter(row => row.status === status).length]));
  const backendCommands = commands.filter(row => row.requiresProtectedBackend);
  const context = { environment: environment || evidence?.environment, publicApiUrl: publicApiUrl || evidence?.expectedPublicApi, now };
  const parityComplete = qualification.deploymentParity(deployments, { ...context, now,
    requiredServices: [...qualification.SERVICES, ...(backendCommands.some(row => row.command === 'eai support') ? ['Website'] : [])] });
  const authorizationVerified = qualification.authorizationVerified(evidence, candidate, context);
  const candidateVerified = sourceBuildVerified(buildReceipt, candidate, { now });
  const aliasEvidence = commands.flatMap(row => row.aliases.map(alias => {
    const executions = (evidence?.aliases || []).filter(item => item.alias === alias && item.command === row.command);
    return { alias, command: row.command, status: executions.some(item => item.status === 'failed') ? 'failed'
      : executions.some(item => item.status === 'blocked') ? 'blocked'
        : executions.length > 0 && executions.every(item => item.status === 'passed' && item.coverageComplete === true
          && Array.isArray(item.assertions) && item.assertions.length > 0) ? 'passed' : 'not-run' };
  }));
  const optionEvidence = commands.flatMap(row => row.options.map(option => ({ command: row.command, option: option.name.replace(/,$/, ''),
    status: (evidence?.commands || []).some(item => item.command === row.command && item.status === 'passed'
      && item.coverageComplete === true && Array.isArray(item.assertions) && item.assertions.length > 0
      && (item.options || []).includes(option.name.replace(/,$/, ''))) ? 'passed' : 'not-run' })));
  const aliasCoverageComplete = aliasEvidence.every(row => row.status === 'passed');
  const optionCoverageComplete = optionEvidence.every(row => row.status === 'passed');
  const unsupportedVerified = [...UNSUPPORTED.keys()].filter(command => commands.some(row => row.command === command)).every(command => {
    const executions = (evidence?.unsupported || []).filter(row => row.command === command);
    return executions.length > 0 && executions.every(row => row.status === 'passed'
      && row.exitCode === 1 && row.authenticationBypassed === true && row.networkCalls === 0);
  });
  const backendCertified = backendCommands.length > 0 && backendCommands.every(row => row.status === 'passed')
    && evidence?.cleanupVerified === true && parityComplete && authorizationVerified && candidateVerified
    && optionEvidence.filter(row => backendCommands.some(command => command.command === row.command)).every(row => row.status === 'passed');
  return {
    schemaVersion: 'eai.cli-backend-audit.v2', generatedAt: new Date(now).toISOString(), candidate,
    commands, deployments, summary, environment: context.environment, publicApiUrl: context.publicApiUrl,
    aliasEvidence, optionEvidence, aliasCoverageComplete, optionCoverageComplete, unsupportedVerified, candidateVerified,
    cleanupVerified: evidence?.cleanupVerified === true,
    parityComplete,
    authorizationVerified,
    backendCertified,
    fullCapabilityQualified: backendCertified && commands.every(row => row.status === 'passed' || row.status === 'unsupported')
      && aliasCoverageComplete && optionCoverageComplete && unsupportedVerified && qualification.cyclesVerified(evidence, candidate, context),
    limitations: ['Help, mocked tests and HTTP health do not prove live backend capability.',
      'An omitted or unfinished execution remains not-run.',
      'Role denial and cross-tenant isolation require separate authenticated role fixtures.',
      'All required service revisions must be observed in the same environment within one hour; partial parity is not complete.',
      'Alias and option execution need their own candidate-bound assertions; planned rows do not satisfy them.',
      'Source qualification requires a fresh canonical Node 24 build receipt joined to this exact source and runtime.',
      'The role probe proves its resource allow/deny matrix; endpoint-specific permissions need their own command assertions.',
      'Evidence files are operator observations, not signed server attestations.'],
  };
}

function commandOutput(args) {
  const result = spawnSync(args[0], args.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Audit input command failed: ' + args.slice(0, 3).join(' '));
  return result.stdout.trim();
}

function markdown(report) {
  return `# EAI CLI backend capability evidence\n\nCandidate: ${report.candidate.version}, ${report.candidate.gitSha}; generated ${report.generatedAt}.\n\nBackend certified: **${report.backendCertified ? 'yes' : 'no'}**. Deployment parity complete: ${report.parityComplete}. Verified lifecycle cleanup: ${report.cleanupVerified}.\n\nPlanned coverage is separate from executed evidence. The matrix includes aliases and executable parent commands.\n\n| Command | Aliases | Operation | Actual evidence | Backend / dependencies | Prerequisite |\n| --- | --- | --- | --- | --- | --- |\n${report.commands.map(row => `| ${row.command} | ${row.aliases.join(', ')} | ${row.operation} | ${row.status} | ${row.dependencies.join(', ')} | ${row.prerequisite.replace(/\|/g, '\\|')} |`).join('\n')}\n\n${report.limitations.map(value => '- ' + value).join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const argument = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const cliPath = resolve(argument('--cli') || join(ROOT, 'dist/index.js'));
  const schema = JSON.parse(commandOutput([process.execPath, cliPath, '--describe']));
  const candidate = smoke.candidateEvidence(cliPath);
  const evidencePath = argument('--evidence');
  const deploymentsPath = argument('--deployments');
  const buildReceiptPath = argument('--build-receipt');
  const evidence = evidencePath ? qualification.readPrivate(resolve(evidencePath)) : undefined;
  const deployments = deploymentsPath ? qualification.readPrivate(resolve(deploymentsPath)) : [];
  const buildReceipt = buildReceiptPath ? qualification.readPrivate(resolve(buildReceiptPath)) : undefined;
  const report = buildAudit({ schema, candidate, evidence, deployments, buildReceipt });
  const output = resolve(argument('--output') || join(ROOT, '.smoke/cli-backend-audit'));
  qualification.writePrivate(join(output, 'capabilities.json'), report);
  qualification.writePrivateText(join(output, 'capabilities.md'), markdown(report));
  console.log(JSON.stringify({ commands: report.commands.length, ...report.summary, backendCertified: report.backendCertified, output }));
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { buildAudit, backendContract, markdown };
