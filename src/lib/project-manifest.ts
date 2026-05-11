import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const PROJECT_MANIFEST_RELATIVE_PATH = '.eai-manifest.json';

export interface GoferManagedFileState {
  readonly sha256: string;
  readonly source: 'bundled' | 'generated';
}

export interface ProjectManifest {
  readonly schemaVersion: 1;
  readonly cli?: {
    readonly version: string;
  };
  readonly template?: {
    readonly repo?: string;
    readonly commit?: string;
    readonly displaySource?: string;
    readonly initializedAt?: string;
  };
  readonly gofer?: {
    readonly bundle?: {
      readonly commit?: string;
      readonly describe?: string;
      readonly syncedAt?: string;
    };
    readonly managedFiles: Record<string, GoferManagedFileState>;
    readonly refreshedAt?: string;
  };
}

export function getProjectManifestPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MANIFEST_RELATIVE_PATH);
}

export async function loadProjectManifest(projectRoot: string): Promise<ProjectManifest | null> {
  try {
    const raw = await readFile(getProjectManifestPath(projectRoot), 'utf-8');
    return JSON.parse(raw) as ProjectManifest;
  } catch {
    return null;
  }
}

export async function saveProjectManifest(projectRoot: string, manifest: ProjectManifest): Promise<void> {
  const manifestPath = getProjectManifestPath(projectRoot);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

export async function updateProjectManifest(
  projectRoot: string,
  updater: (current: ProjectManifest | null) => ProjectManifest,
): Promise<ProjectManifest> {
  const next = updater(await loadProjectManifest(projectRoot));
  await saveProjectManifest(projectRoot, next);
  return next;
}
