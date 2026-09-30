import type { GeneratedDemoArtifact } from './contract';
import { demoArtifactDigest } from './runtime-contract';

export interface GeneratedOperationalBinding {
  fixtureCollection: string;
  objectTypeSlug: string;
  maxRows: number;
}

interface GeneratedOperationalBase {
  tenantId: string;
  appKey: string;
  acceptedArtifactDigest: `sha256:${string}`;
  readBindings: [GeneratedOperationalBinding];
}

export interface GeneratedOperationalReadConfig extends GeneratedOperationalBase {
  schemaVersion: 'eai.generated_app_operational.v1';
  actionsMode: 'simulated';
}

export interface GeneratedOperationalCreateConfig extends GeneratedOperationalBase {
  schemaVersion: 'eai.generated_app_operational.v2';
  actionsMode: 'selected-create';
  createBinding: { objectTypeSlug: string; fields: string[] };
}

export type GeneratedOperationalConfig = GeneratedOperationalReadConfig | GeneratedOperationalCreateConfig;

export interface GeneratedOperationalCreateField {
  name: string;
  type: 'text' | 'number' | 'boolean';
  required: boolean;
}

export type GeneratedOperationalResolution =
  | { status: 'unconfigured' }
  | { status: 'invalid'; errors: string[] }
  | { status: 'ready'; config: GeneratedOperationalConfig; projectedFields: string[];
      createFields: GeneratedOperationalCreateField[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const FORBIDDEN_FIELD = /password|secret|token|credential|api.?key|private|ssn|(?:authorization|url|uri|endpoint|key)$/i;
const RESERVED_FIELD = new Set(['id', '__proto__', 'prototype', 'constructor']);
const SCALAR_TYPES = new Set(['text', 'number', 'boolean', 'date', 'select']);
const CREATE_TYPES = new Set(['text', 'number', 'boolean']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

/** Operational authority is separate from immutable demo source and matches its accepted bytes. */
export function resolveGeneratedOperationalRuntime(
  value: unknown,
  artifact: GeneratedDemoArtifact,
  expectedTenantId: string | undefined,
  expectedAppKey: string,
): GeneratedOperationalResolution {
  if (value === null || value === undefined) return { status: 'unconfigured' };
  const errors: string[] = [];
  if (!record(value)) return { status: 'invalid', errors: ['operational config shape is invalid'] };
  const createMode = value.schemaVersion === 'eai.generated_app_operational.v2';
  if (!exactKeys(value, [
    'schemaVersion', 'tenantId', 'appKey', 'acceptedArtifactDigest',
    'readBindings', 'actionsMode', ...(createMode ? ['createBinding'] : []),
  ])) return { status: 'invalid', errors: ['operational config shape is invalid'] };
  if (!createMode && value.schemaVersion !== 'eai.generated_app_operational.v1')
    errors.push('operational schema is unsupported');
  if (!expectedTenantId || !UUID.test(expectedTenantId) || value.tenantId !== expectedTenantId)
    errors.push('tenant binding does not match deployed identity');
  if (value.appKey !== expectedAppKey || value.appKey !== artifact.appDefinition.appKey)
    errors.push('app binding does not match accepted artifact');
  if (
    typeof value.acceptedArtifactDigest !== 'string' ||
    !DIGEST.test(value.acceptedArtifactDigest) ||
    value.acceptedArtifactDigest !== demoArtifactDigest(artifact)
  ) errors.push('accepted artifact digest does not match');
  if (value.actionsMode !== (createMode ? 'selected-create' : 'simulated'))
    errors.push('operational actions are unsupported');
  const bindingValue = Array.isArray(value.readBindings) && value.readBindings.length === 1
    ? value.readBindings[0] : null;
  if (!record(bindingValue)) {
    errors.push('exactly one reviewed read binding is required');
  } else {
    const binding = bindingValue;
    if (!exactKeys(binding, ['fixtureCollection', 'objectTypeSlug', 'maxRows']) ||
        typeof binding.fixtureCollection !== 'string' ||
        !SLUG.test(binding.fixtureCollection) ||
        !(binding.fixtureCollection in artifact.previewFixtures.collections) ||
        typeof binding.objectTypeSlug !== 'string' ||
        !SLUG.test(binding.objectTypeSlug) ||
        !artifact.objectTypeDefinitions.some((item) => item.slug === binding.objectTypeSlug) ||
        typeof binding.maxRows !== 'number' || !Number.isInteger(binding.maxRows) ||
        binding.maxRows < 1 || binding.maxRows > 50) {
      errors.push('read binding is not a bounded accepted Object Type');
    }
  }
  const projectedFields: string[] = [];
  const createFields: GeneratedOperationalCreateField[] = [];
  if (errors.length === 0 && record(bindingValue)) {
    const definitions = artifact.objectTypeDefinitions.filter((item) => item.slug === bindingValue.objectTypeSlug);
    const properties = definitions[0]?.properties;
    if (definitions.length !== 1 || !Array.isArray(properties) || properties.length > 100) {
      errors.push('operational read has no unambiguous accepted property declaration');
    } else {
      for (const property of properties) {
        if (!record(property) || (property.serverOnly !== undefined && typeof property.serverOnly !== 'boolean')) {
          errors.push('operational property declaration is invalid');
          break;
        }
        if (property.serverOnly === true || !SCALAR_TYPES.has(String(property.type))) continue;
        const name = property.name;
        if (typeof name !== 'string' || !FIELD_NAME.test(name) ||
            RESERVED_FIELD.has(name.toLowerCase()) ||
            FORBIDDEN_FIELD.test(name) || projectedFields.includes(name)) {
          errors.push('operational field projection is unsafe');
          break;
        }
        projectedFields.push(name);
      }
      if (projectedFields.length === 0 || projectedFields.length > 16)
        errors.push('operational field projection must contain 1 to 16 safe scalar fields');
    }
  }
  if (createMode && errors.length === 0 && record(bindingValue)) {
    const createBinding = value.createBinding;
    const definition = artifact.objectTypeDefinitions.find((item) => item.slug === bindingValue.objectTypeSlug);
    const properties = definition?.properties;
    if (!record(createBinding) ||
        !exactKeys(createBinding, ['objectTypeSlug', 'fields']) ||
        createBinding.objectTypeSlug !== bindingValue.objectTypeSlug ||
        !Array.isArray(createBinding.fields) ||
        createBinding.fields.length < 1 || createBinding.fields.length > 16 ||
        new Set(createBinding.fields).size !== createBinding.fields.length ||
        !Array.isArray(properties)) {
      errors.push('selected create binding is invalid');
    } else {
      for (const field of createBinding.fields) {
        const matching = properties.filter((item) => record(item) && item.name === field);
        const property = matching[0];
        if (typeof field !== 'string' || !FIELD_NAME.test(field) ||
            RESERVED_FIELD.has(field.toLowerCase()) || FORBIDDEN_FIELD.test(field) ||
            matching.length !== 1 || !record(property) || property.serverOnly === true ||
            !CREATE_TYPES.has(String(property.type)) ||
            (property.required !== undefined && typeof property.required !== 'boolean')) {
          errors.push('selected create field is not an accepted writable scalar');
          break;
        }
        createFields.push({ name: field, type: property.type as GeneratedOperationalCreateField['type'],
          required: property.required === true });
      }
      if (errors.length === 0 && properties.some((item) =>
        record(item) && item.required === true &&
        !createFields.some((field) => field.name === item.name)))
        errors.push('selected create omits a required accepted field');
    }
  }
  return errors.length
    ? { status: 'invalid', errors }
    : { status: 'ready', config: value as unknown as GeneratedOperationalConfig, projectedFields, createFields };
}
