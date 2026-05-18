import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  KNOWN_MANIFEST_PACKAGES,
  PACKAGE_MANIFEST_EXPORTS,
  PACKAGE_MANIFEST_FILES,
  WORKSPACE_MANIFEST_PATHS,
  type BlockCatalog,
  type CatalogManifestSummary,
  type DiscoveredManifest,
  type ProjectPackageMetadata,
  type RawBlockManifest,
} from './block-catalog-types.js';
import { BUILTIN_BLOCKS, normalizeManifestBlocks, readPackageProfile } from './block-catalog-normalize.js';
import { validateEntries } from './block-catalog-validation.js';
import { asRecord, compactRecord, readJsonFile, readString, readStringArray } from './block-catalog-utils.js';

export async function loadBlockCatalog(): Promise<BlockCatalog> {
  const projectRoot = process.cwd();
  const packageMetadata = await loadProjectPackageMetadata(projectRoot);
  const discovered = [
    ...(await loadInstalledManifests(projectRoot)),
    ...(await loadWorkspaceManifests(projectRoot)),
    ...(await loadPinnedManifests(projectRoot, packageMetadata)),
  ];
  const discoveredBlocks = discovered.flatMap((manifest) => normalizeManifestBlocks(manifest));
  const allBlocks = [...BUILTIN_BLOCKS, ...discoveredBlocks];
  const byId = new Map(allBlocks.map((entry) => [entry.id, entry]));

  return {
    blocks: Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id)),
    manifests: discovered.map((entry) => summarizeManifest(entry)),
    packageMetadata,
    validation: validateEntries(allBlocks, false),
  };
}

async function loadInstalledManifests(projectRoot: string): Promise<DiscoveredManifest[]> {
  const packageNames = await discoverManifestPackageNames(projectRoot);
  const manifests: DiscoveredManifest[] = [];
  for (const packageName of packageNames) {
    const manifest = await loadPackageManifest(projectRoot, packageName);
    if (manifest) {
      manifests.push(manifest);
    }
  }
  return manifests;
}

async function discoverManifestPackageNames(projectRoot: string): Promise<string[]> {
  const packageNames = new Set(KNOWN_MANIFEST_PACKAGES);
  const packageJson = asRecord(await readJsonFile(join(projectRoot, 'package.json')));
  const dependencyBlocks = [
    asRecord(packageJson?.dependencies),
    asRecord(packageJson?.devDependencies),
    asRecord(packageJson?.peerDependencies),
    asRecord(packageJson?.optionalDependencies),
  ];

  for (const dependencyBlock of dependencyBlocks) {
    for (const packageName of Object.keys(dependencyBlock ?? {})) {
      if (isEnterprisePackageName(packageName)) {
        packageNames.add(packageName);
      }
    }
  }

  for (const scope of ['@enterpriseaigroup', '@eai-tools']) {
    try {
      const entries = await readdir(join(projectRoot, 'node_modules', scope), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          packageNames.add(`${scope}/${entry.name}`);
        }
      }
    } catch {
      // node_modules is optional; the built-in catalog remains available.
    }
  }

  return Array.from(packageNames).sort();
}

async function loadPackageManifest(projectRoot: string, packageName: string): Promise<DiscoveredManifest | null> {
  const packageRoot = join(projectRoot, 'node_modules', ...packageName.split('/'));
  const packageJsonPath = join(packageRoot, 'package.json');
  const packageJson = asRecord(await readJsonFile(packageJsonPath));
  if (!packageJson) {
    return null;
  }

  const packageVersion = readString(packageJson, 'version');
  const directManifest = asRecord(asRecord(packageJson.eai)?.blockManifest);
  if (directManifest && Array.isArray(directManifest.blocks)) {
    return {
      manifest: directManifest,
      source: { type: 'installed-package', packageName, packageVersion, manifestPath: packageJsonPath },
      catalogMetadata: buildPackageCatalogMetadata(packageJson),
    };
  }

  for (const manifestPath of [...extractPackageManifestPaths(packageJson), ...PACKAGE_MANIFEST_FILES]) {
    const loaded = await loadManifestFile(join(packageRoot, manifestPath.replace(/^\.\//, '')), {
      type: 'installed-package',
      packageName,
      packageVersion,
    });
    if (loaded) {
      return {
        ...loaded,
        manifest: withPackageDefaults(loaded.manifest, packageName, packageVersion),
        catalogMetadata: {
          ...buildPackageCatalogMetadata(packageJson),
          ...(loaded.catalogMetadata ?? {}),
        },
      };
    }
  }

  return null;
}

async function loadWorkspaceManifests(projectRoot: string): Promise<DiscoveredManifest[]> {
  const packageJson = asRecord(await readJsonFile(join(projectRoot, 'package.json')));
  const manifests: DiscoveredManifest[] = [];
  for (const manifestPath of [...extractWorkspaceManifestPaths(packageJson), ...WORKSPACE_MANIFEST_PATHS]) {
    const loaded = await loadManifestFile(resolve(projectRoot, manifestPath), { type: 'workspace' });
    if (loaded) {
      manifests.push(loaded);
    }
  }
  return dedupeManifests(manifests);
}

async function loadPinnedManifests(
  projectRoot: string,
  packageMetadata: ProjectPackageMetadata
): Promise<DiscoveredManifest[]> {
  const projectManifestPath = join(projectRoot, '.eai-manifest.json');
  const projectManifest = asRecord(await readJsonFile(projectManifestPath));
  const blockCatalog = asRecord(projectManifest?.blockCatalog) ?? asRecord(projectManifest?.blocks);
  if (!projectManifest || !blockCatalog) {
    return [];
  }

  const manifests: DiscoveredManifest[] = [];
  const directCatalog = asRecord(blockCatalog.catalog) ?? blockCatalog;
  const catalogMetadata = compactRecord({
    pinned: true,
    packageProfile: packageMetadata.profile,
    packageSource: packageMetadata.source,
    recordedAt: packageMetadata.recordedAt,
    version: readString(directCatalog, 'version'),
    commit: readString(directCatalog, 'commit'),
  });

  if (directCatalog && Array.isArray(directCatalog.blocks)) {
    manifests.push({
      manifest: {
        schemaVersion: readString(directCatalog, 'schemaVersion') ?? '1.0.0',
        packageName: readString(directCatalog, 'packageName') ?? 'pinned-catalog',
        blocks: directCatalog.blocks,
      },
      source: { type: 'pinned', manifestPath: projectManifestPath },
      catalogMetadata,
    });
  }

  const manifestRefs = [
    ...readManifestRefs(blockCatalog.manifests),
    ...readManifestRefs(directCatalog?.manifests),
  ];
  for (const ref of manifestRefs) {
    const loaded = await loadManifestFile(resolve(projectRoot, ref.path), { type: 'pinned' });
    if (loaded) {
      manifests.push({
        ...loaded,
        catalogMetadata: { ...catalogMetadata, ...(ref.metadata ?? {}), ...(loaded.catalogMetadata ?? {}) },
      });
    }
  }

  return dedupeManifests(manifests);
}

async function loadProjectPackageMetadata(projectRoot: string): Promise<ProjectPackageMetadata> {
  const projectManifest = asRecord(await readJsonFile(join(projectRoot, '.eai-manifest.json')));
  const packages = asRecord(projectManifest?.packages);
  return {
    profile: readPackageProfile(packages?.profile) ?? 'external',
    source: readString(packages, 'source'),
    recordedAt: readString(packages, 'recordedAt'),
  };
}

async function loadManifestFile(path: string, source: DiscoveredManifest['source']): Promise<DiscoveredManifest | null> {
  try {
    await access(path);
  } catch {
    return null;
  }

  try {
    if (extname(path) === '.json') {
      const manifest = asRecord(JSON.parse(await readFile(path, 'utf8')));
      if (!manifest || !Array.isArray(manifest.blocks)) {
        return null;
      }
      return { manifest, source: { ...source, manifestPath: path }, catalogMetadata: asRecord(manifest.catalog) ?? undefined };
    }

    const loaded = await import(pathToFileURL(path).href) as Record<string, unknown>;
    const candidates = [loaded.default, ...Object.values(loaded)];
    const manifest = candidates.map(asRecord).find((candidate) => Array.isArray(candidate?.blocks));
    return manifest
      ? { manifest, source: { ...source, manifestPath: path }, catalogMetadata: asRecord(manifest.catalog) ?? undefined }
      : null;
  } catch {
    return null;
  }
}

function extractPackageManifestPaths(packageJson: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  const eai = asRecord(packageJson.eai);
  const eaiBlocks = asRecord(packageJson.eaiBlocks);
  const uiBlocks = asRecord(eai?.uiBlocks) ?? asRecord(packageJson.uiBlocks);

  for (const value of [
    eai?.blockManifest,
    eai?.blocksManifest,
    eai?.blockCatalog,
    eai?.uiBlockManifest,
    uiBlocks?.manifest,
    eaiBlocks?.manifest,
    packageJson.blockManifest,
  ]) {
    const manifestPath = readManifestPath(value);
    if (manifestPath) {
      paths.add(manifestPath);
    }
  }

  const exportsRecord = asRecord(packageJson.exports);
  for (const exportName of PACKAGE_MANIFEST_EXPORTS) {
    const manifestPath = readManifestPath(exportsRecord?.[exportName]);
    if (manifestPath) {
      paths.add(manifestPath);
    }
  }

  return Array.from(paths);
}

function extractWorkspaceManifestPaths(packageJson: Record<string, unknown> | null): string[] {
  return packageJson
    ? extractPackageManifestPaths(packageJson).filter((entry) => entry.startsWith('.') || !entry.startsWith('/'))
    : [];
}

function readManifestRefs(value: unknown): Array<{ path: string; metadata?: Record<string, unknown> }> {
  const refs = Array.isArray(value) ? value : value ? [value] : [];
  return refs
    .map((ref) => {
      if (typeof ref === 'string') {
        return { path: ref };
      }
      const record = asRecord(ref);
      const path = readString(record, 'path', 'file', 'manifestPath');
      return path ? { path, metadata: record ?? undefined } : null;
    })
    .filter((entry): entry is { path: string; metadata?: Record<string, unknown> } => Boolean(entry));
}

function readManifestPath(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  const record = asRecord(value);
  return record ? readString(record, 'import', 'default', 'require', 'path', 'file') ?? null : null;
}

function withPackageDefaults(manifest: RawBlockManifest, packageName: string, packageVersion?: string): RawBlockManifest {
  return {
    ...manifest,
    packageName: typeof manifest.packageName === 'string' ? manifest.packageName : packageName,
    packageVersion: typeof manifest.packageVersion === 'string' ? manifest.packageVersion : packageVersion,
  };
}

function buildPackageCatalogMetadata(packageJson: Record<string, unknown>): Record<string, unknown> {
  const eai = asRecord(packageJson.eai);
  const uiBlocks = asRecord(eai?.uiBlocks) ?? asRecord(packageJson.uiBlocks);
  return compactRecord({
    packageVersion: readString(packageJson, 'version'),
    packageProfile: readString(eai, 'packageProfile'),
    packageProfiles: readStringArray(eai?.packageProfiles),
    catalogVersion: readString(uiBlocks, 'catalogVersion', 'version'),
    pinnedAt: readString(uiBlocks, 'pinnedAt'),
  });
}

function summarizeManifest(entry: DiscoveredManifest): CatalogManifestSummary {
  return {
    source: entry.source.type,
    packageName: readString(asRecord(entry.manifest), 'packageName') ?? entry.source.packageName ?? 'workspace',
    packageVersion: readString(asRecord(entry.manifest), 'packageVersion') ?? entry.source.packageVersion,
    manifestPath: entry.source.manifestPath,
    blockCount: Array.isArray(entry.manifest.blocks) ? entry.manifest.blocks.length : 0,
    catalogMetadata: entry.catalogMetadata,
  };
}

function dedupeManifests(manifests: DiscoveredManifest[]): DiscoveredManifest[] {
  return Array.from(new Map(
    manifests.map((manifest) => [manifest.source.manifestPath ?? JSON.stringify(manifest.manifest), manifest])
  ).values());
}

function isEnterprisePackageName(packageName: string): boolean {
  return packageName.startsWith('@enterpriseaigroup/') || packageName.startsWith('@eai-tools/');
}
