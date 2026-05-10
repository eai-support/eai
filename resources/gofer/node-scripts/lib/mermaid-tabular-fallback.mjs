/**
 * mermaid-tabular-fallback.mjs
 *
 * Provides a markdown-table fallback for Mermaid diagrams when the Mermaid
 * renderer is unavailable, fails, or the consumer surface does not support
 * Mermaid (e.g. plain-text release notes, terminal output).
 *
 * Supported chart types:
 *   - quadrantChart   → | Item | X | Y | Quadrant |
 *   - xychart-beta    → | X | Y |
 *   - C4Context       → | Element | Type | Description |
 *   - C4Container     → | Element | Type | Description |
 *
 * Usage:
 *   import { tabularFallback } from './mermaid-tabular-fallback.mjs';
 *   const md = tabularFallback(blockString, 'quadrantChart');
 *
 * If the input cannot be parsed for the declared chart type, the module
 * returns a rescue block containing the original Mermaid source verbatim,
 * preceded by a notice. This guarantees no information is lost.
 */

const SUPPORTED = new Set([
  'xychart-beta',
  'quadrantChart',
  'C4Context',
  'C4Container',
]);

/**
 * Render a Mermaid block as a markdown-table fallback.
 *
 * @param {string} mermaidBlock The Mermaid source. May or may not be wrapped
 *   in a ```` ```mermaid ```` code fence; the wrapper is stripped if present.
 * @param {('xychart-beta'|'quadrantChart'|'C4Context'|'C4Container')} chartType
 * @returns {string} Markdown table or a rescue block.
 */
export function tabularFallback(mermaidBlock, chartType) {
  if (typeof mermaidBlock !== 'string' || mermaidBlock.length === 0) {
    return rescue(mermaidBlock ?? '');
  }
  if (!SUPPORTED.has(chartType)) {
    return rescue(mermaidBlock);
  }

  const source = stripFence(mermaidBlock);

  try {
    switch (chartType) {
      case 'quadrantChart':
        return renderQuadrant(source);
      case 'xychart-beta':
        return renderXyChart(source);
      case 'C4Context':
      case 'C4Container':
        return renderC4(source);
      default:
        return rescue(mermaidBlock);
    }
  } catch (_err) {
    return rescue(mermaidBlock);
  }
}

export default tabularFallback;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripFence(input) {
  const fenceRe = /^```mermaid\s*\n([\s\S]*?)\n```\s*$/m;
  const m = input.match(fenceRe);
  return m ? m[1] : input;
}

function rescue(original) {
  const trimmed = (original ?? '').trimEnd();
  return (
    '_Diagram unavailable; see source._\n\n' +
    '```\n' +
    trimmed +
    '\n```\n'
  );
}

function nonEmptyLines(source) {
  return source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// quadrantChart
// ---------------------------------------------------------------------------

/**
 * Parses a Mermaid quadrantChart definition into a markdown table.
 *
 * Rows shaped like `Label: [0.3, 0.7]` are extracted. Quadrant assignment
 * follows Mermaid's convention:
 *   - x ≥ 0.5 && y ≥ 0.5 → quadrant-1 (declared)
 *   - x <  0.5 && y ≥ 0.5 → quadrant-2
 *   - x <  0.5 && y <  0.5 → quadrant-3
 *   - x ≥ 0.5 && y <  0.5 → quadrant-4
 */
function renderQuadrant(source) {
  const lines = nonEmptyLines(source);
  if (lines.length === 0 || !lines[0].toLowerCase().startsWith('quadrantchart')) {
    throw new Error('Not a quadrantChart');
  }

  const quadrantNames = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4' };
  const ITEM_RE = /^([^:]+?):\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]\s*$/;
  const QUAD_DECL = /^quadrant-([1-4])\s+(.+)$/i;

  const items = [];
  for (const line of lines) {
    const qmatch = line.match(QUAD_DECL);
    if (qmatch) {
      quadrantNames[Number(qmatch[1])] = qmatch[2].trim();
      continue;
    }
    const im = line.match(ITEM_RE);
    if (im) {
      const label = im[1].trim();
      const x = Number(im[2]);
      const y = Number(im[3]);
      items.push({ label, x, y });
    }
  }

  let body =
    '| Item | X | Y | Quadrant |\n' +
    '|------|---|---|----------|\n';
  if (items.length === 0) {
    body += '| _none_ | _n/a_ | _n/a_ | _n/a_ |\n';
    return body;
  }
  for (const it of items) {
    const q = quadrantOf(it.x, it.y, quadrantNames);
    body += `| ${escapeCell(it.label)} | ${it.x} | ${it.y} | ${escapeCell(q)} |\n`;
  }
  return body;
}

function quadrantOf(x, y, names) {
  if (x >= 0.5 && y >= 0.5) return names[1];
  if (x < 0.5 && y >= 0.5) return names[2];
  if (x < 0.5 && y < 0.5) return names[3];
  return names[4];
}

// ---------------------------------------------------------------------------
// xychart-beta
// ---------------------------------------------------------------------------

/**
 * Parses a Mermaid xychart-beta block. Extracts:
 *   - x-axis labels: `x-axis [a, b, c]` or `x-axis "Title" [a, b, c]`
 *   - bar/line series: `bar [n, n, ...]` / `line [n, n, ...]`
 */
function renderXyChart(source) {
  const lines = nonEmptyLines(source);
  if (lines.length === 0 || !lines[0].toLowerCase().startsWith('xychart-beta')) {
    throw new Error('Not an xychart-beta');
  }

  const X_AXIS_RE = /^x-axis(?:\s+"[^"]*")?\s*\[([^\]]+)\]\s*$/i;
  const SERIES_RE = /^(?:bar|line)\s+\[([^\]]+)\]\s*$/i;

  let xLabels = [];
  let yValues = [];
  for (const line of lines) {
    const xm = line.match(X_AXIS_RE);
    if (xm) {
      xLabels = splitArray(xm[1]).map(stripQuotes);
      continue;
    }
    const sm = line.match(SERIES_RE);
    if (sm && yValues.length === 0) {
      yValues = splitArray(sm[1]).map(Number);
    }
  }

  let body =
    '| X | Y |\n' +
    '|---|---|\n';

  const rows = Math.max(xLabels.length, yValues.length);
  if (rows === 0) {
    body += '| _none_ | _n/a_ |\n';
    return body;
  }

  for (let i = 0; i < rows; i += 1) {
    const x = xLabels[i] ?? `_row ${i + 1}_`;
    const y = yValues[i] ?? '_n/a_';
    body += `| ${escapeCell(String(x))} | ${escapeCell(String(y))} |\n`;
  }
  return body;
}

function splitArray(inner) {
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function stripQuotes(s) {
  return s.replace(/^"(.*)"$/, '$1');
}

// ---------------------------------------------------------------------------
// C4Context / C4Container
// ---------------------------------------------------------------------------

/**
 * Parses Person/System/System_Ext/Container declarations into a table.
 * Lines look like:
 *   Person(alias, "label")
 *   System(alias, "label")
 *   System_Ext(alias, "label")
 *   Container(alias, "label", "tech")
 */
function renderC4(source) {
  const lines = nonEmptyLines(source);
  if (lines.length === 0 || !/^c4(context|container)/i.test(lines[0])) {
    throw new Error('Not a C4 block');
  }

  const ELEMENT_RE = /^(Person|Person_Ext|System|System_Ext|Container|Container_Ext|ContainerDb|SystemDb)\s*\(\s*([A-Za-z0-9_]+)\s*,\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?\s*\)\s*$/;

  const rows = [];
  for (const line of lines) {
    const m = line.match(ELEMENT_RE);
    if (m) {
      const type = m[1];
      const alias = m[2];
      const label = m[3];
      const tech = m[4];
      const desc = tech ? `${label} — ${tech}` : label;
      rows.push({ alias, type, desc });
    }
  }

  let body =
    '| Element | Type | Description |\n' +
    '|---------|------|-------------|\n';
  if (rows.length === 0) {
    body += '| _none_ | _n/a_ | _n/a_ |\n';
    return body;
  }
  for (const r of rows) {
    body += `| ${escapeCell(r.alias)} | ${escapeCell(r.type)} | ${escapeCell(r.desc)} |\n`;
  }
  return body;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}
