#!/usr/bin/env node
import { readFile, writeFile, realpath, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED = ['spec.md', 'plan.md', 'tasks.md', 'traceability.md'];
const OPTIONAL = ['goal-ledger.json', 'research.md', 'discovery.md', 'issues.md', 'validation-report.md', 'decisions.md', 'priority-plan.json'];
const hash = text => createHash('sha256').update(text).digest('hex');

function namesReceipt(line, receipt) {
  // Consume Markdown links as a whole so their labels cannot stand in for destinations.
  const references = line.matchAll(/`([^`]+)`|\[[^\[\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)|\[[^\[\]]*\](?:\[[^\[\]]*\])?|([^\s|`()[\]<>]+)/g);
  return Array.from(references).some(match => (match[1] ?? match[2] ?? match[3] ?? match[4]) === receipt);
}

async function safeRead(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe artifact path');
  const target = await realpath(path.resolve(root, relative));
  if (!target.startsWith(root + path.sep)) throw new Error('Artifact escapes feature folder');
  return readFile(target, 'utf8');
}

export async function reviewDelivery(featureDir, { capture = false, evidenceMap } = {}) {
  const root = await realpath(featureDir);
  const findings = [];
  const artifacts = {};
  const contents = {};
  for (const file of [...REQUIRED, ...OPTIONAL]) {
    try {
      contents[file] = await safeRead(root, file);
      if (!contents[file].trim()) findings.push(`EMPTY_ARTIFACT:${file}`);
      artifacts[file] = hash(contents[file]);
    } catch (error) {
      artifacts[file] = null;
      if (REQUIRED.includes(file) || error.code !== 'ENOENT') findings.push(`UNREADABLE_ARTIFACT:${file}`);
    }
  }
  let checkpoint;
  try { checkpoint = JSON.parse(await safeRead(root, 'delivery-checkpoint.json')); }
  catch (error) { if (!capture || error.code !== 'ENOENT') findings.push('MISSING_OR_INVALID_CHECKPOINT'); }
  const completed = [];
  const taskIds = new Set();
  for (const line of (contents['tasks.md'] || '').split('\n')) {
    if (/^\s*-\s+\[[xX]\]/.test(line) && !/^\s*-\s+\[[xX]\]\s+(?:\*\*)?#?T\d+\b/.test(line)) findings.push('COMPLETED_TASK_WITHOUT_ID');
  }
  for (const match of (contents['tasks.md'] || '').matchAll(/^\s*-\s+\[([^\]])\]\s+(?:\*\*)?#?(T\d+)\b/gm)) {
    if (taskIds.has(match[2])) findings.push(`DUPLICATE_TASK:${match[2]}`);
    taskIds.add(match[2]);
    if (/[xX]/.test(match[1])) completed.push(match[2]);
  }
  const mapping = evidenceMap ?? checkpoint?.completedTasks ?? {};
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) findings.push('INVALID_EVIDENCE_MAP');
  const checked = {};
  for (const task of completed) {
    const item = mapping?.[task];
    if (!item || !Array.isArray(item.requirements) || !item.requirements.length) {
      findings.push(`MISSING_TASK_EVIDENCE:${task}`); continue;
    }
    const requirements = new Set((contents['spec.md'] || '').match(/\b(?:FR|NFR|SC)-\d+\b/g) || []);
    if (item.requirements.some(id => !requirements.has(id))) findings.push(`UNKNOWN_REQUIREMENT:${task}`);
    const trace = contents['traceability.md'] || '';
    if (!trace.split('\n').some(line => new RegExp(`\\b${task}\\b`).test(line) && item.requirements.every(id => typeof id === 'string' && /^(?:FR|NFR|SC)-\d+$/.test(id) && new RegExp(`\\b${id}\\b`).test(line)))) findings.push(`MISSING_TRACEABILITY:${task}`);
    if (artifacts['priority-plan.json'] && !trace.split('\n').some(line =>
      new RegExp(`\\b${task}\\b`).test(line) && typeof item.evidence === 'string' && namesReceipt(line, item.evidence))) {
      findings.push(`MISSING_NAMED_TASK_RECEIPT:${task}`);
    }
    try {
      const raw = await safeRead(root, item.evidence);
      const proof = JSON.parse(raw);
      if (proof.result !== 'pass' || proof.specHash !== artifacts['spec.md'] ||
          !Array.isArray(proof.requirements) || item.requirements.some(id => !proof.requirements.includes(id)) ||
          typeof proof.check !== 'string' || !proof.check.trim()) findings.push(`INVALID_OR_STALE_EVIDENCE:${task}`);
      if (!capture && item.evidenceHash !== hash(raw)) findings.push(`CHANGED_EVIDENCE:${task}`);
      checked[task] = { requirements: item.requirements, evidence: item.evidence, evidenceHash: hash(raw) };
    } catch { findings.push(`UNREADABLE_EVIDENCE:${task}`); }
  }
  if (mapping && Object.keys(mapping).some(task => !completed.includes(task))) findings.push('EVIDENCE_FOR_UNFINISHED_OR_REMOVED_TASK');
  if (!capture) {
    if (checkpoint?.schemaVersion !== 1) findings.push('INVALID_CHECKPOINT_VERSION');
    for (const file of Object.keys(artifacts)) {
      if ((checkpoint?.artifacts?.[file] ?? null) !== artifacts[file]) findings.push(`ARTIFACT_DRIFT:${file}`);
    }
  }
  if (capture && !findings.length) {
    // Refuse symlink outputs as well as symlink inputs outside the feature.
    try { await safeRead(root, 'delivery-checkpoint.json'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(root, `.delivery-checkpoint-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({
      schemaVersion: 1, capturedAt: new Date().toISOString(), artifacts, completedTasks: checked,
    }, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, path.join(root, 'delivery-checkpoint.json'));
  }
  return { status: findings.length ? 'fail' : 'pass', findings, completedTasks: completed.length,
    artifacts, scope: 'File freshness and recorded evidence checks, not independent proof of test execution or goal alignment.' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: gofer-delivery-check.mjs --feature-dir <path> [--capture --evidence-map <json-file>]'); return;
  }
  const options = {};
  let featureDir;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--capture') options.capture = true;
    else if (['--feature-dir', '--evidence-map'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const flag = args[i++];
      if (flag === '--feature-dir') featureDir = args[i];
      else options.evidenceMap = JSON.parse(await readFile(args[i], 'utf8'));
    } else throw new Error('Invalid arguments');
  }
  if (!featureDir || (options.evidenceMap && !options.capture)) throw new Error('Invalid capture arguments');
  const result = await reviewDelivery(path.resolve(featureDir), options);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'fail') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Delivery check failed. Check the local feature files and arguments.'); process.exitCode = 1; });
}
