#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  canonicalJson,
  deriveObjectTypeSlugV1,
  loadIdentifierValidationContract,
} from './validate-object-type-identifiers.mjs';

const SCHEMA_VERSION = 'eai.object-type-routing.workspace-compatibility/v1';
const CONTRACT_VERSION = 'eai.object-type-routing/v1';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const IS_DIRECT_RUN = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
const SOURCE_ROUTE_OWNER = 'front/eai-app-template/packages/platform-sdk/src/resource-routing.ts';
const GOVERNED_FIELDS = Object.freeze([
  'object_type',
  'parent_type',
  'objectTypes',
  'object_types',
  'parent_object_type',
  'target_type',
]);
const RESERVED_SLUGS = Object.freeze(['operations', 'query', 'search', 'storage']);
const NAME_PATTERN = '^[A-Z][A-Za-z0-9]*$';
const SLUG_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';
const OPENAPI_FIELD_ALIASES = Object.freeze({
  parent_object_type: Object.freeze(['parent_object_type', 'parentType']),
});
const RELATIONSHIP_REFERENCES = Object.freeze({
  sourceField: 'linkTypes[].targetObjectType',
  sourceAcceptedIdentifiers: Object.freeze(['same-manifest-name', 'slug']),
  adapterMustEmit: 'slug',
  persistedIdentifier: 'slug',
  runtimeField: 'target_type',
  runtimeIdentifier: 'slug',
  historicalStoredSlugIsAuthoritative: true,
});
const RELATIONSHIP_REFERENCE_VECTORS = Object.freeze([
  Object.freeze({
    declaredName: 'GitHubConnection',
    declaredSlug: 'github-connection',
    sourceReference: 'GitHubConnection',
    emittedReference: 'github-connection',
  }),
  Object.freeze({
    declaredName: 'OPAMeasure',
    declaredSlug: 'opameasure',
    sourceReference: 'OPAMeasure',
    emittedReference: 'opameasure',
  }),
]);

const ADAPTERS = Object.freeze([
  {
    component: 'Configurator',
    kind: 'typescript',
    path: 'front/Configurator/src/collections/ObjectTypes/identifierContract.ts',
  },
  {
    component: 'eai-app-template',
    kind: 'typescript',
    path: 'front/eai-app-template/packages/platform-sdk/src/resource-routing.ts',
  },
  {
    component: 'eai-cli',
    kind: 'typescript',
    path: 'ops/eai-cli/src/lib/object-type-identifiers.ts',
  },
  {
    component: 'eai-gofer',
    kind: 'gofer',
    path: 'ops/gofer/.specify/scripts/node/validate-object-type-identifiers.mjs',
  },
  {
    component: 'PublicAPI',
    kind: 'python',
    path: 'mid/PublicAPI/src/app/services/object_type_identifiers.py',
  },
  {
    component: 'AdminAPI',
    kind: 'python',
    path: 'mid/AdminAPI/src/services/object_type_identifiers.py',
  },
  {
    component: 'ResourceAPI',
    kind: 'python',
    path: 'mid/ResourceAPI/src/services/object_type_identifiers.py',
  },
]);

const COVERAGE_OWNERS = Object.freeze([
  ['Configurator', 'front/Configurator/.eai/test-coverage.json'],
  ['eai-app-template', 'front/eai-app-template/.eai/test-coverage.json'],
  ['eai-cli', 'ops/eai-cli/.eai/test-coverage.json'],
  ['eai-gofer', 'ops/gofer/.eai/test-coverage.json'],
  ['PublicAPI', 'mid/PublicAPI/.eai/test-coverage.json'],
  ['AdminAPI', 'mid/AdminAPI/.eai/test-coverage.json'],
  ['ResourceAPI', 'mid/ResourceAPI/.eai/test-coverage.json'],
  ['tech-docs', 'ops/tech-docs/.eai/test-coverage.json'],
]);

const MIRRORS = Object.freeze([
  {
    component: 'eai-gofer-contract',
    source: 'ops/tech-docs/static/contracts/object-type-routing-v1.json',
    installed: 'ops/gofer/.specify/contracts/object-type-routing-v1.json',
  },
  {
    component: 'eai-gofer-extension',
    source: 'ops/gofer/.specify/config/object-type-routing.json',
    installed: 'ops/gofer/extension/resources/specify-config/object-type-routing.json',
  },
  {
    component: 'eai-gofer-extension',
    source: 'ops/gofer/.specify/contracts/object-type-routing-v1.json',
    installed: 'ops/gofer/extension/resources/contracts/object-type-routing-v1.json',
  },
  {
    component: 'eai-gofer-extension',
    source: 'ops/gofer/.specify/schemas/object-type-identifier-audit-v1.schema.json',
    installed: 'ops/gofer/extension/resources/schemas/object-type-identifier-audit-v1.schema.json',
  },
  {
    component: 'eai-gofer-extension',
    source: 'ops/gofer/.specify/schemas/object-type-routing-phase-bundle-v1.schema.json',
    installed:
      'ops/gofer/extension/resources/schemas/object-type-routing-phase-bundle-v1.schema.json',
  },
  {
    component: 'eai-cli-installed-gofer',
    source: 'ops/gofer/.specify/config/object-type-routing.json',
    installed: 'ops/eai-cli/resources/gofer/config/object-type-routing.json',
  },
  {
    component: 'eai-cli-installed-gofer',
    source: 'ops/gofer/.specify/contracts/object-type-routing-v1.json',
    installed: 'ops/eai-cli/resources/gofer/contracts/object-type-routing-v1.json',
  },
  {
    component: 'eai-cli-installed-gofer',
    source: 'ops/gofer/.specify/schemas/object-type-identifier-audit-v1.schema.json',
    installed: 'ops/eai-cli/resources/gofer/schemas/object-type-identifier-audit-v1.schema.json',
  },
  {
    component: 'eai-cli-installed-gofer',
    source: 'ops/gofer/.specify/schemas/object-type-routing-phase-bundle-v1.schema.json',
    installed:
      'ops/eai-cli/resources/gofer/schemas/object-type-routing-phase-bundle-v1.schema.json',
  },
]);

class WorkspaceInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceInputError';
    this.code = code;
  }
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digestJson(value) {
  return digestBytes(canonicalJson(value));
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), 'en');
}

function sortFindings(findings) {
  return [...findings].sort(
    (left, right) =>
      compareText(left.component, right.component) ||
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message)
  );
}

function finding(component, artifactPath, code, message, evidence = undefined) {
  return {
    classification: 'blocking',
    component,
    path: artifactPath,
    code,
    message,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

async function readRequired(workspace, relativePath, label = relativePath) {
  try {
    return await fs.readFile(path.join(workspace, relativePath));
  } catch (error) {
    throw new WorkspaceInputError(
      'AUTHORITY_UNREADABLE',
      `${label} is not readable (${error?.code ?? 'unknown error'}).`
    );
  }
}

async function readOptional(workspace, relativePath) {
  try {
    return await fs.readFile(path.join(workspace, relativePath));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new WorkspaceInputError('JSON_MALFORMED', `${label} is not valid JSON.`);
  }
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let regularExpression = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (regularExpression) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '/') regularExpression = false;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '/' && /[=(,:!&|?;\[]/.test(source[index - 1] ?? '=')) {
      regularExpression = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function typeScriptFunctionBody(source, functionName, component) {
  const declaration = new RegExp(
    `(?:export\\s+)?function\\s+${functionName}\\s*\\(\\s*([A-Za-z_$][\\w$]*)[^)]*\\)\\s*(?::\\s*[A-Za-z_$][\\w$<>[\\]| ]*\\s*)?\\{`,
    'm'
  ).exec(source);
  if (!declaration) throw new Error(`${component} does not declare ${functionName}().`);
  const openIndex = declaration.index + declaration[0].lastIndexOf('{');
  const closeIndex = matchingBrace(source, openIndex);
  if (closeIndex === -1) throw new Error(`${component} ${functionName}() is incomplete.`);
  return {
    parameter: declaration[1],
    body: source.slice(openIndex + 1, closeIndex),
  };
}

export function executableTypeScriptDeriver(source, component) {
  const { parameter, body } = typeScriptFunctionBody(
    source,
    'deriveObjectTypeSlugV1',
    component
  );
  if (!/^\s*return\s+/m.test(body)) {
    throw new Error(`${component} derivation function has no executable return expression.`);
  }

  const mapDeclaration =
    /ESTABLISHED_NAME_SLUGS\s*=\s*new Map(?:<[^>]+>)?\s*\(([\s\S]*?)\)\s*;?/m.exec(source);
  if (!mapDeclaration) {
    throw new Error(`${component} does not declare ESTABLISHED_NAME_SLUGS.`);
  }
  const establishedNameSlugs = new Map(
    Function(`'use strict'; return (${mapDeclaration[1]});`)()
  );

  let trimAsciiWhitespace;
  if (/\btrimAsciiWhitespace\s*\(/.test(body)) {
    const asciiHelper = typeScriptFunctionBody(source, 'isAsciiWhitespace', component);
    const trimHelper = typeScriptFunctionBody(source, 'trimAsciiWhitespace', component);
    const isAsciiWhitespace = Function(
      asciiHelper.parameter,
      `'use strict';\n${asciiHelper.body}`
    );
    const executeTrim = Function(
      'isAsciiWhitespace',
      trimHelper.parameter,
      `'use strict';\n${trimHelper.body}`
    );
    trimAsciiWhitespace = (value) => executeTrim(isAsciiWhitespace, value);
  }

  const executeDerivation = Function(
    'ESTABLISHED_NAME_SLUGS',
    'trimAsciiWhitespace',
    parameter,
    `'use strict';\n${body}`
  );
  return (value) => executeDerivation(establishedNameSlugs, trimAsciiWhitespace, value);
}

function sourcePatterns(source, component) {
  const name = /(?:OBJECT_TYPE_)?NAME_PATTERN\s*=\s*\/([^/]+)\/([a-z]*)/.exec(source);
  const slug = /(?:OBJECT_TYPE_)?SLUG_PATTERN\s*=\s*\/([^/]+)\/([a-z]*)/.exec(source);
  if (!name || !slug) throw new Error(`${component} does not declare literal name/slug patterns.`);
  return {
    name: { pattern: name[1], flags: name[2], expression: new RegExp(name[1], name[2]) },
    slug: { pattern: slug[1], flags: slug[2] },
  };
}

function pythonExecutable() {
  return 'python3';
}

function executePythonAdapter(absolutePath, vectors) {
  const program = String.raw`
import importlib.util, json, sys
module_path = sys.argv[1]
vectors = json.loads(sys.argv[2])
spec = importlib.util.spec_from_file_location("eai_object_type_adapter", module_path)
if spec is None or spec.loader is None:
    raise RuntimeError("adapter module is not loadable")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps([{
    "output": module.derive_object_type_slug(vector["input"]),
    "manifestNameValid": module.is_valid_object_type_manifest_name(vector["input"]),
} for vector in vectors], separators=(",", ":"), sort_keys=True))
`;
  const result = spawnSync(
    pythonExecutable(),
    ['-c', program, absolutePath, JSON.stringify(vectors)],
    { encoding: 'utf8', timeout: 15_000 }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Python adapter execution failed: ${result.error?.message ?? result.stderr.trim() ?? 'unknown error'}`
    );
  }
  return JSON.parse(result.stdout.trim());
}

async function reduceAdapter(workspace, definition, vectors, contract) {
  const bytes = await readOptional(workspace, definition.path);
  if (!bytes) {
    return {
      adapter: {
        component: definition.component,
        path: definition.path,
        digest: null,
        compatible: false,
        vectors: [],
      },
      findings: [
        finding(
          definition.component,
          definition.path,
          'ADAPTER_MISSING',
          'The canonical identifier adapter is missing.'
        ),
      ],
    };
  }

  const source = bytes.toString('utf8');
  const adapterFindings = [];
  let results = [];
  let declaredNamePattern;
  let declaredSlugPattern;
  try {
    if (definition.kind === 'typescript') {
      const derive = executableTypeScriptDeriver(source, definition.component);
      const patterns = sourcePatterns(source, definition.component);
      declaredNamePattern = patterns.name.pattern;
      declaredSlugPattern = patterns.slug.pattern;
      results = vectors.map((vector) => ({
        output: derive(vector.input),
        manifestNameValid: patterns.name.expression.test(vector.input),
      }));
    } else if (definition.kind === 'python') {
      results = executePythonAdapter(path.join(workspace, definition.path), vectors);
      declaredNamePattern = /OBJECT_TYPE_NAME_PATTERN[^=]*=\s*r?["']([^"']+)["']/.exec(source)?.[1];
      declaredSlugPattern = /OBJECT_TYPE_SLUG_PATTERN[^=]*=\s*r?["']([^"']+)["']/.exec(source)?.[1];
    } else {
      results = vectors.map((vector) => ({
        output: deriveObjectTypeSlugV1(vector.input),
        manifestNameValid: contract.namePattern.test(vector.input),
      }));
      declaredNamePattern = NAME_PATTERN;
      declaredSlugPattern = SLUG_PATTERN;
    }
  } catch (error) {
    adapterFindings.push(
      finding(
        definition.component,
        definition.path,
        'ADAPTER_UNEXECUTABLE',
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  if (declaredNamePattern !== NAME_PATTERN || declaredSlugPattern !== SLUG_PATTERN) {
    adapterFindings.push(
      finding(
        definition.component,
        definition.path,
        'ADAPTER_PATTERN_DRIFT',
        'The adapter name or slug pattern differs from the authoritative contract.'
      )
    );
  }
  for (const reserved of RESERVED_SLUGS) {
    if (
      definition.kind !== 'gofer' &&
      !source.includes(`'${reserved}'`) &&
      !source.includes(`"${reserved}"`)
    ) {
      adapterFindings.push(
        finding(
          definition.component,
          definition.path,
          'ADAPTER_RESERVED_SET_DRIFT',
          `The adapter does not declare reserved slug ${reserved}.`
        )
      );
    }
  }
  if (!source.includes(CONTRACT_VERSION)) {
    adapterFindings.push(
      finding(
        definition.component,
        definition.path,
        'ADAPTER_VERSION_DRIFT',
        'The adapter does not declare the canonical contract version.'
      )
    );
  }

  const vectorEvidence = vectors.map((vector, ordinal) => {
    const observed = results[ordinal] ?? {};
    const compatible =
      observed.output === vector.output && observed.manifestNameValid === vector.manifestNameValid;
    if (!compatible) {
      adapterFindings.push(
        finding(
          definition.component,
          definition.path,
          'ADAPTER_VECTOR_DRIFT',
          `The adapter differs from authoritative vector ${ordinal}.`,
          {
            ordinal,
            expectedOutput: vector.output,
            observedOutput: observed.output ?? null,
            expectedManifestNameValid: vector.manifestNameValid,
            observedManifestNameValid: observed.manifestNameValid ?? null,
          }
        )
      );
    }
    return {
      ordinal,
      output: observed.output ?? null,
      manifestNameValid: observed.manifestNameValid ?? null,
      compatible,
    };
  });

  return {
    adapter: {
      component: definition.component,
      path: definition.path,
      digest: digestBytes(bytes),
      compatible: adapterFindings.length === 0,
      vectors: vectorEvidence,
    },
    findings: adapterFindings,
  };
}

function validateAuthority(contract, manifestSchema, actionSchema, auditConfig) {
  const findings = [];
  if (contract.contractVersion !== CONTRACT_VERSION) {
    findings.push(
      finding(
        'tech-docs',
        'ops/tech-docs/static/contracts/object-type-routing-v1.json',
        'CONTRACT_VERSION_DRIFT',
        'Contract version is not v1.'
      )
    );
  }
  if (contract.authoritativeTransportIdentifier !== 'slug') {
    findings.push(
      finding(
        'tech-docs',
        'ops/tech-docs/static/contracts/object-type-routing-v1.json',
        'TRANSPORT_IDENTIFIER_DRIFT',
        'The authoritative transport identifier must be slug.'
      )
    );
  }
  if (
    contract.name?.pattern !== NAME_PATTERN ||
    contract.slug?.pattern !== SLUG_PATTERN ||
    canonicalJson(contract.slug?.reserved) !== canonicalJson(RESERVED_SLUGS) ||
    canonicalJson(contract.governedTransportFields) !== canonicalJson(GOVERNED_FIELDS) ||
    contract.derivation?.algorithm !== CONTRACT_VERSION ||
    contract.derivation?.vectors?.length !== 11
  ) {
    findings.push(
      finding(
        'tech-docs',
        'ops/tech-docs/static/contracts/object-type-routing-v1.json',
        'CONTRACT_SHAPE_DRIFT',
        'The contract patterns, reserved slugs, governed fields, algorithm, or vector count drifted.'
      )
    );
  }
  if (canonicalJson(contract.relationshipReferences) !== canonicalJson(RELATIONSHIP_REFERENCES)) {
    findings.push(
      finding(
        'tech-docs',
        'ops/tech-docs/static/contracts/object-type-routing-v1.json',
        'RELATIONSHIP_REFERENCE_CONTRACT_DRIFT',
        'Relationship references must resolve same-manifest names to exact declared slugs before publication and runtime use.'
      )
    );
  }
  const relationshipGuidance = String(auditConfig?.canonicalGuidance ?? '');
  if (
    !relationshipGuidance.includes('linkTypes[].targetObjectType') ||
    !relationshipGuidance.includes('target_type') ||
    !relationshipGuidance.includes('same-manifest name shorthand')
  ) {
    findings.push(
      finding(
        'eai-gofer',
        'ops/gofer/.specify/config/object-type-routing.json',
        'RELATIONSHIP_SOURCE_AUDIT_DRIFT',
        'The source audit must require linkTypes[].targetObjectType and runtime target_type to use the declared slug after same-manifest name resolution.'
      )
    );
  }
  const expectedArtifacts = {
    openapi: '/openapi.json',
    manifestSchema: '/v4/data/contracts/object-type-manifest.schema.json',
    resourceActionSchema: '/v4/data/contracts/resource-action.schema.json',
  };
  if (canonicalJson(contract.artifacts) !== canonicalJson(expectedArtifacts)) {
    findings.push(
      finding(
        'tech-docs',
        'ops/tech-docs/static/contracts/object-type-routing-v1.json',
        'CONTRACT_ARTIFACT_LINK_DRIFT',
        'The public artifact links differ from v1.'
      )
    );
  }

  const manifestSlug = manifestSchema.properties?.slug;
  if (
    manifestSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema' ||
    manifestSchema.$id !== 'urn:eai:schema:object-type-manifest:v1' ||
    manifestSchema['x-eai-object-type-routing-contract'] !== CONTRACT_VERSION ||
    manifestSchema['x-eai-object-type-routing-derivation'] !== CONTRACT_VERSION ||
    canonicalJson(manifestSchema.required) !== canonicalJson(['name', 'slug']) ||
    manifestSchema.properties?.name?.pattern !== NAME_PATTERN ||
    manifestSlug?.pattern !== SLUG_PATTERN ||
    manifestSlug?.format !== 'eai-object-type-slug' ||
    canonicalJson(manifestSlug?.not?.enum) !== canonicalJson(RESERVED_SLUGS)
  ) {
    findings.push(
      finding(
        'tech-docs',
        'ops/tech-docs/static/schemas/object-type-manifest-v1.schema.json',
        'MANIFEST_SCHEMA_DRIFT',
        'The manifest schema is not the strict Draft 2020-12 v1 schema.'
      )
    );
  }
  if (
    actionSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema' ||
    actionSchema.$id !== 'urn:eai:schema:resource-action:v1' ||
    actionSchema['x-eai-object-type-routing-contract'] !== CONTRACT_VERSION ||
    actionSchema.type !== 'object' ||
    actionSchema.additionalProperties !== false ||
    canonicalJson(Object.keys(actionSchema.properties ?? {}).sort()) !== canonicalJson(['params'])
  ) {
    findings.push(
      finding(
        'tech-docs',
        'ops/tech-docs/static/schemas/resource-action-v1.schema.json',
        'ACTION_SCHEMA_DRIFT',
        'The resource action schema is not the closed Draft 2020-12 v1 schema.'
      )
    );
  }
  return findings;
}

function validateRelationshipReferenceVectors() {
  const findings = [];
  for (const vector of RELATIONSHIP_REFERENCE_VECTORS) {
    const emitted = String(vector.emittedReference ?? '');
    const declared = String(vector.declaredSlug ?? '');
    if (emitted !== declared || !new RegExp(SLUG_PATTERN).test(emitted)) {
      findings.push(
        finding(
          'tech-docs',
          'ops/tech-docs/static/contracts/object-type-routing-v1.json',
          'RELATIONSHIP_REFERENCE_VECTOR_INVALID',
          `Relationship vector ${String(vector.declaredName ?? '<unknown>')} does not emit its exact declared slug.`
        )
      );
    }
  }
  return findings;
}

function containsReference(value, reference) {
  if (Array.isArray(value)) return value.some((child) => containsReference(child, reference));
  if (!value || typeof value !== 'object') return false;
  if (value.$ref === reference) return true;
  return Object.values(value).some((child) => containsReference(child, reference));
}

function generatedOpenApi(workspace) {
  const publicApiRoot = path.join(workspace, 'mid/PublicAPI');
  const candidates = [
    path.join(publicApiRoot, '.venv/bin/python'),
    path.join(publicApiRoot, 'venv/bin/python'),
    pythonExecutable(),
  ];
  const executable = candidates.find((candidate) => {
    if (!candidate.includes(path.sep)) return true;
    try {
      return fsSyncAccess(candidate);
    } catch {
      return false;
    }
  });
  const marker = '__EAI_OBJECT_TYPE_OPENAPI__=';
  const program = [
    'import json',
    'from main import app',
    `print("${marker}" + json.dumps(app.openapi(), separators=(",", ":"), sort_keys=True))`,
  ].join('\n');
  const result = spawnSync(executable ?? 'python3', ['-c', program], {
    cwd: path.join(publicApiRoot, 'src'),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim() ?? 'OpenAPI generation failed.');
  }
  const markerIndex = result.stdout.lastIndexOf(marker);
  if (markerIndex === -1) throw new Error('OpenAPI generator did not emit its result marker.');
  return JSON.parse(result.stdout.slice(markerIndex + marker.length).trim());
}

function fsSyncAccess(file) {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function validateOpenApi(document) {
  const findings = [];
  const schemas = document.components?.schemas ?? {};
  const slugReference = '#/components/schemas/ObjectTypeSlug';
  const errorReference = '#/components/schemas/CanonicalObjectTypeSlugErrorResponse';
  const slug = schemas.ObjectTypeSlug;
  if (
    slug?.type !== 'string' ||
    slug?.format !== 'eai-object-type-slug' ||
    slug?.pattern !== SLUG_PATTERN ||
    canonicalJson(slug?.not?.enum) !== canonicalJson(RESERVED_SLUGS) ||
    slug?.['x-eai-object-type-routing-contract'] !== CONTRACT_VERSION
  ) {
    findings.push(
      finding(
        'PublicAPI',
        '/openapi.json',
        'OPENAPI_SLUG_SCHEMA_DRIFT',
        'ObjectTypeSlug is missing or differs from the v1 transport schema.'
      )
    );
  }

  let governedOperationCount = 0;
  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        !['get', 'post', 'put', 'patch', 'delete'].includes(method) ||
        !operation ||
        typeof operation !== 'object'
      )
        continue;
      const governedParameters = (operation.parameters ?? []).filter(
        (parameter) =>
          parameter?.in === 'path' && ['object_type', 'parent_type'].includes(parameter.name)
      );
      const governedBody = containsReference(operation.requestBody, slugReference);
      if (route.startsWith('/v4/data/resources/') && governedParameters.length > 0) {
        governedOperationCount += 1;
        if (governedParameters.some((parameter) => parameter.schema?.$ref !== slugReference)) {
          findings.push(
            finding(
              'PublicAPI',
              '/openapi.json',
              'OPENAPI_PATH_PARAMETER_DRIFT',
              `${method.toUpperCase()} ${route} does not reference ObjectTypeSlug for every governed path parameter.`
            )
          );
        }
      }
      if ((governedParameters.length > 0 || governedBody) && route.startsWith('/v4/')) {
        const errorSchema = operation.responses?.['400']?.content?.['application/json']?.schema;
        if (errorSchema?.$ref !== errorReference) {
          findings.push(
            finding(
              'PublicAPI',
              '/openapi.json',
              'OPENAPI_ERROR_RESPONSE_DRIFT',
              `${method.toUpperCase()} ${route} does not publish the canonical 400 response.`
            )
          );
        }
      }
      if (
        !route.startsWith('/v4/') &&
        (governedParameters.some((parameter) => parameter.schema?.$ref === slugReference) ||
          governedBody)
      ) {
        findings.push(
          finding(
            'PublicAPI',
            '/openapi.json',
            'OPENAPI_LEGACY_SCOPE_EXPANSION',
            `${method.toUpperCase()} ${route} applies the v4 slug contract to a legacy route.`
          )
        );
      }
    }
  }
  if (governedOperationCount === 0) {
    findings.push(
      finding(
        'PublicAPI',
        '/openapi.json',
        'OPENAPI_ROUTE_INVENTORY_EMPTY',
        'No governed v4 Object Type path operations were discovered.'
      )
    );
  }
  for (const field of GOVERNED_FIELDS.slice(2)) {
    const fieldNames = OPENAPI_FIELD_ALIASES[field] ?? [field];
    const represented = Object.values(schemas).some(
      (schema) =>
        fieldNames.some(
          (fieldName) =>
            schema?.properties?.[fieldName] &&
            containsReference(schema.properties[fieldName], slugReference)
        )
    );
    if (!represented) {
      findings.push(
        finding(
          'PublicAPI',
          '/openapi.json',
          'OPENAPI_GOVERNED_FIELD_MISSING',
          `Governed field ${field} does not reference ObjectTypeSlug.`
        )
      );
    }
  }
  const persistedSlug = schemas.ObjectTypeDocument?.properties?.slug;
  if (
    persistedSlug?.type !== 'string' ||
    persistedSlug?.$ref === slugReference ||
    persistedSlug?.pattern ||
    persistedSlug?.format
  ) {
    findings.push(
      finding(
        'PublicAPI',
        '/openapi.json',
        'OPENAPI_LEGACY_DOCUMENT_DRIFT',
        'ObjectTypeDocument.slug must remain a plain required string for legacy reads.'
      )
    );
  }
  return { findings, governedOperationCount };
}

async function reduceRuntimeAssets(workspace) {
  const publications = [
    [
      'ops/tech-docs/static/contracts/object-type-routing-v1.json',
      'mid/PublicAPI/src/app/contracts/object-type-routing-v1.json',
    ],
    [
      'ops/tech-docs/static/schemas/object-type-manifest-v1.schema.json',
      'mid/PublicAPI/src/app/contracts/object-type-manifest-v1.schema.json',
    ],
    [
      'ops/tech-docs/static/schemas/resource-action-v1.schema.json',
      'mid/PublicAPI/src/app/contracts/resource-action-v1.schema.json',
    ],
  ];
  const findings = [];
  const assets = [];
  for (const [authorityPath, runtimePath] of publications) {
    const authority = await readRequired(workspace, authorityPath);
    const runtime = await readOptional(workspace, runtimePath);
    const byteEqual = runtime !== undefined && authority.equals(runtime);
    if (!byteEqual) {
      findings.push(
        finding(
          'PublicAPI',
          runtimePath,
          'RUNTIME_ASSET_DRIFT',
          'The deployable runtime asset is not byte-equal to tech-docs authority.'
        )
      );
    }
    assets.push({
      authorityPath,
      runtimePath,
      authorityDigest: digestBytes(authority),
      runtimeDigest: runtime ? digestBytes(runtime) : null,
      byteEqual,
    });
  }
  return { assets, findings };
}

async function reduceMirrors(workspace) {
  const findings = [];
  const mirrors = [];
  for (const mirror of MIRRORS) {
    const source = await readOptional(workspace, mirror.source);
    const installed = await readOptional(workspace, mirror.installed);
    const byteEqual = source !== undefined && installed !== undefined && source.equals(installed);
    if (!byteEqual) {
      findings.push(
        finding(
          mirror.component,
          mirror.installed,
          'INSTALLED_MIRROR_DRIFT',
          'The installed Gofer resource is missing or differs from its source.'
        )
      );
    }
    mirrors.push({
      ...mirror,
      sourceDigest: source ? digestBytes(source) : null,
      installedDigest: installed ? digestBytes(installed) : null,
      byteEqual,
    });
  }
  return { mirrors, findings };
}

async function reduceCoverage(workspace) {
  const findings = [];
  const coverageOwnership = [];
  for (const [component, coveragePath] of COVERAGE_OWNERS) {
    const bytes = await readOptional(workspace, coveragePath);
    if (!bytes) {
      findings.push(
        finding(
          component,
          coveragePath,
          'COVERAGE_OWNER_MISSING',
          'The pre-E1 coverage map is missing.'
        )
      );
      coverageOwnership.push({
        component,
        path: coveragePath,
        digest: null,
        featureIds: [],
        owned: false,
      });
      continue;
    }
    let document;
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new WorkspaceInputError('JSON_MALFORMED', `${coveragePath} is not valid JSON.`);
    }
    const repositories = Object.values(document.repositories ?? {});
    const features = repositories.flatMap((repository) => repository?.features ?? []);
    const ownedFeatures = features.filter((feature) =>
      /(?:canonical.*object-type|object-type.*(?:routing|identifier)|routing.*object-type)/i.test(
        String(feature?.id ?? '')
      )
    );
    const owned = ownedFeatures.some(
      (feature) =>
        Array.isArray(feature.owned_paths) &&
        feature.owned_paths.length > 0 &&
        Array.isArray(feature.required_repo_tests) &&
        feature.required_repo_tests.length > 0
    );
    if (!owned) {
      findings.push(
        finding(
          component,
          coveragePath,
          'COVERAGE_OWNER_INCOMPLETE',
          'No canonical Object Type routing feature owns paths and repository tests.'
        )
      );
    }
    coverageOwnership.push({
      component,
      path: coveragePath,
      digest: digestBytes(bytes),
      featureIds: ownedFeatures.map((feature) => String(feature.id)).sort(compareText),
      owned,
    });
  }
  return { coverageOwnership, findings };
}

async function reduceLegacyEvidence(workspace) {
  const evidencePaths = [
    'mid/ResourceAPI/src/services/object_type_cache.py',
    'mid/ResourceAPI/tests/unit/test_resource_service_routing.py',
    'mid/ResourceAPI/tests/unit/test_object_type_identifiers.py',
    'front/eai-app-template/src/lib/platform/verify-platform.ts',
    'front/Configurator/src/collections/ObjectTypes/identifierContract.ts',
  ];
  const sources = new Map();
  for (const evidencePath of evidencePaths) {
    const bytes = await readOptional(workspace, evidencePath);
    sources.set(evidencePath, bytes);
  }
  const cache = sources.get(evidencePaths[0])?.toString('utf8') ?? '';
  const routingTests = sources.get(evidencePaths[1])?.toString('utf8') ?? '';
  const identifierTests = sources.get(evidencePaths[2])?.toString('utf8') ?? '';
  const templateVerification = sources.get(evidencePaths[3])?.toString('utf8') ?? '';
  const configurator = sources.get(evidencePaths[4])?.toString('utf8') ?? '';
  const checks = {
    resourceApiExactStoredSlugLookup:
      cache.includes('types.get(slug)') && cache.includes('without alias probes'),
    resourceApiLegacySlugBytePreserved: routingTests.includes(
      'test_resolve_adapter_passes_legacy_stored_slug_to_cache_byte_for_byte'
    ),
    resourceApiUnknownSlugNoAliasProbe:
      routingTests.includes(
        'test_resolve_adapter_preserves_unknown_canonical_slug_404_without_alias_probe'
      ) && identifierTests.includes('rejected_without_normalization_or_aliases'),
    templateUsesStoredLegacySlugExactly:
      templateVerification.includes('client.resources.list(firstSlug') &&
      templateVerification.includes('never\n    // retry with a name, alias'),
    configuratorIdentifierChangesRequireMigration:
      configurator.includes('OBJECT_TYPE_IDENTIFIER_MIGRATION_REQUIRED') &&
      configurator.includes('status: 400 | 409'),
  };
  const findings = [];
  for (const [check, passed] of Object.entries(checks)) {
    if (!passed) {
      findings.push(
        finding(
          'legacy-exact-slug',
          evidencePaths.join(','),
          'LEGACY_EXACT_SLUG_EVIDENCE_MISSING',
          `Legacy exact-slug/no-alias evidence failed: ${check}.`
        )
      );
    }
  }
  return {
    compatible: Object.values(checks).every(Boolean),
    checks,
    evidence: evidencePaths.map((evidencePath) => ({
      path: evidencePath,
      digest: sources.get(evidencePath) ? digestBytes(sources.get(evidencePath)) : null,
    })),
    findings,
  };
}

export async function reduceObjectTypeRoutingWorkspace(workspaceInput) {
  const workspace = path.resolve(workspaceInput);
  let workspaceStat;
  try {
    workspaceStat = await fs.stat(workspace);
  } catch {
    throw new WorkspaceInputError('WORKSPACE_UNREADABLE', 'Workspace is not readable.');
  }
  if (!workspaceStat.isDirectory()) {
    throw new WorkspaceInputError('WORKSPACE_UNSUPPORTED', 'Workspace must be a directory.');
  }

  const authorityPaths = {
    contract: 'ops/tech-docs/static/contracts/object-type-routing-v1.json',
    manifestSchema: 'ops/tech-docs/static/schemas/object-type-manifest-v1.schema.json',
    actionSchema: 'ops/tech-docs/static/schemas/resource-action-v1.schema.json',
    auditSchema: 'ops/gofer/.specify/schemas/object-type-identifier-audit-v1.schema.json',
    auditConfig: 'ops/gofer/.specify/config/object-type-routing.json',
  };
  const authorityEntries = await Promise.all(
    Object.entries(authorityPaths).map(async ([key, relativePath]) => {
      const bytes = await readRequired(workspace, relativePath);
      return [key, { path: relativePath, bytes, digest: digestBytes(bytes) }];
    })
  );
  const authority = Object.fromEntries(authorityEntries);
  const contractDocument = parseJson(authority.contract.bytes, authority.contract.path);
  const manifestSchema = parseJson(authority.manifestSchema.bytes, authority.manifestSchema.path);
  const actionSchema = parseJson(authority.actionSchema.bytes, authority.actionSchema.path);
  parseJson(authority.auditSchema.bytes, authority.auditSchema.path);
  const auditConfig = parseJson(authority.auditConfig.bytes, authority.auditConfig.path);

  const identifierContract = await loadIdentifierValidationContract({
    contractPath: path.join(workspace, authority.contract.path),
    schemaPath: path.join(workspace, authority.auditSchema.path),
    configPath: path.join(workspace, authority.auditConfig.path),
  });
  const vectors = contractDocument.derivation?.vectors ?? [];
  const allFindings = [
    ...validateAuthority(contractDocument, manifestSchema, actionSchema, auditConfig),
    ...validateRelationshipReferenceVectors(),
  ];

  const adapters = [];
  for (const definition of ADAPTERS) {
    const reduced = await reduceAdapter(workspace, definition, vectors, identifierContract);
    adapters.push(reduced.adapter);
    allFindings.push(...reduced.findings);
  }

  const runtimeAssets = await reduceRuntimeAssets(workspace);
  allFindings.push(...runtimeAssets.findings);

  let openapi = { digest: null, governedOperationCount: 0, compatible: false };
  try {
    const openapiDocument = generatedOpenApi(workspace);
    const openapiValidation = validateOpenApi(openapiDocument);
    allFindings.push(...openapiValidation.findings);
    openapi = {
      digest: digestJson(openapiDocument),
      governedOperationCount: openapiValidation.governedOperationCount,
      compatible: openapiValidation.findings.length === 0,
    };
  } catch (error) {
    allFindings.push(
      finding(
        'PublicAPI',
        '/openapi.json',
        'OPENAPI_GENERATION_FAILED',
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  let rawRouteAudit;
  try {
    const auditModulePath = path.join(
      workspace,
      'ops/gofer/.specify/scripts/node/validate-v4-resource-contract.mjs'
    );
    const auditModule = await import(pathToFileURL(auditModulePath).href);
    const audit = await auditModule.validateWorkspace(workspace);
    const ownerBytes = await readOptional(workspace, SOURCE_ROUTE_OWNER);
    const ownerOccurrenceCount = ownerBytes
      ? (ownerBytes.toString('utf8').match(/\/v4\/data\/resources\b/g) ?? []).length
      : 0;
    if (auditModule.OBJECT_TYPE_ROUTING_AUDIT_CONFIG?.soleOwner !== SOURCE_ROUTE_OWNER) {
      allFindings.push(
        finding(
          'eai-gofer',
          authority.auditConfig.path,
          'SOLE_ROUTE_OWNER_DRIFT',
          'The raw-route audit sole owner differs from the approved SDK module.'
        )
      );
    }
    if (ownerOccurrenceCount === 0) {
      allFindings.push(
        finding(
          'eai-app-template',
          SOURCE_ROUTE_OWNER,
          'SOLE_ROUTE_OWNER_EMPTY',
          'The sole route owner does not construct the v4 resource route root.'
        )
      );
    }
    for (const violation of audit.violations) {
      allFindings.push(
        finding(
          'eai-gofer',
          violation.location?.file ?? violation.file ?? '<unknown>',
          violation.rule ?? violation.ruleId ?? 'RAW_ROUTE_AUDIT_FINDING',
          violation.message ?? violation.remediation ?? 'Raw route audit finding.',
          {
            line: violation.location?.line ?? violation.line ?? null,
            column: violation.location?.column ?? null,
          }
        )
      );
    }
    rawRouteAudit = {
      soleOwner: auditModule.OBJECT_TYPE_ROUTING_AUDIT_CONFIG?.soleOwner ?? null,
      soleOwnerOccurrenceCount: ownerOccurrenceCount,
      filesScanned: audit.filesScanned,
      findingCount: audit.violations.length,
      digest: digestJson(audit),
      compatible:
        audit.valid &&
        auditModule.OBJECT_TYPE_ROUTING_AUDIT_CONFIG?.soleOwner === SOURCE_ROUTE_OWNER &&
        ownerOccurrenceCount > 0,
    };
  } catch (error) {
    allFindings.push(
      finding(
        'eai-gofer',
        'ops/gofer/.specify/scripts/node/validate-v4-resource-contract.mjs',
        'RAW_ROUTE_AUDIT_FAILED',
        error instanceof Error ? error.message : String(error)
      )
    );
    rawRouteAudit = {
      soleOwner: null,
      soleOwnerOccurrenceCount: 0,
      filesScanned: 0,
      findingCount: 1,
      digest: null,
      compatible: false,
    };
  }

  const mirrors = await reduceMirrors(workspace);
  const coverage = await reduceCoverage(workspace);
  const legacy = await reduceLegacyEvidence(workspace);
  allFindings.push(...mirrors.findings, ...coverage.findings, ...legacy.findings);

  const findings = sortFindings(allFindings);
  const blockingFindingCount = findings.length;
  const compatible = blockingFindingCount === 0;
  const componentDigests = Object.fromEntries(
    adapters.map((adapter) => [adapter.component, adapter.digest])
  );
  const artifactDigests = Object.fromEntries(
    [
      ...Object.values(authority).map((entry) => [entry.path, entry.digest]),
      ...runtimeAssets.assets.map((entry) => [entry.runtimePath, entry.runtimeDigest]),
      ['/openapi.json', openapi.digest],
    ].sort(([left], [right]) => compareText(left, right))
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    authoritativeTransportIdentifier: contractDocument.authoritativeTransportIdentifier ?? null,
    compatible,
    blockingFindingCount,
    exitCode: compatible ? 0 : 2,
    findings,
    contract: {
      path: authority.contract.path,
      digest: authority.contract.digest,
      vectorCount: vectors.length,
      governedTransportFields: contractDocument.governedTransportFields ?? [],
    },
    adapters,
    runtimeAssets: runtimeAssets.assets,
    schemas: {
      manifest: {
        id: manifestSchema.$id ?? null,
        dialect: manifestSchema.$schema ?? null,
        digest: authority.manifestSchema.digest,
      },
      resourceAction: {
        id: actionSchema.$id ?? null,
        dialect: actionSchema.$schema ?? null,
        digest: authority.actionSchema.digest,
      },
      identifierAudit: {
        id: identifierContract.auditSchema.$id ?? null,
        digest: authority.auditSchema.digest,
      },
    },
    openapi,
    rawRouteAudit,
    legacyExactSlug: legacy,
    generatedResources: mirrors.mirrors,
    coverageOwnership: coverage.coverageOwnership,
    componentDigests,
    artifactDigests,
  };
}

function parseArguments(argv) {
  const options = { workspace: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--workspace' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new WorkspaceInputError('ARGUMENT_MISSING', `${argument} requires a path.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new WorkspaceInputError('ARGUMENT_UNSUPPORTED', `Unsupported argument: ${argument}`);
  }
  return options;
}

async function writeAtomic(file, contents) {
  const target = path.resolve(file);
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function main(argv) {
  let options;
  try {
    options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(
        'Usage: validate-object-type-routing-workspace.mjs [--workspace <path>] [--output <path>] [--json]\n'
      );
      return 0;
    }
    const report = await reduceObjectTypeRoutingWorkspace(options.workspace);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) await writeAtomic(options.output, serialized);
    if (options.json) process.stdout.write(serialized);
    else {
      process.stdout.write(
        `${report.compatible ? 'PASS' : 'BLOCKED'} Object Type routing workspace (${report.blockingFindingCount} blocking finding(s))\n`
      );
    }
    return report.exitCode;
  } catch (error) {
    const code = error instanceof WorkspaceInputError ? error.code : 'WORKSPACE_REDUCTION_FAILED';
    process.stderr.write(`${code}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 4;
  }
}

export const WORKSPACE_REDUCER_EXIT_CODES = Object.freeze({
  compatible: 0,
  blocking: 2,
  malformed: 4,
});

if (IS_DIRECT_RUN) {
  process.exitCode = await main(process.argv.slice(2));
}
