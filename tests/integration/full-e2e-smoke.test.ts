import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ts from 'typescript';
import { findProjectRoot, loadEnvFile, validateObjectTypeDefinitions } from '../../src/lib/config.js';

interface CommandResult { status: number; stdout: string; stderr: string }
interface SmokeReport {
  status: string;
  summaryPath: string;
  projectRoot: string;
  cleanupVerified: boolean;
  cleanupStatus: string;
  coverageComplete: boolean;
  commands: { command: string; status: string; phase: string; exitCode?: number; scopeTenantId?: string }[];
  cleanup: { artifact: string; status: string; evidence?: { tenantId?: string }; reason?: string }[];
  coverage: { command: string; status: string; executions: number }[];
  created: { childTenantId: string; appKey: string; resources: { type: string; id: string }[]; entraClientId: string; workflowIds: string[];
    enrollmentId?: string; recreatedEnrollmentId?: string };
  deletionCycle?: { firstInventoryEmpty: boolean; recreatedSameKey: boolean; enrollmentId: string; recreatedEnrollmentId?: string };
  rotationCycle?: { commandDispatches: number; credentialChanged: boolean };
  workflowReadiness?: { workflowKey: string; status: string; reasonCode: string; executable: boolean };
  leftovers: { artifact: string; reason: string }[];
}
type ControlledOptions = { cwd: string; allowFailure: boolean; timeout: number; env: Record<string, string | undefined>; replaceEnv?: boolean };
type ControlledCall = { args: string[]; cwd: string };
type HarnessOptions = {
  runtime?: string;
  superAdmin?: boolean;
  parentRoles?: string[];
  override?: (args: string[], result: CommandResult, options: ControlledOptions) => CommandResult | undefined;
};

// Minimal producer contract, with imports and helper exports surrounding the
// data initializer. Schema details stay owned by the selected app template.
function producerObjectTypeSource(appKey: string): string {
  return `import type { ProducerTag } from './producer-tag';
export type StorageBackend = 'postgresql' | 'documentdb' | 'blob' | 'search';
export interface ObjectTypeDefinition {
  name: string;
  slug: string;
  displayName: string;
  description?: string;
  authorization?: { privacyClass: 'owner_private' | 'shared_private' };
  properties: { name: string; type: string; required: boolean; indexed?: boolean }[];
  linkTypes: unknown[];
  actions: unknown[];
  storageBackend: StorageBackend;
  status: 'draft' | 'published' | 'deprecated';
  schemaVersion?: number;
  storageMetadataStatus?: 'draft' | 'ready';
  storageBinding?: { sql?: { databaseAlias: 'tenant-postgres'; tenantSchemaStrategy: 'per-tenant-schema'; tableName: string } };
  producerTag?: ProducerTag;
}
function producerPrefixHelper(): StorageBackend { return 'postgresql'; }
export const objectTypes: Record<string, ObjectTypeDefinition[]> = { ${JSON.stringify(appKey)}: [] };
export function producerSuffixHelper(): StorageBackend { return producerPrefixHelper(); }
export const producerSuffixSentinel = 'unchanged';
`;
}

function fixtureObjectTypesFromSource(source: string): Record<string, { name: string; slug: string; storageBackend: string }[]> {
  const file = ts.createSourceFile('object-types.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
    .find(value => ts.isIdentifier(value.name) && value.name.text === 'objectTypes');
  const initializer = declaration?.initializer;
  if (initializer && ts.isCallExpression(initializer) && initializer.expression.getText(file) === 'JSON.parse'
    && initializer.arguments.length === 1 && ts.isStringLiteral(initializer.arguments[0])) {
    return JSON.parse(initializer.arguments[0].text);
  }
  if (initializer && ts.isObjectLiteralExpression(initializer)) {
    return Object.fromEntries(initializer.properties.map(property => {
      if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) || !ts.isArrayLiteralExpression(property.initializer)) {
        throw new Error('Unexpected controlled Object Type initializer.');
      }
      return [property.name.text, JSON.parse(property.initializer.getText(file))];
    }));
  }
  throw new Error('Missing controlled Object Type initializer.');
}

function fixtureTypeDiagnostics(paths: string[]): readonly ts.Diagnostic[] {
  const program = ts.createProgram(paths, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: [] });
  return ts.getPreEmitDiagnostics(program);
}

describe('smoke Object Type producer module compatibility', () => {
  const roots: string[] = [];
  const runId = '20261008123456';
  function project() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-smoke-types-producer-'))); roots.push(dir);
    const modelDir = join(dir, 'src', 'eai.config'); mkdirSync(modelDir, { recursive: true });
    const model = join(modelDir, 'object-types.ts');
    const original = producerObjectTypeSource('fixture-app'); writeFileSync(model, original);
    writeFileSync(join(modelDir, 'producer-tag.ts'), "export type ProducerTag = 'producer-owned';\n");
    const consumer = join(modelDir, 'consumer.ts');
    writeFileSync(consumer, `import { objectTypes, producerSuffixHelper, producerSuffixSentinel } from './object-types';
import type { ObjectTypeDefinition, StorageBackend } from './object-types';
const tenantKey: string = 'arbitrary-runtime';
const types: ObjectTypeDefinition[] = objectTypes[tenantKey];
const backend: StorageBackend = producerSuffixHelper();
const seedInput: (typeof objectTypes)[keyof typeof objectTypes][number] = {
  name: 'CallerRecord', slug: 'caller-record', displayName: 'Caller Record',
  properties: [], linkTypes: [], actions: [], storageBackend: backend, status: 'draft',
  authorization: { privacyClass: 'owner_private' },
};
const optionalPolicy = seedInput.authorization?.privacyClass;
const description: string | undefined = seedInput.description;
// @ts-expect-error The retained producer type is a strict backend union.
const unsupportedBackend: StorageBackend = 'unsupported';
// @ts-expect-error A retained model definition still requires a string name.
const invalidModel: ObjectTypeDefinition = { ...seedInput, name: 42 };
void [types, seedInput, optionalPolicy, description, producerSuffixSentinel];
`);
    return { dir, model, consumer, original };
  }
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  test('replaces only the initializer and compiles producer exports, dynamic keys and optional seed fields', () => {
    const fixture = project();
    const before = ts.createSourceFile(fixture.model, fixture.original, ts.ScriptTarget.Latest, true);
    const declaration = before.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
      .find(value => ts.isIdentifier(value.name) && value.name.text === 'objectTypes')!;
    writeSmokeObjectTypes(fixture.dir, 'fixture-app', runId, 'owned-runtime');
    const rewritten = readFileSync(fixture.model, 'utf8');
    expect(rewritten.startsWith(fixture.original.slice(0, declaration.initializer!.getStart(before)))).toBe(true);
    expect(rewritten.endsWith(fixture.original.slice(declaration.initializer!.end))).toBe(true);
    expect(fixtureObjectTypesFromSource(rewritten)).toEqual({ 'fixture-app': smokeObjectTypes('fixture-app', runId, 'owned-runtime') });
    expect(fixtureTypeDiagnostics([fixture.consumer]).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });

  test('the compiler detects the old overwrite missing-export and literal-key regression', () => {
    const fixture = project();
    writeFileSync(fixture.model, `export const objectTypes = { 'fixture-app': ${JSON.stringify(smokeObjectTypes('fixture-app', runId, 'owned-runtime'))} };\n`);
    const diagnostics = fixtureTypeDiagnostics([fixture.consumer]);
    expect(diagnostics.some(diagnostic => diagnostic.code === 2305)).toBe(true);
    expect(diagnostics.some(diagnostic => diagnostic.code === 7053)).toBe(true);
  });

  test.each([
    ['untyped', (source: string) => source.replace(': Record<string, ObjectTypeDefinition[]>', '')],
    ['missing-export', (source: string) => source.replace('export const objectTypes', 'const objectTypes')],
    ['mutable', (source: string) => source.replace('export const objectTypes', 'export let objectTypes')],
    ['missing-model', (source: string) => source.replace('export interface ObjectTypeDefinition', 'interface ObjectTypeDefinition')],
    ['missing-backend', (source: string) => source.replace('export type StorageBackend', 'type StorageBackend')],
    ['duplicate-types', (source: string) => source.replace('export type StorageBackend', 'type StorageBackend') + '\nexport interface ObjectTypeDefinition { extra?: string }\n'],
    ['duplicate-data', (source: string) => source + '\nexport const objectTypes = {};\n'],
    ['unexpected-initializer', (source: string) => source.replace('{ "fixture-app": [] }', 'loadUnverifiedTypes()')],
    ['invalid-syntax', (source: string) => source + '\nexport const invalid = ;\n'],
  ])('rejects %s producer layouts without changing any source bytes', (_kind, mutate) => {
    const fixture = project(); const source = mutate(fixture.original); writeFileSync(fixture.model, source);
    expect(() => writeSmokeObjectTypes(fixture.dir, 'fixture-app', runId, 'owned-runtime')).toThrow('expected producer types');
    expect(readFileSync(fixture.model, 'utf8')).toBe(source);
  });
});

describe('isolated full lifecycle caller (controlled, no live writes)', () => {
  const fixtureRoots: string[] = [];
  const clientId = '11111111-1111-4111-8111-111111111111';
  const privateSecret = 'test-only-credential-do-not-persist-in-evidence';
  const ok = (body: unknown): CommandResult => ({ status: 0, stdout: JSON.stringify(body), stderr: '' });
  const gone: CommandResult = { status: 1, stdout: JSON.stringify({ ok: false, status: 404 }), stderr: '' };
  const denied: CommandResult = { status: 1, stdout: JSON.stringify({ ok: false, status: 403 }), stderr: '' };
  const flag = (args: string[], name: string): string => args[args.indexOf(name) + 1] || '';
  const matches = (args: string[], prefix: string[]) => prefix.every((part, index) => args[index] === part);

  // The receiver forbids unknown property and storage-binding fields. Local
  // types validate alone does not establish this deployed manifest contract.
  const manifestPropertyFields = new Set(['name', 'type', 'label', 'required', 'indexed', 'defaultValue', 'options',
    'description', 'serverOnly', 'customizationEligibility']);
  const manifestStorageFields: Record<string, Set<string>> = {
    sql: new Set(['databaseAlias', 'tenantSchemaStrategy', 'schemaName', 'tableName', 'tenantIdField', 'indexes']),
    documentdb: new Set(['databaseAlias', 'databaseName', 'collectionName', 'partitionKey', 'indexes']),
    blob: new Set(['storageAccountAlias', 'containerName', 'blobPrefix', 'metadataSchema']),
    search: new Set(['searchServiceAlias', 'indexName', 'sourceObjectTypes', 'fieldMappings']),
  };
  function unsupportedManifestFields(definitions: { properties: Record<string, unknown>[]; storageBinding: Record<string, Record<string, unknown>> }[]): string[] {
    return definitions.flatMap(type => [
      ...type.properties.flatMap(property => Object.keys(property).filter(key => !manifestPropertyFields.has(key)).map(key => 'properties.' + key)),
      ...Object.entries(type.storageBinding).flatMap(([backend, binding]) => Object.keys(binding)
        .filter(key => !manifestStorageFields[backend]?.has(key)).map(key => 'storageBinding.' + backend + '.' + key)),
    ]);
  }

  afterEach(() => {
    for (const path of fixtureRoots.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  function harness(settings: HarnessOptions = {}) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-smoke-controlled-')));
    fixtureRoots.push(dir);
    const preflight = join(dir, 'preflight.json');
    const observedAt = new Date().toISOString();
    writeFileSync(preflight, JSON.stringify({
      schemaVersion: 'eai.cli-child-cleanup-preflight.v1',
      publicApiUrl: 'https://dev-api.au.myenterprise.ai/public',
      parentTenantId: 'qa-parent', actorId: 'qa-actor', observedAt,
      publicApiGitSha: 'a'.repeat(40), adminApiGitSha: 'b'.repeat(40),
      childDeleteRoute: '/v4/platform/tenants/{parent}/children/{child}/delete', childDeleteVerified: true,
    }), { mode: 0o600 });
    const env: Record<string, string> = {
      EAI_E2E_TEST_PROFILE: 'dev-qa', EAI_E2E_TEST_USERNAME: 'qa@example.invalid',
      EAI_E2E_PARENT_TENANT_ID: 'qa-parent', EAI_E2E_TEST_USER_OID: 'qa-actor',
      EAI_E2E_CLEANUP_PREFLIGHT: preflight, EAI_E2E_OUTPUT_ROOT: dir, EAI_E2E_RUN_ID: '20261008123456',
    };
    const runtime = settings.runtime || 'run-child';
    let appKey = '';
    let appExists = false;
    let appCreations = 0;
    let enrollmentId = 'run-enrollment';
    const deletedTenants = new Set<string>();
    let nextId = 0;
    let invited = false;
    const resources = new Map<string, { type: string; data: Record<string, unknown> }>();
    const calls: ControlledCall[] = [];
    function generatedArtifacts(cwd: string): Record<string, string> {
      const content = readFileSync(join(cwd, 'src', 'eai.config', 'object-types.ts'), 'utf8');
      const definitions = fixtureObjectTypesFromSource(content)[appKey];
      // A controlled producer fixture: both artifacts depend on the current
      // Object Type source, so generating before its replacement cannot qualify.
      const identifiers = Object.fromEntries(['postgresql', 'documentdb', 'blob', 'search'].map(backend => [
        backend, definitions.filter(type => type.storageBackend === backend).map(({ name, slug }) => ({ name, slug })),
      ]));
      return {
        'object-types.json': JSON.stringify({ [appKey]: definitions }, null, 2) + '\n',
        'object-types.provisioning.json': JSON.stringify([{ tenantKey: appKey, objectTypeIdentifiersByBackend: identifiers }], null, 2) + '\n',
      };
    }
    function generatedArtifactsCurrent(cwd: string): boolean {
      return Object.entries(generatedArtifacts(cwd)).every(([name, expected]) => {
        const path = join(cwd, 'src', 'eai.config', name);
        return existsSync(path) && readFileSync(path, 'utf8') === expected;
      });
    }
    function base(args: string[], options: ControlledOptions): CommandResult {
      if (matches(args, ['run', 'build:object-types'])) {
        for (const [name, contents] of Object.entries(generatedArtifacts(options.cwd))) {
          writeFileSync(join(options.cwd, 'src', 'eai.config', name), contents);
        }
        return { status: 0, stdout: privateSecret, stderr: '' };
      }
      if (matches(args, ['run', 'check:object-types']) || matches(args, ['run', 'build'])) {
        return generatedArtifactsCurrent(options.cwd) ? { status: 0, stdout: privateSecret, stderr: '' }
          : { status: 1, stdout: '', stderr: 'Generated Object Type artifacts are stale; run npm run build:object-types.' };
      }
      if (matches(args, ['whoami'])) return { status: 0,
        stdout: 'Logged in as qa@example.invalid\nPublicAPI  https://dev-api.au.myenterprise.ai/public\n', stderr: '' };
      if (matches(args, ['tenant', 'list'])) return ok({ tenants: [{ id: 'qa-parent' }] });
      if (matches(args, ['tenant', 'info'])) return ok({ id: args[2] });
      if (matches(args, ['tenant', 'create'])) return ok({ tenant: { id: 'run-child', slug: flag(args, '--slug'), parentTenantId: 'qa-parent' } });
      if (matches(args, ['tenant', 'bootstrap-admin'])) return ok({ parentTenantId: flag(args, '--parent'),
        childTenantId: flag(args, '--child'), userOid: flag(args, '--user-oid'), usable: true,
        membershipCreated: false, adminAssigned: false, status: 'already-usable' });
      if (matches(args, ['tenant', 'delete'])) {
        deletedTenants.add(args[2]);
        return ok({ id: args[2], deleted: true, hardPurged: true,
          response: { status: 'hard_purged', parentTenantId: flag(args, '--parent') } });
      }
      if (matches(args, ['app', 'create'])) {
        appKey = flag(args, '--key'); appExists = true; appCreations++;
        enrollmentId = appCreations === 1 ? 'run-enrollment' : 'recreated-enrollment';
        return ok({ tenantId: 'run-child', appKey,
          response: { tenantId: 'run-child', appKey, verticalKey: appKey,
            app: { id: enrollmentId, tenantId: 'run-child', parentTenantId: 'run-child', verticalKey: appKey,
              ...(appCreations === 1 || runtime !== 'run-child' ? { childTenantId: runtime } : {}) }, childTenant: { id: runtime },
            created: { app: true, childTenant: runtime !== 'run-child' } } });
      }
      if (matches(args, ['init'])) {
        mkdirSync(join(options.cwd, 'src', 'eai.config'), { recursive: true, mode: 0o700 });
        writeFileSync(join(options.cwd, 'src', 'eai.config', 'object-types.ts'), producerObjectTypeSource(appKey));
        writeFileSync(join(options.cwd, 'src', 'eai.config', 'producer-tag.ts'), "export type ProducerTag = 'producer-owned';\n");
        writeFileSync(join(options.cwd, 'src', 'eai.config', 'object-types.json'), JSON.stringify({ [appKey]: [] }) + '\n');
        writeFileSync(join(options.cwd, 'src', 'eai.config', 'object-types.provisioning.json'), '[]\n');
        writeFileSync(join(options.cwd, 'eai.runtime.json'), '{}\n');
        writeFileSync(join(options.cwd, '.env.local'),
          'EAI_PARENT_TENANT_ID=run-child\nEAI_TENANT_ID=' + runtime + '\nEAI_APP_KEY=' + appKey + '\n', { mode: 0o600 });
        return ok({ initialized: true });
      }
      if (matches(args, ['app', 'list'])) return ok({ apps: appExists ? [{ id: enrollmentId, data: { verticalKey: appKey } }] : [] });
      if (matches(args, ['app', 'provision'])) return ok({ tenantId: 'run-child', targetTenantId: runtime, appKey,
        provisioning: { tenantId: 'run-child', appKey, jobId: 'app-prov-owned', status: 'ready', enrollment: { childTenantId: runtime } } });
      if (matches(args, ['app', 'delete'])) {
        appExists = false;
        return ok({ schemaVersion: 'eai.app-deletion-receipt.v1', tenantId: 'run-child', appKey, status: 'deleted',
          operationId: 'run-app-deletion', verified: true, runtimeTenantIds: [...new Set(['run-child', runtime])] });
      }
      if (matches(args, ['user', 'list'])) {
        if (!existsSync(join(options.cwd, 'eai.config.ts')) && !existsSync(join(options.cwd, 'eai.runtime.json'))
          && !existsSync(join(options.cwd, 'src', 'eai.config', 'object-types.ts')))
          return { status: 1, stdout: JSON.stringify({ error: { code: 'E001' } }), stderr: '' };
        const fixture = flag(args, '--search') === 'fixture@example.invalid';
        return ok({ data: fixture ? (flag(args, '--tenant') === 'qa-parent' || invited
          ? [{ email: 'fixture@example.invalid', userId: 'existing-user' }] : [])
          : [{ email: 'qa@example.invalid', userId: 'qa-actor' }] });
      }
      if (matches(args, ['user', 'invite']) || matches(args, ['user', 'role', 'set'])) {
        if (flag(args, '--email') === 'not-an-email') return denied;
        invited = true;
        return ok({ inviteMode: 'existing_user_reused', userId: 'existing-user', email: 'fixture@example.invalid' });
      }
      if (matches(args, ['blocks', 'list'])) return ok({ blocks: [{ id: 'fixture-block' }] });
      if (matches(args, ['types', 'seed'])) {
        const content = readFileSync(join(options.cwd, 'src', 'eai.config', 'object-types.ts'), 'utf8');
        const definitions = fixtureObjectTypesFromSource(content)[appKey];
        const issues = unsupportedManifestFields(definitions);
        return issues.length ? { status: 1, stdout: JSON.stringify({ status: 422, error: issues }), stderr: '' } : ok({ seeded: true });
      }
      if (matches(args, ['resources', 'create'])) {
        const id = 'resource-' + ++nextId;
        const data = JSON.parse(flag(args, '--data')) as Record<string, unknown>;
        resources.set(id, { type: args[2], data }); return ok({ id, data });
      }
      if (matches(args, ['resources', 'get'])) {
        const row = resources.get(args[3]); return row ? ok({ id: args[3], data: row.data }) : gone;
      }
      if (matches(args, ['resources', 'update'])) {
        const row = resources.get(args[3]);
        if (row) row.data = JSON.parse(flag(args, '--data')) as Record<string, unknown>;
        return row ? ok({ id: args[3], data: row.data }) : gone;
      }
      if (matches(args, ['resources', 'delete'])) { resources.delete(args[3]); return ok({ deleted: true, id: args[3] }); }
      if (matches(args, ['resources', 'file', 'get'])) {
        writeFileSync(flag(args, '--output'), readFileSync(join(options.cwd, 'smoke-file.txt')));
        return ok({ downloaded: true });
      }
      if (matches(args, ['resources', 'batch-create']) || matches(args, ['resources', 'batch-import'])) {
        const rows = JSON.parse(readFileSync(flag(args, '--file'), 'utf8')) as Record<string, unknown>[];
        const results = rows.map(data => {
          const id = 'resource-' + ++nextId; resources.set(id, { type: args[2], data }); return { id, data };
        });
        return ok({ results, succeeded: results.length, failed: 0 });
      }
      if (matches(args, ['resources', 'batch-update'])) {
        const rows = JSON.parse(readFileSync(flag(args, '--file'), 'utf8')) as { id: string; data: Record<string, unknown> }[];
        for (const row of rows) { const saved = resources.get(row.id); if (saved) saved.data = row.data; }
        return ok({ succeeded: rows.length, failed: 0 });
      }
      if (matches(args, ['resources', 'batch-delete'])) {
        const rows = JSON.parse(readFileSync(flag(args, '--file'), 'utf8')) as { id: string }[];
        for (const row of rows) resources.delete(row.id); return ok({ succeeded: rows.length, failed: 0 });
      }
      if (matches(args, ['resources', 'list'])) return ok({ docs: [...resources].filter(([, row]) => row.type === args[2]).map(([id]) => ({ id })) });
      if (matches(args, ['resources', 'query'])) {
        const selected = flag(args, '--types').split(',');
        // Model the deployed ResourceAPI placement boundary: these PostgreSQL
        // fixtures use a dedicated tenant database, separate from DocumentDB shadows.
        if (selected.some(type => type.startsWith('eai-smoke-pg'))
          && selected.some(type => !type.startsWith('eai-smoke-pg'))) {
          return { status: 1, stdout: JSON.stringify({ error: { code: 'STORAGE_ROUTE_UNAVAILABLE' } }), stderr: '503 Service Unavailable' };
        }
        const results = [...resources].filter(([, row]) => selected.includes(row.type))
          .map(([id, row]) => ({ [row.type]: { id, data: row.data } }));
        return ok({ results, totalResults: results.length });
      }
      if (matches(args, ['resources', 'search'])) return ok({ results: [...resources].filter(([, row]) => row.data.body === args[2]).map(([id]) => ({ id })) });
      if (matches(args, ['workflow', 'provision'])) {
        const file = join(options.cwd, '.env.local');
        writeFileSync(file, readFileSync(file, 'utf8') + 'NEXT_PUBLIC_SMOKE_WORKFLOW_ID=run-workflow\n', { mode: 0o600 });
        const key = args[2];
        resources.set('run-workflow', { type: 'shared-workflow-config', data: { tenantId: runtime, workflowKey: key,
          status: 'active', consumedBy: [appKey], definition: { workflowDefinition: { stages: [{ id: 'chat', code: 'chat' }] } } } });
        resources.set('run-workflow-app', { type: 'vertical-product-config', data: { tenantId: runtime, verticalKey: appKey,
          configKey: 'workflow:' + key, config: { workflowKey: key, setupStatus: 'completed', setup: { stageIds: { chat: 'chat' } } } } });
        const aiRuntime = args.includes('--bind-ai-runtime') ? [
          { objectType: 'shared-ai-profile', id: 'run-ai-profile', key: key + '-default-model', action: 'created' },
          { objectType: 'shared-chatbot-config', id: 'run-chatbot-config', key: key + '-chat', action: 'created' },
        ] : [];
        for (const row of aiRuntime) resources.set(row.id, { type: row.objectType, data: { tenantId: runtime, key: row.key } });
        return ok({ tenantId: runtime,
          workflow: { objectType: 'shared-workflow-config', id: 'run-workflow', workflowKey: key, action: 'created' },
          app: { objectType: 'vertical-product-config', id: 'run-workflow-app', appKey, configKey: 'workflow:' + key, action: 'created' },
          aiRuntime, env: { NEXT_PUBLIC_SMOKE_WORKFLOW_ID: 'run-workflow' } });
      }
      if (matches(args, ['workflow', 'status'])) return ok({ tenantId: runtime, workflowKey: args[2], status: 'available',
        reasonCode: 'runtime_workflow_available', runtimeWorkflowRef: 'rwf_fixture' });
      if (matches(args, ['chat', 'send'])) return { status: 0, stdout: 'READY', stderr: '' };
      if (matches(args, ['provision', 'entra'])) {
        const file = join(options.cwd, '.env.local');
        if (!args.includes('--deauthorize')) writeFileSync(file, readFileSync(file, 'utf8').replace(/^ENTRA_CLIENT_(ID|SECRET)=.*\n/gm, '')
          + 'ENTRA_CLIENT_ID=' + clientId + '\nENTRA_CLIENT_SECRET=' + privateSecret
          + (args.includes('--rotate-secret') ? '-rotated' : '') + '\n', { mode: 0o600 });
        return { status: 0, stdout: 'client_secret=' + privateSecret, stderr: '' };
      }
      if (matches(args, ['app', 'auth', 'status'])) return ok({ tenantAuthorizedApps: { status: 'authorized' } });
      if (matches(args, ['deploy', 'app'])) return ok({ tenantId: 'run-child', targetTenantId: runtime, appKey,
        classification: 'succeeded', operationId: 'run-deploy', activeUrl: 'https://fixture.example.invalid', deploymentId: 'run-deployment' });
      if (matches(args, ['deploy', 'doctor'])) return ok({ status: 'pass' });
      if (matches(args, ['publicapi', 'post', '/v4/platform/capabilities/evaluate']))
        return ok({ ok: true, status: 200, body: { outcome: 'allow', reasonCode: 'subscription_active' } });
      if (matches(args, ['publicapi', 'delete'])) return ok({ ok: true, status: 200,
        body: { tenantId: runtime, clientId, tenantDeauthorization: { removed: false, alreadyAbsent: true }, appRegistrationFound: false,
          appRegistrationDeleted: false, appRegistrationAlreadyAbsent: true, appRegistrationAbsenceVerified: true } });
      if (matches(args, ['publicapi', 'get'])) {
        const path = args[2];
        if (path === '/v4/identity/me') return ok({ ok: true, status: 200, body: { oid: 'qa-actor', email: 'qa@example.invalid' } });
        if (path.includes('/users/qa-actor/memberships')) return ok({ ok: true, status: 200, body: {
          superAdmin: settings.superAdmin ?? false, tenants: [{ id: 'qa-parent', roles: settings.parentRoles ?? ['tenant-admin'], isActive: true }],
        } });
        if (path.endsWith('/deletion-plan')) return ok({ ok: true, status: 200, body: { tenantId: 'run-child', appKey,
          cleanupContract: 'eai.app-scoped-cleanup.v2', runtimeTenantIds: [...new Set(['run-child', runtime])] } });
        if (path.includes('/children?')) {
          const id = path.split('/').at(-2) || '';
          const children = id === 'qa-parent' ? ['run-child'] : id === 'run-child' && runtime !== 'run-child' ? [runtime] : [];
          return ok({ ok: true, status: 200, body: children.filter(child => !deletedTenants.has(child)).map(child => ({ id: child })) });
        }
        if (path.endsWith('/management')) {
          const id = path.split('/').at(-2) || '';
          return deletedTenants.has(id) ? gone : ok({ ok: true, status: 200, body: { id, parentTenantId: id === runtime ? 'run-child' : 'qa-parent' } });
        }
        if (path.startsWith('/v4/data/resources/')) {
          const id = decodeURIComponent(path.split('/').at(-1) || '');
          return resources.has(id) ? ok({ ok: true, status: 200, body: { id } }) : gone;
        }
      }
      return ok({ ok: true });
    }
    const execute = (_command: unknown, invocation: string[], options: ControlledOptions) => {
      const args = invocation[0] === '--profile' ? invocation.slice(2) : invocation;
      if (invocation[0] === '--profile') expect(invocation[1]).toBe('dev-qa');
      expect(options.allowFailure).toBe(true);
      expect(options.timeout).toBeGreaterThan(0);
      calls.push({ args, cwd: options.cwd });
      const result = base(args, options);
      return settings.override?.(args, result, options) || result;
    };
    return { env, calls, dir, preflight, resources,
      run: (overrides: Record<string, string> = {}): SmokeReport => runLiveSmoke(cliPath, {
        env: { ...env, ...overrides }, execute, log: () => {}, wait: () => {},
        uuid: () => '12345678-1234-4234-8234-123456789abc',
      }) };
  }

  function failure(controlled: ReturnType<typeof harness>, env: Record<string, string> = {}): Error & { report: SmokeReport; summaryPath: string } {
    try { controlled.run(env); } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return error as Error & { report: SmokeReport; summaryPath: string };
    }
    throw new Error('Expected controlled lifecycle failure');
  }

  test('Entra idempotent cleanup proves exact runtime deauthorization plus authoritative registration absence', () => {
    const controlled = harness();
    const report = controlled.run({ EAI_E2E_PROVISION_ENTRA: '1' });
    expect(report.cleanupVerified).toBe(true);
    expect(report.cleanup.find(row => row.artifact === 'entra-registration')?.evidence).toMatchObject({
      clientId, tenantId: 'run-child', authorizationAbsent: true, registrationAbsent: true, registrationAbsenceVerified: true,
    });
  });

  test.each([
    { label: 'wrong-client', change: { clientId: 'foreign-client' } },
    { label: 'wrong-tenant', change: { tenantId: 'foreign-tenant' } },
    { label: 'redacted-deauthorization', change: { tenantDeauthorization: '[redacted]' } },
    { label: 'serialized-deauthorization', change: { tenantDeauthorization: '{"removed":false,"alreadyAbsent":true}' } },
    { label: 'unproved-deauthorization', change: { tenantDeauthorization: { removed: false, alreadyAbsent: false } } },
    { label: 'truthy-deauthorization', change: { tenantDeauthorization: { removed: 'true', alreadyAbsent: false } } },
    { label: 'contradictory-deauthorization', change: { tenantDeauthorization: { removed: true, alreadyAbsent: true } } },
    { label: 'only-found-false', change: { appRegistrationAlreadyAbsent: undefined, appRegistrationAbsenceVerified: undefined } },
    { label: 'unverified-registration', change: { appRegistrationAbsenceVerified: false } },
    { label: 'truthy-registration', change: { appRegistrationAbsenceVerified: 'true' } },
    { label: 'contradictory-action', change: { appRegistrationDeleted: true } },
    { label: 'no-registration-action', change: { appRegistrationAlreadyAbsent: false } },
  ])('Entra cleanup rejects $label receipt and retains unverified cleanup evidence', ({ change }) => {
    const controlled = harness({ override(args, result) {
      if (!matches(args, ['publicapi', 'delete']) || !args[2].includes('/provisioning/entra-apps/')) return undefined;
      const receipt = JSON.parse(result.stdout);
      return ok({ ...receipt, body: { ...receipt.body, ...change } });
    } });
    const report = failure(controlled, { EAI_E2E_PROVISION_ENTRA: '1' }).report;
    expect(report.cleanupVerified).toBe(false);
    expect(report.cleanup.find(row => row.artifact === 'entra-registration')?.status).toBe('failed');
    expect(report.leftovers.some(row => row.artifact === 'entra-registration')).toBe(true);
  });

  test.each(['EAI_E2E_TEST_PROFILE', 'EAI_E2E_TEST_USERNAME', 'EAI_E2E_PARENT_TENANT_ID', 'EAI_E2E_CLEANUP_PREFLIGHT'])(
    'requires explicit %s before executing any CLI command', key => {
      const controlled = harness(); const error = failure(controlled, { [key]: '' });
      expect(error.report.status).toBe('blocked'); expect(controlled.calls).toEqual([]);
      expect(error.report.coverage.every(row => ['not-run', 'unsupported'].includes(row.status))).toBe(true);
    });

  test.each([{ EAI_E2E_CLEANUP: '0' }, { EAI_E2E_CREATE_CHILD_TENANT: '0' }, { EAI_E2E_DOCS: '1' },
    { EAI_E2E_INDEXES_APPLY: '1' },
    { EAI_E2E_WORKFLOW_KEY: 'preexisting' }, { EAI_E2E_ENV_MUTATION: '1' }, { EAI_E2E_CHAT: '1' }])(
    'blocks unsupported or unowned requested lane before CLI writes: %j', env => {
      const controlled = harness(); expect(failure(controlled, env).report.status).toBe('blocked'); expect(controlled.calls).toEqual([]);
    });

  test('tenant-admin can qualify parent cleanup without Configurator superAdmin; viewer cannot create artifacts', () => {
    const allowed = harness({ superAdmin: false }); expect(allowed.run().status).toBe('passed');
    const deniedCaller = harness({ parentRoles: ['tenant-viewer'] }); const error = failure(deniedCaller);
    expect(error.report.status).toBe('blocked');
    expect(deniedCaller.calls.some(call => matches(call.args, ['tenant', 'create']))).toBe(false);
  });

  test.each([[], [{ id: 'other-parent' }], [{ id: 'qa-parent', isActive: false }], [{ id: 'qa-parent', directMembership: false }]])(
    'inaccessible supplied parent blocks before selection or creation: %j', tenants => {
      const controlled = harness({ override: args => matches(args, ['tenant', 'list']) ? ok({ tenants }) : undefined });
      const report = failure(controlled).report;
      expect(report.status).toBe('blocked'); expect(report.cleanupStatus).toBe('not-needed');
      expect(controlled.calls.some(call => matches(call.args, ['tenant', 'select']))).toBe(false);
      expect(controlled.calls.some(call => matches(call.args, ['tenant', 'create']))).toBe(false);
    });

  test('optional invitation verifies existing identity from an actual private parent read project before any creation', async () => {
    const controlled = harness();
    const report = controlled.run({ EAI_E2E_INVITE_TEST_USER: 'fixture@example.invalid', EAI_E2E_INVITE_TEST_USER_OID: 'existing-user' });
    expect(report.status).toBe('passed');
    const index = controlled.calls.findIndex(call => matches(call.args, ['user', 'list']) && call.args.includes('qa-parent'));
    const preflightCall = controlled.calls[index];
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(controlled.calls.findIndex(call => matches(call.args, ['tenant', 'create'])));
    expect(preflightCall.cwd).not.toBe(report.projectRoot);
    expect(await findProjectRoot(preflightCall.cwd)).toBe(preflightCall.cwd);
    const env = await loadEnvFile(preflightCall.cwd);
    expect(env).toEqual({ EAI_PROFILE: 'dev-qa', BASE_URL_PUBLIC_API: 'https://dev-api.au.myenterprise.ai/public',
      ROUTING_BOOTSTRAP_PUBLIC_API_URL: 'https://dev-api.au.myenterprise.ai/public', EAI_TENANT_ID: 'qa-parent' });
    expect(statSync(preflightCall.cwd).mode & 0o777).toBe(0o700);
    expect(statSync(join(preflightCall.cwd, '.env.local')).mode & 0o777).toBe(0o600);
    expect(statSync(join(preflightCall.cwd, 'eai.config.ts')).mode & 0o777).toBe(0o600);
  });

  test('child creation accepts its exact Payload parent reference and refuses an explicit reused tenant', () => {
    const reference = harness({ override(args, result) {
      if (!matches(args, ['tenant', 'create'])) return undefined;
      const body = JSON.parse(result.stdout);
      body.tenant.parentTenant = { id: body.tenant.parentTenantId }; delete body.tenant.parentTenantId;
      return ok(body);
    } });
    expect(reference.run().status).toBe('passed');
    const reused = harness({ override(args, result) {
      if (!matches(args, ['tenant', 'create'])) return undefined;
      const body = JSON.parse(result.stdout); body.tenant.reused = true; return ok(body);
    } });
    const report = failure(reused).report;
    expect(report.status).toBe('failed'); expect(report.created.childTenantId).toBe('');
    expect(reused.calls.some(call => matches(call.args, ['tenant', 'delete']))).toBe(false);
  });

  test('rejects a production endpoint override before auth or writes', () => {
    const controlled = harness();
    expect(failure(controlled, { EAI_E2E_EXPECTED_PUBLIC_API: 'https://api.au.myenterprise.ai/public' }).report.status).toBe('blocked');
    expect(controlled.calls).toEqual([]);
  });

  test('subscription denial is blocked before writes with stable reason and no upgrade URL in evidence', () => {
    const controlled = harness({ override: args => matches(args, ['publicapi', 'post', '/v4/platform/capabilities/evaluate'])
      ? ok({ ok: true, status: 200, body: { outcome: 'deny', reasonCode: 'subscription_inactive',
        upgradeUrl: 'https://billing.example.invalid/private-upgrade' } }) : undefined });
    const error = failure(controlled);
    expect(error.report.status).toBe('blocked'); expect(error.message).toContain('subscription_inactive');
    expect(controlled.calls.some(call => matches(call.args, ['tenant', 'create']))).toBe(false);
    expect(error.report.leftovers).toEqual([]);
    expect(error.report.cleanupVerified).toBe(false); expect(error.report.cleanupStatus).toBe('not-needed');
    expect(error.report.cleanup).toEqual([]);
    expect(readFileSync(error.summaryPath, 'utf8')).not.toContain('private-upgrade');
  });

  test.each(['wrong-actor', 'wrong-api', 'stale-receipt', 'wrong-revision'])('blocks %s before tenant creation', kind => {
    const controlled = harness({ override(args, result) {
      if (kind === 'wrong-actor' && matches(args, ['publicapi', 'get', '/v4/identity/me']))
        return ok({ ok: true, body: { oid: 'other', email: 'other@example.invalid' } });
      if (kind === 'wrong-api' && args[0] === 'whoami') return { ...result, stdout: 'PublicAPI https://dev-api.au.myenterprise.ai/public.evil\n' };
      return undefined;
    } });
    const receipt = JSON.parse(readFileSync(controlled.preflight, 'utf8')) as Record<string, unknown>;
    if (kind === 'stale-receipt') receipt.observedAt = '2000-01-01T00:00:00.000Z';
    if (kind === 'wrong-revision') receipt.publicApiGitSha = 'main';
    writeFileSync(controlled.preflight, JSON.stringify(receipt));
    const error = failure(controlled);
    expect(error.report.status).toBe('blocked');
    expect(controlled.calls.some(call => matches(call.args, ['tenant', 'create']))).toBe(false);
  });

  test('all lifecycle writes target created child/runtime; full resource lifecycle uses explicit slugs and verifies bytes, updates and deletes', () => {
    const controlled = harness({ runtime: 'run-runtime' });
    const report = controlled.run({ EAI_E2E_SYNC_SCHEMA_APPLY: '1', EAI_E2E_PROVISION_ENTRA: '1' });
    expect(report.status).toBe('passed'); expect(report.cleanupVerified).toBe(true); expect(report.coverageComplete).toBe(false);
    for (const { args } of controlled.calls) {
      if (['create', 'update', 'batch-create', 'batch-import', 'batch-update', 'batch-delete', 'delete'].includes(args[1]) && args[0] === 'resources') {
        expect(flag(args, '--tenant-id')).toBe('run-runtime'); expect(args[2]).toMatch(/^eai-smoke-(pg|doc|file|search)[0-9]+$/);
      }
      if (matches(args, ['types', 'seed']) || matches(args, ['provision', 'storage'])) expect(flag(args, '--tenant-id')).toBe('run-runtime');
      if (['create', 'provision', 'delete'].includes(args[1]) && args[0] === 'app') expect(flag(args, '--tenant-id')).toBe('run-child');
    }
    const deletes = controlled.calls.filter(call => matches(call.args, ['tenant', 'delete'])).map(call => call.args);
    expect(deletes.map(args => [args[2], flag(args, '--parent')])).toEqual([['run-runtime', 'run-child'], ['run-child', 'qa-parent']]);
    expect(deletes.every(args => args.includes('--force-hard-purge'))).toBe(true);
    expect(controlled.resources.size).toBe(0);
    const persisted = readFileSync(report.summaryPath, 'utf8');
    expect(persisted).not.toContain(privateSecret);
    expect(report.summaryPath.startsWith(controlled.calls.find(call => call.args[0] === 'init')!.cwd + '/')).toBe(false);
    expect(statSync(report.summaryPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(report.summaryPath)).mode & 0o777).toBe(0o700);
  });

  test('query smoke keeps dedicated PostgreSQL separate and verifies all exact run-created rows', () => {
    const controlled = harness({ runtime: 'run-runtime' });
    const report = controlled.run({ EAI_E2E_SYNC_SCHEMA_APPLY: '1' });
    const queries = controlled.calls.filter(call => matches(call.args, ['resources', 'query']));
    expect(report.status).toBe('passed');
    expect(report.cleanupVerified).toBe(true);
    expect(queries).toHaveLength(2);
    expect(queries.map(call => flag(call.args, '--types').split(','))).toEqual([
      ['eai-smoke-pg20261008123456'],
      ['eai-smoke-doc20261008123456', 'eai-smoke-file20261008123456', 'eai-smoke-search20261008123456'],
    ]);
    expect(queries.every(call => flag(call.args, '--tenant-id') === 'run-runtime')).toBe(true);
    const queryEvidence = report.commands.filter(row => row.command === 'eai resources query') as Array<
      { status: string; assertions: string[] }
    >;
    expect(queryEvidence.every(row => row.status === 'passed')).toBe(true);
    expect(queryEvidence.map(row => row.assertions.filter(name => name.includes('-created-row-')).length)).toEqual([5, 3]);
  });

  test.each(['empty', 'foreign-id', 'wrong-type', 'stale-data', 'bad-total', 'partial-documentdb'])('query smoke rejects %s evidence and still verifies cleanup', kind => {
    const controlled = harness({ override(args, result) {
      if (!matches(args, ['resources', 'query'])) return undefined;
      const selected = flag(args, '--types').split(',');
      if (kind === 'partial-documentdb' && selected.length === 1) return undefined;
      const payload = JSON.parse(result.stdout) as {
        results: Array<Record<string, { id: string; data: Record<string, unknown> }>>;
        totalResults: number;
      };
      if (kind === 'empty') payload.results = [];
      if (kind === 'foreign-id') payload.results = payload.results.map(row => ({
        [selected[0]]: { ...row[selected[0]], id: 'unowned-resource' },
      }));
      if (kind === 'wrong-type') payload.results = payload.results.map(row => ({ 'other-type': row[selected[0]] }));
      if (kind === 'stale-data') payload.results = payload.results.map(row => ({
        [selected[0]]: { ...row[selected[0]], data: { ...row[selected[0]].data, status: 'stale' } },
      }));
      if (kind === 'partial-documentdb') payload.results = payload.results.filter(row => !(selected[1] in row));
      payload.totalResults = payload.results.length + (kind === 'bad-total' ? 1 : 0);
      return ok(payload);
    } });
    const error = failure(controlled, { EAI_E2E_SYNC_SCHEMA_APPLY: '1' });
    expect(error.report.status).toBe('failed');
    expect(error.report.cleanupVerified).toBe(true);
    expect(error.report.commands.find(row => row.command === 'eai resources query' && row.status === 'failed')).toBeDefined();
    expect(controlled.resources.size).toBe(0);
  });

  test('regenerates and checks both producer artifacts after fixture replacement before validate, seed and build', () => {
    let sawFixtureSource = false;
    const controlled = harness({ override(args, _result, options) {
      if (args[0] !== 'run') return undefined;
      expect(options.env.EAI_OBJECT_TYPES_INPUT_PATH).toBe(join(options.cwd, 'src', 'eai.config', 'object-types.ts'));
      expect(options.env.EAI_OBJECT_TYPES_OUTPUT_PATH).toBe(join(options.cwd, 'src', 'eai.config', 'object-types.json'));
      expect(options.env.EAI_OBJECT_TYPES_PROVISIONING_OUTPUT_PATH).toBe(join(options.cwd, 'src', 'eai.config', 'object-types.provisioning.json'));
      if (args[1] === 'build:object-types') {
        expect(options.timeout).toBe(120000);
        const content = readFileSync(options.env.EAI_OBJECT_TYPES_INPUT_PATH!, 'utf8');
        expect(content).toContain('EaiSmokePg20261008123456');
        expect(content).toContain('eai-smoke-search20261008123456');
        sawFixtureSource = true;
      }
      return undefined;
    } });
    const report = controlled.run({ EAI_OBJECT_TYPES_INPUT_PATH: '/unowned/input.ts',
      EAI_OBJECT_TYPES_OUTPUT_PATH: '/unowned/output.json', EAI_OBJECT_TYPES_PROVISIONING_OUTPUT_PATH: '/unowned/provisioning.json' });
    expect(sawFixtureSource).toBe(true);
    expect(report.status).toBe('passed'); expect(report.cleanupVerified).toBe(true);
    const index = (prefix: string[]) => controlled.calls.findIndex(call => matches(call.args, prefix));
    const generated = index(['run', 'build:object-types']), checked = index(['run', 'check:object-types']);
    expect(generated).toBeGreaterThan(index(['app', 'provision']));
    expect(checked).toBeGreaterThan(generated);
    expect(index(['types', 'validate'])).toBeGreaterThan(checked);
    expect(index(['types', 'seed'])).toBeGreaterThan(checked);
    expect(index(['run', 'build'])).toBeGreaterThan(checked);
    expect(report.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'npm run build:object-types', status: 'passed', exitCode: 0 }),
      expect.objectContaining({ command: 'npm run check:object-types', status: 'passed', exitCode: 0 }),
    ]));
    expect(readFileSync(report.summaryPath, 'utf8')).not.toContain(privateSecret);
  });

  test.each(['exit', 'throw', 'stale-runtime', 'stale-provisioning'])('preserves %s generation failure and completes owned cleanup', kind => {
    const controlled = harness({ override(args, _result, options) {
      if (!matches(args, ['run', 'build:object-types'])) return undefined;
      if (kind === 'exit') return { status: 7, stdout: privateSecret, stderr: privateSecret };
      if (kind === 'throw') throw new Error('Controlled generator interrupted');
      const file = kind === 'stale-runtime' ? 'object-types.json' : 'object-types.provisioning.json';
      writeFileSync(join(options.cwd, 'src', 'eai.config', file), '{}\n');
      return undefined;
    } });
    const outcome = failure(controlled);
    const report = outcome.report;
    expect(report.status).toBe('failed'); expect(report.cleanupVerified).toBe(true); expect(report.leftovers).toEqual([]);
    const failedCommand = kind.startsWith('stale') ? 'npm run check:object-types' : 'npm run build:object-types';
    expect(report.commands.find(row => row.command === failedCommand)?.status).toBe('failed');
    expect(controlled.calls.some(call => matches(call.args, ['types', 'validate']) || matches(call.args, ['types', 'seed'])
      || matches(call.args, ['run', 'build']))).toBe(false);
    expect(controlled.calls.some(call => matches(call.args, ['app', 'delete']))).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['tenant', 'delete']))).toBe(true);
    expect(readFileSync(outcome.summaryPath, 'utf8')).not.toContain(privateSecret);
  });

  test('unexpected producer layout fails before generation or seed and still cleans the acknowledged app and child', () => {
    const controlled = harness({ override(args, _result, options) {
      if (matches(args, ['init'])) writeFileSync(join(options.cwd, 'src', 'eai.config', 'object-types.ts'), 'export const objectTypes = {};\n');
      return undefined;
    } });
    const report = failure(controlled).report;
    expect(report.status).toBe('failed'); expect(report.cleanupVerified).toBe(true); expect(report.leftovers).toEqual([]);
    expect(controlled.calls.some(call => matches(call.args, ['run', 'build:object-types']) || matches(call.args, ['types', 'validate'])
      || matches(call.args, ['types', 'seed']))).toBe(false);
    expect(controlled.calls.some(call => matches(call.args, ['app', 'delete']))).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['tenant', 'delete']))).toBe(true);
  });

  test('runner gives app provisioning its bounded wait budget and requires exact readiness before seeding', () => {
    let provisionChecked = false;
    const controlled = harness({ override(args, _result, options) {
      if (matches(args, ['app', 'provision'])) {
        expect(options.timeout).toBeGreaterThanOrEqual(930000);
        provisionChecked = true;
      }
      return undefined;
    } });
    expect(controlled.run().status).toBe('passed');
    expect(provisionChecked).toBe(true);
    const pending = harness({ override: (args, result) => matches(args, ['app', 'provision'])
      ? { ...result, stdout: JSON.stringify({ tenantId: 'run-child', targetTenantId: 'run-child',
        provisioning: { status: 'running', jobId: 'app-prov-owned' } }) } : undefined });
    const error = failure(pending);
    expect(error.report.status).toBe('failed');
    expect(error.report.cleanupVerified).toBe(true);
    expect(pending.calls.some(call => matches(call.args, ['types', 'seed']))).toBe(false);
  });

  test.each([undefined, null])('same-workspace ready provisioning accepts the legacy empty runtime binding %s', childTenantId => {
    const controlled = harness({ override: (args, result) => {
      if (!matches(args, ['app', 'provision'])) return undefined;
      const body = JSON.parse(result.stdout);
      body.provisioning.enrollment = { childTenantId };
      return { ...result, stdout: JSON.stringify(body) };
    } });
    expect(controlled.run().status).toBe('passed');
    expect(controlled.calls.some(call => matches(call.args, ['types', 'seed']))).toBe(true);
  });

  test.each([undefined, 'another-runtime'])('descendant ready provisioning rejects missing or mismatched runtime %s', childTenantId => {
    const controlled = harness({ runtime: 'run-runtime', override: (args, result) => {
      if (!matches(args, ['app', 'provision'])) return undefined;
      const body = JSON.parse(result.stdout);
      body.provisioning.enrollment = { childTenantId };
      return { ...result, stdout: JSON.stringify(body) };
    } });
    const error = failure(controlled);
    expect(error.report.cleanupVerified).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['types', 'seed']))).toBe(false);
  });

  test('failure after creating app still deletes captured app and child, with original error and execution evidence', () => {
    const controlled = harness({ override: (args, result) => args[0] === 'init' ? { ...result, status: 1 } : undefined });
    const error = failure(controlled);
    expect(error.message).toContain('eai init failed'); expect(error.report.created.appKey).toMatch(/^eai-e2e-/);
    expect(error.report.cleanup.map(row => [row.artifact, row.status])).toEqual([['app', 'passed'], ['child-tenant', 'passed']]);
    expect(error.report.commands.find(row => row.command === 'eai init')?.status).toBe('failed');
    expect(JSON.parse(readFileSync(error.summaryPath, 'utf8')).status).toBe('failed');
  });

  test('child absence uses complete parent inventory when deleted-tenant reads are fenced', () => {
    const controlled = harness({ override: (args) => matches(args, ['publicapi', 'get'])
      && args[2] === '/v4/platform/tenants/run-child/management'
      ? { status: 1, stdout: JSON.stringify({ ok: false, status: 403 }), stderr: '' } : undefined });
    const report = controlled.run();
    expect(report.cleanupVerified).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['publicapi', 'get']) && call.args[2].includes('/children?limit=100&offset=0'))).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['publicapi', 'get']) && call.args[2] === '/v4/platform/tenants/run-child/management')).toBe(false);
  });

  test('hard-purge receipt cannot verify cleanup while the exact child remains in parent inventory', () => {
    const controlled = harness({ override: (args) => matches(args, ['publicapi', 'get']) && args[2].includes('/children?')
      ? { status: 0, stdout: JSON.stringify({ ok: true, status: 200, body: [{ id: 'run-child' }] }), stderr: '' } : undefined });
    const error = failure(controlled);
    expect(error.report.cleanupVerified).toBe(false);
    expect(error.report.leftovers).toContainEqual(expect.objectContaining({ artifact: 'child-tenant' }));
  });

  test('parent inventory verification checks later pages before confirming absence', () => {
    const controlled = harness({ override: (args) => matches(args, ['publicapi', 'get']) && args[2].includes('/children?')
      ? { status: 0, stdout: JSON.stringify({ ok: true, status: 200, body: args[2].endsWith('offset=0')
        ? Array.from({ length: 100 }, (_, index) => ({ id: 'unrelated-child-' + index })) : [{ id: 'run-child' }] }), stderr: '' } : undefined });
    expect(failure(controlled).report.cleanupVerified).toBe(false);
    expect(controlled.calls.some(call => call.args[2]?.endsWith('/children?limit=100&offset=100'))).toBe(true);
  });

  test('bootstrap failure still cleans acknowledged child; explicit create denial is blocked without phantom orphan', () => {
    const bootstrap = harness({ override: (args) => matches(args, ['tenant', 'bootstrap-admin']) ? denied : undefined });
    expect(failure(bootstrap).report.cleanup).toMatchObject([{ artifact: 'child-tenant', status: 'passed' }]);
    const deniedCreate = harness({ override: args => matches(args, ['tenant', 'create']) ? denied : undefined });
    const deniedReport = failure(deniedCreate).report;
    expect(deniedReport.status).toBe('blocked'); expect(deniedReport.leftovers).toEqual([]); expect(deniedReport.created.childTenantId).toBe('');
  });

  test('captures resource IDs before a failed command exit, then deletes and proves absence', () => {
    let failed = false;
    const controlled = harness({ override(args, result) {
      if (!failed && matches(args, ['resources', 'create'])) { failed = true; return { ...result, status: 1 }; }
      return undefined;
    } });
    const report = failure(controlled, { EAI_E2E_SYNC_SCHEMA_APPLY: '1' }).report;
    expect(report.created.resources).toHaveLength(1);
    expect(report.cleanup.find(row => row.artifact.startsWith('resource:'))?.status).toBe('passed');
    expect(controlled.resources.size).toBe(0);
  });

  test('partial batch result fails and retains returned IDs for cleanup instead of relying on zero exit code', () => {
    const controlled = harness({ override(args, result) {
      if (matches(args, ['resources', 'batch-create'])) {
        const body = JSON.parse(result.stdout) as { results: { id: string }[] };
        return ok({ results: body.results, succeeded: 1, failed: 1 });
      }
      return undefined;
    } });
    const report = failure(controlled, { EAI_E2E_SYNC_SCHEMA_APPLY: '1' }).report;
    expect(report.status).toBe('failed');
    expect(report.created.resources.filter(row => row.type.includes('-pg'))).toHaveLength(3);
    expect(report.cleanup.filter(row => row.artifact.startsWith('resource:')).every(row => row.status === 'passed')).toBe(true);
  });

  test('partial batch deletion verifies already removed IDs and continues exact per-row cleanup', () => {
    const controlled = harness({ override(args) {
      if (matches(args, ['resources', 'batch-delete'])) return ok({ succeeded: 1, failed: 1 });
      return undefined;
    } });
    const report = failure(controlled, { EAI_E2E_SYNC_SCHEMA_APPLY: '1' }).report;
    expect(report.status).toBe('failed');
    expect(report.cleanup.find(row => row.artifact === 'batch-resources')?.status).toBe('failed');
    expect(report.cleanupVerified).toBe(true); expect(report.leftovers).toEqual([]);
    expect(controlled.resources.size).toBe(0);
    expect(controlled.calls.filter(call => matches(call.args, ['resources', 'delete']))).toHaveLength(4);
  });

  test('incomplete app acknowledgement never authorizes a guessed runtime or app cleanup', () => {
    const controlled = harness({ override(args, result) {
      if (!matches(args, ['app', 'create'])) return undefined;
      const body = JSON.parse(result.stdout);
      delete body.response.app.parentTenantId;
      return ok(body);
    } });
    const report = failure(controlled).report;
    expect(report.created.appKey).toBe('');
    expect(report.leftovers.some(row => row.artifact === 'app')).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['app', 'delete']))).toBe(false);
    expect(controlled.calls.filter(call => matches(call.args, ['tenant', 'delete']))).toHaveLength(1);
  });

  test('candidate fingerprint changes with a runtime dependency and does not mislabel an installed package as this worktree', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'eai-candidate-controlled-')));
    fixtureRoots.push(dir);
    mkdirSync(join(dir, 'dist', 'lib'), { recursive: true }); mkdirSync(join(dir, 'resources'));
    writeFileSync(join(dir, 'dist', 'index.js'), 'entry'); writeFileSync(join(dir, 'dist', 'lib', 'api.js'), 'first');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.0.0-fixture', gitHead: 'c'.repeat(40) }));
    const before = candidateEvidence(join(dir, 'dist', 'index.js'));
    writeFileSync(join(dir, 'dist', 'lib', 'api.js'), 'second');
    const after = candidateEvidence(join(dir, 'dist', 'index.js'));
    expect(after.binarySha256).toBe(before.binarySha256);
    expect(after.runtimeSha256).not.toBe(before.runtimeSha256);
    expect(after.gitSha).toBe('c'.repeat(40)); expect(after.dirty).toBeNull();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.0.0-fixture' }));
    expect(candidateEvidence(join(dir, 'dist', 'index.js')).gitSha).toBeNull();
  });

  test.each(['app-receipt', 'resource-absence', 'child-receipt', 'entra-receipt', 'unowned-target'])(
    'cleanup rejects %s while continuing independent child teardown', kind => {
      const controlled = harness({ override(args, result) {
        if (kind === 'app-receipt' && matches(args, ['app', 'delete'])) return ok({ verified: false });
        if (kind === 'resource-absence' && matches(args, ['publicapi', 'get']) && args[2].startsWith('/v4/data/resources/')) return denied;
        if (kind === 'child-receipt' && matches(args, ['tenant', 'delete'])) return ok({ id: args[2], deleted: true, hardPurged: false });
        if (kind === 'entra-receipt' && matches(args, ['publicapi', 'delete'])) return ok({ ok: true, body: { tenantId: 'unowned', clientId } });
        if (kind === 'unowned-target' && matches(args, ['publicapi', 'get']) && args[2].endsWith('/deletion-plan'))
          return ok({ ok: true, body: { tenantId: 'run-child', appKey: 'unknown',
            cleanupContract: 'eai.app-scoped-cleanup.v2', runtimeTenantIds: ['run-child', 'foreign'] } });
        return undefined;
      } });
      const report = failure(controlled, { EAI_E2E_SYNC_SCHEMA_APPLY: '1', EAI_E2E_PROVISION_ENTRA: '1' }).report;
      expect(report.status).toBe('failed'); expect(report.cleanupVerified).toBe(false); expect(report.leftovers.length).toBeGreaterThan(0);
      expect(controlled.calls.some(call => matches(call.args, ['tenant', 'delete']))).toBe(true);
      if (kind === 'unowned-target') expect(controlled.calls.some(call => matches(call.args, ['app', 'delete']))).toBe(false);
    });

  test('cleanup retries a transient app inventory read and retains the original failed execution', () => {
    let attempts = 0;
    const controlled = harness({ override(args, result) {
      if (matches(args, ['app', 'list']) && JSON.parse(result.stdout).apps?.length === 0) {
        attempts++;
        if (attempts === 1) return { status: 1, stdout: '', stderr: '503 Service Unavailable' };
      }
      return undefined;
    } });
    const report = controlled.run();
    expect(attempts).toBe(2);
    expect(report.cleanupVerified).toBe(true);
    expect(report.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'eai app list', status: 'failed', retryableReadFailure: true }),
    ]));
  });

  test.each(['503', 'nonempty'])('strict first-read qualification fails immediately on %s and still purges the child', condition => {
    let emptyReads = 0;
    const controlled = harness({ override(args, result) {
      if (matches(args, ['app', 'list']) && JSON.parse(result.stdout).apps?.length === 0) {
        emptyReads++;
        return condition === '503' ? { status: 1, stdout: '', stderr: '503 Service Unavailable' }
          : ok({ apps: [{ id: 'unrelated-enrollment', data: { verticalKey: 'unrelated-app' } }] });
      }
      return undefined;
    } });
    const report = failure(controlled, { EAI_E2E_REQUIRE_FIRST_EMPTY: '1' }).report;
    expect(emptyReads).toBe(1); expect(report.deletionCycle?.firstInventoryEmpty).toBe(false);
    expect(report.cleanupVerified).toBe(false);
    expect(report.cleanup).toContainEqual(expect.objectContaining({ artifact: 'child-tenant', status: 'passed' }));
  });

  test('same-key recreation proves a new enrollment and deletes both enrollments with first-read freshness', () => {
    const controlled = harness();
    const report = controlled.run({ EAI_E2E_REQUIRE_FIRST_EMPTY: '1', EAI_E2E_RECREATE_AFTER_DELETE: '1',
      EAI_E2E_PROVISION_ENTRA: '1', EAI_E2E_ROTATE_ENTRA_SECRET: '1' });
    expect(report.deletionCycle).toMatchObject({ firstInventoryEmpty: true, recreatedSameKey: true,
      enrollmentId: 'run-enrollment', recreatedEnrollmentId: 'recreated-enrollment' });
    expect(report.rotationCycle).toMatchObject({ commandDispatches: 1, credentialChanged: true });
    expect(controlled.calls.filter(call => matches(call.args, ['app', 'create']))).toHaveLength(2);
    expect(controlled.calls.filter(call => matches(call.args, ['app', 'delete']))).toHaveLength(2);
    expect(report.cleanupVerified).toBe(true); expect(report.leftovers).toEqual([]);
    expect(readFileSync(report.summaryPath, 'utf8')).not.toContain(privateSecret);
  });
  test('live CLI and build subprocesses replace ambient auth/routing with the owned profile and app context', () => {
    let subprocesses = 0, builds = 0;
    const controlled = harness({ override(args, _result, options) {
      subprocesses++; if (matches(args, ['run', 'build'])) builds++;
      expect(options.replaceEnv).toBe(true); expect(options.env.EAI_PROFILE).toBe('dev-qa');
      expect(options.env.BASE_URL_PUBLIC_API).toBe('https://dev-api.au.myenterprise.ai/public');
      for (const key of ['NEXT_PUBLIC_EAI_TENANT_ID', 'NEXT_PUBLIC_APP_KEY', 'ENTRA_CLIENT_SECRET', 'AUTH_SECRET',
        'ROUTING_BOOTSTRAP_PUBLIC_API_URL', 'BASE_URL_ADMIN_API', 'EAI_ACCESS_TOKEN', 'PUBLICAPI_TOKEN']) expect(options.env[key]).toBeUndefined();
      expect(options.env.HOME).toBe('/normal-profile-home'); return undefined;
    } });
    const report = controlled.run({ HOME: '/normal-profile-home', NEXT_PUBLIC_EAI_TENANT_ID: 'foreign-workspace', NEXT_PUBLIC_APP_KEY: 'foreign-app',
      ENTRA_CLIENT_SECRET: privateSecret, AUTH_SECRET: privateSecret, ROUTING_BOOTSTRAP_PUBLIC_API_URL: 'https://foreign.invalid',
      BASE_URL_ADMIN_API: 'https://foreign.invalid', EAI_ACCESS_TOKEN: privateSecret, PUBLICAPI_TOKEN: privateSecret });
    expect(report.cleanupVerified).toBe(true); expect(subprocesses).toBeGreaterThan(10); expect(builds).toBe(1);
    expect(readFileSync(report.summaryPath, 'utf8')).not.toContain(privateSecret);
  });

  test.each(['nonzero', 'unknown', 'same-id', 'foreign'])('recreation %s preserves acknowledged cleanup and never retries creation', condition => {
    let creates = 0;
    const controlled = harness({ override(args, result) {
      if (!matches(args, ['app', 'create']) || ++creates === 1) return undefined;
      if (condition === 'nonzero') return { ...result, status: 1 };
      if (condition === 'unknown') return { status: 1, stdout: '', stderr: '503 Service Unavailable' };
      const body = JSON.parse(result.stdout);
      if (condition === 'same-id') body.response.app.id = 'run-enrollment';
      if (condition === 'foreign') body.response.app.tenantId = 'foreign-tenant';
      return ok(body);
    } });
    const report = failure(controlled, { EAI_E2E_REQUIRE_FIRST_EMPTY: '1', EAI_E2E_RECREATE_AFTER_DELETE: '1' }).report;
    expect(creates).toBe(2);
    expect(report.cleanup).toContainEqual(expect.objectContaining({ artifact: 'child-tenant', status: 'passed' }));
    expect(controlled.calls.filter(call => matches(call.args, ['app', 'delete']))).toHaveLength(['nonzero', 'same-id'].includes(condition) ? 2 : 1);
    if (['unknown', 'foreign'].includes(condition)) expect(report.leftovers).toContainEqual(expect.objectContaining({ artifact: 'recreated-app' }));
    expect(report.cleanupVerified).toBe(false);
  });

  test.each([
    ['503 Service Unavailable', 3],
    ['403 Forbidden', 1],
  ])('cleanup keeps app absence unverified after %s and still purges its owned child', (stderr, expectedAttempts) => {
    let attempts = 0;
    const controlled = harness({ override(args, result) {
      if (matches(args, ['app', 'list']) && JSON.parse(result.stdout).apps?.length === 0) {
        attempts++;
        return { status: 1, stdout: '', stderr: String(stderr) };
      }
      return undefined;
    } });
    const report = failure(controlled).report;
    expect(attempts).toBe(expectedAttempts);
    expect(report.cleanupVerified).toBe(false);
    expect(report.cleanup).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifact: 'child-tenant', status: 'passed' }),
    ]));
  });

  test('Entra failure after private ID persistence still verifies deletion without persisting secret values', () => {
    const controlled = harness({ override: (args, result) => matches(args, ['provision', 'entra']) && !args.includes('--deauthorize')
      ? { ...result, status: 1 } : undefined });
    const error = failure(controlled, { EAI_E2E_PROVISION_ENTRA: '1' });
    expect(error.report.created.entraClientId).toBe(clientId);
    expect(error.report.cleanup.find(row => row.artifact === 'entra-registration')?.status).toBe('passed');
    expect(readFileSync(error.summaryPath, 'utf8')).not.toContain(privateSecret);
  });

  test('workflow/chat execute real positional contract, and workflow failure cannot silently pass', () => {
    const controlled = harness();
    expect(controlled.run({ EAI_E2E_WORKFLOW_PROVISION: '1', EAI_E2E_CHAT: '1', EAI_E2E_AI_PROVIDER: 'qa-provider', EAI_E2E_AI_MODEL: 'qa-model' }).status).toBe('passed');
    const chat = controlled.calls.find(call => matches(call.args, ['chat', 'send']))!.args;
    expect(chat[2]).toBe('Reply READY.'); expect(chat).not.toContain('--message'); expect(chat).not.toContain('--format');
    const status = controlled.calls.find(call => matches(call.args, ['workflow', 'status']))!.args;
    expect(status[2]).toMatch(/^eai-e2e-[0-9]+-[a-f0-9]+-workflow$/);
    expect(status[2]).not.toBe('run-workflow');
    expect(flag(chat, '--workflow')).toBe(status[2]);
    expect(flag(chat, '--workflow')).not.toBe('run-workflow');
    expect(controlled.resources.size).toBe(0);
    const broken = harness({ override: args => matches(args, ['workflow', 'status']) ? denied : undefined });
    expect(failure(broken, { EAI_E2E_WORKFLOW_PROVISION: '1' }).report.status).toBe('failed');
  });

  test('workflow provisioning binds exact nested resource IDs, readback and cleanup', () => {
    const controlled = harness();
    const report = controlled.run({ EAI_E2E_WORKFLOW_PROVISION: '1' });
    expect(report.created.workflowIds).toEqual(['run-workflow']);
    expect(report.created.resources).toEqual([
      { type: 'shared-workflow-config', id: 'run-workflow' },
      { type: 'vertical-product-config', id: 'run-workflow-app' },
    ]);
    for (const { type, id } of report.created.resources) {
      expect(controlled.calls.some(call => matches(call.args, ['resources', 'get', type, id]))).toBe(true);
      expect(controlled.calls.some(call => matches(call.args, ['resources', 'delete', type, id]))).toBe(true);
      expect(report.cleanup.find(row => row.artifact === 'resource:' + type + '/' + id)?.status).toBe('passed');
    }
    expect(controlled.resources.size).toBe(0);
    expect(report.workflowReadiness?.executable).toBe(true);
  });

  test.each(['operator_required', 'not_ready', 'paid_upgrade_required'])('workflow %s remains incomplete while independent app lanes continue', status => {
    const controlled = harness({ override: args => matches(args, ['workflow', 'status'])
      ? ok({ tenantId: 'run-child', workflowKey: args[2], status, reasonCode: 'runtime_workflow_not_bound' }) : undefined });
    const report = controlled.run({ EAI_E2E_WORKFLOW_PROVISION: '1', EAI_E2E_PROVISION_ENTRA: '1', EAI_E2E_DEPLOY: '1' });
    expect(report.status).toBe('passed');
    expect(report.workflowReadiness).toMatchObject({ status, executable: false });
    expect(report.commands.find(row => row.command === 'eai workflow status')?.status).toBe('incomplete');
    expect(report.coverage.find(row => row.command === 'eai workflow status')?.status).toBe('incomplete');
    expect(controlled.calls.some(call => matches(call.args, ['provision', 'entra']))).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['run', 'build']))).toBe(true);
    expect(controlled.calls.some(call => matches(call.args, ['deploy', 'app']))).toBe(true);
    expect(report.cleanupVerified).toBe(true);
  });

  test('failed workflow command retains exact nested IDs for cleanup before checking its exit', () => {
    const controlled = harness({ override: (args, result) => matches(args, ['workflow', 'provision']) ? { ...result, status: 1 } : undefined });
    const report = failure(controlled, { EAI_E2E_WORKFLOW_PROVISION: '1' }).report;
    expect(report.created.workflowIds).toEqual(['run-workflow']);
    expect(report.created.resources).toHaveLength(2);
    expect(report.cleanupVerified).toBe(true);
    expect(controlled.resources.size).toBe(0);
  });

  test('workflow readback scope drift fails and still cleans every acknowledged owned config', () => {
    const controlled = harness({ override: (args, result) => matches(args, ['resources', 'get', 'shared-workflow-config'])
      ? ok({ ...JSON.parse(result.stdout), data: { tenantId: 'foreign-runtime', workflowKey: 'foreign-workflow' } }) : undefined });
    const report = failure(controlled, { EAI_E2E_WORKFLOW_PROVISION: '1' }).report;
    expect(report.status).toBe('failed');
    expect(report.commands.find(row => row.command === 'eai resources get')?.status).toBe('failed');
    expect(report.cleanupVerified).toBe(true);
    expect(controlled.resources.size).toBe(0);
  });

  test('managed publication pending is blocked and cleaned; completed exact operation runs doctor', () => {
    const blocked = harness({ override: args => matches(args, ['deploy', 'app'])
      ? ok({ tenantId: 'run-child', targetTenantId: 'run-child', appKey: args[2], operationId: 'pending-operation',
        status: 'pending_review', classification: 'pending' }) : undefined });
    const report = failure(blocked, { EAI_E2E_DEPLOY: '1' }).report;
    expect(report.status).toBe('blocked'); expect(report.cleanupVerified).toBe(true);
    expect(blocked.calls.some(call => matches(call.args, ['deploy', 'doctor']))).toBe(false);
    const completed = harness(); expect(completed.run({ EAI_E2E_DEPLOY: '1' }).status).toBe('passed');
    expect(completed.calls.find(call => matches(call.args, ['deploy', 'doctor']))?.args).toContain('run-deploy');
  });

  test('evidence never promotes running, skipped, unknown, or incomplete diagnostics to passed', () => {
    for (const status of ['running', 'skipped', 'unknown', 'not-run']) {
      const rows = coverageEvidence([{ command: 'eai whoami', status }]) as SmokeReport['coverage'];
      expect(rows.find(row => row.command === 'eai whoami')?.status).toBe('incomplete');
    }
    const rows = coverageEvidence([{ command: 'eai verify calls', status: 'passed', coverageComplete: false }]) as SmokeReport['coverage'];
    expect(rows.find(row => row.command === 'eai verify calls')?.status).toBe('incomplete');
  });

  test('coverage keeps index apply unsupported regardless of mocked success evidence', () => {
    const rows = coverageEvidence([{ command: 'eai resources indexes-apply', status: 'passed' }]) as SmokeReport['coverage'];
    expect(rows.find(row => row.command === 'eai resources indexes-apply')?.status).toBe('unsupported');
  });

  test('schema inventory includes action-bearing parents and aliases, excluding the root menu', () => {
    const entries = leafEntries({ name: 'eai', hasAction: true, subcommands: [
      { name: 'verify', hasAction: true, aliases: ['inspect'], subcommands: [{ name: 'storage' }] },
    ] }) as { command: string; aliases: string[] }[];
    expect(entries.map(row => row.command)).toEqual(['eai verify', 'eai verify storage']);
    expect(entries[0].aliases).toEqual(['eai inspect']);
  });

  test('published Object Types preserve source names and explicit transport slugs with bounded unique storage names', () => {
    const definitions = smokeObjectTypes('eai-e2e-20261008123456-12345678', '20261008123456', 'run-child');
    expect(() => validateObjectTypeDefinitions({ fixture: definitions })).not.toThrow();
    expect(definitions.map((type: { name: string }) => type.name)).toEqual([
      'EaiSmokePg20261008123456', 'EaiSmokeDoc20261008123456', 'EaiSmokeFile20261008123456', 'EaiSmokeSearch20261008123456',
    ]);
    expect(definitions.map((type: { slug: string }) => type.slug)).toEqual([
      'eai-smoke-pg20261008123456', 'eai-smoke-doc20261008123456', 'eai-smoke-file20261008123456', 'eai-smoke-search20261008123456',
    ]);
    expect(definitions[0].storageBinding.sql.tableName.length).toBeLessThanOrEqual(63);
    expect(definitions[2].storageBinding.blob.containerName.length).toBeLessThanOrEqual(63);
    expect(unsupportedManifestFields(definitions)).toEqual([]);
    expect(definitions[2].storageBinding.blob.blobPrefix).toBe('eai-e2e-20261008123456-12345678/file/20261008123456');
    expect(definitions[3].storageBinding.search.sourceObjectTypes).toEqual(['eai-smoke-search20261008123456']);
    expect(definitions[3].storageBinding.search.fieldMappings).toEqual({ title: 'title', body: 'body' });
  });

  test.each(['pathPrefix', 'keyField', 'contentFields', 'searchable'])('manifest receiver rejects unsupported fixture key %s even after local validation passes', key => {
    const controlled = harness({ override(args, result, options) {
      if (!matches(args, ['types', 'validate'])) return undefined;
      const path = join(options.cwd, 'src', 'eai.config', 'object-types.ts');
      const content = readFileSync(path, 'utf8');
      const payload = fixtureObjectTypesFromSource(content);
      const definitions = payload[Object.keys(payload)[0]] as unknown as {
        storageBinding: Record<string, Record<string, unknown>>; properties: Record<string, unknown>[];
      }[];
      if (key === 'pathPrefix') {
        definitions[2].storageBinding.blob.pathPrefix = definitions[2].storageBinding.blob.blobPrefix;
        delete definitions[2].storageBinding.blob.blobPrefix;
      } else if (key === 'searchable') definitions[0].properties[0].searchable = true;
      else definitions[3].storageBinding.search[key] = 'unsupported';
      const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
      const declaration = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
        .find(value => ts.isIdentifier(value.name) && value.name.text === 'objectTypes')!;
      const inserted = content.slice(0, declaration.initializer!.getStart(source))
        + `JSON.parse(${JSON.stringify(JSON.stringify(payload))})` + content.slice(declaration.initializer!.end);
      expect(inserted).not.toBe(content); writeFileSync(path, inserted);
      return result;
    } });
    const report = failure(controlled).report;
    expect(report.commands.find(row => row.command === 'eai types validate')?.status).toBe('passed');
    expect(report.commands.find(row => row.command === 'eai types seed')?.status).toBe('failed');
    expect(report.cleanupVerified).toBe(true);
  });
});


const root = process.cwd();
const scriptPath = join(root, 'scripts', 'eai-full-e2e-smoke.cjs');
const cliPath = join(root, 'dist', 'index.js');
const { runOptionalDocumentSmoke, runLiveSmoke, runLocalSmoke, writeSmokeObjectTypes, smokeObjectTypes, coverageEvidence, leafEntries, candidateEvidence, redact } = createRequire(import.meta.url)(scriptPath);

describe('local CLI qualification', () => {
  const fixtureRoots: string[] = [];
  afterEach(() => { for (const path of fixtureRoots.splice(0)) rmSync(path, { recursive: true, force: true }); });

  interface LocalReport {
    status: string;
    qualification: string;
    summaryPath: string;
    localCleanupVerified: boolean;
    cleanupVerified: boolean;
    cleanupStatus: string;
    coverageComplete: boolean;
    commands: { command: string; status: string; coverageComplete?: boolean; reason?: string }[];
    assertions: { name: string; status: string }[];
  }
  function outputRoot(): string {
    const path = realpathSync(mkdtempSync(join(tmpdir(), 'eai-local-smoke-tests-'))); fixtureRoots.push(path); return path;
  }
  function controlledExecute(options: { failedRuntime?: boolean; mutateEnvRead?: boolean; leakSyntheticSecret?: boolean } = {}) {
    return (_command: unknown, invocation: string[], settings: ControlledOptions): CommandResult => {
      expect(invocation.slice(0, 2)).toEqual(['--profile', 'default']);
      const args = invocation.slice(2);
      expect(settings.env.HOME).not.toBe(process.env.HOME);
      expect(settings.env.USERPROFILE).toBe(settings.env.HOME);
      expect(settings.env.EAI_PROFILE).toBe('default');
      expect(settings.env.EAI_GOFER_REFRESH_SOURCE).toBe('bundled');
      expect(settings.env.EAI_SERVICE_CLIENT_SECRET).toBeUndefined();
      expect(settings.env.EAI_UPDATE_PACKUMENT_URL).toBeUndefined();
      const ok = (body: unknown) => ({ status: 0, stdout: JSON.stringify(body), stderr: '' });
      if (args[0] === 'blocks' && args[1] === 'list') return ok({ blocks: [{ id: 'core.button' }] });
      if (args[0] === 'blocks' && args[1] === 'describe') return ok({ id: 'core.button' });
      if (args[0] === 'runtime') return ok({ status: options.failedRuntime ? 'fail' : 'pass' });
      if (args[0] === 'env') {
        if (options.mutateEnvRead) writeFileSync(join(settings.cwd, 'unrequested-write.txt'), 'unexpected write');
        return ok({ variables: { AUTH_SECRET: options.leakSyntheticSecret ? 'synthetic-local-fixture-value' : '[redacted]' } });
      }
      if (args[0] === 'template') return ok({ items: [{ relativePath: 'fixture-component.tsx' }] });
      if (args[0] === 'gofer') return ok({ mode: args.includes('--check') ? 'check' : 'apply', items: [] });
      if (args[0] === 'deploy' && args[1] === 'setup') {
        mkdirSync(join(settings.cwd, '.github', 'workflows'), { recursive: true });
        writeFileSync(join(settings.cwd, '.github', 'workflows', 'deploy-demo.yml'), 'local workflow');
      }
      if (args[0] === 'logout') rmSync(join(settings.env.HOME!, '.eai', 'tokens.json'));
      if (args[0] === 'login') return { status: 1, stdout: '', stderr: 'Invalid callback port: 0' };
      return ok({ ok: true });
    };
  }

  test('controlled local execution pins disposable identity state and never promotes negative-only login or local cleanup to backend proof', () => {
    const report: LocalReport = runLocalSmoke(cliPath, { env: { EAI_E2E_OUTPUT_ROOT: outputRoot(),
      EAI_SERVICE_CLIENT_SECRET: 'operator-credential-must-not-reach-child', EAI_UPDATE_PACKUMENT_URL: 'https://untrusted.invalid' },
      execute: controlledExecute(), log: () => {} });
    expect(report.status).toBe('passed'); expect(report.qualification).toBe('local-fixtures');
    expect(report.localCleanupVerified).toBe(true); expect(report.cleanupVerified).toBe(false); expect(report.cleanupStatus).toBe('not-needed');
    expect(report.commands.find(row => row.command === 'eai login')?.status).toBe('incomplete');
    expect(report.commands.find(row => row.command === 'eai login')?.coverageComplete).toBe(false);
    expect(report.commands.some(row => row.command === 'eai update')).toBe(false);
    expect(report.coverageComplete).toBe(false);
    const saved = readFileSync(report.summaryPath, 'utf8');
    expect(saved).not.toContain('operator-credential-must-not-reach-child'); expect(saved).not.toContain('synthetic-local-fixture-value');
  });

  test.each(['failedRuntime', 'mutateEnvRead', 'leakSyntheticSecret'] as const)('controlled local failure %s preserves truthful command evidence and cleans fixtures', option => {
    let failure: Error & { report: LocalReport } | undefined;
    try { runLocalSmoke(cliPath, { env: { EAI_E2E_OUTPUT_ROOT: outputRoot() }, execute: controlledExecute({ [option]: true }), log: () => {} }); }
    catch (error) { failure = error as Error & { report: LocalReport }; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure!.report.status).toBe('failed'); expect(failure!.report.localCleanupVerified).toBe(true);
    expect(failure!.report.commands.find(row => row.command === (option === 'failedRuntime' ? 'eai runtime validate' : 'eai env list'))?.status).toBe('failed');
    if (option === 'mutateEnvRead') expect(failure!.report.commands.some(row => row.command === 'eai logout')).toBe(false);
    else expect(failure!.report.commands.find(row => row.command === 'eai logout')?.status).toBe('passed');
  });

  test('built candidate executes offline local contracts without ambient Gofer overrides and removes its isolated auth/fixture trees', () => {
    const dir = outputRoot();
    vi.stubEnv('EAI_GOFER_REFRESH_RESOURCES_PATH', join(dir, 'ambient-override-must-not-be-read'));
    let report: LocalReport;
    try { report = runLocalSmoke(cliPath, { env: { EAI_E2E_OUTPUT_ROOT: dir }, log: () => {} }); }
    finally { vi.unstubAllEnvs(); }
    expect(report.status).toBe('passed'); expect(report.localCleanupVerified).toBe(true);
    expect(report.commands.filter(row => row.status === 'passed').length).toBeGreaterThanOrEqual(19);
    expect(report.commands.find(row => row.command === 'eai login')?.status).toBe('incomplete');
    const runRoot = dirname(report.summaryPath);
    for (const name of ['app', 'isolated-home', 'template']) expect(existsSync(join(runRoot, name))).toBe(false);
    expect(statSync(report.summaryPath).mode & 0o777).toBe(0o600);
  }, 60000);
});

describe('opt-in document lifecycle caller (controlled, no network)', () => {
  const env = {
    EAI_E2E_DOCS: '1',
    EAI_E2E_DOCS_TENANT_ID: 'tenant-fixture',
    EAI_E2E_DOCS_VERTICAL_KEY: 'fixture-app',
    EAI_E2E_DOCS_WORKFLOW_KEY: 'fixture-workflow',
    EAI_E2E_DOCS_FILE: scriptPath,
    EAI_E2E_DOCS_EXPECTED_TYPE: 'fixture-type',
    EAI_E2E_DOCS_WAIT_MS: '5000',
    EAI_E2E_CLEANUP: '0',
  };
  const id = 'DOC/fixture';
  const jobId = 'job/fixture';
  const recordPath = `/v4/data/documents/records/${encodeURIComponent(id)}?storage_target=resourceapi&job_id=${encodeURIComponent(jobId)}`;
  const queued = { jobId, documents: [{ documentId: id }] };
  const job = {
    jobId, tenantId: env.EAI_E2E_DOCS_TENANT_ID, status: 'completed',
    documents: [{ documentId: id, storage: { status: 'completed' },
      classification: { status: 'completed', detectedType: 'fixture-type' }, rag: { status: 'skipped' } }],
  };
  const record = { documentId: id, resourceId: 'resource-fixture', storageTarget: 'resourceapi',
    processingStatus: 'complete', classification: { documentType: 'fixture-type' } };
  const receipt = { success: true, documentId: id, storageTarget: 'resourceapi', analysisCleanupComplete: true };
  const response = (body: unknown) => ({ status: 0, stdout: JSON.stringify({ ok: true, status: 200, body }), stderr: '' });
  const absent = { status: 1, stdout: JSON.stringify({ ok: false, status: 404 }), stderr: '' };
  function harness(responses: ReturnType<typeof response>[]) {
    let time = 0;
    const calls: string[][] = [];
    const eai = (args: string[], options: { allowFailure: boolean; timeout: number }) => {
      calls.push(args);
      expect(options.allowFailure).toBe(true);
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(30000);
      expect(args.slice(args.indexOf('--tenant-id'), args.indexOf('--tenant-id') + 2)).toEqual(['--tenant-id', 'tenant-fixture']);
      expect(args.slice(args.indexOf('--format'), args.indexOf('--format') + 2)).toEqual(['--format', 'json']);
      const result = responses.shift();
      if (!result) throw new Error('Unexpected CLI call');
      return result;
    };
    return { calls, run: (config = env) => runOptionalDocumentSmoke(eai, config, {
      now: () => time, wait: (ms: number) => { time += ms; },
    }) };
  }

  test('disabled means no commands; prerequisites fail before submission', () => {
    const controlled = harness([]);
    expect(controlled.run({ ...env, EAI_E2E_DOCS: '0' })).toEqual({ skipped: true });
    for (const key of ['TENANT_ID', 'VERTICAL_KEY', 'WORKFLOW_KEY', 'FILE', 'EXPECTED_TYPE']) {
      expect(() => controlled.run({ ...env, [`EAI_E2E_DOCS_${key}`]: '' })).toThrow(`EAI_E2E_DOCS_${key}`);
    }
    for (const value of ['0', '-1', 'Infinity', '600001', '1.5']) {
      expect(() => controlled.run({ ...env, EAI_E2E_DOCS_WAIT_MS: value })).toThrow('EAI_E2E_DOCS_WAIT_MS');
    }
    expect(() => controlled.run({ ...env, EAI_E2E_DOCS_FILE: '/nonexistent-smoke-fixture' })).toThrow('does not exist');
    expect(controlled.calls).toEqual([]);
  });

  test('submits once with app/workflow context, polls same job, reads saved result, deletes and verifies despite general cleanup opt-out', () => {
    const controlled = harness([response(queued), response({ ...job, status: 'processing' }), response(job),
      response(record), response(receipt), absent]);
    expect(controlled.run()).toEqual({ jobId, documentIds: [id], cleanupVerified: true });
    expect(controlled.calls[0]).toEqual(['docs', 'classify', scriptPath, '--tenant-id', 'tenant-fixture',
      '--format', 'json', '--storage-target', 'resourceapi', '--vertical-key', 'fixture-app', '--workflow-key', 'fixture-workflow']);
    expect(controlled.calls.map((args) => args.slice(0, 3))).toEqual([
      ['docs', 'classify', scriptPath],
      ['publicapi', 'get', '/v4/data/documents/jobs/job%2Ffixture'],
      ['publicapi', 'get', '/v4/data/documents/jobs/job%2Ffixture'],
      ['publicapi', 'get', recordPath], ['publicapi', 'delete', recordPath], ['publicapi', 'get', recordPath],
    ]);
  });

  test('queue acceptance times out without resubmission and still cleans up', () => {
    const controlled = harness([response(queued), ...Array.from({ length: 3 }, () => response({ ...job, status: 'processing' })),
      response(receipt), absent]);
    expect(() => controlled.run()).toThrow('timed out after 5000ms');
    expect(controlled.calls.filter((args) => args[0] === 'docs')).toHaveLength(1);
    expect(controlled.calls.at(-2)?.slice(0, 3)).toEqual(['publicapi', 'delete', recordPath]);
  });

  test.each([
    ['failed', { ...job, status: 'failed' }, 'Document job failed'],
    ['partial failure', { ...job, status: 'completed_with_errors' }, 'Document job failed'],
    ['wrong tenant', { ...job, tenantId: 'other-tenant' }, 'identity or tenant mismatch'],
    ['wrong job', { ...job, jobId: 'other-job' }, 'identity or tenant mismatch'],
    ['wrong document', { ...job, documents: [{ ...job.documents[0], documentId: 'unowned' }] }, 'identity or tenant mismatch'],
    ['missing result', { ...job, documents: [{ ...job.documents[0], classification: { status: 'skipped' } }] }, 'missing the expected'],
  ])('rejects %s and only deletes submission-owned IDs', (_label, failedJob, message) => {
    const controlled = harness([response(queued), response(failedJob), response(receipt), absent]);
    expect(() => controlled.run()).toThrow(message);
    expect(controlled.calls.at(-2)?.slice(0, 3)).toEqual(['publicapi', 'delete', recordPath]);
  });

  test.each([
    { ...record, processingStatus: 'pending' },
    { ...record, documentId: 'other' },
    { ...record, classification: { documentType: 'wrong' } },
    { ...record, storageTarget: 'payload' },
  ])('requires persisted results, not just job completion: %j', (saved) => {
    const controlled = harness([response(queued), response(job), response(saved), response(receipt), absent]);
    expect(() => controlled.run()).toThrow('Persisted document');
    expect(controlled.calls.at(-2)?.[1]).toBe('delete');
  });

  test('missing IDs cannot silently pass or use generic id fields', () => {
    const controlled = harness([response({ id: 'not-a-document-id', jobId, documents: [] })]);
    expect(() => controlled.run()).toThrow(/IDs will not be inferred[\s\S]*Document leftovers/);
    expect(controlled.calls).toHaveLength(1);
  });

  test('missing job ID still cleans returned document using the optional-job contract', () => {
    const controlled = harness([response({ documents: queued.documents }), response(receipt), absent]);
    expect(() => controlled.run()).toThrow('explicit job ID');
    expect(controlled.calls[1][2]).toBe('/v4/data/documents/records/DOC%2Ffixture?storage_target=resourceapi');
  });

  test('cleanup failure preserves the original error and identifies leftovers', () => {
    const controlled = harness([response(queued), response({ ...job, status: 'failed' }),
      { status: 1, stdout: JSON.stringify({ ok: false, status: 403 }), stderr: '' }]);
    expect(() => controlled.run()).toThrow(/Document job failed[\s\S]*Document leftovers:[\s\S]*DOC\/fixture[\s\S]*job\/fixture/);
  });

  test.each([
    [response({ ...receipt, analysisCleanupComplete: false })],
    [response(receipt), response(record)],
    [response(receipt), { status: 1, stdout: JSON.stringify({ ok: false, status: 403 }), stderr: '' }],
  ])('cleanup requires complete receipt and verified absence', (...cleanupResponses) => {
    const controlled = harness([response(queued), response(job), response(record), ...cleanupResponses]);
    expect(() => controlled.run()).toThrow(/Document cleanup failed[\s\S]*Document leftovers/);
  });

  test('malformed polling output still triggers cleanup', () => {
    const controlled = harness([response(queued), { status: 1, stdout: 'not JSON', stderr: '' }, response(receipt), absent]);
    expect(() => controlled.run()).toThrow();
    expect(controlled.calls.at(-2)?.[1]).toBe('delete');
  });
});

describe('full e2e smoke traceability', () => {
  test('covers every public CLI leaf command from --describe', () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      '--check',
      '--cli',
      cliPath,
    ], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('Full e2e traceability covers');
    expect(output).toContain('executable CLI entries');
  });

  test('generated plan documents option-level and alias coverage', () => {
    const output = execFileSync(process.execPath, [
      scriptPath,
      '--plan',
      '--cli',
      cliPath,
    ], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output).toContain('Smoke calls / options');
    expect(output).toContain('Deferred options');
    expect(output).toContain('--binding-receipt: Optional protected POSIX acknowledgement');
    expect(output).toContain('--binding-receipt-nonce: Paired canonical UUIDv4');
    expect(output).toContain('`eai vertical list`');
    expect(output).toContain('EAI_E2E_DOCS_EXPECTED_TYPE');
    expect(output).toContain('storage_target=resourceapi');
    expect(output).not.toContain('EAI_E2E_DOCS=1 eai docs upload');
    expect(output).not.toContain('EAI_E2E_DOCS=1 eai docs index');
  });

  test('redacts browser handoff tickets in plain and JSON diagnostics while preserving non-secret scope', () => {
    const ticket = 'synthetic-one-use-browser-handoff';
    for (const diagnostic of [
      `Open https://dev.example.invalid/cli/github-link?ticket=${ticket} then resume operation owned-operation.`,
      JSON.stringify({ error: { code: 'GITHUB_LINK_REQUIRED', message: `Open https://dev.example.invalid/cli/github-link?ticket=${ticket}` }, operationId: 'owned-operation' }),
      `https://dev.example.invalid/link?ticket=${ticket}&operation=owned-operation`,
    ]) {
      const output = redact(diagnostic);
      expect(output).not.toContain(ticket);
      expect(output).toContain('ticket=[redacted]');
      expect(output).toContain('owned-operation');
      if (diagnostic.startsWith('{')) expect(JSON.parse(output).error.code).toBe('GITHUB_LINK_REQUIRED');
    }
  });

  test('redacts password-like values without executing live auth preflight', () => {
    const secret = 'super-secret-e2e-password';
    vi.stubEnv('EAI_E2E_TEST_PASSWORD', secret);
    try {
      const output = redact(`test profile is not authenticated: ${secret}`);
      expect(output).toContain('test profile is not authenticated');
      expect(output).toContain('[redacted]');
      expect(output).not.toContain(secret);
    } finally {
      vi.unstubAllEnvs();
    }
  });

});
