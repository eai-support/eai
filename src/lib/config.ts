/**
 * Config loader — reads eai.config.ts from project root.
 *
 * Uses a lightweight approach: transpile TypeScript to JS using Node's
 * native import() with a temporary .mjs file. This avoids requiring
 * ts-node or tsx as dependencies.
 */

import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface ObjectTypeProperty {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'json' | 'file' | 'relationship';
  required: boolean;
  indexed?: boolean;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

export interface ObjectTypeLinkType {
  name: string;
  targetObjectType: string;
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  cascadeDelete?: boolean;
}

export interface ObjectTypeAction {
  name: string;
  displayName: string;
  requiredRole: 'tenant-viewer' | 'tenant-builder' | 'tenant-admin';
  validationRules: {
    requiredFields?: string[];
    requiredStatus?: string;
  };
  sideEffects: Array<{
    type: 'set_field' | 'set_timestamp' | 'set_user';
    field: string;
    value?: string | number | boolean;
  }>;
}

export interface ObjectTypeDefinition {
  name: string;
  displayName: string;
  description?: string;
  properties: ObjectTypeProperty[];
  linkTypes: ObjectTypeLinkType[];
  actions: ObjectTypeAction[];
  storageBackend?: string;
  status: 'draft' | 'published' | 'deprecated';
}

/**
 * Find the project root by walking up from cwd looking for eai.config.ts
 * or src/eai.config/object-types.ts (Vertical-Template convention).
 */
export async function findProjectRoot(from?: string): Promise<string | null> {
  let dir = from || process.cwd();
  const root = resolve('/');

  while (dir !== root) {
    // Check for eai.config.ts at project root (CLI convention)
    try {
      await access(join(dir, 'eai.config.ts'));
      return dir;
    } catch { /* not here */ }

    // Check for src/eai.config/ directory (Vertical-Template convention)
    try {
      await access(join(dir, 'src', 'eai.config', 'object-types.ts'));
      return dir;
    } catch { /* not here */ }

    // Check for package.json with eai-related deps (fallback)
    try {
      await access(join(dir, 'package.json'));
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'));
      if (pkg.dependencies?.['@eai-tools/platform-sdk'] ||
          pkg.dependencies?.['@eai-tools/core']) {
        return dir;
      }
    } catch { /* not here */ }

    dir = resolve(dir, '..');
  }

  return null;
}

/**
 * Load object types from the project's object-types.ts file.
 *
 * Strips TypeScript-specific syntax (type annotations, interfaces, enums,
 * import/export type statements) and evaluates the resulting JS.
 */
export async function loadObjectTypes(
  projectRoot: string,
): Promise<Record<string, ObjectTypeDefinition[]>> {
  // Try src/eai.config/object-types.ts (Vertical-Template convention)
  let objectTypesPath = join(projectRoot, 'src', 'eai.config', 'object-types.ts');
  try {
    await access(objectTypesPath);
  } catch {
    // Try eai.config/object-types.ts
    objectTypesPath = join(projectRoot, 'eai.config', 'object-types.ts');
    try {
      await access(objectTypesPath);
    } catch {
      throw new Error(
        `No object-types.ts found. Expected at:\n` +
        `  ${join(projectRoot, 'src', 'eai.config', 'object-types.ts')}\n` +
        `  ${join(projectRoot, 'eai.config', 'object-types.ts')}`,
      );
    }
  }

  const source = await readFile(objectTypesPath, 'utf-8');

  // Strip TypeScript constructs to produce evaluable JS
  const jsSource = stripTypeScript(source);

  // Write to a temp .mjs file and import it
  const tempFile = join(tmpdir(), `eai-object-types-${randomUUID()}.mjs`);
  try {
    await writeFile(tempFile, jsSource, 'utf-8');
    const module = await import(tempFile);
    return module.objectTypes || module.default?.objectTypes || {};
  } finally {
    try { await unlink(tempFile); } catch { /* cleanup best-effort */ }
  }
}

/**
 * Load environment variables from the project's .env.local file.
 */
export async function loadEnvFile(projectRoot: string): Promise<Record<string, string>> {
  const envPath = join(projectRoot, '.env.local');
  try {
    const content = await readFile(envPath, 'utf-8');
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

/**
 * Merge key=value pairs into an existing .env.local, updating existing keys
 * in-place and appending new ones. All other lines (comments, blanks) are
 * preserved unchanged.
 */
export async function patchEnvFile(
  projectRoot: string,
  patches: Record<string, string>,
): Promise<void> {
  const envPath = join(projectRoot, '.env.local');
  let content: string;

  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    // File doesn't exist — create it from the patches alone
    const lines = Object.entries(patches).map(([k, v]) => `${k}=${v}`);
    await writeFile(envPath, lines.join('\n') + '\n', 'utf-8');
    return;
  }

  const patchKeys = Object.keys(patches);
  const patched = new Set<string>();

  const updatedLines = content.split('\n').map((line) => {
    for (const key of patchKeys) {
      if (line.startsWith(`${key}=`) || line === key) {
        patched.add(key);
        return `${key}=${patches[key]}`;
      }
    }
    return line;
  });

  for (const key of patchKeys) {
    if (!patched.has(key)) {
      updatedLines.push(`${key}=${patches[key]}`);
    }
  }

  await writeFile(envPath, updatedLines.join('\n'), 'utf-8');
}

/**
 * Strip TypeScript-specific syntax to produce evaluable JS.
 * Based on Vertical-Template's generate-object-types-json.mjs approach.
 */
function stripTypeScript(source: string): string {
  let js = source;

  // Remove import statements
  js = js.replace(/^import\s+.*$/gm, '');

  // Remove export type / export interface blocks
  js = js.replace(/^export\s+type\s+\w+\s*=\s*[^;]+;/gm, '');
  js = js.replace(/^export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  js = js.replace(/^interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  js = js.replace(/^type\s+\w+\s*=\s*[^;]+;/gm, '');

  // Remove type annotations from variable declarations: `: TypeName` after identifiers
  // e.g., `const x: Record<string, Foo[]> = {` → `const x = {`
  js = js.replace(/:\s*(?:Record|Array|Map|Set)<[^>]+>(?:\[\])?(?:\s*=)/g, ' =');
  js = js.replace(/:\s*\w+(?:\[\])?\s*(?==)/g, ' =');

  // Remove `as const` assertions
  js = js.replace(/\s+as\s+const/g, '');

  // Change `export const` to just `export const` (keep for module)
  // Actually, wrap in an export for ESM
  js = js.replace(/^export\s+const\s+/gm, 'export const ');

  return js;
}

