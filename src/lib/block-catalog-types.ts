export type PackageLane = 'foundation' | 'product' | 'addon' | 'dev';
export type BackendCoupling = 'external-safe' | 'external-with-adapter' | 'internal-only';
export type PublicReadiness = 'public-ready' | 'preview' | 'internal' | 'blocked';
export type PackageProfile = 'external' | 'internal' | 'hybrid';
export type BlockSourceType = 'builtin' | 'installed-package' | 'workspace' | 'pinned';
export type GroupBy = 'lane' | 'package' | 'coupling' | 'profile' | 'readiness';

export interface RequiredResource {
  type: string;
  fields: string[];
  actions: string[];
  events: string[];
  purpose?: string;
  required: boolean;
}

export interface BlockBinding {
  name: string;
  resource?: string;
  field?: string;
  action?: string;
  event?: string;
  description?: string;
  required: boolean;
}

export interface OverridePoint {
  name: string;
  path?: string;
  kind?: string;
  description?: string;
  required: boolean;
}

export interface BlockSource {
  type: BlockSourceType;
  manifestPath?: string;
  packageName?: string;
  packageVersion?: string;
}

export interface BlockCatalogEntry {
  id: string;
  title: string;
  description?: string;
  packageName: string;
  importPath: string;
  exportName: string;
  packageLane: PackageLane;
  packageProfiles: PackageProfile[];
  publicReadiness: PublicReadiness;
  backendCoupling: BackendCoupling;
  capabilities: string[];
  slots: string[];
  themeTokens: string[];
  requiredResources: RequiredResource[];
  dataBindings: BlockBinding[];
  actionBindings: BlockBinding[];
  overridePoints: OverridePoint[];
  customExtension: boolean;
  source: BlockSource;
  catalogMetadata?: Record<string, unknown>;
  storybook?: {
    title: string;
    storyId?: string;
  };
}

export interface RawBlockManifest {
  schemaVersion?: unknown;
  packageName?: unknown;
  packageVersion?: unknown;
  packageLane?: unknown;
  packageProfile?: unknown;
  packageProfiles?: unknown;
  catalog?: unknown;
  blocks?: unknown;
}

export interface DiscoveredManifest {
  manifest: RawBlockManifest;
  source: BlockSource;
  catalogMetadata?: Record<string, unknown>;
}

export interface CatalogManifestSummary {
  source: BlockSourceType;
  packageName: string;
  packageVersion?: string;
  manifestPath?: string;
  blockCount: number;
  catalogMetadata?: Record<string, unknown>;
}

export interface ProjectPackageMetadata {
  profile: PackageProfile;
  source?: string;
  recordedAt?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BlockCatalog {
  blocks: BlockCatalogEntry[];
  manifests: CatalogManifestSummary[];
  packageMetadata: ProjectPackageMetadata;
  validation: ValidationResult;
}

export const PACKAGE_LANES = ['foundation', 'product', 'addon', 'dev'] as const;
export const BACKEND_COUPLINGS = ['external-safe', 'external-with-adapter', 'internal-only'] as const;
export const PUBLIC_READINESS = ['public-ready', 'preview', 'internal', 'blocked'] as const;
export const PACKAGE_PROFILES = ['external', 'internal', 'hybrid'] as const;
export const DEFAULT_GROUP_BY: GroupBy = 'lane';

export const KNOWN_MANIFEST_PACKAGES = [
  '@enterpriseaigroup/ui',
  '@enterpriseaigroup/blocks',
  '@enterpriseaigroup/core',
  '@enterpriseaigroup/daisy',
  '@enterpriseaigroup/assess',
  '@enterpriseaigroup/demo',
];

export const WORKSPACE_MANIFEST_PATHS = [
  'eai.blocks.json',
  'eai-blocks.json',
  'block-manifest.json',
  'blocks.manifest.json',
  '.eai/blocks.json',
  '.eai/block-catalog.json',
  'src/eai.blocks.json',
  'src/eai.config/blocks.json',
];

export const PACKAGE_MANIFEST_EXPORTS = [
  './manifest',
  './block-manifest',
  './blocks/manifest',
  './ui-blocks/manifest',
  './ui-blocks',
];

export const PACKAGE_MANIFEST_FILES = [
  'eai-blocks.json',
  'block-manifest.json',
  'blocks.manifest.json',
  'manifest.json',
  'dist/eai-blocks.json',
  'dist/block-manifest.json',
  'dist/blocks.manifest.json',
  'dist/manifest.js',
];
