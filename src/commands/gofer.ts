import { Command } from 'commander';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import * as out from '../lib/output.js';
import { applyGoferRefresh, planGoferRefresh } from '../lib/gofer-refresh.js';
import { resolveProjectManifest } from '../lib/project-manifest.js';

function describeAction(action: string): string {
  switch (action) {
    case 'add':
      return `${out.symbols.added} add`;
    case 'update':
      return `${out.symbols.updated} update`;
    case 'adopt-update':
      return `${out.symbols.changed} adopt`;
    case 'delete':
      return `${out.symbols.removed} delete`;
    case 'conflict':
      return `${out.symbols.warning} conflict`;
    case 'conflict-delete':
      return `${out.symbols.warning} conflict-delete`;
    default:
      return `${out.symbols.unchanged} unchanged`;
  }
}

export const goferCommand = new Command('gofer')
  .description('Inspect and refresh Gofer-managed project assets');

goferCommand
  .command('refresh')
  .description('Refresh Gofer-managed assets in the current project without blindly overwriting local work')
  .option('--check', 'Show the refresh plan without writing files', false)
  .option('--force', 'Overwrite conflicting managed files after backing them up', false)
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options: { check?: boolean; force?: boolean; format?: string }) => {
    const root = await findProjectRoot();
    if (!root) {
      out.error('Not in an EAI project. Run `eai init` or cd into an existing project.');
      process.exit(1);
    }

    const resolvedManifest = await resolveProjectManifest(root);
    const plan = await planGoferRefresh(root, resolvedManifest.manifest, { workflowProfile: 'enterpriseai' });
    const actionableItems = plan.items.filter((item) => item.action !== 'unchanged');

    if (options.format === 'json') {
      if (options.check) {
        out.json({
          mode: 'check',
          projectRoot: root,
          firstRefresh: plan.firstRefresh,
          bundle: plan.bundle,
          summary: plan.summary,
          items: actionableItems,
        });
        return;
      }

      const result = await applyGoferRefresh(plan, { force: options.force });
      out.json({
        mode: 'apply',
        projectRoot: root,
        firstRefresh: plan.firstRefresh,
        bundle: plan.bundle,
        summary: result.summary,
        backupDirectory: result.backupDirectory,
      });
      return;
    }

    out.heading('Gofer Refresh');
    out.blank();
    out.success(`Project root: ${chalk.dim(root)}`);

    if (plan.bundle.describe || plan.bundle.commit) {
      const sourceLabel = plan.bundle.source === 'latest' ? 'latest' : 'bundled';
      out.success(`Gofer assets: ${plan.bundle.describe || plan.bundle.commit} ${chalk.dim(`(${sourceLabel})`)}`);
    }

    if (plan.bundle.warning) {
      out.warn(plan.bundle.warning);
    }

    if (resolvedManifest.source === 'inferred-init-commit') {
      out.info('Using template provenance inferred from the original `eai init` scaffold commit because this project does not yet record template provenance in `.eai-manifest.json`.');
    } else if (resolvedManifest.source === 'inferred-project-structure') {
      out.info('Using template provenance inferred from this legacy EAI scaffold because this project does not yet record template provenance in `.eai-manifest.json`.');
    }

    if (plan.firstRefresh) {
      out.info('This project has no prior Gofer refresh manifest yet. The first refresh adopts the current repo state and backs up replaced managed files.');
    }

    if (actionableItems.length === 0 && !plan.firstRefresh) {
      out.success('Gofer-managed assets are already up to date.');
      return;
    }

    if (actionableItems.length > 0) {
      out.blank();
      for (const item of actionableItems) {
        console.log(`  ${describeAction(item.action)}  ${item.relativePath}`);
      }

      out.blank();
      out.table([
        ['Add', String(plan.summary.added)],
        ['Update', String(plan.summary.updated)],
        ['Delete', String(plan.summary.deleted)],
        ['Conflict', String(plan.summary.conflicted)],
        ['Unchanged', String(plan.summary.unchanged)],
      ]);
    }

    if (options.check) {
      out.blank();
      if (plan.firstRefresh && actionableItems.length === 0) {
        out.info('Run `eai gofer refresh` once to record the current Gofer-managed snapshot in `.eai-manifest.json` without rewriting matching files.');
      } else {
        out.info('Run `eai gofer refresh` to apply the safe changes, or `eai gofer refresh --force` to overwrite conflicting managed files after backup.');
      }
      return;
    }

    const result = await applyGoferRefresh(plan, { force: options.force });
    out.blank();
    if (plan.firstRefresh && actionableItems.length === 0) {
      out.success('Gofer-managed assets already matched the bundled snapshot. Recorded the current state in `.eai-manifest.json`.');
    } else {
      out.success('Gofer-managed assets refreshed.');
    }
    out.table([
      ['Added', String(result.summary.added)],
      ['Updated', String(result.summary.updated)],
      ['Deleted', String(result.summary.deleted)],
      ['Conflicted', String(result.summary.conflicted)],
      ['Backed up', String(result.summary.backedUp)],
    ]);

    if (result.backupDirectory) {
      out.info(`Backup directory: ${result.backupDirectory}`);
    }

    if (result.summary.conflicted > 0 && !options.force) {
      out.warn('Some managed files were left untouched because they have local edits. Re-run with `--force` only if you want the backed-up replacements.');
    }
  });
