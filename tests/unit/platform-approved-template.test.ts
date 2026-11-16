import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Issues2025#3574: `eai create` scaffolds from the bundled app template, and AdminAPI
 * rejects any managed deploy whose template commit is not the environment's approved pin.
 *
 * Source of truth is Infra2025 `config/app-config/{env}-{region}.json`
 * (`ADMIN_EAI_GENERATED_APP_TEMPLATE_RUNTIME_COMMIT_SHA` / `EAI_GENERATED_APP_TEMPLATE_RUNTIME_VERSION`).
 * Infra2025 is private to another GitHub organisation and is not readable from this
 * repository's CI, so CI compares against the checked-in expectation below. Refresh it in the
 * same PR whenever either side moves. A staged rollout may approve different
 * pins per environment; only the explicitly selected cells approve the bundle.
 */
interface ApprovedTemplate {
  version: string;
  commit: string;
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
const bundled = readJson<{ appTemplate: ApprovedTemplate }>('resources/linked-sources.json').appTemplate;
const expectation = readJson<{
  schema: string;
  source: { repository: string; ref: string; files: string[]; keys: string[] };
  bundledTemplateEnvironments: string[];
  environments: Record<string, ApprovedTemplate>;
}>('.eai/platform-approved-app-template.json');

const INFRA_SOT_FILES = [
  'dev-ae', 'test-ae', 'test-cc', 'test-gwc', 'prod-ae', 'prod-cc', 'prod-gwc',
].map(name => `config/app-config/${name}.json`);

describe('bundled app template matches the platform-approved pin', () => {
  test('the expectation covers every Infra2025 environment and region', () => {
    expect(expectation.schema).toBe('eai.platform_approved_app_template.v1');
    expect(expectation.source.repository).toBe('enterpriseaigroup/Infra2025');
    expect(expectation.source.ref).toMatch(/^[a-f0-9]{40}$/);
    expect([...expectation.source.files].sort()).toEqual([...INFRA_SOT_FILES].sort());
    expect(Object.keys(expectation.environments).sort()).toEqual(
      INFRA_SOT_FILES.map(file => file.replace('config/app-config/', '').replace('.json', '')).sort(),
    );
  });

  test('the bundle approval scope is exactly the reviewed DEV and TEST rollout', () => {
    expect([...expectation.bundledTemplateEnvironments].sort()).toEqual([
      'dev-ae', 'test-ae', 'test-cc', 'test-gwc',
    ]);
  });

  test.each(Object.entries(expectation.environments))('%s retains its exact compatibility with the bundled template', (environment, approved) => {
    expect(approved.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(approved.version).toMatch(/^v\d+\.\d+\.\d+$/);
    const bundledMatches = bundled.version === approved.version && bundled.commit === approved.commit;
    expect(
      bundledMatches,
      'The bundled release must match exactly the selected Infra2025 cells; '
        + 'retained PROD pins must remain incompatible during the DEV/TEST rollout',
    ).toBe(expectation.bundledTemplateEnvironments.includes(environment));
  });
});
