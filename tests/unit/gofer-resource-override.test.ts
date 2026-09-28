import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm, symlink, link, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});
import { readdirSync } from 'node:fs';
import { GOFER_RESOURCE_MAPPINGS, installGoferResources, renderGoferManagedTextFiles, resolveGoferResourcesPath } from '../../src/lib/gofer-installer.js';
import { planGoferRefresh } from '../../src/lib/gofer-refresh.js';
import { setActiveProfile } from '../../src/lib/profile.js';

describe('explicit complete Gofer resource source', () => {
  let root: string;
  let resources: string;
  let project: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'eai-gofer-override-')));
    resources = join(root, 'resources'); project = join(root, 'project');
    const bundled = fileURLToPath(new URL('../../resources/gofer', import.meta.url));
    for (const { sourceSubdirectory } of GOFER_RESOURCE_MAPPINGS) {
      await mkdir(join(resources, sourceSubdirectory), { recursive: true });
      await writeFile(join(resources, sourceSubdirectory, 'fixture.md'), 'fixture-resource');
    }
    await cp(join(bundled, 'instruction-templates'), join(resources, 'instruction-templates'), { recursive: true });
    await cp(join(bundled, 'claude-commands/0_gofer_start.md'), join(resources, 'claude-commands/0_gofer_start.md'));
    await mkdir(project);
    setActiveProfile('default'); vi.mocked(readdirSync).mockClear();
  });
  afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); });

  test('initial copy, generated instructions and refresh share the explicit source with zero latest fetches', async () => {
    vi.stubEnv('EAI_GOFER_REFRESH_RESOURCES_PATH', resources);
    vi.stubEnv('EAI_GOFER_REFRESH_SOURCE', 'latest');
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    const template = join(resources, 'instruction-templates/base/agents-base.md');
    await writeFile(template, (await readFile(template, 'utf8')) + '\nfixture-selected-gofer\n');
    await writeFile(join(resources, 'references/selected-source.md'), 'fixture-selected-reference');
    await installGoferResources(project);
    const captureReads = vi.mocked(readdirSync).mock.calls.length;
    expect(captureReads).toBeGreaterThan(0);
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toContain('fixture-selected-gofer');
    expect(await readFile(join(project, '.specify/references/selected-source.md'), 'utf8')).toBe('fixture-selected-reference');
    expect((await renderGoferManagedTextFiles(project)).find((file) => file.relativePath === 'AGENTS.md')?.content).toContain('fixture-selected-gofer');
    const plan = await planGoferRefresh(project, null);
    expect(plan.items.find((item) => item.relativePath === '.specify/references/selected-source.md')).toBeDefined();
    expect(vi.mocked(readdirSync)).toHaveBeenCalledTimes(captureReads);
    expect(provider).not.toHaveBeenCalled();
  });
  test.each(['missing-directory', 'missing-template', 'symlink', 'hardlink', 'relative', 'empty'])('invalid explicit source fails before project writes or provider: %s', async (kind) => {
    let selected = resources;
    if (kind === 'missing-directory') await rm(join(resources, 'agents-skills'), { recursive: true });
    if (kind === 'missing-template') await rm(join(resources, 'instruction-templates/base/agents-base.md'));
    if (kind === 'symlink') await symlink(join(resources, 'references'), join(resources, 'alias'));
    if (kind === 'hardlink') await link(join(resources, 'instruction-templates/base/agents-base.md'), join(resources, 'alias'));
    if (kind === 'relative') selected = './resources';
    if (kind === 'empty') selected = '';
    vi.stubEnv('EAI_GOFER_REFRESH_RESOURCES_PATH', selected);
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    await expect(installGoferResources(project)).rejects.toThrow();
    await expect(readFile(join(project, 'AGENTS.md'))).rejects.toThrow();
    await expect(planGoferRefresh(project, null)).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
  test('bundled default performs no override tree capture', () => {
    expect(resolveGoferResourcesPath()).toBe(fileURLToPath(new URL('../../resources/gofer', import.meta.url)));
    expect(readdirSync).not.toHaveBeenCalled();
  });
});
