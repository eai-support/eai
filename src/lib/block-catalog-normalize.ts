import {
  BACKEND_COUPLINGS,
  PACKAGE_LANES,
  PACKAGE_PROFILES,
  PUBLIC_READINESS,
  type BackendCoupling,
  type BlockBinding,
  type BlockCatalogEntry,
  type BlockSource,
  type DiscoveredManifest,
  type GroupBy,
  type OverridePoint,
  type PackageLane,
  type PackageProfile,
  type PublicReadiness,
  type RequiredResource,
} from './block-catalog-types.js';
import { asRecord, readBoolean, readString, readStringArray } from './block-catalog-utils.js';

export const BUILTIN_BLOCKS: BlockCatalogEntry[] = [
  block('core.button', 'Button', '@enterpriseaigroup/core', 'Button', 'foundation', 'external-safe', ['ui', 'action'], {
    description: 'Primitive button for client-side actions and form submits.',
    actionBindings: [{ name: 'onClick', action: 'client-handler', required: false }],
    overridePoints: [
      { name: 'label', path: 'presentationConfig.label', kind: 'copy', required: false },
      { name: 'variant', path: 'presentationConfig.variant', kind: 'presentation', required: false },
    ],
  }),
  block('core.input', 'Input', '@enterpriseaigroup/core', 'Input', 'foundation', 'external-safe', ['ui', 'form'], {
    description: 'Primitive input bound to a form field or resource field.',
    dataBindings: [{ name: 'value', field: 'value', required: false }],
    overridePoints: [
      { name: 'label', path: 'presentationConfig.label', kind: 'copy', required: false },
      { name: 'validation', path: 'dataConfig.validation', kind: 'schema', required: false },
    ],
  }),
  block('core.card', 'Card', '@enterpriseaigroup/core', 'Card', 'foundation', 'external-safe', ['ui', 'layout'], {
    description: 'Container block for grouped content and actions.',
    overridePoints: [
      { name: 'header', path: 'presentationConfig.header', kind: 'slot', required: false },
      { name: 'actions', path: 'actionsConfig', kind: 'actions', required: false },
    ],
  }),
  block('design.hero', 'Hero', '@enterpriseaigroup/blocks', 'Hero', 'foundation', 'external-safe', ['marketing', 'layout'], {
    description: 'Public-safe hero section for product and vertical entry pages.',
    overridePoints: [
      { name: 'headline', path: 'presentationConfig.headline', kind: 'copy', required: true },
      { name: 'cta', path: 'actionsConfig.primary', kind: 'actions', required: false },
    ],
  }),
  block('design.feature-grid', 'FeatureGrid', '@enterpriseaigroup/blocks', 'FeatureGrid', 'foundation', 'external-safe', ['marketing', 'layout'], {
    description: 'Public-safe feature grid for explaining capabilities.',
    dataBindings: [{ name: 'features', field: 'features', required: false }],
    overridePoints: [{ name: 'items', path: 'presentationConfig.items', kind: 'copy', required: true }],
  }),
  block('design.form-builder', 'FormBuilder', '@enterpriseaigroup/blocks', 'FormBuilder', 'foundation', 'external-safe', ['form'], {
    description: 'Schema-driven form renderer for Object Type backed intake flows.',
    requiredResources: [{ type: 'ObjectType', fields: ['fields'], actions: ['create'], events: [], required: true }],
    dataBindings: [{ name: 'schema', resource: 'ObjectType', field: 'fields', required: true }],
    actionBindings: [{ name: 'submit', resource: 'Resource', action: 'create', required: true }],
    overridePoints: [
      { name: 'fieldLayout', path: 'presentationConfig.fieldLayout', kind: 'presentation', required: false },
      { name: 'submitAction', path: 'actionsConfig.submit', kind: 'actions', required: true },
    ],
  }),
  block('daisy.stage-progress', 'StageProgress', '@enterpriseaigroup/daisy', 'StageProgress', 'product', 'external-with-adapter', ['workflow'], {
    description: 'Workflow stage tracker for DAISY-backed journeys.',
    requiredResources: [{ type: 'WorkflowRun', fields: ['stage', 'status'], actions: [], events: ['stage.changed'], required: true }],
    dataBindings: [{ name: 'stage', resource: 'WorkflowRun', field: 'stage', required: true }],
  }),
  block('daisy.chatbot', 'Chatbot', '@enterpriseaigroup/daisy', 'Chatbot', 'product', 'external-with-adapter', ['chat', 'ai'], {
    description: 'Chat surface that requires an adapter-backed runtime workflow.',
    requiredResources: [{ type: 'Conversation', fields: ['messages'], actions: ['sendMessage'], events: ['message.received'], required: true }],
    dataBindings: [{ name: 'messages', resource: 'Conversation', field: 'messages', required: true }],
    actionBindings: [{ name: 'sendMessage', resource: 'Conversation', action: 'sendMessage', required: true }],
  }),
  block('daisy.address-lookup', 'AddressLookup', '@enterpriseaigroup/daisy', 'AddressLookup', 'product', 'external-with-adapter', ['address', 'form'], {
    description: 'Address search and selection block that uses an adapter-backed lookup service.',
    requiredResources: [{ type: 'AddressSuggestion', fields: ['label', 'addressId'], actions: ['search'], events: [], required: true }],
    dataBindings: [{ name: 'suggestions', resource: 'AddressSuggestion', field: 'label', required: true }],
    actionBindings: [{ name: 'search', resource: 'AddressSuggestion', action: 'search', required: true }],
  }),
  block('assess.workflow-navigator', 'WorkflowNavigator', '@enterpriseaigroup/assess', 'WorkflowNavigator', 'product', 'external-with-adapter', ['workflow', 'navigation'], {
    description: 'Assessment workflow navigation block for guided review journeys.',
    requiredResources: [{ type: 'AssessmentWorkflow', fields: ['steps', 'currentStep'], actions: ['advance'], events: [], required: true }],
    dataBindings: [{ name: 'currentStep', resource: 'AssessmentWorkflow', field: 'currentStep', required: true }],
    actionBindings: [{ name: 'advance', resource: 'AssessmentWorkflow', action: 'advance', required: true }],
  }),
  block('demo.example-card', 'ExampleCard', '@enterpriseaigroup/demo', 'ExampleCard', 'dev', 'external-safe', ['demo', 'layout'], {
    description: 'Demo-only example block for local prototypes and docs.',
    publicReadiness: 'preview',
    packageProfiles: ['external', 'hybrid'],
  }),
];

export function normalizeManifestBlocks(discovered: DiscoveredManifest): BlockCatalogEntry[] {
  const manifestRecord = asRecord(discovered.manifest) ?? {};
  const packageName = readString(manifestRecord, 'packageName') ?? discovered.source.packageName ?? 'workspace';
  const packageVersion = readString(manifestRecord, 'packageVersion') ?? discovered.source.packageVersion;
  const manifestLane = readPackageLane(manifestRecord.packageLane);
  const manifestProfiles = readPackageProfiles(manifestRecord.packageProfiles ?? manifestRecord.packageProfile);
  const catalogMetadata = {
    ...(asRecord(manifestRecord.catalog) ?? {}),
    ...(discovered.catalogMetadata ?? {}),
  };

  return Array.isArray(discovered.manifest.blocks)
    ? discovered.manifest.blocks
        .map((rawBlock, index) => normalizeBlockEntry(rawBlock, {
          packageName,
          packageVersion,
          packageLane: manifestLane,
          packageProfiles: manifestProfiles,
          source: discovered.source,
          catalogMetadata,
          index,
        }))
        .filter((entry): entry is BlockCatalogEntry => Boolean(entry))
    : [];
}

export function normalizeBlockEntry(rawBlock: unknown, context: {
  packageName: string;
  packageVersion?: string;
  packageLane?: PackageLane;
  packageProfiles?: PackageProfile[];
  source: BlockSource;
  catalogMetadata?: Record<string, unknown>;
  index: number;
}): BlockCatalogEntry | null {
  const blockRecord = asRecord(rawBlock);
  const id = readString(blockRecord, 'id', 'blockId');
  if (!blockRecord || !id) {
    return null;
  }

  const packageName = readString(blockRecord, 'packageName', 'package') ?? context.packageName;
  const backendCoupling = readBackendCoupling(blockRecord.backendCoupling ?? blockRecord.coupling)
    ?? inferCouplingFromPackage(packageName);
  const bindings = asRecord(blockRecord.bindings);

  return {
    id,
    title: readString(blockRecord, 'title', 'displayName', 'name') ?? id,
    description: readString(blockRecord, 'description', 'summary'),
    packageName,
    importPath: readString(blockRecord, 'importPath', 'import', 'module') ?? packageName,
    exportName: readString(blockRecord, 'exportName', 'export') ?? toExportName(id),
    packageLane: readPackageLane(blockRecord.packageLane ?? blockRecord.lane ?? blockRecord.category)
      ?? context.packageLane
      ?? inferLaneFromPackage(packageName),
    packageProfiles: readPackageProfiles(blockRecord.packageProfiles ?? blockRecord.packageProfile ?? blockRecord.profiles ?? blockRecord.profile)
      ?? context.packageProfiles
      ?? inferProfilesForCoupling(backendCoupling),
    publicReadiness: readPublicReadiness(blockRecord.publicReadiness ?? blockRecord.readiness)
      ?? inferReadinessForCoupling(backendCoupling),
    backendCoupling,
    capabilities: readStringArray(blockRecord.capabilities),
    slots: readStringArray(blockRecord.slots),
    themeTokens: readStringArray(blockRecord.themeTokens ?? blockRecord.tokens),
    requiredResources: readResources(blockRecord.requiredResources ?? blockRecord.resources),
    dataBindings: readBindings(blockRecord.dataBindings ?? bindings?.data),
    actionBindings: readBindings(blockRecord.actionBindings ?? bindings?.actions),
    overridePoints: readOverridePoints(blockRecord.overridePoints ?? blockRecord.overrides),
    customExtension: readBoolean(blockRecord.customExtension ?? blockRecord.customExtensionBlock ?? asRecord(blockRecord.extension)?.custom) ?? false,
    source: { ...context.source, packageName, packageVersion: context.packageVersion },
    catalogMetadata: Object.keys(context.catalogMetadata ?? {}).length > 0 ? context.catalogMetadata : undefined,
    storybook: readStorybook(blockRecord.storybook),
  };
}

export function filterBlocks(
  blocks: BlockCatalogEntry[],
  options: {
    lane?: PackageLane;
    coupling?: BackendCoupling;
    readiness?: PublicReadiness;
    packageProfile?: PackageProfile;
    custom?: boolean;
  }
): BlockCatalogEntry[] {
  return blocks.filter((entry) => {
    if (options.lane && entry.packageLane !== options.lane) return false;
    if (options.coupling && entry.backendCoupling !== options.coupling) return false;
    if (options.readiness && entry.publicReadiness !== options.readiness) return false;
    if (options.packageProfile && !entry.packageProfiles.includes(options.packageProfile)) return false;
    if (options.custom && !entry.customExtension) return false;
    return true;
  });
}

export function groupBlocks(blocks: BlockCatalogEntry[], groupBy: GroupBy): Array<{ key: string; blocks: BlockCatalogEntry[] }> {
  const grouped = new Map<string, BlockCatalogEntry[]>();
  for (const entry of blocks) {
    for (const key of groupKeys(entry, groupBy)) {
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
  }

  const order = groupBy === 'package' ? Array.from(grouped.keys()).sort() : groupOrder(groupBy);
  return order
    .filter((key) => grouped.has(key))
    .map((key) => ({ key, blocks: grouped.get(key) ?? [] }));
}

export function buildReadinessSummary(blocks: BlockCatalogEntry[], packageProfile: PackageProfile) {
  const byReadiness = { 'public-ready': 0, preview: 0, internal: 0, blocked: 0 };
  const byLane = { foundation: 0, product: 0, addon: 0, dev: 0 };
  const compatibleBlocks: string[] = [];
  const incompatibleBlocks: string[] = [];
  const customExtensionBlocks: string[] = [];

  for (const entry of blocks) {
    byReadiness[entry.publicReadiness] += 1;
    byLane[entry.packageLane] += 1;
    if (entry.packageProfiles.includes(packageProfile)) {
      compatibleBlocks.push(entry.id);
    } else {
      incompatibleBlocks.push(entry.id);
    }
    if (entry.customExtension) {
      customExtensionBlocks.push(entry.id);
    }
  }

  return { total: blocks.length, byReadiness, byLane, compatibleBlocks, incompatibleBlocks, customExtensionBlocks };
}

export function readPackageLane(value: unknown): PackageLane | undefined {
  return readEnum(value, PACKAGE_LANES);
}

export function readBackendCoupling(value: unknown): BackendCoupling | undefined {
  return readEnum(value, BACKEND_COUPLINGS);
}

export function readPublicReadiness(value: unknown): PublicReadiness | undefined {
  if (value === 'ready') {
    return 'public-ready';
  }
  return readEnum(value, PUBLIC_READINESS);
}

export function readPackageProfile(value: unknown): PackageProfile | undefined {
  return readEnum(value, PACKAGE_PROFILES);
}

export function readPackageProfiles(value: unknown): PackageProfile[] | undefined {
  const values = readStringArray(value)
    .map((entry) => readPackageProfile(entry))
    .filter((entry): entry is PackageProfile => Boolean(entry));
  return values.length > 0 ? Array.from(new Set(values)) : undefined;
}

function block(
  id: string,
  title: string,
  packageName: string,
  exportName: string,
  packageLane: PackageLane,
  backendCoupling: BackendCoupling,
  capabilities: string[],
  metadata: Partial<Omit<BlockCatalogEntry, 'id' | 'title' | 'packageName' | 'importPath' | 'exportName' | 'packageLane' | 'backendCoupling' | 'capabilities' | 'source'>> = {}
): BlockCatalogEntry {
  return {
    id,
    title,
    description: metadata.description,
    packageName,
    importPath: packageName,
    exportName,
    packageLane,
    backendCoupling,
    capabilities,
    slots: metadata.slots ?? ['page', 'inline'],
    themeTokens: metadata.themeTokens ?? ['color', 'radius', 'spacing', 'typography'],
    packageProfiles: metadata.packageProfiles ?? inferProfilesForCoupling(backendCoupling),
    publicReadiness: metadata.publicReadiness ?? inferReadinessForCoupling(backendCoupling),
    requiredResources: metadata.requiredResources ?? [],
    dataBindings: metadata.dataBindings ?? [],
    actionBindings: metadata.actionBindings ?? [],
    overridePoints: metadata.overridePoints ?? [
      { name: 'theme', path: 'themeTokens', kind: 'theme', required: false },
      { name: 'presentationConfig', path: 'presentationConfig', kind: 'presentation', required: false },
    ],
    customExtension: metadata.customExtension ?? false,
    source: { type: 'builtin', packageName },
    storybook: metadata.storybook,
    catalogMetadata: metadata.catalogMetadata,
  };
}

function readResources(value: unknown): RequiredResource[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(readResource).filter((entry): entry is RequiredResource => Boolean(entry));
}

function readResource(value: unknown): RequiredResource | null {
  if (typeof value === 'string') return { type: value, fields: [], actions: [], events: [], required: true };
  const record = asRecord(value);
  const type = readString(record, 'type', 'resource', 'objectType', 'name');
  if (!record || !type) return null;
  return {
    type,
    fields: readStringArray(record.fields ?? record.requiredFields),
    actions: readStringArray(record.actions ?? record.requiredActions),
    events: readStringArray(record.events ?? record.requiredEvents),
    purpose: readString(record, 'purpose', 'description'),
    required: readBoolean(record.required) ?? true,
  };
}

function readBindings(value: unknown): BlockBinding[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(readBinding).filter((entry): entry is BlockBinding => Boolean(entry));
}

function readBinding(value: unknown): BlockBinding | null {
  if (typeof value === 'string') return { name: value, required: false };
  const record = asRecord(value);
  const name = readString(record, 'name', 'id', 'binding');
  if (!record || !name) return null;
  return {
    name,
    resource: readString(record, 'resource', 'objectType'),
    field: readString(record, 'field', 'path'),
    action: readString(record, 'action'),
    event: readString(record, 'event'),
    description: readString(record, 'description', 'purpose'),
    required: readBoolean(record.required) ?? false,
  };
}

function readOverridePoints(value: unknown): OverridePoint[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(readOverridePoint).filter((entry): entry is OverridePoint => Boolean(entry));
}

function readOverridePoint(value: unknown): OverridePoint | null {
  if (typeof value === 'string') return { name: value, required: false };
  const record = asRecord(value);
  const name = readString(record, 'name', 'id', 'path');
  if (!record || !name) return null;
  return {
    name,
    path: readString(record, 'path'),
    kind: readString(record, 'kind', 'type'),
    description: readString(record, 'description', 'purpose'),
    required: readBoolean(record.required) ?? false,
  };
}

function readStorybook(value: unknown): BlockCatalogEntry['storybook'] | undefined {
  const record = asRecord(value);
  const title = readString(record, 'title');
  return record && title ? { title, storyId: readString(record, 'storyId', 'id') } : undefined;
}

function groupKeys(entry: BlockCatalogEntry, groupBy: GroupBy): string[] {
  if (groupBy === 'lane') return [entry.packageLane];
  if (groupBy === 'package') return [entry.packageName];
  if (groupBy === 'coupling') return [entry.backendCoupling];
  if (groupBy === 'readiness') return [entry.publicReadiness];
  return entry.packageProfiles;
}

function groupOrder(groupBy: GroupBy): string[] {
  if (groupBy === 'lane') return [...PACKAGE_LANES];
  if (groupBy === 'coupling') return [...BACKEND_COUPLINGS];
  if (groupBy === 'profile') return [...PACKAGE_PROFILES];
  if (groupBy === 'readiness') return [...PUBLIC_READINESS];
  return [];
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined;
}

function inferLaneFromPackage(packageName: string): PackageLane {
  if (packageName.includes('/daisy') || packageName.includes('/assess')) return 'product';
  if (packageName.includes('/demo')) return 'dev';
  if (packageName.includes('/addon') || packageName.includes('/plugin')) return 'addon';
  return 'foundation';
}

function inferCouplingFromPackage(packageName: string): BackendCoupling {
  return packageName.includes('/daisy') || packageName.includes('/assess') ? 'external-with-adapter' : 'external-safe';
}

function inferProfilesForCoupling(coupling: BackendCoupling): PackageProfile[] {
  if (coupling === 'internal-only') return ['internal'];
  if (coupling === 'external-with-adapter') return ['hybrid', 'internal'];
  return ['external', 'hybrid', 'internal'];
}

function inferReadinessForCoupling(coupling: BackendCoupling): PublicReadiness {
  return coupling === 'internal-only' ? 'internal' : 'public-ready';
}

function toExportName(id: string): string {
  const parts = id.split(/[.\-_]/).filter(Boolean);
  const pascal = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return pascal || 'Block';
}
