import { createHash } from 'node:crypto';

export const APPLICATION_PACKAGE_SCHEMA_VERSION = 'eai.application-package.v1';
export const APP_CAPABILITY_SCHEMA_VERSION = 'eai.app_capabilities.v1';
export const CANONICALIZER_ID = 'eai.canonical-json/v1';

const OBJECT_TYPE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RAW_SECRET = /^(?:sk-|ghp_|github_pat_|eyJ)[A-Za-z0-9_.-]{16,}$/u;
const PACKAGE_FORBIDDEN_KEYS = /^(?:tenantId|tenant_id|buyerTenantId|buyer_tenant_id|secret|token|password|credential|connectionString|apiKey|clientSecret|accessToken|refreshToken|privateKey)$/u;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function comparable(value) {
  return JSON.stringify(value);
}

function typeMatches(type, value) {
  if (type === 'object') return isObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function branchIsValid(schema, value) {
  return validateAgainstSchema(schema, value).length === 0;
}

/** Validate the closed Draft 2020-12 subset used by the application package schema. */
export function validateAgainstSchema(schema, value, location = '$') {
  const errors = [];
  if (!isObject(schema)) return [`${location}: schema must be an object`];

  if ('const' in schema && comparable(value) !== comparable(schema.const)) {
    errors.push(`${location}: must equal ${comparable(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => comparable(item) === comparable(value))) {
    errors.push(`${location}: value is not in the allowed set`);
  }
  if (schema.type && !typeMatches(schema.type, value)) {
    return [...errors, `${location}: expected ${schema.type}`];
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) errors.push(...validateAgainstSchema(branch, value, location));
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => branchIsValid(branch, value))) {
    errors.push(`${location}: does not match any allowed shape`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch) => branchIsValid(branch, value)).length;
    if (matches !== 1) errors.push(`${location}: must match exactly one allowed shape`);
  }
  if (schema.not && branchIsValid(schema.not, value)) {
    errors.push(`${location}: matches a prohibited shape`);
  }
  if (schema.if) {
    const selected = branchIsValid(schema.if, value) ? schema.then : schema.else;
    if (selected) errors.push(...validateAgainstSchema(selected, value, location));
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location}: must contain at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${location}: must contain at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${location}: does not match the required pattern`);
    }
    if (schema.format === 'date-time' && (!value.includes('T') || Number.isNaN(Date.parse(value)))) {
      errors.push(`${location}: must be an RFC 3339 date-time`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${location}: must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${location}: must be at most ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${location}: must be greater than ${schema.exclusiveMinimum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location}: must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${location}: must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems && new Set(value.map(comparable)).size !== value.length) {
      errors.push(`${location}: items must be unique`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateAgainstSchema(schema.items, item, `${location}[${index}]`));
      });
    }
  }

  if (isObject(value)) {
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(`${location}: missing required property ${required}`);
    }
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = schema.properties?.[key];
      if (propertySchema) {
        errors.push(...validateAgainstSchema(propertySchema, item, `${location}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${location}: additional property ${key} is not allowed`);
      } else if (isObject(schema.additionalProperties)) {
        errors.push(...validateAgainstSchema(schema.additionalProperties, item, `${location}.${key}`));
      }
    }
  }

  return errors;
}

function inspectPackageSecrets(value, location, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPackageSecrets(item, `${location}[${index}]`, errors));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const itemLocation = `${location}.${key}`;
    if (PACKAGE_FORBIDDEN_KEYS.test(key)) {
      errors.push(`${itemLocation}: tenant-specific or credential values are prohibited`);
      continue;
    }
    if (typeof item === 'string' && RAW_SECRET.test(item)) {
      errors.push(`${itemLocation}: raw secret-like value is prohibited`);
      continue;
    }
    inspectPackageSecrets(item, itemLocation, errors);
  }
}

/** Validate schema plus immutable hosting, identity and transport invariants. */
export function validateApplicationPackageContract(schema, value) {
  const errors = validateAgainstSchema(schema, value);
  inspectPackageSecrets(value, '$', errors);
  if (!isObject(value)) return [...new Set(errors)];

  const capabilities = value.capabilities;
  if (isObject(capabilities)) {
    for (const [kind, entries] of Object.entries(capabilities)) {
      if (Array.isArray(entries) && entries.some((entry) => typeof entry === 'string' && entry.includes('*'))) {
        errors.push(`$.capabilities.${kind}: wildcard capabilities are prohibited`);
      }
    }
  }

  const artifact = value.artifact;
  if (isObject(artifact)) {
    if (typeof artifact.digest !== 'string' || !SHA256_DIGEST.test(artifact.digest)) {
      errors.push('$.artifact.digest: immutable lowercase sha256 digest is required');
    }
    if (typeof artifact.repository === 'string' && /:(?:latest|main|dev|test|prod)$/iu.test(artifact.repository)) {
      errors.push('$.artifact.repository: mutable tags are prohibited');
    }
  }

  const runtime = value.runtime;
  const distribution = value.distribution;
  const publisher = value.publisher;
  if (isObject(runtime) && isObject(distribution) && isObject(publisher)) {
    if (runtime.type === 'trusted-embedded') {
      if (publisher.kind !== 'eai' || distribution.visibility !== 'first-party') {
        errors.push('$.runtime: trusted embedded hosting is restricted to EAI first-party packages');
      }
      if (runtime.topology !== 'eai-owned-embedded' || typeof runtime.staticImport !== 'string') {
        errors.push('$.runtime: trusted embedded packages require the static EAI import allowlist');
      }
    }
    if (runtime.type === 'isolated-hosted') {
      if (!['eai-hosted', 'buyer-hosted'].includes(runtime.topology)) {
        errors.push('$.runtime.topology: V1 isolated hosting must be EAI-hosted or buyer-hosted');
      }
      if ('staticImport' in runtime || 'entrypoint' in runtime) {
        errors.push('$.runtime: isolated packages cannot declare dynamic package imports');
      }
    }
    if (distribution.visibility === 'distributable' && runtime.type !== 'isolated-hosted') {
      errors.push('$.distribution: customer/partner distributable packages must be isolated-hosted');
    }
  }

  if (Array.isArray(value.objectTypes)) {
    for (const [index, objectType] of value.objectTypes.entries()) {
      if (!isObject(objectType) || typeof objectType.slug !== 'string' || !OBJECT_TYPE_SLUG.test(objectType.slug)) {
        errors.push(`$.objectTypes[${index}].slug: exact stored kebab-case transport slug is required`);
      }
    }
  }
  return [...new Set(errors)];
}

/** Serialize JSON with recursively sorted object keys and no ambient whitespace. */
export function canonicalizeJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Return the lowercase content digest of canonical JSON bytes. */
export function digestCanonicalJson(value) {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex')}`;
}

/** Materialize a fixture case from one canonical base without hiding mutations. */
export function materializeFixture(baseValue, fixture) {
  const value = JSON.parse(JSON.stringify(baseValue));
  for (const dottedPath of fixture.delete ?? []) {
    const segments = dottedPath.split('.');
    const key = segments.pop();
    let target = value;
    for (const segment of segments) target = target?.[segment];
    if (isObject(target) && key) delete target[key];
  }
  for (const [dottedPath, replacement] of Object.entries(fixture.set ?? {})) {
    const segments = dottedPath.split('.');
    const key = segments.pop();
    let target = value;
    for (const segment of segments) {
      if (!isObject(target[segment])) target[segment] = {};
      target = target[segment];
    }
    if (key) target[key] = replacement;
  }
  return value;
}
