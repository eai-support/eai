import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { parseContentUnderstandingManifest, parseContentUnderstandingAnalyzer } from '../../src/lib/content-understanding-manifest.js';

const golden = JSON.parse(readFileSync(new URL('../../resources/content-understanding/contract-golden.json', import.meta.url), 'utf8'));
const manifest = () => structuredClone(golden.input);
const analyzer = () => manifest().documentTypes[0].contentUnderstanding.analyzerDefinition;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

describe('bounded Content Understanding manifest', () => {
  test('matches the actual Configurator/AICore golden normalization and canonical digest without inventing model defaults', () => {
    const value = parseContentUnderstandingManifest(golden.input);
    expect(value).toEqual(golden.normalized);
    expect(canonical(value)).toBe(golden.canonical);
    expect(createHash('sha256').update(canonical(value)).digest('hex')).toBe(golden.definitionDigest);
    expect(value.documentTypes[0].contentUnderstanding.analyzerDefinition.config).toEqual({ returnDetails: true, estimateFieldSourceAndConfidence: true });
    expect(golden.input.documentTypes[0].contentUnderstanding.analyzerDefinition.schemaVersion).toBeUndefined();
  });
  test.each(golden.numericEdges)('shared numeric edge $value retains the canonical spelling', (row: { value: number; canonical: string; digest: string }) => {
    const encoded = canonical({ minimumConfidence: row.value });
    expect(encoded).toBe(row.canonical); expect(createHash('sha256').update(encoded).digest('hex')).toBe(row.digest);
  });
  test('shared UTF16 ordering and integer-like key edges are stable', () => {
    expect(canonical(golden.unicode.input)).toBe(golden.unicode.canonical);
  });
  test.each(['\ud800', '\udfff'])('rejects a lone surrogate in values or authored object keys: %j', invalidUnicode => {
    const value = manifest(); value.documentTypes[0].description = invalidUnicode;
    expect(() => parseContentUnderstandingManifest(value)).toThrow('Unicode scalar');
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { Result: { type: 'string', method: 'classify', enum: ['Allowed'], enumDescriptions: { [invalidUnicode]: 'value' } } } } })).toThrow('Unicode scalar');
  });
  test('preserves paired surrogate emoji in authored descriptions', () => {
    const value = manifest(); value.documentTypes[0].description = 'Receive 📄 and review';
    expect(parseContentUnderstandingManifest(value).documentTypes[0].description).toBe(value.documentTypes[0].description);
  });
  test('description bounds use the common UTF16 code unit budget', () => {
    const value = manifest(); value.documentTypes[0].description = '📄'.repeat(512);
    expect(parseContentUnderstandingManifest(value).documentTypes[0].description).toBe(value.documentTypes[0].description);
    value.documentTypes[0].description += 'a'; expect(() => parseContentUnderstandingManifest(value)).toThrow('bounded string');
  });
  test('human names are preserved verbatim without one-sided trimming', () => {
    const value = manifest(); value.documentTypes[0].name = '  Human document name  ';
    expect(parseContentUnderstandingManifest(value).documentTypes[0].name).toBe(value.documentTypes[0].name);
  });
  test.each(['bundle', 'tenant', 'field', 'definition'])('rejects a final line terminator in exact %s identifiers', kind => {
    const value = manifest();
    if (kind === 'bundle') value.bundleKey += '\n';
    if (kind === 'tenant') value.tenantId += '\n';
    if (kind === 'field') value.documentTypes[0].contentUnderstanding.analyzerDefinition.fieldSchema.fields['Invalid\n'] = { type: 'string' };
    if (kind === 'definition') value.documentTypes[0].contentUnderstanding.analyzerDefinition.fieldSchema.definitions = { 'Invalid\n': { type: 'string' } };
    expect(() => parseContentUnderstandingManifest(value)).toThrow();
  });
  test('reserved Other represents manual review and cannot own or reference an analyzer leaf', () => {
    const value = manifest(); value.documentTypes[0].code = 'Other';
    expect(() => parseContentUnderstandingManifest(value)).toThrow('reserved');
    const classifier = manifest(); classifier.classifier.definition.labels.find((label: { key: string }) => label.key === 'Other').documentTypeKey = classifier.documentTypes[0].code;
    expect(() => parseContentUnderstandingManifest(classifier)).toThrow('manual review');
  });
  test.each(['description', 'category', 'classifier'])('optional manifest %s rejects authored null rather than treating it as omitted', property => {
    const value = manifest(); if (property === 'classifier') value.classifier = null; else value.documentTypes[0][property] = null;
    expect(() => parseContentUnderstandingManifest(value)).toThrow();
  });
  test.each(['string', 'date', 'time', 'number', 'integer', 'boolean', 'array', 'object', 'json'])('supports the actual typed %s field variant', type => {
    const field = { type, method: 'generate', ...(type === 'array' ? { items: { type: 'string' } } : {}),
      ...(type === 'object' ? { properties: { Name: { type: 'string' } } } : {}) };
    expect(parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { Result: field } } }).fieldSchema).toEqual({ fields: { Result: field } });
  });
  test.each(['extract', 'generate', 'classify'])('supports %s without coercing the field shape', method => {
    const field = { type: 'string', method, ...(method === 'classify' ? { enum: ['Goods', 'Other'], enumDescriptions: { Goods: 'Physical goods', Other: 'Everything else' } } : {}) };
    expect(parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { Result: field } } }).fieldSchema).toEqual({ fields: { Result: field } });
  });
  test.each([
    { config: { enableSegment: true } }, { config: { segmentPerPage: true } }, { config: { omitContent: true } },
    { config: { contentCategories: { Quote: { analyzerId: 'unowned' } } } }, { baseAnalyzerId: 'prebuilt-audio' },
    { modelProfile: 'arbitrary-deployment' }, { endpoint: 'https://azure.fixture.invalid' },
  ])('refuses unsupported provider/routing configuration locally: %j', patch => {
    expect(() => parseContentUnderstandingAnalyzer({ ...analyzer(), ...patch })).toThrow(/supported|unavailable/);
  });
  test.each(['true', 1, null])('switches are exact booleans: %j', value => {
    expect(() => parseContentUnderstandingAnalyzer({ ...analyzer(), config: { enableOcr: value } })).toThrow('exact boolean');
  });
  test('preserves explicit false switches and omitted field methods', () => {
    const value = parseContentUnderstandingAnalyzer({ config: { omitContent: false, enableSegment: false, segmentPerPage: false },
      fieldSchema: { fields: { Result: { type: 'string' } } } });
    expect(value.config).toEqual({ returnDetails: true, estimateFieldSourceAndConfidence: true, omitContent: false, enableSegment: false, segmentPerPage: false });
    expect(value.fieldSchema).toEqual({ fields: { Result: { type: 'string' } } });
  });
  test.each(['extract', undefined])('effective extraction evidence cannot be false for method %s', method => {
    expect(() => parseContentUnderstandingAnalyzer({ config: { estimateFieldSourceAndConfidence: false },
      fieldSchema: { fields: { Result: { type: 'string', ...(method ? { method } : {}) } } } })).toThrow('effective source');
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { Result: { type: 'string', method: 'extract', estimateSourceAndConfidence: false } } } })).toThrow('effective source');
  });
  test('supports finite reference chains and evidence overrides while rejecting cycles and structural overlays', () => {
    const fieldSchema = { fields: { Result: { $ref: '#/definitions/A' } }, definitions: { A: { $ref: '#/definitions/B' }, B: { type: 'string', method: 'extract' } } };
    expect(parseContentUnderstandingAnalyzer({ fieldSchema }).fieldSchema).toEqual(fieldSchema);
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { ...fieldSchema, definitions: { A: { $ref: '#/definitions/A' } } } })).toThrow('cycles');
    for (const overlay of [{ type: 'string' }, { method: 'generate' }, { examples: ['value'] }, { enum: ['value'] }]) {
      expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { ...fieldSchema, fields: { Result: { $ref: '#/definitions/A', ...overlay } } } })).toThrow('overlays');
    }
  });
  test.each([
    { type: 'array' }, { type: 'object' }, { type: 'string', properties: { Child: { type: 'string' } } },
    { type: 'string', method: 'classify' }, { type: 'string', method: 'classify', enum: ['Goods', 'Goods'] },
    { type: 'integer', method: 'classify', enum: ['Goods'] }, { type: 'string', enum: ['Goods'] },
    { type: 'string', method: 'classify', enum: ['Goods', 'Other'], enumDescriptions: { Goods: 'Goods' } },
    { type: 'string', description: 'Use {{customer}}' }, { $ref: 'https://schema.fixture.invalid' },
  ])('rejects invalid polymorphic fields before any backend admission: %j', field => {
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { Result: field } } })).toThrow();
  });
  test('enforces field-key, expanded-node and nesting limits including unused definitions', () => {
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { ['A'.repeat(65)]: { type: 'string' } } } })).toThrow('64');
    const fields = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`Field${index}`, { type: 'string' }]));
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { fields } })).toThrow('200');
    let field: Record<string, unknown> = { type: 'string' };
    for (let index = 0; index < 7; index++) field = { type: 'array', items: field };
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { Result: field } } })).toThrow('7');
    expect(() => parseContentUnderstandingAnalyzer({ fieldSchema: { fields: { Result: { type: 'string' } }, definitions: { Hidden: { type: 'unsupported' } } } })).toThrow('field type');
  });
  test('rejects mixed legacy authoring, duplicate codes, foreign label leaves and noncanonical tenants', () => {
    const value = manifest(); value.documentTypes[0].rules = [];
    expect(() => parseContentUnderstandingManifest(value)).toThrow('unsupported setting');
    const duplicate = manifest(); duplicate.documentTypes.push(structuredClone(duplicate.documentTypes[0])); expect(() => parseContentUnderstandingManifest(duplicate)).toThrow('unique');
    const foreign = manifest(); foreign.classifier.definition.labels[0].documentTypeKey = 'Foreign'; expect(() => parseContentUnderstandingManifest(foreign)).toThrow('leaf');
    const invalid = manifest(); invalid.tenantId = '11111111-1111-4111-8111-11111111111A'; expect(() => parseContentUnderstandingManifest(invalid)).toThrow('canonical UUID');
  });
  test('combined snapshots respect the existing queue admission budget', () => {
    const value = manifest(); value.classifier = undefined;
    value.documentTypes = Array.from({ length: 20 }, (_, index) => ({ code: `Document${index}`, name: `Document ${index}`,
      contentUnderstanding: { analyzerDefinition: { description: 'd'.repeat(1000), fieldSchema: { fields: { Result: { type: 'string' } } } } } }));
    expect(() => parseContentUnderstandingManifest(value)).toThrow('16 KiB');
  });
});
