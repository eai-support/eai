import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { loadObjectTypes, canonicalizeObjectTypeRelationshipTargets } from '../../src/lib/config.js';

const roots: string[] = [];
async function project(source: string, alias = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eai-compiler-loader-'));
  roots.push(root);
  await mkdir(join(root, 'src/eai.config'), { recursive: true });
  await writeFile(join(root, 'src/eai.config/object-types.ts'), source);
  if (alias) {
    const aliasParent = await mkdtemp(join(tmpdir(), 'eai-compiler-alias-'));
    roots.push(aliasParent);
    const aliasRoot = join(aliasParent, 'project');
    await symlink(root, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
    return aliasRoot;
  }
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe.each(['directory', 'symlink'] as const)('Object Type compiler loading through a %s root', rootKind => {
  const fixture = (source: string): Promise<string> => project(source, rootKind === 'symlink');
  test('supports typed helpers/constants, generics, enums, satisfies and erased type imports', async () => {
    const root = await fixture(`import type { Ignored } from './types-not-executed.js';
interface Property { name: string; type: string; }
enum Kind { Text = 'text' }
function property<T extends string>(name: T): Property { return { name, type: Kind.Text }; }
const factory: (name: string) => Property = property;
export const objectTypes = { app: [{ properties: [factory('name')] }] } satisfies Record<string, object[]>;`);
    expect(await loadObjectTypes(root)).toEqual({ app: [{ properties: [{ name: 'name', type: 'text' }] }] });
  });

  test('resolves relative value imports and tsconfig aliases from the original module', async () => {
    const root = await fixture(`import { name } from './helper.js';
import { field } from '@fields/field';
export const objectTypes = { app: [{ name, field }] };`);
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { '@fields/*': ['./src/fields/*'] } } }));
    await writeFile(join(root, 'src/eai.config/helper.ts'), 'enum Name { Record = "Record" }; export const name: string = Name.Record;');
    await mkdir(join(root, 'src/fields'));
    await writeFile(join(root, 'src/fields/field.ts'), 'enum Field { Title = "title" }; export const field: string = Field.Title;');
    expect(await loadObjectTypes(root)).toEqual({ app: [{ name: 'Record', field: 'title' }] });
  });

  test('loads a fresh transitive imported graph on repeated evaluation', async () => {
    const root = await fixture(`import { value } from './helper.ts'; export const objectTypes = { app: [value] };`);
    await writeFile(join(root, 'src/eai.config/helper.ts'), `export { value } from './nested.ts';`);
    const helper = join(root, 'src/eai.config/nested.ts');
    await writeFile(helper, 'enum Name { Value = "First" }; export const value = { name: Name.Value };');
    expect(await loadObjectTypes(root)).toEqual({ app: [{ name: 'First' }] });
    await writeFile(helper, 'enum Name { Value = "Second" }; export const value = { name: Name.Value };');
    expect(await loadObjectTypes(root)).toEqual({ app: [{ name: 'Second' }] });
  });

  test('reports syntax errors with original file, line, column and source', async () => {
    const root = await fixture('export const objectTypes = {\n  app: [;\n};');
    await expect(loadObjectTypes(root)).rejects.toThrow(/object-types\.ts:2:\d+.*\n\s*app: \[;/);
  });

  test('reports source runtime failures and releases environment and loader state', async () => {
    const original = process.env.EAI_STORAGE_TABLE_PREFIX;
    delete process.env.EAI_STORAGE_TABLE_PREFIX;
    try {
      const root = await fixture('interface Erased { x: string; }\nthrow new Error("helper failed");');
      await writeFile(join(root, '.env.local'), 'EAI_STORAGE_TABLE_PREFIX=transient_\n');
      await expect(loadObjectTypes(root)).rejects.toThrow(/object-types\.ts:2:\d+[\s\S]*throw new Error\("helper failed"\)/);
      expect(process.env.EAI_STORAGE_TABLE_PREFIX).toBeUndefined();
      await writeFile(join(root, 'src/eai.config/object-types.ts'), 'export const objectTypes = { app: [] };');
      expect(await loadObjectTypes(root)).toEqual({ app: [] });
    } finally {
      if (original !== undefined) process.env.EAI_STORAGE_TABLE_PREFIX = original;
    }
  });

  test('preserves the native package cache for node_modules dependencies', async () => {
    const root = await fixture(`import { value } from 'fixture-dependency'; export const objectTypes = { app: [value] };`);
    const dependency = join(root, 'node_modules/fixture-dependency');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-dependency', type: 'module', exports: './index.js' }));
    await writeFile(join(dependency, 'index.js'), 'export const value = { name: "First" };');
    expect(await loadObjectTypes(root)).toEqual({ app: [{ name: 'First' }] });
    await writeFile(join(dependency, 'index.js'), 'export const value = { name: "Second" };');
    expect(await loadObjectTypes(root)).toEqual({ app: [{ name: 'First' }] });
  });
});

describe('explicit relationship targets', () => {
  const definition = (properties: Array<{ name: string; type: 'relationship'; required: boolean; targetObjectType?: string }>) => ({ app: [{ name: 'Role', slug: 'role', displayName: 'Role', status: 'published' as const, properties, actions: [], linkTypes: [] }, { name: 'Trust', slug: 'trust', displayName: 'Trust', status: 'published' as const, properties: [], actions: [], linkTypes: [] }] });
  test('resolves property targets through declared slugs without guessing a link name', () => {
    expect(canonicalizeObjectTypeRelationshipTargets(definition([{ name: 'trustId', type: 'relationship', required: true, targetObjectType: 'Trust' }])).app[0].properties[0]).toMatchObject({ targetObjectType: 'trust' });
  });
  test('rejects relationship source definitions without a target', () => {
    expect(() => canonicalizeObjectTypeRelationshipTargets(definition([{ name: 'trustId', type: 'relationship', required: true }]))).toThrow(/trustId.*Relationship target/);
  });
});
