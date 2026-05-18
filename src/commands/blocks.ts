import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

type PackageLane = 'foundation' | 'product' | 'addon' | 'dev';
type BackendCoupling = 'external-safe' | 'external-with-adapter' | 'internal-only';

interface BlockCatalogEntry {
  id: string;
  title: string;
  packageName: string;
  importPath: string;
  exportName: string;
  packageLane: PackageLane;
  backendCoupling: BackendCoupling;
  capabilities: string[];
  slots: string[];
  themeTokens: string[];
  storybook?: {
    title: string;
    storyId?: string;
  };
}

interface BlockManifest {
  schemaVersion: string;
  packageName: string;
  blocks: BlockCatalogEntry[];
}

const KNOWN_MANIFEST_PACKAGES = [
  '@enterpriseaigroup/ui',
  '@enterpriseaigroup/blocks',
  '@enterpriseaigroup/core',
  '@enterpriseaigroup/daisy',
  '@enterpriseaigroup/assess',
  '@enterpriseaigroup/demo',
];

const BUILTIN_BLOCKS: BlockCatalogEntry[] = [
  block('core.button', 'Button', '@enterpriseaigroup/core', 'Button', 'foundation', 'external-safe', ['ui', 'action']),
  block('core.input', 'Input', '@enterpriseaigroup/core', 'Input', 'foundation', 'external-safe', ['ui', 'form']),
  block('core.card', 'Card', '@enterpriseaigroup/core', 'Card', 'foundation', 'external-safe', ['ui', 'layout']),
  block('design.hero', 'Hero', '@enterpriseaigroup/blocks', 'Hero', 'foundation', 'external-safe', ['marketing', 'layout']),
  block('design.feature-grid', 'FeatureGrid', '@enterpriseaigroup/blocks', 'FeatureGrid', 'foundation', 'external-safe', ['marketing', 'layout']),
  block('design.form-builder', 'FormBuilder', '@enterpriseaigroup/blocks', 'FormBuilder', 'foundation', 'external-safe', ['form']),
  block('daisy.stage-progress', 'StageProgress', '@enterpriseaigroup/daisy', 'StageProgress', 'product', 'external-with-adapter', ['workflow']),
  block('daisy.chatbot', 'Chatbot', '@enterpriseaigroup/daisy', 'Chatbot', 'product', 'external-with-adapter', ['chat', 'ai']),
  block('daisy.address-lookup', 'AddressLookup', '@enterpriseaigroup/daisy', 'AddressLookup', 'product', 'external-with-adapter', ['address', 'form']),
  block('assess.workflow-navigator', 'WorkflowNavigator', '@enterpriseaigroup/assess', 'WorkflowNavigator', 'product', 'external-with-adapter', ['workflow', 'navigation']),
  block('demo.example-card', 'ExampleCard', '@enterpriseaigroup/demo', 'ExampleCard', 'dev', 'external-safe', ['demo', 'layout']),
];

export const blocksCommand = new Command('blocks')
  .description('Discover AI-readable EAI UI block manifests')
  .addCommand(
    new Command('list')
      .description('List available EAI UI blocks')
      .option('--format <format>', 'Output format: text or json', 'text')
      .option('--lane <lane>', 'Filter by package lane: foundation, product, addon, dev')
      .option('--coupling <status>', 'Filter by coupling: external-safe, external-with-adapter, internal-only')
      .action(async (options: { format: string; lane?: PackageLane; coupling?: BackendCoupling }) => {
        const blocks = filterBlocks(await loadBlockCatalog(), options);
        if (options.format === 'json') {
          out.json({ blocks });
          return;
        }

        out.heading('EAI UI Blocks');
        for (const lane of ['foundation', 'product', 'addon', 'dev'] as const) {
          const laneBlocks = blocks.filter((entry) => entry.packageLane === lane);
          if (laneBlocks.length === 0) {
            continue;
          }
          out.blank();
          out.heading(lane);
          for (const entry of laneBlocks) {
            out.table([
              [entry.id, `${entry.title} (${entry.packageName})`],
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
        const entry = (await loadBlockCatalog()).find((blockEntry) => blockEntry.id === id);
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
          ['package', entry.packageName],
          ['import', `${entry.importPath}#${entry.exportName}`],
          ['lane', entry.packageLane],
          ['coupling', entry.backendCoupling],
          ['capabilities', entry.capabilities.join(', ') || 'none'],
          ['slots', entry.slots.join(', ') || 'none'],
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
            ['required layers', 'presentationConfig, dataConfig, businessLogic, accessControl, actionsConfig'],
            ['coupling', 'external-safe, external-with-adapter, internal-only'],
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
      .action(async (options: { file?: string; format: string }) => {
        const result = options.file
          ? validateManifest(JSON.parse(await readFile(options.file, 'utf8')))
          : validateEntries(await loadBlockCatalog());

        if (options.format === 'json') {
          out.json(result);
          return;
        }

        if (result.valid) {
          out.success('Block manifest validation passed');
          return;
        }

        result.errors.forEach((error) => out.error(error));
        process.exitCode = 1;
      })
  );

function block(
  id: string,
  title: string,
  packageName: string,
  exportName: string,
  packageLane: PackageLane,
  backendCoupling: BackendCoupling,
  capabilities: string[]
): BlockCatalogEntry {
  return {
    id,
    title,
    packageName,
    importPath: packageName,
    exportName,
    packageLane,
    backendCoupling,
    capabilities,
    slots: ['page', 'inline'],
    themeTokens: ['color', 'radius', 'spacing', 'typography'],
  };
}

async function loadBlockCatalog(): Promise<BlockCatalogEntry[]> {
  const discovered = await loadInstalledManifests();
  const byId = new Map<string, BlockCatalogEntry>();
  for (const entry of [...BUILTIN_BLOCKS, ...discovered.flatMap((manifest) => manifest.blocks)]) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

async function loadInstalledManifests(): Promise<BlockManifest[]> {
  const manifests: BlockManifest[] = [];
  for (const packageName of KNOWN_MANIFEST_PACKAGES) {
    const manifest = await loadPackageManifest(packageName);
    if (manifest) {
      manifests.push(manifest);
    }
  }
  return manifests;
}

async function loadPackageManifest(packageName: string): Promise<BlockManifest | null> {
  const packageRoot = join(process.cwd(), 'node_modules', ...packageName.split('/'));
  const packageJsonPath = join(packageRoot, 'package.json');
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      exports?: Record<string, string | { import?: string; require?: string }>;
    };
    const manifestExport = packageJson.exports?.['./manifest'];
    const manifestPath = typeof manifestExport === 'string'
      ? manifestExport
      : manifestExport?.import ?? manifestExport?.require;
    if (!manifestPath) {
      return null;
    }

    const fullPath = join(packageRoot, manifestPath.replace(/^\.\//, ''));
    await access(fullPath);
    const loaded = await import(pathToFileURL(fullPath).href) as Record<string, unknown>;
    const manifest = Object.values(loaded).find(isManifest);
    return manifest ?? null;
  } catch {
    return null;
  }
}

function filterBlocks(
  blocks: BlockCatalogEntry[],
  options: { lane?: PackageLane; coupling?: BackendCoupling }
): BlockCatalogEntry[] {
  return blocks.filter((entry) => {
    if (options.lane && entry.packageLane !== options.lane) {
      return false;
    }
    if (options.coupling && entry.backendCoupling !== options.coupling) {
      return false;
    }
    return true;
  });
}

function validateManifest(value: unknown): { valid: boolean; errors: string[] } {
  if (!isManifest(value)) {
    return { valid: false, errors: ['Manifest must include schemaVersion, packageName, and blocks array'] };
  }
  return validateEntries(value.blocks);
}

function validateEntries(blocks: BlockCatalogEntry[]): { valid: boolean; errors: string[] } {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const entry of blocks) {
    for (const field of ['id', 'title', 'packageName', 'importPath', 'exportName', 'packageLane', 'backendCoupling'] as const) {
      if (!entry[field]) {
        errors.push(`${entry.id || '<unknown>'} is missing ${field}`);
      }
    }
    if (seen.has(entry.id)) {
      errors.push(`Duplicate block id "${entry.id}"`);
    }
    seen.add(entry.id);
  }
  return { valid: errors.length === 0, errors };
}

function isManifest(value: unknown): value is BlockManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const manifest = value as Partial<BlockManifest>;
  return typeof manifest.schemaVersion === 'string'
    && typeof manifest.packageName === 'string'
    && Array.isArray(manifest.blocks);
}

function buildManifestSchemaSummary() {
  return {
    schemaVersion: '1.0.0',
    requiredBlockFields: [
      'id',
      'title',
      'packageName',
      'importPath',
      'exportName',
      'packageLane',
      'backendCoupling',
      'presentationConfig',
      'dataConfig',
      'businessLogic',
      'accessControl',
      'actionsConfig',
    ],
    packageLanes: ['foundation', 'product', 'addon', 'dev'],
    backendCoupling: ['external-safe', 'external-with-adapter', 'internal-only'],
  };
}
