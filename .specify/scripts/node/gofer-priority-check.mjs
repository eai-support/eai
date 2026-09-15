#!/usr/bin/env node
import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const text = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const taskId = value => typeof value === 'string' && /^T\d+$/.test(value);
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_EVIDENCE_BYTES = 128 * 1024 * 1024;
const MAX_TASKS = 20000;
const MAX_EDGES = 100000;
class CheckError extends Error {}
function namesReceipt(line, receipt) {
  const references = line.matchAll(/`([^`]+)`|\[[^\[\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)|\[[^\[\]]*\](?:\[[^\[\]]*\])?|([^\s|`()[\]<>]+)/g);
  return Array.from(references).some(match => (match[1] ?? match[2] ?? match[3] ?? match[4]) === receipt);
}
function relative(value) {
  if (!text(value) || value.includes('\\') || value.includes(':') || path.isAbsolute(value) ||
      value.includes('\0') || value.split('/').some(part => part === '..' || part === '.') || /[*?\[\]]/.test(value)) throw new CheckError('UNSAFE_RELATIVE_PATH');
  return value;
}
async function read(root, file, digest = false, cache) {
  const target = await realpath(path.resolve(root, relative(file)));
  if (!target.startsWith(root + path.sep)) throw new CheckError('EVIDENCE_OUTSIDE_FEATURE');
  const handle = await open(target, constants.O_RDONLY | (constants.O_NONBLOCK || 0) | (constants.O_NOFOLLOW || 0));
  try {
    const limit = digest ? MAX_EVIDENCE_BYTES : MAX_DOCUMENT_BYTES;
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new CheckError('INVALID_FILE_TYPE_OR_SIZE');
    const identity = `${stat.ino ? `${stat.dev}:${stat.ino}` : target}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (digest && cache?.hashes.has(identity)) return cache.hashes.get(identity);
    if (digest && cache && stat.size + cache.bytes > MAX_TOTAL_EVIDENCE_BYTES) throw new CheckError('TOTAL_EVIDENCE_LIMIT');
    let bytes = 0;
    const chunks = [];
    const sha = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > limit) throw new CheckError('FILE_SIZE_LIMIT');
      if (digest && cache) {
        cache.bytes += chunk.length;
        if (cache.bytes > MAX_TOTAL_EVIDENCE_BYTES) throw new CheckError('TOTAL_EVIDENCE_LIMIT');
      }
      if (digest) sha.update(chunk); else chunks.push(chunk);
    }
    const result = digest ? sha.digest('hex') : Buffer.concat(chunks);
    if (digest && cache) cache.hashes.set(identity, result);
    return result;
  } finally { await handle.close(); }
}

// Resolve existing parents too: proposed new files can sit below a symlink.
async function destination(root, file) {
  let candidate = path.resolve(root, relative(file));
  const suffix = [];
  while (true) {
    try {
      const resolved = path.resolve(await realpath(candidate), ...suffix);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new CheckError('EDIT_OUTSIDE_REPOSITORY');
      return resolved;
    } catch (error) {
      if (error.code !== 'ENOENT' || candidate === path.dirname(candidate)) throw error;
      const existing = await lstat(candidate).catch(statError => {
        if (statError.code !== 'ENOENT') throw statError;
        return null;
      });
      if (existing?.isSymbolicLink()) throw new CheckError('DANGLING_EDIT_SYMLINK');
      suffix.unshift(path.basename(candidate));
      candidate = path.dirname(candidate);
    }
  }
}

export async function reviewPriority(featureDir, { task, changedFiles = [], workspaceRoot, finish = false } = {}) {
  const findings = [];
  let nextTask = null;
  let lastInstruction = null;
  try {
    const root = await realpath(featureDir);
    const raw = await read(root, 'priority-plan.json');
    const plan = JSON.parse(raw);
    const spec = await read(root, 'spec.md');
    const decisions = (await read(root, 'decisions.md')).toString('utf8');
    const tasksText = (await read(root, 'tasks.md')).toString('utf8');
    const trace = (await read(root, 'traceability.md')).toString('utf8');
    const tasks = new Map();
    for (const match of tasksText.matchAll(/^\s*-\s+\[([ xX])\]\s+(?:\*\*)?#?(T\d+)\b/gm)) {
      if (tasks.has(match[2])) throw new Error('Duplicate task');
      tasks.set(match[2], match[1].toLowerCase() === 'x');
    }
    if (plan.schemaVersion !== 1 || !text(plan.objective) || !text(plan.revision) ||
        !Array.isArray(plan.criticalPath) || !plan.criticalPath.length ||
        new Set(plan.criticalPath).size !== plan.criticalPath.length ||
        plan.criticalPath.some(id => !taskId(id) || !tasks.has(id)) ||
        !plan.tasks || typeof plan.tasks !== 'object' || Array.isArray(plan.tasks)) throw new Error('Invalid priority plan');
    lastInstruction = plan.lastInstruction;
    if (!text(lastInstruction?.id) || !text(lastInstruction?.text) ||
        !decisions.includes(lastInstruction.id) || !decisions.includes(lastInstruction.text)) throw new Error('Latest direction is not recorded in decisions.md');
    if (Object.keys(plan.tasks).length !== tasks.size) throw new Error('Task scope coverage mismatch');
    for (const [id, item] of Object.entries(plan.tasks)) {
      if (!tasks.has(id) || !Array.isArray(item.dependsOn) ||
          item.dependsOn.some(dep => !tasks.has(dep)) || !Array.isArray(item.allowedEditScope) ||
          item.allowedEditScope.some(scope => !relative(scope))) throw new Error('Invalid task dependencies or edit scope');
      if (item.parallelFor !== undefined && (!plan.criticalPath.includes(item.parallelFor) ||
          !text(item.reason) || !text(item.decisionId) || !decisions.includes(item.decisionId))) throw new Error('Parallel work needs a recorded decision');
    }
    if (tasks.size > MAX_TASKS || Object.values(plan.tasks).reduce((n, item) => n + item.dependsOn.length, 0) > MAX_EDGES) throw new CheckError('TASK_GRAPH_LIMIT');
    const visited = new Set();
    for (const id of tasks.keys()) {
      const stack = [{ id, index: 0 }];
      const visiting = new Set();
      while (stack.length) {
        const current = stack[stack.length - 1];
        if (visited.has(current.id)) { stack.pop(); continue; }
        visiting.add(current.id);
        const deps = plan.tasks[current.id].dependsOn;
        if (current.index === deps.length) {
          visiting.delete(current.id); visited.add(current.id); stack.pop(); continue;
        }
        const dep = deps[current.index++];
        if (visiting.has(dep)) throw new CheckError('CYCLIC_TASK_DEPENDENCIES');
        if (!visited.has(dep)) stack.push({ id: dep, index: 0 });
      }
    }
    const critical = plan.criticalPath.find(id => !tasks.get(id));
    nextTask = critical || null;
    while (nextTask) {
      const dependency = plan.tasks[nextTask].dependsOn.find(dep => !tasks.get(dep));
      if (!dependency) break;
      nextTask = dependency;
    }
    for (const [id, complete] of tasks) {
      if (complete && plan.tasks[id].dependsOn.some(dep => !tasks.get(dep))) findings.push(`UNFINISHED_DEPENDENCY:${id}`);
    }
    if (task !== undefined) {
      if (!taskId(task) || !tasks.has(task) || tasks.get(task)) throw new Error('Unknown or completed task');
      const item = plan.tasks[task];
      if (item.dependsOn.some(dep => !tasks.get(dep))) findings.push('TASK_DEPENDENCIES_OPEN');
      if (critical && task !== nextTask && item.parallelFor !== critical) findings.push('TASK_NOT_ON_APPROVED_PATH');
      if (changedFiles.length && !text(workspaceRoot)) throw new CheckError('WORKSPACE_ROOT_REQUIRED');
      const workspace = changedFiles.length ? await realpath(workspaceRoot) : null;
      for (const file of changedFiles) {
        relative(file);
        const actual = await destination(workspace, file);
        const inScope = candidate => item.allowedEditScope.some(scope => scope.endsWith('/') ? candidate.startsWith(scope) : candidate === scope);
        const resolvedRelative = path.relative(workspace, actual).split(path.sep).join('/');
        const allowed = inScope(file) && inScope(resolvedRelative);
        if (!allowed) findings.push(`EDIT_OUTSIDE_SCOPE:${file}`);
      }
    } else if (changedFiles.length) throw new Error('Changed files need a task');
    const outcome = plan.outcome;
    if (!text(outcome?.id) || !text(outcome?.statement) || !text(outcome?.target?.environment) ||
        !text(outcome?.target?.revision) || !Array.isArray(outcome?.requirements) || !outcome.requirements.length ||
        outcome.requirements.some(id => typeof id !== 'string' || !/^(FR|NFR|SC)-\d+$/.test(id) || !new RegExp(`\\b${id}\\b`).test(spec))) throw new Error('Invalid outcome definition');
    relative(outcome.receipt);
    if (finish) {
      if (critical) findings.push('PRIORITY_TASKS_OPEN');
      const receipt = JSON.parse(await read(root, outcome.receipt));
      if (receipt.result !== 'pass' || receipt.outcomeId !== outcome.id || receipt.planHash !== hash(raw) ||
          receipt.specHash !== hash(spec) || receipt.target?.environment !== outcome.target.environment ||
          receipt.target?.revision !== outcome.target.revision || !Array.isArray(receipt.requirements) ||
          outcome.requirements.some(id => !receipt.requirements.includes(id)) ||
          !Array.isArray(receipt.checks) || !receipt.checks.length) throw new Error('Outcome evidence is stale or does not match the target');
      if (receipt.checks.length > 1000) throw new CheckError('OUTCOME_CHECK_LIMIT');
      const evidenceCache = { hashes: new Map(), bytes: 0 };
      for (const check of receipt.checks) {
        relative(check.evidence);
        if (check.result !== 'pass' || !text(check.command) || await read(root, check.evidence, true, evidenceCache) !== check.sha256) throw new CheckError('OUTCOME_CHECK_INVALID');
      }
      for (const id of outcome.requirements) {
        if (!trace.split('\n').some(line => new RegExp(`\\b${id}\\b`).test(line) && namesReceipt(line, outcome.receipt))) findings.push(`OUTCOME_TRACE_MISSING:${id}`);
      }
    }
  } catch (error) { findings.push(`PRIORITY_CHECK_INVALID:${error instanceof CheckError ? error.message : 'INVALID_INPUT_OR_EVIDENCE'}`); }
  return { status: findings.length ? 'fail' : 'pass', findings, nextTask, lastInstruction,
    outcomeStatus: finish ? (findings.length ? 'unverified' : 'verified_record') : 'not_checked',
    coverage: 'Recorded direction, scope and evidence integrity only. Does not intercept host tools, authenticate approval or independently prove deployment.' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: gofer-priority-check.mjs --feature-dir <path> [--task T001] [--workspace <repo-root> --changed-file relative/path] [--finish]'); return; }
  const options = { changedFiles: [] };
  let dir;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--finish') options.finish = true;
    else if (['--feature-dir', '--task', '--changed-file', '--workspace'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const value = args[++i];
      if (flag === '--feature-dir') dir = value;
      else if (flag === '--task') options.task = value;
      else if (flag === '--workspace') options.workspaceRoot = value;
      else options.changedFiles.push(value);
    } else throw new Error('Invalid arguments');
  }
  if (!dir) throw new Error('Feature directory is required');
  const result = await reviewPriority(dir, options);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Priority check failed. Check the local plan and arguments.'); process.exitCode = 1; });
}
