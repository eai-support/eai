import type { BlockCatalog, BlockCatalogEntry, ValidationResult } from './block-catalog-types.js';
import { asRecord, readString } from './block-catalog-utils.js';
import {
  normalizeBlockEntry,
  readBackendCoupling,
  readPackageLane,
  readPackageProfiles,
  readPublicReadiness,
} from './block-catalog-normalize.js';

export function validateCatalog(catalog: BlockCatalog, strict: boolean): ValidationResult {
  return strict && catalog.validation.warnings.length > 0
    ? {
        valid: false,
        errors: [...catalog.validation.errors, ...catalog.validation.warnings],
        warnings: catalog.validation.warnings,
      }
    : catalog.validation;
}

export function validateManifest(value: unknown, strict: boolean): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifest = asRecord(value);

  if (!manifest) {
    return { valid: false, errors: ['Manifest must be a JSON object'], warnings };
  }
  if (typeof manifest.schemaVersion !== 'string') {
    errors.push('Manifest must include schemaVersion');
  }
  if (typeof manifest.packageName !== 'string') {
    errors.push('Manifest must include packageName');
  }
  if (!Array.isArray(manifest.blocks)) {
    errors.push('Manifest must include blocks array');
  }

  const entries = Array.isArray(manifest.blocks)
    ? manifest.blocks
        .map((rawBlock, index) => {
          validateRawBlock(rawBlock, index, errors, warnings);
          return normalizeBlockEntry(rawBlock, {
            packageName: readString(manifest, 'packageName') ?? 'manifest',
            packageVersion: readString(manifest, 'packageVersion'),
            packageLane: readPackageLane(manifest.packageLane),
            packageProfiles: readPackageProfiles(manifest.packageProfiles ?? manifest.packageProfile),
            source: { type: 'workspace' },
            catalogMetadata: asRecord(manifest.catalog) ?? undefined,
            index,
          });
        })
        .filter((entry): entry is BlockCatalogEntry => Boolean(entry))
    : [];

  const entryResult = validateEntries(entries, strict);
  const result = {
    valid: errors.length === 0 && entryResult.errors.length === 0,
    errors: [...errors, ...entryResult.errors],
    warnings: [...warnings, ...entryResult.warnings],
  };

  return strict && result.warnings.length > 0
    ? { valid: false, errors: [...result.errors, ...result.warnings], warnings: result.warnings }
    : result;
}

export function validateEntries(blocks: BlockCatalogEntry[], strict: boolean): ValidationResult {
  const seen = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const entry of blocks) {
    for (const field of ['id', 'title', 'packageName', 'importPath', 'exportName', 'packageLane', 'backendCoupling'] as const) {
      if (!entry[field]) {
        errors.push(`${entry.id || '<unknown>'} is missing ${field}`);
      }
    }
    if (seen.has(entry.id)) {
      errors.push(`Duplicate block id "${entry.id}"`);
    }
    seen.add(entry.id);
    if (entry.backendCoupling !== 'external-safe' && entry.requiredResources.length === 0) {
      warnings.push(`${entry.id} has ${entry.backendCoupling} coupling but no requiredResources metadata`);
    }
    if (entry.publicReadiness === 'public-ready' && entry.packageProfiles.length === 1 && entry.packageProfiles[0] === 'internal') {
      warnings.push(`${entry.id} is public-ready but only lists the internal package profile`);
    }
  }

  return {
    valid: errors.length === 0 && (!strict || warnings.length === 0),
    errors: strict ? [...errors, ...warnings] : errors,
    warnings,
  };
}

function validateRawBlock(rawBlock: unknown, index: number, errors: string[], warnings: string[]): void {
  const blockRecord = asRecord(rawBlock);
  const prefix = `blocks[${index}]`;
  if (!blockRecord) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  for (const field of ['id', 'title', 'exportName'] as const) {
    if (typeof blockRecord[field] !== 'string' || blockRecord[field].trim() === '') {
      errors.push(`${prefix} is missing ${field}`);
    }
  }
  if (blockRecord.packageLane !== undefined && !readPackageLane(blockRecord.packageLane)) {
    errors.push(`${prefix} has invalid packageLane "${String(blockRecord.packageLane)}"`);
  }
  if (blockRecord.backendCoupling !== undefined && !readBackendCoupling(blockRecord.backendCoupling)) {
    errors.push(`${prefix} has invalid backendCoupling "${String(blockRecord.backendCoupling)}"`);
  }
  if (blockRecord.publicReadiness !== undefined && !readPublicReadiness(blockRecord.publicReadiness)) {
    errors.push(`${prefix} has invalid publicReadiness "${String(blockRecord.publicReadiness)}"`);
  }

  const profiles = blockRecord.packageProfiles ?? blockRecord.packageProfile ?? blockRecord.profiles ?? blockRecord.profile;
  if (profiles !== undefined && !readPackageProfiles(profiles)) {
    errors.push(`${prefix} has invalid packageProfiles`);
  }
  for (const field of ['requiredResources', 'dataBindings', 'actionBindings', 'overridePoints'] as const) {
    if (blockRecord[field] !== undefined && !Array.isArray(blockRecord[field])) {
      warnings.push(`${prefix}.${field} should be an array`);
    }
  }
}
