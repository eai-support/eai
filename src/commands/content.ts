import { Command } from 'commander';
import {
  createCapabilityControlPlaneClient,
  formatControlPlaneError,
  sanitizeControlPlaneValue,
  type CapabilityContentDomain,
} from '../lib/capability-control-plane.js';
import { normalizeFormat, resolveCommandContext } from '../lib/context.js';
import * as out from '../lib/output.js';

interface ContentOptions {
  tenant?: string;
  format?: string;
  json?: boolean;
  app?: string;
  as?: string;
  capability?: string;
  environment?: string;
  type?: string;
}

interface ContentRegistration {
  command: string;
  label: string;
  domain: CapabilityContentDomain;
  capabilityKey: string;
  assetType: string;
  bindable: boolean;
}

const CONTENT: readonly ContentRegistration[] = [
  {
    command: 'document-template',
    label: 'document templates',
    domain: 'document-templates',
    capabilityKey: 'templates.documents',
    assetType: 'shared-document-template',
    bindable: true,
  },
  {
    command: 'email-template',
    label: 'email templates',
    domain: 'email-templates',
    capabilityKey: 'templates.email',
    assetType: 'shared-email-template',
    bindable: true,
  },
  {
    command: 'knowledge-article',
    label: 'knowledge articles',
    domain: 'knowledge-articles',
    capabilityKey: 'knowledge',
    assetType: 'shared-kb-article',
    bindable: true,
  },
  {
    command: 'policy',
    label: 'policies',
    domain: 'policies',
    capabilityKey: 'knowledge',
    assetType: 'shared-policy',
    bindable: false,
  },
  {
    command: 'document-type',
    label: 'document types',
    domain: 'document-types',
    capabilityKey: 'documents',
    assetType: 'shared-document-type',
    bindable: true,
  },
  {
    command: 'document-checklist',
    label: 'document checklists',
    domain: 'document-checklists',
    capabilityKey: 'document-checklists',
    assetType: 'shared-document-checklist',
    bindable: true,
  },
  {
    command: 'requirement-group',
    label: 'document requirement groups',
    domain: 'requirement-groups',
    capabilityKey: 'document-checklists',
    assetType: 'shared-document-requirement-group',
    bindable: true,
  },
];

async function controlPlane(options: ContentOptions) {
  const context = await resolveCommandContext({ tenantId: options.tenant, interactive: !options.tenant });
  return createCapabilityControlPlaneClient(context.client, context.tenantId);
}

function writeResult(result: unknown, options: ContentOptions): void {
  const safe = sanitizeControlPlaneValue(result);
  if (normalizeFormat(options) === 'json') {
    out.json(safe);
    return;
  }
  out.json(safe);
}

function fail(error: unknown): never {
  out.error(formatControlPlaneError(error));
  process.exit(1);
}

function common(command: Command): Command {
  return command
    .option('--tenant <id>', 'Tenant id (defaults to active tenant)')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--json', 'Output raw JSON (deprecated, use --format json)', false);
}

function bindingOptions(command: Command, registration: ContentRegistration): Command {
  return command
    .requiredOption('--app <key>', 'App key')
    .requiredOption('--as <alias>', 'Logical binding alias stored server-side')
    .option('--capability <key>', 'Capability key', registration.capabilityKey)
    .option('--environment <name>', 'Optional environment binding');
}

function registerContentCommands(parent: Command, registration: ContentRegistration): void {
  const command = parent.command(registration.command).description(`Inspect Portal-managed ${registration.label}`);

  common(command.command('list').description(`List tenant ${registration.label}`))
    .action(async (options: ContentOptions) => {
      try {
        writeResult(await (await controlPlane(options)).listContent(registration.domain), options);
      } catch (error) {
        fail(error);
      }
    });

  common(command.command('show <key>').description(`Show one ${registration.label} record by natural key`))
    .action(async (key: string, options: ContentOptions) => {
      try {
        writeResult(await (await controlPlane(options)).getContent(registration.domain, key), options);
      } catch (error) {
        fail(error);
      }
    });

  if (registration.bindable) {
    common(bindingOptions(
      command.command('use <key>').description(`Bind one ${registration.label} record to a logical app alias`),
      registration,
    )).action(async (key: string, options: ContentOptions) => {
      try {
        const client = await controlPlane(options);
        writeResult(await client.setAssetBinding(options.app ?? '', {
          bindingKey: options.as ?? '',
          capabilityKey: options.capability ?? registration.capabilityKey,
          assetType: registration.assetType,
          assetKey: key,
          ...(options.environment ? { environment: options.environment } : {}),
        }), options);
      } catch (error) {
        fail(error);
      }
    });
  }
}

export const contentCommand = new Command('content')
  .description('Discover and bind Portal-managed shared content without mutating it');

for (const registration of CONTENT) registerContentCommands(contentCommand, registration);

const sharedAssetCommand = contentCommand
  .command('shared-asset')
  .description('Inspect tenant-declared additional asset types and records');

common(sharedAssetCommand.command('types').description('List allowed tenant shared-asset Object Types'))
  .action(async (options: ContentOptions) => {
    try {
      writeResult(await (await controlPlane(options)).listSharedAssetTypes(), options);
    } catch (error) {
      fail(error);
    }
  });

common(sharedAssetCommand.command('list').description('List one tenant-declared shared asset type')
  .requiredOption('--type <object-type>', 'Exact shared-asset-* Object Type from `eai content shared-asset types`'))
  .action(async (options: ContentOptions) => {
    try {
      writeResult(await (await controlPlane(options)).listSharedAssets(options.type ?? ''), options);
    } catch (error) {
      fail(error);
    }
  });

common(sharedAssetCommand.command('show <key>').description('Show one shared asset by natural key')
  .requiredOption('--type <object-type>', 'Exact tenant-declared shared-asset-* Object Type'))
  .action(async (key: string, options: ContentOptions) => {
    try {
      writeResult(await (await controlPlane(options)).getSharedAsset(options.type ?? '', key), options);
    } catch (error) {
      fail(error);
    }
  });

common(bindingOptions(
  sharedAssetCommand.command('use <key>').description('Bind one shared asset to a logical app alias')
    .requiredOption('--type <object-type>', 'Exact tenant-declared shared-asset-* Object Type'),
  {
    command: 'shared-asset',
    label: 'shared assets',
    domain: 'document-types',
    capabilityKey: 'shared-assets',
    assetType: 'shared-asset-*',
    bindable: true,
  },
)).action(async (key: string, options: ContentOptions) => {
  try {
    const client = await controlPlane(options);
    writeResult(await client.setAssetBinding(options.app ?? '', {
      bindingKey: options.as ?? '',
      capabilityKey: options.capability ?? 'shared-assets',
      assetType: options.type ?? '',
      assetKey: key,
      ...(options.environment ? { environment: options.environment } : {}),
    }), options);
  } catch (error) {
    fail(error);
  }
});

contentCommand.addHelpText('after', `
Shared content is authored in Admin Portal Advanced Settings. These commands are
read/select/bind-only; they never create, edit, or delete tenant content.
`);
