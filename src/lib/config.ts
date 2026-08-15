/**
 * Config loader — reads eai.config.ts from project root.
 *
 * Uses a lightweight approach: transpile TypeScript to JS using Node's
 * native import() with a temporary .mjs file. This avoids requiring
 * ts-node or tsx as dependencies.
 */

import { readFile, writeFile, unlink, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  ObjectTypeIdentifierError,
  isCanonicalObjectTypeSlug,
  validateObjectTypeIdentifierPair,
} from './object-type-identifiers.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ObjectTypeProperty {
  name: string;
  type:
    | "text"
    | "number"
    | "boolean"
    | "date"
    | "select"
    | "json"
    | "file"
    | "relationship";
  required: boolean;
  indexed?: boolean;
  defaultValue?: JsonValue;
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

export interface ObjectTypeLinkType {
  name: string;
  /**
   * Exact stored Object Type slug used on relationship routes. A same-manifest
   * model name is accepted only as source input and resolved before transport.
   */
  targetObjectType: string;
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  cascadeDelete?: boolean;
}

export interface ObjectTypeAction {
  name: string;
  displayName: string;
  requiredRole: "tenant-viewer" | "tenant-builder" | "tenant-admin";
  validationRules: {
    requiredFields?: string[];
    requiredStatus?: string | string[];
  };
  sideEffects: Array<{
    type: "set_field" | "set_timestamp" | "set_user";
    field: string;
    value?: string | number | boolean;
  }>;
}

export interface StorageIndexDefinition {
  name?: string;
  fields: string[] | Array<Record<string, unknown>> | Record<string, unknown>;
  unique?: boolean;
}

export interface SqlStorageBinding {
  databaseAlias: string;
  tenantSchemaStrategy:
    | "per-tenant-schema"
    | "shared-schema"
    | "per-tenant-database";
  schemaName?: string;
  tableName: string;
  indexes?: StorageIndexDefinition[];
}

export interface DocumentDbStorageBinding {
  databaseAlias: string;
  databaseName: string;
  collectionName: string;
  partitionKey: string;
  indexes?: StorageIndexDefinition[];
}

export interface BlobStorageBinding {
  storageAccountAlias: string;
  containerName: string;
  blobPrefix?: string;
  metadataSchema?: Record<string, unknown>;
}

export interface SearchStorageBinding {
  searchServiceAlias: string;
  indexName: string;
  sourceObjectTypes?: string[];
  fieldMappings?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export interface StorageBindingDefinition {
  sql?: SqlStorageBinding;
  documentdb?: DocumentDbStorageBinding;
  blob?: BlobStorageBinding;
  search?: SearchStorageBinding;
}

export interface ObjectTypeDefinition {
  /** PascalCase configuration/model identifier; never emitted as a v4 slug. */
  name: string;
  /** Exact stored transport identifier; required for new source, legacy-readable here. */
  slug?: string;
  displayName: string;
  description?: string;
  properties: ObjectTypeProperty[];
  linkTypes: ObjectTypeLinkType[];
  actions: ObjectTypeAction[];
  storageBackend?: string;
  schemaVersion?: number;
  storageMetadataStatus?: "draft" | "ready";
  storageBinding?: StorageBindingDefinition;
  provisioningHints?: Record<string, unknown>;
  status: "draft" | "published" | "deprecated";
}

/**
 * Resolve relationship model names through the exact slug declared in the
 * same manifest; already-canonical external slugs pass through unchanged.
 */
export function canonicalizeObjectTypeRelationshipTargets(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
): Record<string, ObjectTypeDefinition[]> {
  return Object.fromEntries(
    Object.entries(objectTypes).map(([tenantKey, types]) => {
      const slugByName = new Map(
        types
          .filter(
            (type): type is ObjectTypeDefinition & { slug: string } =>
              typeof type.slug === "string" && type.slug.length > 0,
          )
          .map((type) => [type.name, type.slug]),
      );

      return [
        tenantKey,
        types.map((type) => ({
          ...type,
          linkTypes: type.linkTypes.map((link) => {
            const declaredSlug = slugByName.get(link.targetObjectType);
            if (declaredSlug) {
              return { ...link, targetObjectType: declaredSlug };
            }
            if (isCanonicalObjectTypeSlug(link.targetObjectType)) {
              return { ...link };
            }
            throw new ObjectTypeIdentifierError(
              "OBJECT_TYPE_LINK_TARGET_UNRESOLVED",
              `OBJECT_TYPE_LINK_TARGET_UNRESOLVED: [${tenantKey}/${type.name}/${link.name}] Relationship target "${link.targetObjectType}" must be an exact canonical slug or the name of an Object Type declared in the same manifest.`,
            );
          }),
        })),
      ];
    }),
  );
}

/** Validate new local source definitions before any CLI write or provision action. */
export function validateObjectTypeDefinitions(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
): void {
  for (const [tenantKey, types] of Object.entries(objectTypes)) {
    for (const type of types) {
      try {
        validateObjectTypeIdentifierPair(
          { name: type.name, slug: type.slug },
          { requireExplicitSlug: true },
        );
      } catch (error) {
        if (error instanceof ObjectTypeIdentifierError) {
          throw new Error(
            `[${tenantKey}/${type.name}] ${error.code}: ${error.message}`,
            { cause: error },
          );
        }
        throw error;
      }
    }
  }

  canonicalizeObjectTypeRelationshipTargets(objectTypes);
}

/**
 * Find the project root by walking up from cwd looking for eai.config.ts
 * or src/eai.config/object-types.ts (eai-app-template convention).
 */
export async function findProjectRoot(from?: string): Promise<string | null> {
  let dir = from || process.cwd();
  const root = resolve("/");

  while (dir !== root) {
    // Check for eai.config.ts at project root (CLI convention)
    try {
      await access(join(dir, "eai.config.ts"));
      return dir;
    } catch {
      /* not here */
    }

    // Check for src/eai.config/ directory (eai-app-template convention)
    try {
      await access(join(dir, "src", "eai.config", "object-types.ts"));
      return dir;
    } catch {
      /* not here */
    }

    // Provider-neutral EAI app runtime contract.
    try {
      await access(join(dir, "eai.runtime.json"));
      return dir;
    } catch {
      /* not here */
    }

    // Check for package.json with eai-related deps (fallback)
    try {
      await access(join(dir, "package.json"));
      const pkg = JSON.parse(
        await readFile(join(dir, "package.json"), "utf-8"),
      );
      if (
        pkg.dependencies?.["@enterpriseaigroup/platform-sdk"] ||
        pkg.dependencies?.["@eai-tools/platform-sdk"] ||
        pkg.dependencies?.["@eai-tools/core"]
      ) {
        return dir;
      }
    } catch {
      /* not here */
    }

    dir = resolve(dir, "..");
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
  // Try src/eai.config/object-types.ts (eai-app-template convention)
  let objectTypesPath = join(
    projectRoot,
    "src",
    "eai.config",
    "object-types.ts",
  );
  try {
    await access(objectTypesPath);
  } catch {
    // Try eai.config/object-types.ts
    objectTypesPath = join(projectRoot, "eai.config", "object-types.ts");
    try {
      await access(objectTypesPath);
    } catch {
      throw new Error(
        `No object-types.ts found. Expected at:\n` +
          `  ${join(projectRoot, "src", "eai.config", "object-types.ts")}\n` +
          `  ${join(projectRoot, "eai.config", "object-types.ts")}`,
      );
    }
  }

  const source = await readFile(objectTypesPath, "utf-8");

  // Strip TypeScript constructs to produce evaluable JS
  const jsSource = stripTypeScript(source);

  // Write to a temp .mjs file and import it
  const tempFile = join(tmpdir(), `eai-object-types-${randomUUID()}.mjs`);
  const evaluationEnv = await loadObjectTypeEvaluationEnv(projectRoot);
  const restoredEnv = applyTemporaryEnv(evaluationEnv);
  try {
    await writeFile(tempFile, jsSource, "utf-8");
    const module = await import(pathToFileURL(tempFile).href);
    return module.objectTypes || module.default?.objectTypes || {};
  } finally {
    restoreTemporaryEnv(restoredEnv);
    try {
      await unlink(tempFile);
    } catch {
      /* cleanup best-effort */
    }
  }
}

type TemporaryEnvRestore = Array<[string, string | undefined]>;

async function loadObjectTypeEvaluationEnv(
  projectRoot: string,
): Promise<Record<string, string>> {
  const safeEnvNames = new Set([
    "EAI_TENANT_ID",
    "NEXT_PUBLIC_EAI_TENANT_ID",
    "EAI_APP_KEY",
    "NEXT_PUBLIC_EAI_APP_KEY",
    "NEXT_PUBLIC_APP_NAME",
    "EAI_STORAGE_TABLE_PREFIX",
    "EAI_STORAGE_CONTAINER_PREFIX",
    "EAI_STORAGE_COLLECTION_PREFIX",
    "EAI_STORAGE_INDEX_PREFIX",
  ]);
  const env = await loadEnvFile(projectRoot);
  const safeEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => safeEnvNames.has(key)),
  );

  try {
    const contractPath = join(projectRoot, ".eai", "storage-bindings.json");
    const contract = JSON.parse(await readFile(contractPath, "utf-8"));
    if (contract && typeof contract === "object") {
      const data = contract as Record<string, unknown>;
      const prefixes = data.storageNamePrefixes;
      if (typeof data.tenantId === "string") {
        safeEnv.EAI_TENANT_ID = data.tenantId;
        safeEnv.NEXT_PUBLIC_EAI_TENANT_ID = data.tenantId;
      }
      if (typeof data.appKey === "string") {
        safeEnv.EAI_APP_KEY = data.appKey;
        safeEnv.NEXT_PUBLIC_EAI_APP_KEY = data.appKey;
      }
      if (prefixes && typeof prefixes === "object") {
        const prefixData = prefixes as Record<string, unknown>;
        if (typeof prefixData.sql === "string") {
          safeEnv.EAI_STORAGE_TABLE_PREFIX = prefixData.sql;
        }
        if (typeof prefixData.blob === "string") {
          safeEnv.EAI_STORAGE_CONTAINER_PREFIX = prefixData.blob;
        }
        if (typeof prefixData.documentdb === "string") {
          safeEnv.EAI_STORAGE_COLLECTION_PREFIX = prefixData.documentdb;
        }
        if (typeof prefixData.search === "string") {
          safeEnv.EAI_STORAGE_INDEX_PREFIX = prefixData.search;
        }
      }
    }
  } catch {
    /* No generated storage contract yet. */
  }

  return safeEnv;
}

function applyTemporaryEnv(env: Record<string, string>): TemporaryEnvRestore {
  const restore: TemporaryEnvRestore = [];
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] !== undefined) {
      continue;
    }
    restore.push([key, process.env[key]]);
    process.env[key] = value;
  }
  return restore;
}

function restoreTemporaryEnv(restore: TemporaryEnvRestore): void {
  for (const [key, value] of restore.reverse()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Load environment variables from the project's .env.local file.
 */
export async function loadEnvFile(
  projectRoot: string,
): Promise<Record<string, string>> {
  const envPath = join(projectRoot, ".env.local");
  try {
    const content = await readFile(envPath, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
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
  const envPath = join(projectRoot, ".env.local");
  let content: string;

  try {
    content = await readFile(envPath, "utf-8");
  } catch {
    // File doesn't exist — create it from the patches alone
    const lines = Object.entries(patches).map(([k, v]) => `${k}=${v}`);
    await writeFile(envPath, lines.join("\n") + "\n", "utf-8");
    return;
  }

  const patchKeys = Object.keys(patches);
  const patched = new Set<string>();

  const updatedLines = content.split("\n").map((line) => {
    for (const key of patchKeys) {
      if (line.startsWith(`${key}=`)) {
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

  const trailingNewline = content.endsWith("\n") ? "\n" : "";
  await writeFile(envPath, updatedLines.join("\n") + trailingNewline, "utf-8");
}

/**
 * Strip TypeScript-specific syntax to produce evaluable JS.
 * Based on eai-app-template's generate-object-types-json.mjs approach.
 */
function stripTypeScript(source: string): string {
  let js = source;

  // Remove import statements
  js = js.replace(/^import\s+.*$/gm, "");

  // Remove export type / export interface blocks
  js = js.replace(/^export\s+type\s+\w+\s*=\s*[^;]+;/gm, "");
  js = js.replace(/^export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/gm, "");
  js = js.replace(/^interface\s+\w+\s*\{[\s\S]*?\n\}/gm, "");
  js = js.replace(/^type\s+\w+\s*=\s*[^;]+;/gm, "");

  // Remove type annotations from variable declarations: `: TypeName` after identifiers
  // e.g., `const x: Record<string, Foo[]> = {` → `const x = {`
  js = js.replace(
    /:\s*(?:Record|Array|Map|Set)<[^>]+>(?:\[\])?(?:\s*=)/g,
    " =",
  );
  js = js.replace(/:\s*\w+(?:\[\])?\s*(?==)/g, " =");

  // Remove `as const` assertions
  js = js.replace(/\s+as\s+const/g, "");

  // Change `export const` to just `export const` (keep for module)
  // Actually, wrap in an export for ESM
  js = js.replace(/^export\s+const\s+/gm, "export const ");

  return js;
}
