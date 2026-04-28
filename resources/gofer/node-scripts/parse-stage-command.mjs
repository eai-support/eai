/**
 * parse-stage-command.mjs
 * Parses a .specify/commands/<stage>.md file with YAML frontmatter.
 * Uses a minimal inline YAML parser (no external deps required).
 */

import { readFile } from 'fs/promises';

/**
 * Minimal YAML parser for stage-command frontmatter.
 * Handles:
 *   - string scalars: `key: value`
 *   - quoted strings: `key: "value"` or `key: 'value'`
 *   - block sequences (arrays): `key:\n  - item`
 *   - inline sequences: `key: [a, b, c]`
 *   - boolean: `key: true` / `key: false`
 *
 * @param {string} yaml Raw YAML text
 * @returns {Record<string, unknown>}
 */
function parseMinimalYaml(yaml) {
  const result = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    // Key: value pair (top-level only — sufficient for frontmatter)
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1];
    const rest = keyMatch[2].trim();

    // Inline array: key: [a, b, c]
    if (rest.startsWith('[')) {
      const inner = rest.slice(1, rest.lastIndexOf(']'));
      result[key] = inner
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      i++;
      continue;
    }

    // Empty value → check for block sequence on next lines
    if (rest === '' || rest === null) {
      const items = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-\s+/)) {
        const item = lines[i].replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '');
        items.push(item);
        i++;
      }
      result[key] = items.length > 0 ? items : '';
      continue;
    }

    // Boolean
    if (rest === 'true') { result[key] = true; i++; continue; }
    if (rest === 'false') { result[key] = false; i++; continue; }

    // Quoted string
    if ((rest.startsWith('"') && rest.endsWith('"')) ||
        (rest.startsWith("'") && rest.endsWith("'"))) {
      result[key] = rest.slice(1, -1);
      i++;
      continue;
    }

    // Plain scalar
    result[key] = rest;
    i++;
  }

  return result;
}

/**
 * Performs structural validation of a parsed frontmatter object.
 * Throws if required fields are missing or have wrong types.
 *
 * @param {Record<string, unknown>} fm Parsed frontmatter
 * @param {string} filePath Source file path (for error messages)
 */
function validateFrontmatter(fm, filePath) {
  const required = ['name', 'description', 'title', 'surfaces', 'category'];
  for (const field of required) {
    if (fm[field] === undefined || fm[field] === null || fm[field] === '') {
      throw new Error(`Missing required frontmatter field '${field}' in ${filePath}`);
    }
  }

  if (typeof fm.name !== 'string') {
    throw new Error(`'name' must be a string in ${filePath}`);
  }
  if (typeof fm.description !== 'string') {
    throw new Error(`'description' must be a string in ${filePath}`);
  }
  if (fm.description.length > 140) {
    throw new Error(`'description' exceeds 140 chars in ${filePath}`);
  }
  if (typeof fm.title !== 'string') {
    throw new Error(`'title' must be a string in ${filePath}`);
  }
  if (!Array.isArray(fm.surfaces) || fm.surfaces.length === 0) {
    throw new Error(`'surfaces' must be a non-empty array in ${filePath}`);
  }

  const validSurfaces = new Set([
    'claude', 'claude-mirror', 'copilot', 'vscode', 'codex',
    'gemini', 'github-prompts', 'agents-skills', 'system-skills',
  ]);
  for (const s of fm.surfaces) {
    if (!validSurfaces.has(s)) {
      throw new Error(`Invalid surface '${s}' in ${filePath}`);
    }
  }

  const validCategories = new Set(['pipeline', 'utility', 'diagnostic', 'control']);
  if (!validCategories.has(fm.category)) {
    throw new Error(`Invalid category '${fm.category}' in ${filePath}`);
  }
}

/**
 * Parses a stage command markdown file.
 *
 * The file format is:
 * ```
 * ---
 * name: stage_name
 * description: "Short description"
 * title: "Human title"
 * surfaces:
 *   - claude
 *   - codex
 * category: pipeline
 * ---
 *
 * Markdown body content here...
 * ```
 *
 * @param {string} filePath Absolute or relative path to the .md file
 * @returns {Promise<{ frontmatter: Record<string, unknown>, body: string }>}
 */
export async function parseStageCommand(filePath) {
  const raw = await readFile(filePath, 'utf8');

  // Must start with ---
  if (!raw.startsWith('---')) {
    throw new Error(`File does not start with frontmatter fence '---': ${filePath}`);
  }

  // Find the closing --- after the opening
  const afterOpen = raw.slice(3); // skip first ---
  // Handle both \r\n and \n
  const closeIdx = afterOpen.search(/\r?\n---(\r?\n|$)/);
  if (closeIdx === -1) {
    throw new Error(`No closing frontmatter fence found in ${filePath}`);
  }

  const yamlText = afterOpen.slice(0, closeIdx).replace(/^\r?\n/, '');

  // Find where the body starts (after closing --- line)
  const closingFenceMatch = afterOpen.match(/\r?\n---(\r?\n|$)/);
  const bodyStart = 3 /* opening --- */ + closeIdx + closingFenceMatch[0].length;
  const body = raw.slice(bodyStart);

  const frontmatter = parseMinimalYaml(yamlText);
  validateFrontmatter(frontmatter, filePath);

  return { frontmatter, body };
}
