/**
 * eai types — manage Object Type definitions.
 *
 * seed:     Push local Object Types to platform via PublicAPI
 * validate: Check types against platform schema rules
 * diff:     Compare local definitions with remote platform state
 * pull:     Download remote Object Types to local TypeScript
 * define:   Interactive Object Type builder (future)
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { findProjectRoot, loadObjectTypes, type ObjectTypeDefinition } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import * as out from '../lib/output.js';
import { ErrorCode, exitWithError } from '../lib/error-codes.js';

export interface TenantResolution {
  tenantId?: string;
  source: 'option' | 'active:tenant' | 'unresolved';
}

export function resolveTenantIdForKey(
  tenantKey: string,
  explicitTenantId?: string,
  activeTenantId?: string,
): TenantResolution {
  if (explicitTenantId) {
    return { tenantId: explicitTenantId, source: 'option' };
  }

  if (activeTenantId) {
    return { tenantId: activeTenantId, source: 'active:tenant' };
  }

  return { source: 'unresolved' };
}

function describeTenantResolutionSource(source: TenantResolution['source']): string {
  switch (source) {
    case 'option':
      return 'CLI override';
    case 'active:tenant':
      return 'active tenant';
    default:
      return 'unresolved';
  }
}

function explainMissingTenantId(tenantKey: string): void {
  out.warn(`No active tenant is available for "${tenantKey}"`);
  out.info(`Run ${chalk.cyan('eai login')} and ${chalk.cyan('eai tenant select')} to choose the tenant to work with, or use ${chalk.cyan(`--tenant-key ${tenantKey} --tenant-id <uuid>`)}`);
}

export function resolveDefaultTenantKey(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
  activeTenantSlug?: string,
): string | null {
  const keys = Object.keys(objectTypes);
  if (keys.length === 1) {
    return keys[0];
  }
  if (activeTenantSlug && objectTypes[activeTenantSlug]) {
    return activeTenantSlug;
  }
  if (objectTypes.template) {
    return 'template';
  }
  if (objectTypes.default) {
    return 'default';
  }
  return null;
}

async function selectTenantKey(
  objectTypes: Record<string, ObjectTypeDefinition[]>,
  explicitTenantKey?: string,
  activeTenantSlug?: string,
): Promise<string[]> {
  if (explicitTenantKey) {
    return [explicitTenantKey];
  }

  const defaultKey = resolveDefaultTenantKey(objectTypes, activeTenantSlug);
  if (defaultKey) {
    return [defaultKey];
  }

  const keys = Object.keys(objectTypes);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    exitWithError(ErrorCode.E303, { field: '--tenant-key' });
  }

  const { tenantKey } = await inquirer.prompt([{
    type: 'list',
    name: 'tenantKey',
    message: 'Select the local object-type scope to publish or diff',
    choices: keys.map((key) => ({
      name: key,
      value: key,
    })),
  }]);

  return [tenantKey as string];
}

export const typesCommand = new Command('types')
  .description('Manage Object Type definitions')
  .addHelpText('after', `
Workflow:
  1. Validate local definitions:
       eai types validate
  2. Login and select the active tenant:
       eai login
       eai tenant select
  3. Preview remote differences:
       eai types diff --tenant-key <key>
  4. Publish:
       eai types seed --tenant-key <key>
  5. Verify published schema:
       eai resources schema
  `);

// ─── eai types seed ────────────────────────────────────────────────────────

typesCommand
  .command('seed')
  .description('Push Object Types to platform')
  .option('--env <environment>', 'Target environment', 'dev')
  .option('--tenant-key <key>', 'Specific tenant key from object-types.ts')
  .option('--tenant-id <id>', 'Override the resolved tenant ID (use with --tenant-key)')
  .option('--dry-run', 'Show what would be seeded without making changes', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .option('--json', 'Output raw JSON (deprecated, use --format json)', false)
  .addHelpText('after', `
Examples:
  $ eai types seed
  $ eai types seed --dry-run
  $ eai types seed --tenant-key trial-portal
  $ eai types seed --tenant-key template --tenant-id 50808ce0-f31b-4fd0-9861-74b83b8c112a
  $ eai types seed --format json | jq
  `)
  .action(async (options) => {
    // Backward compatibility: --json maps to --format json
    if (options.json) {
      options.format = 'json';
    }
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001, undefined, options.format);
    }

    const spinner = options.format === 'json' ? null : ora('Loading Object Types...').start();

    let objectTypes: Record<string, ObjectTypeDefinition[]>;
    try {
      objectTypes = await loadObjectTypes(root);
      const totalTypes = Object.values(objectTypes).reduce((sum, types) => sum + types.length, 0);
      const tenantKeys = Object.keys(objectTypes);
      if (spinner) {
        spinner.succeed(`Found ${totalTypes} types across ${tenantKeys.length} tenant scope(s): ${tenantKeys.join(', ')}`);
      }
    } catch (err) {
      if (spinner) spinner.fail('Failed to load Object Types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (options.tenantId && !options.tenantKey && Object.keys(objectTypes).length > 1) {
      exitWithError(ErrorCode.E303, { field: '--tenant-key when using --tenant-id with multiple tenant scopes' }, options.format);
    }

    const publicApiUrl = await resolvePublicApiUrl(root);
    const activeContext = await resolveActiveTenantContext({
      projectRoot: root,
      publicApiUrl,
      interactive: true,
    });

    // Filter to specific tenant key if requested
    const keysToSeed = await selectTenantKey(objectTypes, options.tenantKey, activeContext.activeTenant.slug);

    out.blank();

    const jsonResults: Array<{ tenantKey: string; tenantId: string; created: number; updated: number; failed: number }> = [];

    for (const tenantKey of keysToSeed) {
      const types = objectTypes[tenantKey];
      if (!types || types.length === 0) {
        out.warn(`No types for tenant key "${tenantKey}"`);
        continue;
      }

      // Resolve tenant ID
      const resolution = resolveTenantIdForKey(tenantKey, options.tenantId, activeContext.activeTenant.id);
      const tenantId = resolution.tenantId;

      if (!tenantId) {
        explainMissingTenantId(tenantKey);
        continue;
      }

      out.heading(`Tenant: ${tenantKey} → ${chalk.dim(tenantId)} ${chalk.dim(`(${describeTenantResolutionSource(resolution.source)})`)}`);

      if (options.dryRun) {
        for (const type of types) {
          out.info(`Would publish: ${chalk.cyan(type.name)}`);
        }
        out.info('Dry run — no changes made');
        continue;
      }

      const client = new PlatformAPIClient(publicApiUrl, tenantId);
      let created = 0, updated = 0, failed = 0;

      for (const type of types) {
        const typeSpinner = ora(`  ${type.name}`).start();

        try {
          // Check if type exists
          const checkRes = await client.platformRequest('/object-types', 'GET', undefined, {
            where: { name: { equals: type.name }, tenant: { equals: tenantId } },
          });

          const checkData = await checkRes.json() as { docs?: Array<{ id: string }> };
          const existing = checkData?.docs?.[0];

          if (existing) {
            // Update
            const updateRes = await client.platformRequest(`/object-types/${existing.id}`, 'PATCH', {
              displayName: type.displayName,
              description: type.description,
              properties: type.properties,
              linkTypes: type.linkTypes,
              actions: type.actions,
              storageBackend: type.storageBackend,
              status: type.status,
            });

            if (updateRes.ok) {
              typeSpinner.succeed(`  ${type.name} ${chalk.cyan('(updated)')}`);
              updated++;
            } else {
              typeSpinner.fail(`  ${type.name} — update failed: ${updateRes.status}`);
              failed++;
            }
          } else {
            // Create
            const createRes = await client.platformRequest('/object-types', 'POST', {
              name: type.name,
              displayName: type.displayName,
              description: type.description,
              properties: type.properties,
              linkTypes: type.linkTypes,
              actions: type.actions,
              storageBackend: type.storageBackend,
              status: type.status,
              tenant: tenantId,
            });

            if (createRes.ok) {
              typeSpinner.succeed(`  ${type.name} ${chalk.green('(created)')}`);
              created++;
            } else {
              typeSpinner.fail(`  ${type.name} — create failed: ${createRes.status}`);
              failed++;
            }
          }
        } catch (err) {
          typeSpinner.fail(`  ${type.name} — ${err instanceof Error ? err.message : String(err)}`);
          failed++;
        }
      }

      out.blank();
      if (options.format !== 'json') {
        out.info(`Result: ${chalk.green(`${created} created`)}, ${chalk.cyan(`${updated} updated`)}, ${chalk.red(`${failed} failed`)}`);
      }
      jsonResults.push({ tenantKey, tenantId: tenantId!, created, updated, failed });
    }

    if (options.format === 'json') {
      out.json({ tenants: jsonResults });
    }
  });

// ─── eai types validate ────────────────────────────────────────────────────

typesCommand
  .command('validate')
  .description('Validate Object Types against platform schema rules')
  .addHelpText('after', `
Examples:
  $ eai types validate
  `)
  .action(async () => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const spinner = ora('Loading Object Types...').start();

    let objectTypes: Record<string, ObjectTypeDefinition[]>;
    try {
      objectTypes = await loadObjectTypes(root);
      spinner.succeed('Loaded Object Types');
    } catch (err) {
      spinner.fail('Failed to load Object Types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    let errors = 0;
    let warnings = 0;

    for (const [tenantKey, types] of Object.entries(objectTypes)) {
      out.heading(`Tenant: ${tenantKey}`);

      for (const type of types) {
        const issues: string[] = [];
        const warns: string[] = [];

        // Name must be PascalCase
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(type.name)) {
          issues.push(`name "${type.name}" must be PascalCase`);
        }

        // Must have displayName
        if (!type.displayName) {
          issues.push('missing displayName');
        }

        // Status must be valid
        if (!['draft', 'published', 'deprecated'].includes(type.status)) {
          issues.push(`invalid status "${type.status}"`);
        }

        // Validate properties
        const propNames = new Set<string>();
        const validTypes = ['text', 'number', 'boolean', 'date', 'select', 'json', 'file', 'relationship'];

        for (const prop of type.properties) {
          if (propNames.has(prop.name)) {
            issues.push(`duplicate property name "${prop.name}"`);
          }
          propNames.add(prop.name);

          if (!validTypes.includes(prop.type)) {
            issues.push(`property "${prop.name}" has invalid type "${prop.type}"`);
          }

          if (prop.type === 'select' && (!prop.options || prop.options.length === 0)) {
            issues.push(`select property "${prop.name}" must have options`);
          }

          if (prop.type !== 'select' && prop.options && prop.options.length > 0) {
            warns.push(`property "${prop.name}" has options but type is "${prop.type}" (not select)`);
          }
        }

        // Validate link types
        for (const link of type.linkTypes) {
          if (!link.targetObjectType) {
            issues.push(`link "${link.name}" missing targetObjectType`);
          }
          if (!['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'].includes(link.cardinality)) {
            issues.push(`link "${link.name}" has invalid cardinality "${link.cardinality}"`);
          }
        }

        // Validate actions
        for (const action of type.actions) {
          if (!action.name) {
            issues.push('action missing name');
          }
          if (!['tenant-viewer', 'tenant-builder', 'tenant-admin'].includes(action.requiredRole)) {
            issues.push(`action "${action.name}" has invalid requiredRole "${action.requiredRole}"`);
          }
          for (const effect of action.sideEffects) {
            if (!['set_field', 'set_timestamp', 'set_user'].includes(effect.type)) {
              issues.push(`action "${action.name}" side effect has invalid type "${effect.type}"`);
            }
            if (effect.type === 'set_field' && !propNames.has(effect.field)) {
              warns.push(`action "${action.name}" side effect references unknown field "${effect.field}"`);
            }
          }
        }

        // Print results
        if (issues.length === 0 && warns.length === 0) {
          out.success(`${type.name} — ${type.properties.length} props, ${type.linkTypes.length} links, ${type.actions.length} actions`);
        } else {
          if (issues.length > 0) {
            out.error(`${type.name}`);
            for (const issue of issues) {
              out.error(`  ${issue}`);
            }
            errors += issues.length;
          }
          if (warns.length > 0) {
            if (issues.length === 0) out.warn(`${type.name}`);
            for (const w of warns) {
              out.warn(`  ${w}`);
            }
            warnings += warns.length;
          }
        }
      }
    }

    out.blank();
    if (errors > 0) {
      exitWithError(ErrorCode.E302, { details: `${errors} validation error(s), ${warnings} warning(s)` });
    } else if (warnings > 0) {
      out.warn(`${warnings} warning(s), 0 errors`);
    } else {
      out.success('All Object Types are valid');
    }
  });

// ─── eai types diff ────────────────────────────────────────────────────────

typesCommand
  .command('diff')
  .description('Compare local Object Types with remote platform')
  .option('--tenant-key <key>', 'Specific tenant key from object-types.ts')
  .option('--tenant-id <id>', 'Override the resolved tenant ID (use with --tenant-key)')
  .addHelpText('after', `
Examples:
  $ eai types diff
  $ eai types diff --tenant-key council --tenant-id 423b7e9c-9a69-4763-5b9a-69570218f65d
  `)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001);
    }

    const spinner = ora('Loading local Object Types...').start();

    let objectTypes: Record<string, ObjectTypeDefinition[]>;
    try {
      objectTypes = await loadObjectTypes(root);
      spinner.succeed('Loaded local types');
    } catch (err) {
      spinner.fail('Failed to load local types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const publicApiUrl = await resolvePublicApiUrl(root);
    const activeContext = await resolveActiveTenantContext({
      projectRoot: root,
      publicApiUrl,
      interactive: true,
    });
    const keysToDiff = await selectTenantKey(objectTypes, options.tenantKey, activeContext.activeTenant.slug);
    const entries = keysToDiff
      .map((key) => [key, objectTypes[key] as ObjectTypeDefinition[] | undefined] as const);

    if (options.tenantId && !options.tenantKey && Object.keys(objectTypes).length > 1) {
      exitWithError(ErrorCode.E303, { field: '--tenant-key when using --tenant-id with multiple tenant scopes' });
    }

    for (const [tenantKey, localTypes] of entries) {
      if (!localTypes || localTypes.length === 0) {
        out.warn(`No local Object Types found for "${tenantKey}"`);
        continue;
      }

      const resolution = resolveTenantIdForKey(tenantKey, options.tenantId, activeContext.activeTenant.id);
      const tenantId = resolution.tenantId;
      if (!tenantId) {
        explainMissingTenantId(tenantKey);
        continue;
      }

      out.heading(`Tenant: ${tenantKey} → ${chalk.dim(tenantId)} ${chalk.dim(`(${describeTenantResolutionSource(resolution.source)})`)}`);

      const client = new PlatformAPIClient(publicApiUrl, tenantId);
      const remoteSpinner = ora('  Fetching remote types...').start();

      try {
        const res = await client.platformRequest('/object-types', 'GET', undefined, {
          where: { tenant: { equals: tenantId } }, limit: 100,
        });

        const data = await res.json() as { docs?: Array<{ name: string; properties: unknown[]; linkTypes: unknown[]; actions: unknown[] }> };
        const remoteDocs = data?.docs || [];
        remoteSpinner.succeed(`  ${remoteDocs.length} remote types`);

        const remoteByName = new Map(remoteDocs.map(d => [d.name, d]));
        const localByName = new Map(localTypes.map(t => [t.name, t]));

        // Local-only types
        for (const [name, localType] of localByName) {
          if (!remoteByName.has(name)) {
            out.info(`  ${out.symbols.added} ${localType.name} — local only`);
            continue;
          }

          const remote = remoteByName.get(name)!;
          const localPropNames = new Set(localType.properties.map(p => p.name));
          const remotePropNames = new Set((remote.properties as Array<{ name: string }>).map(p => p.name));

          const added = [...localPropNames].filter(p => !remotePropNames.has(p));
          const removed = [...remotePropNames].filter(p => !localPropNames.has(p));
          const unchanged = [...localPropNames].filter(p => remotePropNames.has(p));

          if (added.length === 0 && removed.length === 0) {
            out.info(`  ${out.symbols.unchanged} ${localType.name} — no changes`);
          } else {
            out.info(`  ${out.symbols.changed} ${localType.name}`);
            for (const p of added) {
              out.info(`    ${out.symbols.added} ${p}`);
            }
            for (const p of removed) {
              out.info(`    ${out.symbols.removed} ${p}`);
            }
            if (unchanged.length > 0) {
              out.dim(`    ${unchanged.length} unchanged`);
            }
          }
        }

        // Remote-only types
        for (const [name] of remoteByName) {
          if (!localByName.has(name)) {
            out.warn(`  ${out.symbols.warning} ${name} — exists remotely but not locally`);
          }
        }
      } catch (err) {
        remoteSpinner.fail('  Failed to fetch remote types');
        out.error(err instanceof Error ? err.message : String(err));
      }
    }
  });

// ─── eai types pull ────────────────────────────────────────────────────────

typesCommand
  .command('pull')
  .description('Download remote Object Types to local TypeScript')
  .option('--tenant-id <id>', 'platform tenant ID')
  .option('--output <path>', 'Output file path', 'src/eai.config/object-types.generated.ts')
  .addHelpText('after', `
Examples:
  $ eai types pull
  $ eai types pull --output src/types/generated.ts
  `)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      exitWithError(ErrorCode.E001, undefined, options.format);
    }

    const publicApiUrl = await resolvePublicApiUrl(root);
    const activeContext = await resolveActiveTenantContext({
      projectRoot: root,
      publicApiUrl,
      interactive: true,
      tenantId: options.tenantId,
    });
    const tenantId = options.tenantId || activeContext.activeTenant.id;

    const spinner = ora('Fetching remote Object Types...').start();

    try {
      const client = new PlatformAPIClient(publicApiUrl, tenantId);
      const res = await client.platformRequest('/object-types', 'GET', undefined, {
        where: { tenant: { equals: tenantId } }, limit: 100,
      });

      const data = await res.json() as { docs?: ObjectTypeDefinition[] };
      const types = data?.docs || [];
      spinner.succeed(`Found ${types.length} remote types`);

      // Generate TypeScript
      const ts = generateTypeScript(types, tenantId);
      const { writeFile: write } = await import('node:fs/promises');
      const { join: pathJoin } = await import('node:path');
      const outputPath = pathJoin(root, options.output);
      await write(outputPath, ts, 'utf-8');

      out.success(`Written to ${chalk.bold(options.output)}`);
      out.info('Review the generated file and merge into object-types.ts');
    } catch (err) {
      spinner.fail('Failed to pull types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── eai types define ──────────────────────────────────────────────────────

typesCommand
  .command('define')
  .description('Interactive Object Type builder (coming soon)')
  .action(async () => {
    out.info('Interactive Object Type builder is planned for Phase 3.');
    out.info('For now, edit src/eai.config/object-types.ts directly.');
    out.info('See the Object Types Guide in CLAUDE.md for the schema format.');
  });

// ─── Helpers ───────────────────────────────────────────────────────────────

function generateTypeScript(types: ObjectTypeDefinition[], tenantKey: string): string {
  const lines: string[] = [
    '/**',
    ' * Object Types — auto-generated by `eai types pull`',
    ` * Generated: ${new Date().toISOString()}`,
    ' *',
    ' * Review and merge into object-types.ts.',
    ' */',
    '',
    'import type { ObjectTypeDefinition } from \'./object-types\';',
    '',
    `export const pulledTypes: Record<string, ObjectTypeDefinition[]> = {`,
    `  '${tenantKey}': ${JSON.stringify(types, null, 4).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')},`,
    '};',
    '',
  ];
  return lines.join('\n');
}
