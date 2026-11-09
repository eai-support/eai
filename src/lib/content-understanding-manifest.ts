/** Bounded document configuration accepted from any consultant harness. */
import { isRecord } from './utils.js';

export const CONTENT_UNDERSTANDING_KIND = 'eai.content-understanding';
export const CONTENT_UNDERSTANDING_API_VERSION = '2025-11-01';
export const CONTENT_UNDERSTANDING_MAX_BYTES = 16 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const CANONICAL_TENANT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TYPES = ['string', 'date', 'time', 'number', 'integer', 'boolean', 'array', 'object', 'json'];
const METHODS = ['extract', 'generate', 'classify'];
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const BOOLEAN_CONFIG = ['enableOcr', 'enableLayout', 'enableFormula', 'enableFigureAnalysis', 'enableFigureDescription',
  'returnDetails', 'estimateFieldSourceAndConfidence', 'omitContent', 'enableSegment', 'segmentPerPage'];
const FORMAT_CONFIG: Record<string, readonly string[]> = { tableFormat: ['html', 'markdown'], chartFormat: ['chartJs', 'markdown'], annotationFormat: ['markdown', 'none'] };

export class ContentUnderstandingError extends Error {
  constructor(readonly code: string, message: string, readonly operationId?: string, readonly status?: number) {
    super(message); this.name = 'ContentUnderstandingError';
  }
}
export interface ContentUnderstandingDocumentType {
  code: string;
  name: string;
  description?: string;
  category?: string;
  contentUnderstanding: { analyzerDefinition: Record<string, unknown> };
}
export interface ContentUnderstandingManifest {
  kind: typeof CONTENT_UNDERSTANDING_KIND;
  schemaVersion: 1;
  tenantId: string;
  bundleKey: string;
  provider: 'azure-content-understanding';
  apiVersion: typeof CONTENT_UNDERSTANDING_API_VERSION;
  binding: { appKey: string; workflowKey: string; documentLifecycle: 'business-document-v1' };
  documentTypes: ContentUnderstandingDocumentType[];
  classifier?: Record<string, unknown>;
}

function invalid(path: string, message: string): never {
  throw new ContentUnderstandingError('CU_INVALID_MANIFEST', `${path}: ${message}`);
}
function unsupported(path: string, message: string): never {
  throw new ContentUnderstandingError('CU_CAPABILITY_UNSUPPORTED', `${path}: ${message}`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(path, 'must be an object.');
  return value;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) unsupported(path, 'contains an unsupported setting.');
}
function text(value: unknown, path: string, identifier = false): string {
  if (typeof value !== 'string' || value.length === 0) invalid(path, 'must be a nonempty exact string.');
  if (identifier && !IDENTIFIER.test(value)) invalid(path, 'must be a bounded stable identifier.');
  return value;
}
function optionalText(value: Record<string, unknown>, names: readonly string[], path: string, maximum = 1024): void {
  for (const name of names) if (value[name] !== undefined && (typeof value[name] !== 'string' || value[name].length > maximum)) invalid(`${path}.${name}`, 'must be a bounded string.');
}
function fieldName(value: string, path: string): void {
  if (!FIELD_NAME.test(value)) invalid(path, 'field names must be ASCII identifiers of at most 64 characters.');
}
/** RFC 8785 input must contain Unicode scalar values, including authored keys. */
function scalarStrings(value: unknown): void {
  const pending: unknown[] = [value], visited = new Set<object>();
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string' && loneSurrogate.test(current)) invalid('manifest', 'strings and keys must contain valid Unicode scalar values.');
    if (current && typeof current === 'object' && !visited.has(current)) {
      visited.add(current);
      for (const [key, child] of Object.entries(current)) pending.push(key, child);
    }
  }
}

/** Validates and normalizes the launch leaf schema without reading auth, profiles or provider endpoints. */
export function parseContentUnderstandingAnalyzer(value: unknown): Record<string, unknown> {
  scalarStrings(value);
  const definition = object(value, 'analyzerDefinition');
  keys(definition, ['schemaVersion', 'baseAnalyzerId', 'description', 'modelProfile', 'config', 'fieldSchema'], 'analyzerDefinition');
  if (definition.schemaVersion !== undefined && definition.schemaVersion !== 1) unsupported('analyzerDefinition.schemaVersion', 'only version 1 is supported.');
  if (definition.baseAnalyzerId !== undefined && definition.baseAnalyzerId !== 'prebuilt-document') unsupported('analyzerDefinition.baseAnalyzerId', 'only prebuilt-document is supported.');
  if (definition.modelProfile !== undefined && definition.modelProfile !== 'default') unsupported('analyzerDefinition.modelProfile', 'only the configured default profile is supported.');
  optionalText(definition, ['description'], 'analyzerDefinition');
  const suppliedConfig = definition.config === undefined ? {} : object(definition.config, 'analyzerDefinition.config');
  keys(suppliedConfig, [...BOOLEAN_CONFIG, ...Object.keys(FORMAT_CONFIG)], 'analyzerDefinition.config');
  for (const name of BOOLEAN_CONFIG) if (suppliedConfig[name] !== undefined && typeof suppliedConfig[name] !== 'boolean') invalid(`config.${name}`, 'must be an exact boolean.');
  for (const name of ['omitContent', 'enableSegment', 'segmentPerPage']) if (suppliedConfig[name] === true) unsupported(`config.${name}`, 'hierarchical routing, segmentation and omitted content are unavailable in this launch mode.');
  for (const [name, values] of Object.entries(FORMAT_CONFIG)) if (suppliedConfig[name] !== undefined && (typeof suppliedConfig[name] !== 'string' || !values.includes(suppliedConfig[name] as string))) unsupported(`config.${name}`, 'unsupported output format.');
  const config = { returnDetails: true, estimateFieldSourceAndConfidence: true, ...suppliedConfig };
  const schema = object(definition.fieldSchema, 'fieldSchema');
  keys(schema, ['name', 'description', 'fields', 'definitions'], 'fieldSchema'); optionalText(schema, ['name'], 'fieldSchema', 64); optionalText(schema, ['description'], 'fieldSchema');
  const fields = object(schema.fields, 'fieldSchema.fields');
  if (Object.keys(fields).length === 0) invalid('fieldSchema.fields', 'at least one field is required.');
  const definitions = schema.definitions === undefined ? {} : object(schema.definitions, 'fieldSchema.definitions');
  let expandedNodes = 0, classifyCategories = 0;
  function validateField(input: unknown, path: string, depth: number, references: readonly string[] = []): void {
    if (++expandedNodes > 200) invalid(path, 'expanded field validation exceeds 200 nodes.');
    if (depth > 7) invalid(path, 'expanded field nesting exceeds 7.');
    const original = object(input, path);
    keys(original, ['$ref', 'type', 'method', 'description', 'examples', 'estimateSourceAndConfidence', 'properties', 'items', 'enum', 'enumDescriptions'], path);
    const field = original;
    if (field.$ref !== undefined) {
      if (typeof field.$ref !== 'string' || !/^#\/definitions\/[^/~]+$/.test(field.$ref)) unsupported(path, 'only finite local definition references are supported.');
      const name = field.$ref.slice('#/definitions/'.length);
      fieldName(name, path);
      if (!Object.hasOwn(definitions, name)) invalid(path, 'definition reference is unresolved.');
      if (references.includes(name)) invalid(path, 'definition references must not contain cycles.');
      if (Object.keys(field).some(key => !['$ref', 'description', 'estimateSourceAndConfidence'].includes(key))) invalid(path, 'reference overlays support only description and evidence.');
      const overlays = { ...original }; delete overlays.$ref;
      validateField({ ...object(definitions[name], `${path}.$ref`), ...overlays }, `${path}.$ref`, depth, [...references, name]);
      return;
    }
    if (typeof field.type !== 'string' || !TYPES.includes(field.type)) unsupported(path, 'unsupported or missing field type.');
    if (field.method !== undefined && (typeof field.method !== 'string' || !METHODS.includes(field.method))) unsupported(path, 'unsupported field method.');
    optionalText(field, ['description'], path);
    if (typeof field.description === 'string' && (field.description.includes('{{') || field.description.includes('}}'))) invalid(path, 'typed field descriptions cannot contain context templates.');
    if (field.examples !== undefined && (!Array.isArray(field.examples) || field.examples.length > 100 || !field.examples.every(item => typeof item === 'string' && item.length <= 1024))) invalid(path, 'examples must be strings.');
    if (field.estimateSourceAndConfidence !== undefined && typeof field.estimateSourceAndConfidence !== 'boolean') invalid(path, 'evidence estimation must be an exact boolean.');
    if ((field.method ?? 'extract') === 'extract' && (field.estimateSourceAndConfidence ?? config.estimateFieldSourceAndConfidence) !== true) invalid(path, 'extract fields require effective source and confidence estimation.');
    if (field.method === 'classify') {
      if (field.type !== 'string' || !Array.isArray(field.enum) || field.enum.length === 0 || field.enum.length > 200 || !field.enum.every(item => typeof item === 'string' && item.length > 0 && item.length <= 200)
        || new Set(field.enum).size !== field.enum.length) invalid(path, 'classify requires a string field and a nonempty unique string enum.');
      classifyCategories += field.enum.length;
      if (classifyCategories > 300) invalid(path, 'expanded classify categories exceed 300.');
      if (field.enumDescriptions !== undefined) {
        const descriptions = object(field.enumDescriptions, `${path}.enumDescriptions`);
        if (Object.keys(descriptions).length !== field.enum.length || !field.enum.every(item => Object.hasOwn(descriptions, item))) invalid(path, 'enum descriptions must match all enum values exactly.');
        for (const description of Object.values(descriptions)) if (typeof description !== 'string' || description.length > 1024) invalid(path, 'enum descriptions must be bounded strings.');
      }
    } else if (field.enum !== undefined || field.enumDescriptions !== undefined) invalid(path, 'enum settings require classify.');
    if (field.type === 'object') {
      const properties = object(field.properties, `${path}.properties`);
      if (Object.keys(properties).length === 0) invalid(path, 'objects require properties.');
      for (const [name, child] of Object.entries(properties)) { fieldName(name, `${path}.properties`); validateField(child, `${path}.properties.${name}`, depth + 1, references); }
    } else if (field.properties !== undefined) invalid(path, 'properties require object type.');
    if (field.type === 'array') validateField(field.items, `${path}.items`, depth + 1, references);
    else if (field.items !== undefined) invalid(path, 'items require array type.');
  }
  for (const [name, field] of Object.entries(fields)) { fieldName(name, 'fieldSchema.fields'); validateField(field, `fields.${name}`, 1); }
  for (const [name, field] of Object.entries(definitions)) { fieldName(name, 'fieldSchema.definitions'); validateField(field, `definitions.${name}`, 1, [name]); }
  return { ...structuredClone(definition), schemaVersion: 1, baseAnalyzerId: 'prebuilt-document', modelProfile: 'default', config };
}

/** Reject unsupported constructs for the entire bundle before resolving any authenticated command context. */
export function parseContentUnderstandingManifest(value: unknown): ContentUnderstandingManifest {
  scalarStrings(value);
  const manifest = object(value, 'manifest');
  keys(manifest, ['kind', 'schemaVersion', 'tenantId', 'bundleKey', 'provider', 'apiVersion', 'binding', 'documentTypes', 'classifier'], 'manifest');
  if (manifest.kind !== CONTENT_UNDERSTANDING_KIND || manifest.schemaVersion !== 1) unsupported('manifest', 'unsupported kind or schema version.');
  if ((!CANONICAL_TENANT_ID.test(text(manifest.tenantId, 'tenantId')) || manifest.tenantId === '00000000-0000-0000-0000-000000000000')) invalid('tenantId', 'must be a canonical UUID.');
  text(manifest.bundleKey, 'bundleKey', true);
  if (manifest.provider !== 'azure-content-understanding' || manifest.apiVersion !== CONTENT_UNDERSTANDING_API_VERSION) unsupported('manifest', 'only the Azure document GA provider contract is supported.');
  const binding = object(manifest.binding, 'binding');
  keys(binding, ['appKey', 'workflowKey', 'documentLifecycle'], 'binding'); text(binding.appKey, 'binding.appKey', true); text(binding.workflowKey, 'binding.workflowKey', true);
  if (binding.documentLifecycle !== 'business-document-v1') unsupported('binding.documentLifecycle', 'only business-document-v1 is supported.');
  if (!Array.isArray(manifest.documentTypes) || manifest.documentTypes.length === 0 || manifest.documentTypes.length > 64) invalid('documentTypes', 'must be a nonempty array.');
  const codes = new Set<string>();
  const documentTypes = manifest.documentTypes.map((input, index) => {
    const path = `documentTypes[${index}]`, doc = object(input, path);
    keys(doc, ['code', 'name', 'description', 'category', 'contentUnderstanding'], path);
    const code = text(doc.code, `${path}.code`, true); text(doc.name, `${path}.name`); optionalText(doc, ['description'], path);
    if ((doc.name as string).length > 200) invalid(path, 'document name exceeds 200 characters.');
    if (doc.category !== undefined) text(doc.category, `${path}.category`, true);
    if (code === 'Other') invalid(path, 'Other is reserved for manual review and cannot be a document type.');
    if (codes.has(code)) invalid(path, 'document type codes must be unique.'); codes.add(code);
    const cu = object(doc.contentUnderstanding, `${path}.contentUnderstanding`); keys(cu, ['analyzerDefinition'], `${path}.contentUnderstanding`);
    return { ...structuredClone(doc), contentUnderstanding: { analyzerDefinition: parseContentUnderstandingAnalyzer(cu.analyzerDefinition) } } as unknown as ContentUnderstandingDocumentType;
  });
  if (manifest.classifier !== undefined) {
    const classifier = object(manifest.classifier, 'classifier');
    keys(classifier, ['classifierKey', 'displayName', 'description', 'definition'], 'classifier');
    text(classifier.classifierKey, 'classifier.classifierKey', true); text(classifier.displayName, 'classifier.displayName'); optionalText(classifier, ['description'], 'classifier');
    if ((classifier.displayName as string).length > 200) invalid('classifier.displayName', 'exceeds 200 characters.');
    const definition = object(classifier.definition, 'classifier.definition'); keys(definition, ['labels', 'minimumConfidence'], 'classifier.definition');
    if (!Array.isArray(definition.labels) || definition.labels.length < 2 || definition.labels.length > 64) invalid('classifier.definition.labels', 'flat classifiers require 2 to 64 labels.');
    const labels = new Set<string>();
    for (const input of definition.labels) {
      const label = object(input, 'classifier.definition.labels'); keys(label, ['key', 'displayName', 'description', 'documentTypeKey'], 'classifier.definition.labels');
      const key = text(label.key, 'classifier.label.key', true); if (labels.has(key)) invalid('classifier.definition.labels', 'label keys must be unique.'); labels.add(key);
      text(label.displayName, 'classifier.label.displayName'); text(label.description, 'classifier.label.description'); text(label.documentTypeKey, 'classifier.label.documentTypeKey', true);
      if ((label.displayName as string).length > 200 || (label.description as string).length > 1024) invalid('classifier.label', 'display name or description exceeds its bound.');
      if (key === 'Other' && label.documentTypeKey !== 'Other') invalid('classifier.label', 'Other must route to the reserved manual review target Other.');
      if (key !== 'Other' && !codes.has(label.documentTypeKey as string)) invalid('classifier.label', 'each non-Other label must reference a leaf in this bundle.');
    }
    if (definition.minimumConfidence !== undefined && (typeof definition.minimumConfidence !== 'number' || !Number.isFinite(definition.minimumConfidence) || definition.minimumConfidence < 0 || definition.minimumConfidence > 1)) invalid('classifier.minimumConfidence', 'must be between 0 and 1.');
  }
  const normalized = { ...structuredClone(manifest), documentTypes } as unknown as ContentUnderstandingManifest;
  const snapshots = Object.fromEntries(documentTypes.map(doc => [doc.code, doc.contentUnderstanding.analyzerDefinition]));
  if (Buffer.byteLength(JSON.stringify(snapshots), 'utf8') > CONTENT_UNDERSTANDING_MAX_BYTES) invalid('manifest', 'combined leaf snapshots exceed the 16 KiB admission budget.');
  return normalized;
}
