import type { AppCapabilityRequirements } from "./capability-control-plane.js";
import { isRecord } from "./utils.js";

const SCHEMA_VERSION = "eai.app_capabilities.v1";
const LOGICAL_KEY = /^[A-Za-z][A-Za-z0-9._-]*$/;
const RAW_RECORD_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const SUPPORTED_CAPABILITIES = new Set([
  "ai.chat",
  "ai.profiles",
  "document-checklists",
  "document-intelligence",
  "documents",
  "integrations",
  "knowledge",
  "shared-assets",
  "templates.documents",
  "templates.email",
  "workflows.runtime",
]);

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${field} contains unsupported or missing fields.`);
  }
}

function logicalKey(value: unknown, field: string, maxLength: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !LOGICAL_KEY.test(normalized) ||
    normalized.length > maxLength ||
    RAW_RECORD_ID.test(normalized)
  ) {
    throw new Error(`${field} must be a bounded logical key.`);
  }
  return normalized;
}

function logicalList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error(`${field} must be an array of at most 20 logical keys.`);
  }
  const items = value.map((item, index) => {
    const raw = typeof item === "string" ? item.trim() : "";
    const wildcard = raw.endsWith("*");
    return `${logicalKey(wildcard ? raw.slice(0, -1) : raw, `${field}[${index}]`, 120)}${wildcard ? "*" : ""}`;
  });
  if (new Set(items).size !== items.length)
    throw new Error(`${field} must not contain duplicates.`);
  return items;
}

/** Validate the complete source-controlled manifest before it crosses the CLI boundary. */
export function validateAppCapabilityRequirements(
  value: unknown,
): AppCapabilityRequirements {
  if (!isRecord(value))
    throw new Error("Capability requirements must be an object.");
  exactKeys(
    value,
    ["schemaVersion", "appKey", "requirements"],
    "Capability requirements",
  );
  if (value.schemaVersion !== SCHEMA_VERSION)
    throw new Error("Capability requirements schema is unsupported.");
  const appKey = logicalKey(value.appKey, "appKey", 120);
  if (
    !Array.isArray(value.requirements) ||
    value.requirements.length < 1 ||
    value.requirements.length > 100
  ) {
    throw new Error(
      "Capability requirements must contain between 1 and 100 entries.",
    );
  }

  const aliases = new Set<string>();
  const requirements = value.requirements.map((candidate, index) => {
    if (!isRecord(candidate))
      throw new Error(`Capability requirement ${index} must be an object.`);
    const allowedKeys = ["alias", "capability", "required", "description"];
    if (candidate.compatibleProviders !== undefined)
      allowedKeys.push("compatibleProviders");
    if (candidate.compatibleAssetTypes !== undefined)
      allowedKeys.push("compatibleAssetTypes");
    exactKeys(candidate, allowedKeys, `Capability requirement ${index}`);
    const alias = logicalKey(
      candidate.alias,
      `Capability requirement ${index} alias`,
      120,
    );
    if (aliases.has(alias))
      throw new Error(`Duplicate capability alias: ${alias}.`);
    aliases.add(alias);
    const capability = logicalKey(
      candidate.capability,
      `Capability requirement ${index} capability`,
      160,
    );
    if (!SUPPORTED_CAPABILITIES.has(capability))
      throw new Error(`Capability requirement ${index} is unsupported.`);
    if (typeof candidate.required !== "boolean")
      throw new Error(
        `Capability requirement ${index} required must be boolean.`,
      );
    if (
      typeof candidate.description !== "string" ||
      !candidate.description.trim() ||
      candidate.description.trim().length > 500
    ) {
      throw new Error(
        `Capability requirement ${index} description must contain 1 to 500 characters.`,
      );
    }
    const compatibleProviders = logicalList(
      candidate.compatibleProviders,
      `Capability requirement ${index} compatibleProviders`,
    );
    const compatibleAssetTypes = logicalList(
      candidate.compatibleAssetTypes,
      `Capability requirement ${index} compatibleAssetTypes`,
    );
    return {
      alias,
      capability,
      required: candidate.required,
      description: candidate.description.trim(),
      ...(compatibleProviders ? { compatibleProviders } : {}),
      ...(compatibleAssetTypes ? { compatibleAssetTypes } : {}),
    };
  });
  return { schemaVersion: SCHEMA_VERSION, appKey, requirements };
}
