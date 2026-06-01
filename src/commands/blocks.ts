import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';
import { loadBlockCatalog } from '../lib/block-catalog.js';
import {
  BACKEND_COUPLINGS,
  DEFAULT_GROUP_BY,
  PACKAGE_LANES,
  PACKAGE_MANIFEST_EXPORTS,
  PACKAGE_PROFILES,
  PUBLIC_READINESS,
  WORKSPACE_MANIFEST_PATHS,
  type BackendCoupling,
  type BlockBinding,
  type BlockCatalog,
  type BlockSource,
  type GroupBy,
  type OverridePoint,
  type PackageLane,
  type PackageProfile,
  type PublicReadiness,
  type RequiredResource,
} from '../lib/block-catalog-types.js';
import { buildReadinessSummary, filterBlocks, groupBlocks } from '../lib/block-catalog-normalize.js';
import { validateCatalog, validateManifest } from '../lib/block-catalog-validation.js';

export const blocksCommand = new Command('blocks')
  .description('Discover AI-readable EAI UI block manifests')
  .addCommand(
    new Command('list')
      .description('List available EAI UI blocks')
      .option('--format <format>', 'Output format: text or json', 'text')
      .option('--lane <lane>', 'Filter by package lane: foundation, product, addon, dev')
      .option('--coupling <status>', 'Filter by coupling: external-safe, external-with-adapter, internal-only')
      .option('--readiness <status>', 'Filter by public readiness: public-ready, preview, internal, blocked')
      .option('--package-profile <profile>', 'Filter by package profile compatibility: external, internal, hybrid')
      .option('--custom', 'Show only custom extension blocks')
      .option('--group-by <field>', 'Group output by lane, package, coupling, profile, or readiness', DEFAULT_GROUP_BY)
      .action(async (options: {
        format: string;
        lane?: string;
        coupling?: string;
        readiness?: string;
        packageProfile?: string;
        custom?: boolean;
        groupBy: string;
      }) => {
        const filters = parseFilterOptions(options);
        const groupBy = parseGroupBy(options.groupBy, options.format);
        const catalog = await loadBlockCatalog();
        const blocks = filterBlocks(catalog.blocks, filters);
        const groups = groupBlocks(blocks, groupBy);

        if (options.format === 'json') {
          out.json({
            packageProfile: catalog.packageMetadata.profile,
            manifests: catalog.manifests,
            groupBy,
            groups,
            blocks,
          });
          return;
        }

        out.heading('EAI UI Blocks');
        printCatalogMetadata(catalog);
        for (const group of groups) {
          out.blank();
          out.heading(group.key);
          for (const entry of group.blocks) {
            out.table([
              [entry.id, `${entry.title} (${entry.packageName})`],
              ['readiness', entry.publicReadiness],
              ['profiles', entry.packageProfiles.join(', ')],
              ['coupling', entry.backendCoupling],
              ['capabilities', entry.capabilities.join(', ') || 'none'],
            ]);
          }
        }
      })
  )
  .addCommand(
    new Command('describe')
      .description('Describe a block by stable block id')
      .argument('<id>', 'Block id or alias, e.g. core.button')
      .option('--format <format>', 'Output format: text or json', 'text')
      .action(async (id: string, options: { format: string }) => {
        const entry = (await loadBlockCatalog()).blocks.find((blockEntry) => blockEntry.id === id);
        if (!entry) {
          exitWithError(
            ErrorCode.E305,
            { details: `Unknown block id "${id}". Run "eai blocks list".` },
            options.format === 'json' ? 'json' : 'text'
          );
        }

        if (options.format === 'json') {
          out.json(entry);
          return;
        }

        out.heading(entry.title);
        out.table([
          ['id', entry.id],
          ['description', entry.description ?? 'none'],
          ['package', entry.packageName],
          ['import', `${entry.importPath}#${entry.exportName}`],
          ['lane', entry.packageLane],
          ['profiles', entry.packageProfiles.join(', ')],
          ['readiness', entry.publicReadiness],
          ['coupling', entry.backendCoupling],
          ['custom extension', entry.customExtension ? 'yes' : 'no'],
          ['capabilities', entry.capabilities.join(', ') || 'none'],
          ['slots', entry.slots.join(', ') || 'none'],
          ['theme tokens', entry.themeTokens.join(', ') || 'none'],
          ['required resources', formatResources(entry.requiredResources)],
          ['data bindings', formatBindings(entry.dataBindings)],
          ['action bindings', formatBindings(entry.actionBindings)],
          ['override points', formatOverridePoints(entry.overridePoints)],
          ['source', formatSource(entry.source)],
        ]);
      })
  )
  .addCommand(
    new Command('readiness')
      .description('Summarize public readiness and package-profile compatibility')
      .option('--format <format>', 'Output format: text or json', 'text')
      .option('--package-profile <profile>', 'Evaluate compatibility for external, internal, or hybrid projects')
      .action(async (options: { format: string; packageProfile?: string }) => {
        const catalog = await loadBlockCatalog();
        const packageProfile = parsePackageProfileOption(
          options.packageProfile ?? catalog.packageMetadata.profile,
          options.format
        );
        const summary = buildReadinessSummary(catalog.blocks, packageProfile);

        if (options.format === 'json') {
          out.json({
            packageProfile,
            projectPackageMetadata: catalog.packageMetadata,
            manifests: catalog.manifests,
            ...summary,
          });
          return;
        }

        out.heading('EAI UI Block Readiness');
        out.table([
          ['package profile', packageProfile],
          ['public-ready', String(summary.byReadiness['public-ready'])],
          ['preview', String(summary.byReadiness.preview)],
          ['internal', String(summary.byReadiness.internal)],
          ['blocked', String(summary.byReadiness.blocked)],
          ['compatible', String(summary.compatibleBlocks.length)],
          ['incompatible', String(summary.incompatibleBlocks.length)],
        ]);
      })
  )
  .addCommand(
    new Command('schema')
      .description('Print the public EAI block manifest schema summary')
      .option('--format <format>', 'Output format: json or text', 'json')
      .action((options: { format: string }) => {
        const schema = buildManifestSchemaSummary();
        if (options.format === 'text') {
          out.heading('EAIBlockManifest');
          out.table([
            ['schemaVersion', '1.0.0'],
            ['required fields', schema.requiredBlockFields.join(', ')],
            ['resource metadata', 'requiredResources, dataBindings, actionBindings'],
            ['override metadata', 'overridePoints, themeTokens, customExtension'],
            ['package profiles', PACKAGE_PROFILES.join(', ')],
            ['public readiness', PUBLIC_READINESS.join(', ')],
            ['coupling', BACKEND_COUPLINGS.join(', ')],
          ]);
          return;
        }
        out.json(schema);
      })
  )
  .addCommand(
    new Command('validate')
      .description('Validate installed block catalog metadata or a manifest JSON file')
      .option('--file <path>', 'Validate a manifest JSON file instead of the installed catalog')
      .option('--format <format>', 'Output format: text or json', 'text')
      .option('--strict', 'Treat warnings as validation failures', false)
      .action(async (options: { file?: string; format: string; strict?: boolean }) => {
        const result = options.file
          ? validateManifest(JSON.parse(await readFile(options.file, 'utf8')), Boolean(options.strict))
          : validateCatalog(await loadBlockCatalog(), Boolean(options.strict));

        if (options.format === 'json') {
          out.json(result);
          if (!result.valid) {
            process.exitCode = 1;
          }
          return;
        }

        if (result.valid) {
          out.success('Block manifest validation passed');
        } else {
          result.errors.forEach((error) => out.error(error));
          process.exitCode = 1;
        }
        result.warnings.forEach((warning) => out.warn(warning));
      })
  );

function parseFilterOptions(options: {
  format: string;
  lane?: string;
  coupling?: string;
  readiness?: string;
  packageProfile?: string;
  custom?: boolean;
}): {
  lane?: PackageLane;
  coupling?: BackendCoupling;
  readiness?: PublicReadiness;
  packageProfile?: PackageProfile;
  custom?: boolean;
} {
  return {
    lane: options.lane ? parseEnumOption(options.lane, PACKAGE_LANES, 'lane', options.format) : undefined,
    coupling: options.coupling ? parseEnumOption(options.coupling, BACKEND_COUPLINGS, 'coupling', options.format) : undefined,
    readiness: options.readiness ? parseEnumOption(options.readiness, PUBLIC_READINESS, 'readiness', options.format) : undefined,
    packageProfile: options.packageProfile ? parsePackageProfileOption(options.packageProfile, options.format) : undefined,
    custom: Boolean(options.custom),
  };
}

function parsePackageProfileOption(value: string, format: string): PackageProfile {
  return parseEnumOption(value, PACKAGE_PROFILES, 'package-profile', format);
}

function parseGroupBy(value: string, format: string): GroupBy {
  return parseEnumOption(value, ['lane', 'package', 'coupling', 'profile', 'readiness'] as const, 'group-by', format);
}

function parseEnumOption<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
  format: string
): T {
  if (allowed.includes(value as T)) {
    return value as T;
  }
  exitWithError(
    ErrorCode.E305,
    { details: `Invalid --${label} "${value}". Valid values: ${allowed.join(', ')}.` },
    format === 'json' ? 'json' : 'text'
  );
}

function printCatalogMetadata(catalog: BlockCatalog): void {
  out.table([
    ['package profile', catalog.packageMetadata.profile],
    ['discovered manifests', String(catalog.manifests.length)],
  ]);
}

function formatResources(resources: RequiredResource[]): string {
  return resources.map((resource) => {
    const details = [
      resource.fields.length > 0 ? `fields: ${resource.fields.join(', ')}` : '',
      resource.actions.length > 0 ? `actions: ${resource.actions.join(', ')}` : '',
      resource.events.length > 0 ? `events: ${resource.events.join(', ')}` : '',
    ].filter(Boolean);
    return details.length > 0 ? `${resource.type} (${details.join('; ')})` : resource.type;
  }).join(' | ') || 'none';
}

function formatBindings(bindings: BlockBinding[]): string {
  return bindings.map((binding) => {
    const target = [binding.resource, binding.field, binding.action, binding.event].filter(Boolean).join('.');
    return target ? `${binding.name} -> ${target}` : binding.name;
  }).join(' | ') || 'none';
}

function formatOverridePoints(overrides: OverridePoint[]): string {
  return overrides.map((override) => {
    const details = [override.kind, override.path].filter(Boolean).join(':');
    return details ? `${override.name} (${details})` : override.name;
  }).join(' | ') || 'none';
}

function formatSource(source: BlockSource): string {
  const details = [source.packageName, source.packageVersion, source.manifestPath].filter(Boolean).join(' ');
  return details ? `${source.type}: ${details}` : source.type;
}

function buildManifestSchemaSummary() {
  return {
    schemaVersion: '1.0.0',
    discovery: {
      packageJsonFields: [
        'eai.blockManifest',
        'eai.blocksManifest',
        'eai.blockCatalog',
        'eai.uiBlockManifest',
        'eai.uiBlocks.manifest',
        'eaiBlocks.manifest',
      ],
      packageExports: PACKAGE_MANIFEST_EXPORTS,
      workspacePaths: WORKSPACE_MANIFEST_PATHS,
      pinnedProjectManifestPaths: ['.eai-manifest.json#blocks.manifests', '.eai-manifest.json#blockCatalog.manifests'],
    },
    requiredBlockFields: [
      'id',
      'title',
      'packageName',
      'importPath',
      'exportName',
      'packageLane',
      'backendCoupling',
      'publicReadiness',
      'packageProfiles',
      'requiredResources',
      'dataBindings',
      'actionBindings',
      'overridePoints',
    ],
    packageLanes: PACKAGE_LANES,
    packageProfiles: PACKAGE_PROFILES,
    publicReadiness: PUBLIC_READINESS,
    backendCoupling: BACKEND_COUPLINGS,
  };
}
