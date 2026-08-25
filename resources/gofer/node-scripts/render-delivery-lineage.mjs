#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { augmentCustomerLineageCorpus } from './delivery-lineage-corpus.mjs';

const SCHEMA_VERSION = 'eai.delivery_lineage.v1';
const STAGES = ['intent', 'requirements', 'architecture', 'delivery', 'validation', 'outcome'];
const STATUSES = ['current', 'suspect', 'anchor-lost', 'broken', 'superseded'];
const EDGE_STATUS_STYLES = {
  current: 'stroke:#1565c0,stroke-width:2px',
  suspect: 'stroke:#f59e0b,stroke-width:3px',
  'anchor-lost': 'stroke:#e53935,stroke-width:3px',
  broken: 'stroke:#c62828,stroke-width:3px',
  superseded: 'stroke:#8b949e,stroke-width:2px,stroke-dasharray:7 5',
};
const FORBIDDEN_INTERNAL_TERMS = [
  'AdminAPI',
  'ResourceAPI',
  'Configurator',
  'Authz',
  'AzureAPI',
  'AICore',
  'GeoService',
  'Infra2025',
  'eai-testing-dev',
  'tech-docs',
];

function parseArgs(argv) {
  const args = { input: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input' && argv[index + 1]) args.input = argv[++index];
    else if (argv[index] === '--output' && argv[index + 1]) args.output = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return 'Usage: node render-delivery-lineage.mjs --input <delivery-lineage.json> [--output <delivery-lineage.md>]';
}

function cleanLabel(value) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function titleCase(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function validateCustomerLineage(lineage) {
  const errors = [];
  if (lineage?.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (lineage?.plane !== 'customer') errors.push('plane must be customer');
  if (!String(lineage?.featureId ?? '').trim()) errors.push('featureId is required');
  if (!Array.isArray(lineage?.nodes)) errors.push('nodes must be an array');
  if (!Array.isArray(lineage?.edges)) errors.push('edges must be an array');
  if (errors.length > 0) return errors;

  const nodeIds = new Set();
  for (const node of lineage.nodes) {
    if (!node?.id || nodeIds.has(node.id)) errors.push(`node id is missing or duplicated: ${node?.id ?? '<empty>'}`);
    nodeIds.add(node?.id);
    if (!STAGES.includes(node?.stage)) errors.push(`node ${node?.id} has an invalid stage`);
    if (!STATUSES.includes(node?.status)) errors.push(`node ${node?.id} has an invalid status`);
    if (!['customer', 'public-contract'].includes(node?.visibility)) {
      errors.push(`node ${node?.id} crosses the customer trust boundary`);
    }
  }
  const edgeIds = new Set();
  for (const edge of lineage.edges) {
    if (!edge?.id || edgeIds.has(edge.id)) errors.push(`edge id is missing or duplicated: ${edge?.id ?? '<empty>'}`);
    edgeIds.add(edge?.id);
    if (!nodeIds.has(edge?.source) || !nodeIds.has(edge?.target)) errors.push(`edge ${edge?.id} references a missing node`);
    if (!STATUSES.includes(edge?.status)) errors.push(`edge ${edge?.id} has an invalid status`);
    if (!['customer', 'public-contract'].includes(edge?.visibility)) {
      errors.push(`edge ${edge?.id} crosses the customer trust boundary`);
    }
  }

  const serialized = JSON.stringify(lineage).toLowerCase();
  for (const term of FORBIDDEN_INTERNAL_TERMS) {
    if (serialized.includes(term.toLowerCase())) errors.push(`customer lineage contains forbidden internal term: ${term}`);
  }
  return errors;
}

export function renderCustomerLineageMarkdown(lineage, inputName = 'delivery-lineage.json') {
  const errors = validateCustomerLineage(lineage);
  if (errors.length > 0) throw new Error(`Cannot render customer lineage:\n- ${errors.join('\n- ')}`);

  const nodeNames = new Map(lineage.nodes.map((node, index) => [node.id, `n${index}`]));
  const finalDecision = lineage.nodes.reduce((selected, node) => {
    if (node.kind !== 'decision' || node.decisionOutcome !== 'selected' || node.status !== 'current') return selected;
    if (!selected || STAGES.indexOf(node.stage) >= STAGES.indexOf(selected.stage)) return node;
    return selected;
  }, undefined);
  const lines = [
    '---',
    `feature: ${JSON.stringify(lineage.featureId)}`,
    `source: ${JSON.stringify(path.basename(inputName))}`,
    `schema: ${SCHEMA_VERSION}`,
    'plane: customer',
    '---',
    '',
    `# Delivery Lineage: ${cleanLabel(lineage.featureId)}`,
    '',
    '> Customer-safe graph. EAI dependencies stop at published PublicAPI capabilities.',
    '',
    '```mermaid',
    'flowchart LR',
  ];

  for (const stage of STAGES) {
    const stageNodes = lineage.nodes.filter((node) => node.stage === stage);
    if (stageNodes.length === 0) continue;
    lines.push(`  subgraph stage_${stage}["${titleCase(stage)}"]`, '    direction TB');
    for (const node of stageNodes) {
      const className = node.id === finalDecision?.id ? 'final_selected' : node.decisionOutcome === 'rejected' ? 'rejected_decision' : node.status.replace('-', '_');
      const outcomeLabel = node.id === finalDecision?.id ? '<br/>FINAL SELECTED DECISION' : '';
      lines.push(`    ${nodeNames.get(node.id)}["${cleanLabel(node.label)}<br/>${titleCase(node.kind)}${outcomeLabel}"]:::${className}`);
    }
    lines.push('  end');
  }

  const edgeStyles = [];
  for (const [index, edge] of lineage.edges.entries()) {
    const statusLabel = edge.status === 'current' ? '' : ` · ${titleCase(edge.status)}`;
    lines.push(`  ${nodeNames.get(edge.source)} -->|"${titleCase(cleanLabel(edge.relation))}${statusLabel}"| ${nodeNames.get(edge.target)}`);
    if (EDGE_STATUS_STYLES[edge.status]) {
      edgeStyles.push(`  linkStyle ${index} ${EDGE_STATUS_STYLES[edge.status]}`);
    }
  }
  lines.push(...edgeStyles);
  lines.push(
    '  classDef current fill:#e8f5e9,stroke:#2e7d32,color:#102a13',
    '  classDef suspect fill:#fff4ce,stroke:#f59e0b,color:#3d2800',
    '  classDef anchor_lost fill:#ffebee,stroke:#e53935,color:#3f1010',
    '  classDef broken fill:#ffcdd2,stroke:#c62828,color:#3f1010',
    '  classDef superseded fill:#eceff1,stroke:#8b949e,color:#30363d',
    '  classDef final_selected fill:#e3f2fd,stroke:#1565c0,stroke-width:4px,color:#0d2440',
    '  classDef rejected_decision fill:#eceff1,stroke:#8b949e,stroke-dasharray:5 4,color:#30363d',
    '```',
    '',
    `Generated from \`${path.basename(inputName)}\`. Open **Gofer: Show Delivery Lineage** for the interactive viewer.`,
    ''
  );
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.input) throw new Error(usage());
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output || path.join(path.dirname(inputPath), 'delivery-lineage.md'));
  const lineage = await augmentCustomerLineageCorpus(
    JSON.parse(await fs.readFile(inputPath, 'utf8')),
    inputPath
  );
  await fs.writeFile(outputPath, renderCustomerLineageMarkdown(lineage, inputPath), 'utf8');
  console.log(outputPath);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
