import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadProjectManifest, saveProjectManifest, updateProjectManifest, type ProjectManifest } from '../../src/lib/project-manifest.js';

test('CLI metadata updates preserve the package contract and runtime identity declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eai-package-manifest-'));
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    applicationPackage: {
      source: 'eai.application.json',
      generated: 'eai.application.generated.json',
      schemaLock: 'eai.application.schema-lock.json',
      validator: '@enterpriseaigroup/application-package@0.1.0',
    },
    runtime: {
      interactiveIdentity: 'delegated-user',
      workloadIdentity: 'short-lived-installation-binding',
      platformIngress: 'regional-public-api',
      supportedHosting: ['eai-hosted', 'buyer-hosted'],
    },
  };
  try {
    await saveProjectManifest(root, manifest);
    await updateProjectManifest(root, (current) => ({ ...current!, cli: { version: '3.20.10' } }));
    expect(await loadProjectManifest(root)).toEqual({ ...manifest, cli: { version: '3.20.10' } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
