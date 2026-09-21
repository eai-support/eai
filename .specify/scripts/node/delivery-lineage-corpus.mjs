import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = ['AdminAPI', 'ResourceAPI', 'Configurator', 'Authz', 'AzureAPI', 'AICore', 'GeoService', 'Infra2025', 'eai-testing-dev', 'tech-docs'];
const PHASES = {
  P1: { name: 'Research', stage: 'intent', kind: 'artifact', preferred: ['research.md', 'discovery.md', 'problem-brief.md'] },
  P2: { name: 'Specify', stage: 'requirements', kind: 'requirement', preferred: ['spec.md', 'spec-summary.md', 'assumptions.md'] },
  P3: { name: 'Plan', stage: 'architecture', kind: 'architecture', preferred: ['plan.md', 'data-model.md', 'quickstart.md'] },
  P4: { name: 'Tasks', stage: 'delivery', kind: 'work-order', preferred: ['tasks.md', 'traceability.md', 'issues.md'] },
  P5: { name: 'Implement', stage: 'delivery', kind: 'artifact', preferred: ['implementation-status.md', 'tdd-session.md', 'audit-history.md'] },
  P6: { name: 'Validate', stage: 'validation', kind: 'test', preferred: ['validation.md', 'validation-report.md', 'engineering-review-report.md'] },
  Feature: { name: 'Artifact', stage: 'requirements', kind: 'documentation-file', preferred: [] },
};

const NAMES = {
  P1: new Set(['research', 'discovery', 'problem-brief', 'working-backwards-prfaq', 'business-analysis', 'market-analysis', 'proposal-review', 'context-bundle', 'reuse-scan', 'build-map', 'eai-preflight', 'ui-preview-brief', 'execution-profile']),
  P2: new Set(['spec', 'spec-summary', 'glossary', 'assumptions', 'contract-pack', 'business-owner-summary']),
  P3: new Set(['plan', 'data-model', 'quickstart', 'cto-architecture-summary', 'service-fit-matrix', 'ui-review-log', 'ui-show-and-tell']),
  P4: new Set(['tasks', 'traceability', 'issues', 'workflow-dag', 'loop-contract']),
  P5: new Set(['implementation-status', 'implementation-skill-evidence', 'tdd-session', 'diagnose-report', 'doc-consistency-scan', 'audit-history', 'session-checkpoint']),
  P6: new Set(['validation', 'validation-report', 'engineering-review-report', 'blast-radius-report', 'remediation-report', 'goal-rebaseline-report', 'loop-audit-report']),
};

function stem(relativePath) {
  return path.posix.basename(relativePath, path.posix.extname(relativePath)).toLowerCase();
}

function phaseFor(relativePath) {
  const name = stem(relativePath);
  if (NAMES.P1.has(name)) return 'P1';
  if (NAMES.P2.has(name) || relativePath.startsWith('checklists/')) return 'P2';
  if (NAMES.P3.has(name) || relativePath.startsWith('contracts/') || relativePath.startsWith('visuals/') || relativePath.startsWith('sequence-diagrams/')) return 'P3';
  if (NAMES.P4.has(name)) return 'P4';
  if (NAMES.P5.has(name)) return 'P5';
  if (NAMES.P6.has(name)) return 'P6';
  return 'Feature';
}

function titleFor(relativePath, content) {
  const frontmatter = content.match(/^---\s*[\r\n]+[\s\S]*?^title:\s*["']?([^\r\n"']+)/m)?.[1];
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return (frontmatter ?? heading ?? stem(relativePath).replace(/[-_]+/g, ' ')).trim().slice(0, 120);
}

function outcomeFor(heading) {
  if (/\b(rejected|declined|not selected)\b/i.test(heading)) return 'rejected';
  if (/\bsuperseded\b/i.test(heading)) return 'superseded';
  if (/\b(selected approach|approved direction|chosen option|recommendation|final decision|architecture decision)\b/i.test(heading)) return 'selected';
  return undefined;
}

function summaryFor(value) {
  const summary = value.replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[\s]*[-+*]\s+/gm, '').replace(/[#>*_`|]/g, ' ').replace(/\s+/g, ' ').trim();
  return summary ? summary.slice(0, 320) : undefined;
}

function decisionsFor(content) {
  const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)];
  const decisions = [];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const heading = match[1].trim();
    if (!/\b(decision|decisions|selected approach|approved direction|chosen option|recommendation|rejected alternative|declined option|superseded decision)\b/i.test(heading)) continue;
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = headings[index + 1]?.index ?? content.length;
    decisions.push({ heading, decisionOutcome: outcomeFor(heading), summary: summaryFor(content.slice(bodyStart, bodyEnd)) });
  }
  return decisions.slice(0, 30);
}

function id(prefix, value) {
  return `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

async function listArtifacts(folder, prefix = '') {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(folder, entry.name);
    if (entry.isDirectory()) artifacts.push(...(await listArtifacts(absolutePath, relativePath)));
    else if (/\.(md|json)$/i.test(entry.name) && !/^delivery-lineage\.(md|json)$/i.test(entry.name)) {
      const content = await fs.readFile(absolutePath, 'utf8');
      const leaked = FORBIDDEN.find((term) => content.toLowerCase().includes(term.toLowerCase()));
      if (leaked) throw new Error(`Customer feature artifact ${relativePath} contains forbidden internal term ${leaked}.`);
      artifacts.push({ relativePath, content });
    }
  }
  return artifacts;
}

function sortArtifacts(code, left, right) {
  const preferred = PHASES[code].preferred;
  const leftRank = preferred.indexOf(left.relativePath);
  const rightRank = preferred.indexOf(right.relativePath);
  if (leftRank >= 0 || rightRank >= 0) {
    if (leftRank < 0) return 1;
    if (rightRank < 0) return -1;
    return leftRank - rightRank;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

/** Enriches CLI/plugin Mermaid output with the complete customer-safe P1-P6 corpus. */
export async function augmentCustomerLineageCorpus(lineage, inputPath) {
  const marker = `${path.sep}.specify${path.sep}`;
  const markerIndex = inputPath.indexOf(marker);
  if (markerIndex < 0) return lineage;
  const repositoryRoot = inputPath.slice(0, markerIndex);
  const repository = path.basename(repositoryRoot);
  const featureFolder = path.dirname(inputPath);
  const featureRoot = path.relative(repositoryRoot, featureFolder).split(path.sep).join('/');
  const nodes = lineage.nodes.map((node) => ({ ...node }));
  const edges = lineage.edges.map((edge) => ({ ...edge }));
  const nodeBySource = new Map(nodes.filter((node) => node.source?.repository === repository).map((node) => [node.source.path, node.id]));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const groups = new Map();
  const addEdge = (edge) => {
    if (!edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  };

  for (const artifact of await listArtifacts(featureFolder)) {
    const code = phaseFor(artifact.relativePath);
    const phase = PHASES[code];
    const sourcePath = `${featureRoot}/${artifact.relativePath}`;
    let nodeId = nodeBySource.get(sourcePath);
    if (!nodeId) {
      nodeId = id('corpus', sourcePath);
      nodes.push({ id: nodeId, kind: phase.kind, label: `${code} ${phase.name} · ${titleFor(artifact.relativePath, artifact.content)}`, stage: phase.stage, visibility: 'customer', status: 'current', source: { repository, path: sourcePath } });
      nodeBySource.set(sourcePath, nodeId);
    }
    const items = groups.get(code) ?? [];
    items.push({ nodeId, relativePath: artifact.relativePath });
    groups.set(code, items);
    for (const decision of decisionsFor(artifact.content)) {
      const decisionId = id('decision', `${sourcePath}#${decision.heading}`);
      if (!nodes.some((node) => node.id === decisionId)) nodes.push({ id: decisionId, kind: 'decision', label: `${code} Decision · ${decision.heading}`, stage: phase.stage, visibility: 'customer', status: 'current', decisionOutcome: decision.decisionOutcome, summary: decision.summary, source: { repository, path: sourcePath, anchor: decision.heading } });
      addEdge({ id: id('corpus-edge', `${nodeId}:records-decision:${decisionId}`), source: nodeId, target: decisionId, relation: 'records-decision', visibility: 'customer', status: 'current' });
    }
  }

  let previousAnchor;
  for (const code of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'Feature']) {
    const items = (groups.get(code) ?? []).sort((left, right) => sortArtifacts(code, left, right));
    const anchor = items[0]?.nodeId;
    if (!anchor) continue;
    if (previousAnchor) addEdge({ id: id('corpus-edge', `${previousAnchor}:informs:${anchor}`), source: previousAnchor, target: anchor, relation: 'informs', visibility: 'customer', status: 'current' });
    for (const item of items.slice(1)) addEdge({ id: id('corpus-edge', `${anchor}:supports:${item.nodeId}`), source: anchor, target: item.nodeId, relation: 'supports', visibility: 'customer', status: 'current' });
    previousAnchor = anchor;
  }
  return { ...lineage, nodes, edges };
}
