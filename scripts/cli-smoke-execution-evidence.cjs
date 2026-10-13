// Actual producer receipts. Collection placement never invents an invocation.
const { randomUUID } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const UNSUPPORTED = new Set(['eai types define', 'eai resources indexes-apply']);
const { requiresProtectedScope, observedScopeVerified } = require('./cli-qa-execution-scope.cjs');

function invocationIdentity(args, entries) {
  const matches = entries.flatMap(entry => [entry.command, ...(entry.aliases || [])]
    .map(spelling => ({ command: entry.command, spelling, parts: spelling.split(' ').slice(1) })))
    .filter(entry => entry.parts.every((part, index) => args[index] === part))
    .sort((a, b) => b.parts.length - a.parts.length);
  const selected = matches[0];
  if (!selected) throw new Error('Actual smoke invocation is absent from the installed command schema.');
  return { command: selected.command, invokedCommand: selected.spelling,
    ...(selected.spelling !== selected.command ? { alias: selected.spelling } : {}) };
}

function producerEvidence(report, entries, uuid = randomUUID) {
  report.executions = [];
  report.commands = []; report.aliases = []; report.unsupported = [];
  const handles = new WeakMap();
  const identities = new Set();
  const semanticContracts = new WeakSet();
  function start(args, phase, scope = {}) {
    const identity = typeof args === 'string' ? { command: args, invokedCommand: args } : invocationIdentity(args, entries);
    const executionId = uuid();
    if (!UUID.test(executionId) || identities.has(executionId.toLowerCase())) {
      throw new Error('Every actual smoke invocation needs a fresh execution UUID.');
    }
    identities.add(executionId.toLowerCase());
    const entry = { ...identity, executionId, executionSequence: report.executions.length, phase,
      status: 'running', coverageComplete: false, assertions: [], ...scope,
      options: typeof args === 'string' ? [] : [...new Set(args.filter(arg => arg.startsWith('--')).map(arg => arg.split('=')[0]))] };
    report.executions.push(entry);
    if (identity.command.startsWith('eai ')) {
      (identity.alias ? report.aliases : UNSUPPORTED.has(identity.command) ? report.unsupported : report.commands).push(entry);
    }
    return entry;
  }
  function bind(value, entry) {
    if (value && typeof value === 'object') handles.set(value, entry);
    return value;
  }
  function receipt(value) { return value && typeof value === 'object' ? handles.get(value) : undefined; }
  function assert(entry, name, status, { option, contract = false, phase = entry?.phase } = {}) {
    if (typeof name !== 'string' || name.trim() !== name || name.length < 1 || name.length > 200
      || !['passed', 'failed', 'blocked', 'incomplete'].includes(status)) throw new Error('Assertion name/status must satisfy the bounded consumer contract.');
    if (entry && !report.executions.includes(entry)) throw new Error('Assertion execution was not actually recorded by this producer.');
    if (option !== undefined && (!entry || !entry.options.includes(option))) {
      throw new Error('An option assertion must describe an actually invoked option.');
    }
    const row = { name, phase, status, ...(entry ? { command: entry.command, executionId: entry.executionId,
      executionSequence: entry.executionSequence,
      ...(entry.alias ? { alias: entry.alias } : {}),
      ...(entry.environment ? { environment: entry.environment } : {}),
      ...(entry.publicApiUrl ? { publicApiUrl: entry.publicApiUrl } : {}),
      ...(entry.scopeTenantId ? { scopeTenantId: entry.scopeTenantId } : {}) } : {}),
      ...(option ? { option } : {}) };
    report.assertions.push(row);
    if (entry) {
      entry.assertions.push(row);
      if (status === 'failed' || status === 'blocked') { entry.status = status; entry.coverageComplete = false; }
      // JSON/exit observations alone cannot complete a command contract.
      if (contract && status === 'passed') semanticContracts.add(entry);
      complete(entry);
    }
    return row;
  }
  function complete(entry) {
    const unsupported = UNSUPPORTED.has(entry.command);
    entry.coverageComplete = semanticContracts.has(entry) && entry.status === 'passed' && entry.exitCode === (unsupported ? 1 : 0)
      && (!requiresProtectedScope(entry.command) || observedScopeVerified(entry))
      && (!unsupported || (entry.authenticationBypassed === true && entry.networkCalls === 0))
      && entry.assertions.length > 0 && entry.assertions.every(assertion => assertion.status === 'passed');
  }
  return { start, bind, receipt, assert, complete };
}
module.exports = { invocationIdentity, producerEvidence };
