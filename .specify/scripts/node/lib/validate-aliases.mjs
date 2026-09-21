/**
 * validate-aliases.mjs
 *
 * Loads all `.specify/commands/*.md` source-of-truth files (via parseStageCommand)
 * and validates that every alias and `name` is unique across the set.
 *
 * Used by `tests/unit/scripts/alias-uniqueness.test.ts` and by the source-of-truth
 * generator's pre-flight check (so we never emit two providers that claim the same
 * `gofer:*` namespace).
 *
 * Public API:
 *   loadStages(commandsDir)
 *     -> Promise<Array<{ filePath, name, aliases }>>
 *
 *   validateAliases(stages)
 *     -> { ok: boolean, conflicts: Array<{ alias, owners: string[] }> }
 *
 * The two are split so tests can feed synthetic stage arrays into validateAliases
 * without touching the filesystem.
 */

import { readdir } from 'fs/promises';
import path from 'path';
import { parseStageCommand } from '../parse-stage-command.mjs';

/**
 * Load every `.md` file in `commandsDir` (non-recursive) and return a normalized
 * stage descriptor: { filePath, name, aliases }.
 *
 * @param {string} commandsDir Absolute path to `.specify/commands`
 * @returns {Promise<Array<{ filePath: string, name: string, aliases: string[] }>>}
 */
export async function loadStages(commandsDir) {
  const entries = await readdir(commandsDir, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(commandsDir, e.name));

  const stages = [];
  for (const filePath of mdFiles) {
    const { frontmatter } = await parseStageCommand(filePath);
    const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [];
    stages.push({
      filePath,
      name: String(frontmatter.name),
      aliases,
    });
  }
  return stages;
}

/**
 * Detect duplicate identifiers across a set of stages.
 *
 * The "identifier set" for a stage is its `name` plus every entry in its
 * `aliases` array. Two stages may not share any identifier; if they do, the
 * conflict is reported.
 *
 * @param {Array<{ filePath: string, name: string, aliases: string[] }>} stages
 * @returns {{ ok: boolean, conflicts: Array<{ alias: string, owners: string[] }> }}
 */
export function validateAliases(stages) {
  /** @type {Map<string, string[]>} */
  const owners = new Map();

  for (const stage of stages) {
    const ids = [stage.name, ...stage.aliases];
    for (const id of ids) {
      if (!id) continue;
      if (!owners.has(id)) {
        owners.set(id, []);
      }
      owners.get(id).push(stage.filePath);
    }
  }

  const conflicts = [];
  for (const [alias, files] of owners.entries()) {
    if (files.length > 1) {
      conflicts.push({ alias, owners: files });
    }
  }

  return { ok: conflicts.length === 0, conflicts };
}
