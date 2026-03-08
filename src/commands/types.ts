/**
 * eai types — manage Object Type definitions.
 *
 * seed:     Push local Object Types to Configurator via PublicAPI
 * validate: Check types against platform schema rules
 * diff:     Compare local definitions with remote Configurator state
 * pull:     Download remote Object Types to local TypeScript
 * define:   Interactive Object Type builder (future)
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { findProjectRoot, loadObjectTypes, loadEnvFile, type ObjectTypeDefinition } from '../lib/config.js';
import { PlatformAPIClient } from '../lib/api.js';
import * as out from '../lib/output.js';

export const typesCommand = new Command('types')
  .description('Manage Object Type definitions');

// ─── eai types seed ────────────────────────────────────────────────────────

typesCommand
  .command('seed')
  .description('Push Object Types to Configurator')
  .option('--env <environment>', 'Target environment', 'dev')
  .option('--tenant-key <key>', 'Specific tenant key from object-types.ts')
  .option('--dry-run', 'Show what would be seeded without making changes', false)
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project.');
      process.exit(1);
    }

    const spinner = ora('Loading Object Types...').start();

    let objectTypes: Record<string, ObjectTypeDefinition[]>;
    try {
      objectTypes = await loadObjectTypes(root);
      const totalTypes = Object.values(objectTypes).reduce((sum, types) => sum + types.length, 0);
      const tenantKeys = Object.keys(objectTypes);
      spinner.succeed(`Found ${totalTypes} types across ${tenantKeys.length} tenant scope(s): ${tenantKeys.join(', ')}`);
    } catch (err) {
      spinner.fail('Failed to load Object Types');
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // Resolve tenant IDs from env vars
    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;

    if (!publicApiUrl) {
      out.error('BASE_URL_PUBLIC_API not set. Run `eai env pull` or set it in .env.local');
      process.exit(1);
    }

    // Filter to specific tenant key if requested
    const keysToSeed = options.tenantKey
      ? [options.tenantKey]
      : Object.keys(objectTypes);

    out.blank();

    for (const tenantKey of keysToSeed) {
      const types = objectTypes[tenantKey];
      if (!types || types.length === 0) {
        out.warn(`No types for tenant key "${tenantKey}"`);
        continue;
      }

      // Resolve tenant ID
      const normalizedKey = tenantKey.replace(/-/g, '_').toUpperCase();
      const tenantId = env[`TENANT_${normalizedKey}_ID`] ||
                       env[`TENANT_${tenantKey.toUpperCase()}_ID`] ||
                       env.TENANT_DEFAULT_ID;

      if (!tenantId) {
        out.error(`No tenant ID found for "${tenantKey}". Set TENANT_${normalizedKey}_ID in .env.local`);
        continue;
      }

      out.heading(`Tenant: ${tenantKey} → ${chalk.dim(tenantId)}`);

      if (options.dryRun) {
        for (const type of types) {
          console.log(`  ${chalk.cyan(type.name)} — ${type.properties.length} props, ${type.linkTypes.length} links, ${type.actions.length} actions`);
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
          const checkRes = await client.orchestrate({
            target_backend: 'payload',
            endpoint: '/object-types',
            method: 'GET',
            params: {
              where: { name: { equals: type.name }, tenant: { equals: tenantId } },
            },
          });

          const checkData = await checkRes.json() as { docs?: Array<{ id: string }> };
          const existing = checkData?.docs?.[0];

          if (existing) {
            // Update
            const updateRes = await client.orchestrate({
              target_backend: 'payload',
              endpoint: `/object-types/${existing.id}`,
              method: 'PATCH',
              body: {
                displayName: type.displayName,
                description: type.description,
                properties: type.properties,
                linkTypes: type.linkTypes,
                actions: type.actions,
                storageBackend: type.storageBackend,
                status: type.status,
              },
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
            const createRes = await client.orchestrate({
              target_backend: 'payload',
              endpoint: '/object-types',
              method: 'POST',
              body: {
                name: type.name,
                displayName: type.displayName,
                description: type.description,
                properties: type.properties,
                linkTypes: type.linkTypes,
                actions: type.actions,
                storageBackend: type.storageBackend,
                status: type.status,
                tenant: tenantId,
              },
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
      out.info(`Result: ${chalk.green(`${created} created`)}, ${chalk.cyan(`${updated} updated`)}, ${chalk.red(`${failed} failed`)}`);
    }
  });

// ─── eai types validate ────────────────────────────────────────────────────

typesCommand
  .command('validate')
  .description('Validate Object Types against platform schema rules')
  .action(async () => {
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project.');
      process.exit(1);
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
          if (!['tenant-user', 'tenant-staff', 'tenant-admin'].includes(action.requiredRole)) {
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
              console.log(`    ${chalk.red('error')}: ${issue}`);
            }
            errors += issues.length;
          }
          if (warns.length > 0) {
            if (issues.length === 0) out.warn(`${type.name}`);
            for (const w of warns) {
              console.log(`    ${chalk.yellow('warn')}: ${w}`);
            }
            warnings += warns.length;
          }
        }
      }
    }

    out.blank();
    if (errors > 0) {
      out.error(`${errors} error(s), ${warnings} warning(s)`);
      process.exit(1);
    } else if (warnings > 0) {
      out.warn(`${warnings} warning(s), 0 errors`);
    } else {
      out.success('All Object Types are valid');
    }
  });

// ─── eai types diff ────────────────────────────────────────────────────────

typesCommand
  .command('diff')
  .description('Compare local Object Types with remote Configurator')
  .action(async () => {
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project.');
      process.exit(1);
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

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;

    if (!publicApiUrl) {
      out.error('BASE_URL_PUBLIC_API not set.');
      process.exit(1);
    }

    for (const [tenantKey, localTypes] of Object.entries(objectTypes)) {
      const normalizedKey = tenantKey.replace(/-/g, '_').toUpperCase();
      const tenantId = env[`TENANT_${normalizedKey}_ID`] || env.TENANT_DEFAULT_ID;

      if (!tenantId) {
        out.warn(`No tenant ID for "${tenantKey}" — skipping`);
        continue;
      }

      out.heading(`Tenant: ${tenantKey}`);

      const client = new PlatformAPIClient(publicApiUrl, tenantId);
      const remoteSpinner = ora('  Fetching remote types...').start();

      try {
        const res = await client.orchestrate({
          target_backend: 'payload',
          endpoint: '/object-types',
          method: 'GET',
          params: { where: { tenant: { equals: tenantId } }, limit: 100 },
        });

        const data = await res.json() as { docs?: Array<{ name: string; properties: unknown[]; linkTypes: unknown[]; actions: unknown[] }> };
        const remoteDocs = data?.docs || [];
        remoteSpinner.succeed(`  ${remoteDocs.length} remote types`);

        const remoteByName = new Map(remoteDocs.map(d => [d.name, d]));
        const localByName = new Map(localTypes.map(t => [t.name, t]));

        // Local-only types
        for (const [name, localType] of localByName) {
          if (!remoteByName.has(name)) {
            console.log(`  ${out.symbols.added} ${chalk.green(name)} — ${chalk.green('LOCAL ONLY')}`);
            continue;
          }

          const remote = remoteByName.get(name)!;
          const localPropNames = new Set(localType.properties.map(p => p.name));
          const remotePropNames = new Set((remote.properties as Array<{ name: string }>).map(p => p.name));

          const added = [...localPropNames].filter(p => !remotePropNames.has(p));
          const removed = [...remotePropNames].filter(p => !localPropNames.has(p));
          const unchanged = [...localPropNames].filter(p => remotePropNames.has(p));

          if (added.length === 0 && removed.length === 0) {
            console.log(`  ${out.symbols.unchanged} ${name} — no differences`);
          } else {
            console.log(`  ${out.symbols.changed} ${chalk.yellow(name)}`);
            for (const p of added) {
              console.log(`    ${out.symbols.added} property: ${chalk.green(p)} (local only)`);
            }
            for (const p of removed) {
              console.log(`    ${out.symbols.removed} property: ${chalk.red(p)} (remote only)`);
            }
            if (unchanged.length > 0) {
              console.log(`    ${out.symbols.unchanged} ${unchanged.length} properties unchanged`);
            }
          }
        }

        // Remote-only types
        for (const [name] of remoteByName) {
          if (!localByName.has(name)) {
            console.log(`  ${out.symbols.removed} ${chalk.red(name)} — ${chalk.red('REMOTE ONLY (not in local definition)')}`);
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
  .option('--tenant-id <id>', 'Configurator tenant ID')
  .option('--output <path>', 'Output file path', 'src/eai.config/object-types.generated.ts')
  .action(async (options) => {
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project.');
      process.exit(1);
    }

    const envVars = await loadEnvFile(root);
    const env = { ...envVars, ...process.env };
    const publicApiUrl = env.BASE_URL_PUBLIC_API;
    const tenantId = options.tenantId || env.TENANT_DEFAULT_ID;

    if (!publicApiUrl || !tenantId) {
      out.error('BASE_URL_PUBLIC_API and tenant ID required.');
      process.exit(1);
    }

    const spinner = ora('Fetching remote Object Types...').start();

    try {
      const client = new PlatformAPIClient(publicApiUrl, tenantId);
      const res = await client.orchestrate({
        target_backend: 'payload',
        endpoint: '/object-types',
        method: 'GET',
        params: { where: { tenant: { equals: tenantId } }, limit: 100 },
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
