#!/usr/bin/env node

import path from 'path';
import {
  bootstrapWorkspace,
  findWorkspaceRoot,
  normalizeHost,
  scriptRootFromUrl,
} from './workspace-bootstrap-lib.mjs';

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    host: 'auto',
    dryRun: false,
    includeMirrors: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace' && argv[i + 1]) {
      args.workspace = argv[++i];
    } else if (arg === '--host' && argv[i + 1]) {
      args.host = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--include-mirrors') {
      args.includeMirrors = true;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = await findWorkspaceRoot(path.resolve(args.workspace));
  const sourceRoot = scriptRootFromUrl(import.meta.url);

  const result = await bootstrapWorkspace({
    workspaceRoot,
    host: normalizeHost(args.host),
    sourceRoot,
    dryRun: args.dryRun,
    includeMirrors: args.includeMirrors,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.status === 'healthy' ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

