#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALIDATION_SCHEMA_VERSION = 'eai.object-type-routing.validation/v1';
const CONTRACT_VERSION = 'eai.object-type-routing/v1';
const INVENTORY_SCHEMA_VERSION = 'eai.object-type-routing.inventory/v1';
const NAME_RULE = '^[A-Z][A-Za-z0-9]*$';
const SLUG_RULE = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  '..',
  '..',
  'config',
  'object-type-routing.json'
);
const DEFAULT_SCHEMA_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  '..',
  '..',
  'schemas',
  'object-type-identifier-audit-v1.schema.json'
);
const DEFAULT_CONTRACT_CANDIDATES = [
  path.resolve(SCRIPT_DIRECTORY, '..', '..', 'contracts', 'object-type-routing-v1.json'),
  path.resolve(SCRIPT_DIRECTORY, '..', 'contracts', 'object-type-routing-v1.json'),
  path.resolve(
    SCRIPT_DIRECTORY,
    '..',
    '..',
    '..',
    '..',
    'tech-docs',
    'static',
    'contracts',
    'object-type-routing-v1.json'
  ),
  path.resolve('ops/tech-docs/static/contracts/object-type-routing-v1.json'),
  path.resolve('../tech-docs/static/contracts/object-type-routing-v1.json'),
];
const SOURCE_CLASSIFICATION = 'blocking_source_drift';
const PERSISTED_CLASSIFICATION = 'report_only_persisted_legacy_drift';
const ACTIVATION_CLASSIFICATION = 'activation_blocker';
const ESTABLISHED_NAME_SLUGS = new Map([['GitHubConnection', 'github-connection']]);

const IS_DIRECT_RUN =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

class ValidationInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationInputError';
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonTypeMatches(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return isRecord(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

/** Canonical JSON is sufficient here because finding sort keys contain only JSON scalars. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Return a sorted copy; never mutate source or supplied inventory data. */
export function sortIdentifierFindings(findings) {
  return [...findings].sort((left, right) => {
    for (const [leftValue, rightValue] of [
      [left.classification, right.classification],
      [canonicalJson(left.location), canonicalJson(right.location)],
      [left.rule, right.rule],
      [left.field ?? '', right.field ?? ''],
    ]) {
      const comparison = compareText(String(leftValue), String(rightValue));
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

/** The sole Gofer JavaScript adapter for the ordered v1 algorithm. */
export function deriveObjectTypeSlugV1(value) {
  const normalizedName = String(value).replace(
    /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g,
    ''
  );
  const derivationSource = ESTABLISHED_NAME_SLUGS.get(normalizedName) ?? normalizedName;

  return derivationSource
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\t\n\v\f\r _]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/[A-Z]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) + ('a'.charCodeAt(0) - 'A'.charCodeAt(0)))
    );
}

async function readJson(file, label) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new ValidationInputError(`${label.toUpperCase()}_UNREADABLE`, `${label} is not readable.`);
  }
  try {
    return { value: JSON.parse(text), text };
  } catch {
    throw new ValidationInputError(`${label.toUpperCase()}_MALFORMED`, `${label} is not valid JSON.`);
  }
}

async function firstReadableContract(candidates) {
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      // Search only fixed local candidates; the validator never performs network discovery.
    }
  }
  throw new ValidationInputError(
    'CONTRACT_UNREADABLE',
    'canonical routing contract is not readable; supply --contract.'
  );
}

function assertContractAssets(config, schema, routing) {
  if (
    !isRecord(config) ||
    config.schemaVersion !== 'eai.object-type-routing.source-audit-config/v1' ||
    config.contractVersion !== CONTRACT_VERSION
  ) {
    throw new ValidationInputError('CONFIG_UNSUPPORTED', 'routing config is unsupported.');
  }
  if (
    !isRecord(schema) ||
    schema.$id !== 'urn:eai:schema:object-type-identifier-audit:v1' ||
    !isRecord(schema.$defs) ||
    !isRecord(schema.$defs.IdentifierFinding) ||
    !isRecord(schema.$defs.InventoryRun)
  ) {
    throw new ValidationInputError('SCHEMA_UNSUPPORTED', 'identifier audit schema is unsupported.');
  }
  if (
    !isRecord(routing) ||
    routing.contractVersion !== CONTRACT_VERSION ||
    routing.authoritativeTransportIdentifier !== 'slug' ||
    routing.name?.pattern !== NAME_RULE ||
    routing.slug?.pattern !== SLUG_RULE ||
    routing.derivation?.algorithm !== CONTRACT_VERSION ||
    routing.derivation?.establishedNameSlugs?.GitHubConnection !== 'github-connection' ||
    !Array.isArray(routing.derivation?.vectors) ||
    !Array.isArray(routing.slug?.reserved)
  ) {
    throw new ValidationInputError('CONTRACT_UNSUPPORTED', 'canonical routing contract is unsupported.');
  }
  for (const vector of routing.derivation.vectors) {
    if (
      !isRecord(vector) ||
      typeof vector.input !== 'string' ||
      typeof vector.output !== 'string' ||
      typeof vector.manifestNameValid !== 'boolean' ||
      deriveObjectTypeSlugV1(vector.input) !== vector.output
    ) {
      throw new ValidationInputError(
        'CONTRACT_VECTOR_UNSUPPORTED',
        'canonical routing corpus does not match the Gofer v1 adapter.'
      );
    }
  }
}

export async function loadIdentifierValidationContract(options = {}) {
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
  const contractPath =
    options.contractPath ?? (await firstReadableContract(DEFAULT_CONTRACT_CANDIDATES));
  const [{ value: config }, { value: schema }, { value: routing }] = await Promise.all([
    readJson(configPath, 'config'),
    readJson(schemaPath, 'schema'),
    readJson(contractPath, 'contract'),
  ]);
  assertContractAssets(config, schema, routing);

  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    config,
    auditSchema: schema,
    namePattern: new RegExp(routing.name.pattern),
    slugPattern: new RegExp(routing.slug.pattern),
    reserved: Object.freeze([...routing.slug.reserved]),
    vectors: Object.freeze(routing.derivation.vectors.map((vector) => Object.freeze({ ...vector }))),
  });
}

function sourceLocation(location, field) {
  return {
    kind: 'source',
    file: location?.file ?? 'object-type-manifest.json',
    line: location?.line ?? 1,
    ...(location?.column ? { column: location.column } : {}),
    field,
  };
}

function sourceFinding(contract, location, rule, field, offendingValue, expectedValue, remediation) {
  const normalized = sourceLocation(location, field);
  return {
    contractVersion: contract.contractVersion,
    rule,
    classification: SOURCE_CLASSIFICATION,
    severity: 'error',
    location: {
      kind: normalized.kind,
      file: normalized.file,
      line: normalized.line,
      ...(normalized.column ? { column: normalized.column } : {}),
    },
    field,
    offendingValue,
    ...(expectedValue === undefined ? {} : { expectedValue }),
    remediation,
  };
}

/** Strictly validate one new source definition in fail-fast contract order. */
export function validateSourceManifest(manifest, contract, location) {
  if (!isRecord(manifest)) {
    return [
      sourceFinding(
        contract,
        location,
        'OBJECT_TYPE_NAME_NON_CANONICAL',
        'name',
        null,
        NAME_RULE,
        `Set name to a PascalCase identifier matching ${NAME_RULE}.`
      ),
    ];
  }
  if (typeof manifest.name !== 'string' || !contract.namePattern.test(manifest.name)) {
    return [
      sourceFinding(
        contract,
        location,
        'OBJECT_TYPE_NAME_NON_CANONICAL',
        'name',
        typeof manifest.name === 'string' ? manifest.name : null,
        NAME_RULE,
        `Set name to a PascalCase identifier matching ${NAME_RULE}.`
      ),
    ];
  }

  const expectedSlug = deriveObjectTypeSlugV1(manifest.name);
  if (!Object.hasOwn(manifest, 'slug') || manifest.slug === null || manifest.slug === '') {
    return [
      sourceFinding(
        contract,
        location,
        'OBJECT_TYPE_SLUG_MISSING',
        'slug',
        null,
        expectedSlug,
        'Add slug using the v1 derivation of name.'
      ),
    ];
  }
  if (
    typeof manifest.slug !== 'string' ||
    !contract.slugPattern.test(manifest.slug) ||
    contract.reserved.includes(manifest.slug)
  ) {
    return [
      sourceFinding(
        contract,
        location,
        'OBJECT_TYPE_SLUG_NON_CANONICAL',
        'slug',
        typeof manifest.slug === 'string' ? manifest.slug : null,
        { pattern: SLUG_RULE, reserved: [...contract.reserved] },
        `Set slug to a non-reserved kebab-case identifier matching ${SLUG_RULE}.`
      ),
    ];
  }
  if (manifest.slug !== expectedSlug) {
    return [
      sourceFinding(
        contract,
        location,
        'OBJECT_TYPE_SLUG_DERIVATION_MISMATCH',
        'slug',
        manifest.slug,
        expectedSlug,
        'Set slug to the v1 derivation of name.'
      ),
    ];
  }
  return [];
}

function resolveLocalReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) return undefined;
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((value, part) => value?.[part], rootSchema);
}

function schemaErrors(value, schema, rootSchema, instancePath = '$') {
  if (!isRecord(schema)) return [{ path: instancePath, reason: 'unsupported schema node' }];
  if (typeof schema.$ref === 'string') {
    const resolved = resolveLocalReference(rootSchema, schema.$ref);
    return resolved
      ? schemaErrors(value, resolved, rootSchema, instancePath)
      : [{ path: instancePath, reason: 'unsupported schema reference' }];
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate) => schemaErrors(value, candidate, rootSchema, instancePath).length === 0
    );
    if (matches.length !== 1) return [{ path: instancePath, reason: 'must match exactly one schema' }];
  }
  const expectedTypes = Array.isArray(schema.type)
    ? schema.type
    : typeof schema.type === 'string'
      ? [schema.type]
      : [];
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => jsonTypeMatches(value, type))) {
    return [{ path: instancePath, reason: `must have type ${expectedTypes.join('|')}` }];
  }

  const errors = [];
  if (Object.hasOwn(schema, 'const') && canonicalJson(value) !== canonicalJson(schema.const)) {
    errors.push({ path: instancePath, reason: 'must equal the required constant' });
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(value))
  ) {
    errors.push({ path: instancePath, reason: 'must be an allowed value' });
  }
  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push({ path: instancePath, reason: `must have length >= ${schema.minLength}` });
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path: instancePath, reason: 'must match the required pattern' });
    }
    if (
      schema.format === 'date-time' &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
        Number.isNaN(Date.parse(value)))
    ) {
      errors.push({ path: instancePath, reason: 'must be a valid UTC date-time' });
    }
  }
  if (typeof value === 'number' && Number.isFinite(schema.minimum) && value < schema.minimum) {
    errors.push({ path: instancePath, reason: `must be >= ${schema.minimum}` });
  }
  if (Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((item, index) => {
      errors.push(...schemaErrors(item, schema.items, rootSchema, `${instancePath}[${index}]`));
    });
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const property of schema.required) {
        if (!Object.hasOwn(value, property)) {
          errors.push({ path: `${instancePath}.${property}`, reason: 'is required' });
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const property of Object.keys(value)) {
        if (!Object.hasOwn(properties, property)) {
          errors.push({ path: `${instancePath}.${property}`, reason: 'is not allowed' });
        }
      }
    }
    for (const [property, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, property)) {
        errors.push(
          ...schemaErrors(value[property], propertySchema, rootSchema, `${instancePath}.${property}`)
        );
      }
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) {
      if (!isRecord(child)) continue;
      const conditionMatches =
        !isRecord(child.if) || schemaErrors(value, child.if, rootSchema, instancePath).length === 0;
      if (conditionMatches && isRecord(child.then)) {
        errors.push(...schemaErrors(value, child.then, rootSchema, instancePath));
      }
      if (!conditionMatches && isRecord(child.else)) {
        errors.push(...schemaErrors(value, child.else, rootSchema, instancePath));
      }
    }
  }
  return errors;
}

function findingSemanticError(finding, report) {
  const locationKind = finding.location.kind;
  const expected = (() => {
    if (locationKind === 'source') return [SOURCE_CLASSIFICATION, 'error'];
    if (
      locationKind === 'persisted' &&
      finding.rule === 'OBJECT_TYPE_SLUG_DERIVATION_MISMATCH'
    ) {
      return [PERSISTED_CLASSIFICATION, 'warning'];
    }
    if (locationKind === 'persisted' && finding.rule === 'OBJECT_TYPE_SLUG_NON_CANONICAL') {
      return [ACTIVATION_CLASSIFICATION, 'error'];
    }
    if (locationKind === 'inventory' && finding.rule === 'OBJECT_TYPE_INVENTORY_INCOMPLETE') {
      return [ACTIVATION_CLASSIFICATION, 'error'];
    }
    return undefined;
  })();
  if (!expected || finding.classification !== expected[0] || finding.severity !== expected[1]) {
    return 'finding rule, location, classification, and severity are inconsistent';
  }
  if (locationKind === 'source') {
    return 'inventory reports cannot contain source-code findings';
  }
  if (locationKind === 'persisted') {
    if (
      !isHmacReference(finding.location.tenantRef) ||
      !isHmacReference(finding.location.recordRef)
    ) {
      return 'persisted locations must use HMAC-redacted references';
    }
    if (!/separately approved[\s\S]*migration/i.test(finding.remediation)) {
      return 'persisted remediation must require a separately approved migration';
    }
  }
  if (
    locationKind === 'inventory' &&
    (finding.location.environment !== report.environment || finding.location.region !== report.region)
  ) {
    return 'inventory finding location must match the report target';
  }
  return undefined;
}

function findingsSummary(findings) {
  return findings.reduce(
    (summary, finding) => {
      summary[finding.classification] += 1;
      return summary;
    },
    {
      blocking_source_drift: 0,
      report_only_persisted_legacy_drift: 0,
      activation_blocker: 0,
    }
  );
}

function isHmacReference(value) {
  return /^(?:[a-z-]+:)?hmac-sha256:[A-Za-z0-9._:-]+$/.test(String(value));
}

function inventoryCompletenessFailures(report) {
  const failures = [];
  if (report.status !== 'complete') failures.push('status');
  if (report.writeAttemptCount !== 0) failures.push('writeAttemptCount');
  if (report.identityKind !== 'USER') failures.push('identityKind');
  if (report.roleVisibilityComplete !== true) failures.push('roleVisibilityComplete');
  if (report.expectedActiveTenantCount !== report.scannedTenantCount) failures.push('tenantCount');
  if (report.expectedTenantSetDigest !== report.scannedTenantSetDigest) failures.push('tenantSetDigest');
  if (report.prePostUniverseStable !== true) failures.push('prePostUniverseStable');
  if (report.tenantPagination.terminal !== true) failures.push('tenantPagination');
  if (report.tenantPagination.recordCount !== report.expectedActiveTenantCount) {
    failures.push('tenantPaginationRecordCount');
  }
  if (
    report.objectTypePagination.length !== report.expectedActiveTenantCount ||
    report.objectTypePagination.some((evidence) => evidence.terminal !== true)
  ) {
    failures.push('objectTypePagination');
  }
  if (
    report.objectTypePagination.reduce((total, evidence) => total + evidence.pageCount, 0) !==
    report.objectTypePageCount
  ) {
    failures.push('objectTypePageCount');
  }
  if (
    report.objectTypePagination.reduce((total, evidence) => total + evidence.recordCount, 0) !==
    report.objectTypeRecordCount
  ) {
    failures.push('objectTypeRecordCount');
  }
  if (report.sourceErrorCount !== 0) failures.push('sourceErrorCount');
  if (Date.parse(report.snapshotStartedAt) > Date.parse(report.snapshotCompletedAt)) {
    failures.push('snapshotOrder');
  }
  if (report.snapshotBasis === 'stable_pre_post_enumeration') {
    if (
      report.preTenantSetDigest !== report.postTenantSetDigest ||
      report.preTenantSetDigest !== report.expectedTenantSetDigest ||
      report.postTenantSetDigest !== report.scannedTenantSetDigest
    ) {
      failures.push('prePostTenantSetDigest');
    }
  }
  return [...new Set(failures)].sort();
}

/** Validate one already-collected report without login, network calls, or writes. */
export function validateInventoryReport(report, contract) {
  const inventorySchema = contract.auditSchema.$defs.InventoryRun;
  const errors = schemaErrors(report, inventorySchema, contract.auditSchema).sort((left, right) =>
    compareText(`${left.path}:${left.reason}`, `${right.path}:${right.reason}`)
  );
  if (errors.length > 0) {
    return {
      complete: false,
      exitCode: 4,
      findings: [],
      errors,
      completenessFailures: [],
    };
  }

  if (!isHmacReference(report.releaseOwnerUserRef)) {
    errors.push({
      path: '$.releaseOwnerUserRef',
      reason: 'must be a privacy-safe HMAC reference',
    });
  }
  report.findings.forEach((finding, index) => {
    const reason = findingSemanticError(finding, report);
    if (reason) errors.push({ path: `$.findings[${index}]`, reason });
  });
  const sortedFindings = sortIdentifierFindings(report.findings);
  if (canonicalJson(sortedFindings) !== canonicalJson(report.findings)) {
    errors.push({ path: '$.findings', reason: 'must use canonical finding order' });
  }
  const sortedPagination = [...report.objectTypePagination].sort((left, right) =>
    compareText(left.tenantRef, right.tenantRef)
  );
  if (canonicalJson(sortedPagination) !== canonicalJson(report.objectTypePagination)) {
    errors.push({ path: '$.objectTypePagination', reason: 'must be sorted by tenantRef' });
  }
  if (new Set(report.objectTypePagination.map(({ tenantRef }) => tenantRef)).size !== report.objectTypePagination.length) {
    errors.push({ path: '$.objectTypePagination', reason: 'must contain unique tenantRef values' });
  }
  for (const [index, evidence] of report.objectTypePagination.entries()) {
    if (!isHmacReference(evidence.tenantRef)) {
      errors.push({
        path: `$.objectTypePagination[${index}].tenantRef`,
        reason: 'must be a privacy-safe HMAC reference',
      });
    }
  }
  if (canonicalJson(findingsSummary(report.findings)) !== canonicalJson(report.findingsSummary)) {
    errors.push({ path: '$.findingsSummary', reason: 'must equal the findings classification counts' });
  }
  errors.sort((left, right) =>
    compareText(`${left.path}:${left.reason}`, `${right.path}:${right.reason}`)
  );
  if (errors.length > 0) {
    return {
      complete: false,
      exitCode: 4,
      findings: [],
      errors,
      completenessFailures: [],
    };
  }

  const completenessFailures = inventoryCompletenessFailures(report);
  const complete = completenessFailures.length === 0;
  const hasBlockingFinding = report.findings.some(
    ({ classification }) =>
      classification === SOURCE_CLASSIFICATION || classification === ACTIVATION_CLASSIFICATION
  );
  return {
    complete,
    exitCode: complete ? (hasBlockingFinding ? 2 : 0) : 3,
    findings: sortedFindings,
    errors: [],
    completenessFailures,
  };
}

function manifestEntries(value) {
  if (Array.isArray(value)) {
    return value.map((manifest, index) => ({ manifest, index }));
  }
  if (!isRecord(value)) return [];
  if (Object.hasOwn(value, 'name') || Object.hasOwn(value, 'slug')) {
    return [{ manifest: value, index: 0 }];
  }
  const entries = [];
  for (const key of Object.keys(value).sort()) {
    if (!Array.isArray(value[key])) continue;
    for (const manifest of value[key]) entries.push({ manifest, index: entries.length });
  }
  return entries;
}

function parseArguments(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (['--manifest', '--inventory', '--contract', '--schema', '--config'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new ValidationInputError('ARGUMENT_MISSING', `${argument} requires a path.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new ValidationInputError('ARGUMENT_UNSUPPORTED', `Unsupported argument: ${argument}`);
  }
  if (Boolean(options.manifest) === Boolean(options.inventory)) {
    throw new ValidationInputError(
      'INPUT_KIND_UNSUPPORTED',
      'Supply exactly one of --manifest or --inventory.'
    );
  }
  return options;
}

function outputResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${result.status}: ${result.findings?.length ?? 0} finding(s), exit ${result.exitCode}\n`
  );
}

async function runCli(argv) {
  let options;
  try {
    options = parseArguments(argv);
    const contract = await loadIdentifierValidationContract({
      contractPath: options.contract,
      schemaPath: options.schema,
      configPath: options.config,
    });
    if (options.manifest) {
      const { value } = await readJson(options.manifest, 'manifest');
      const entries = manifestEntries(value);
      if (entries.length === 0) {
        throw new ValidationInputError(
          'MANIFEST_SHAPE_UNSUPPORTED',
          'manifest must be one definition, an array, or a keyed array map.'
        );
      }
      const findings = sortIdentifierFindings(
        entries.flatMap(({ manifest, index }) =>
          validateSourceManifest(manifest, contract, {
            file: options.manifest.replace(/\\/g, '/'),
            line: index + 1,
          })
        )
      );
      const exitCode = findings.length > 0 ? 2 : 0;
      const result = {
        schemaVersion: VALIDATION_SCHEMA_VERSION,
        contractVersion: contract.contractVersion,
        inputKind: 'source_manifest',
        status: exitCode === 0 ? 'valid' : 'blocked',
        exitCode,
        findings,
        errors: [],
      };
      outputResult(result, options.json);
      return exitCode;
    }

    const { value: report } = await readJson(options.inventory, 'inventory');
    const validation = validateInventoryReport(report, contract);
    const status =
      validation.exitCode === 4
        ? 'malformed'
        : validation.exitCode === 3
          ? 'incomplete'
          : validation.exitCode === 2
            ? 'blocked'
            : 'valid';
    const result = {
      schemaVersion: VALIDATION_SCHEMA_VERSION,
      contractVersion: contract.contractVersion,
      inputKind: 'inventory',
      status,
      exitCode: validation.exitCode,
      findings: validation.findings,
      errors: validation.errors,
      completenessFailures: validation.completenessFailures,
    };
    outputResult(result, options.json);
    return validation.exitCode;
  } catch (error) {
    const result = {
      schemaVersion: VALIDATION_SCHEMA_VERSION,
      contractVersion: CONTRACT_VERSION,
      inputKind: options?.inventory ? 'inventory' : options?.manifest ? 'source_manifest' : 'unsupported',
      status: 'malformed',
      exitCode: 4,
      findings: [],
      errors: [
        {
          code: error instanceof ValidationInputError ? error.code : 'VALIDATION_FAILED',
          message:
            error instanceof ValidationInputError
              ? error.message
              : 'Identifier validation could not be completed.',
        },
      ],
    };
    outputResult(result, options?.json ?? argv.includes('--json'));
    return 4;
  }
}

if (IS_DIRECT_RUN) {
  process.exitCode = await runCli(process.argv.slice(2));
}

export const IDENTIFIER_VALIDATION_EXIT_CODES = Object.freeze({
  valid: 0,
  blocked: 2,
  incomplete: 3,
  malformed: 4,
});

export { INVENTORY_SCHEMA_VERSION };
