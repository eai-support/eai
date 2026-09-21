#!/usr/bin/env node

import path from 'path';
import {
  checkWorkspaceState,
  findWorkspaceRoot,
  formatWorkspaceCheckReport,
  normalizeHost,
  scriptRootFromUrl,
} from './workspace-bootstrap-lib.mjs';

function parseArgs(argv) {
  const args = {
    workspace: process.cwd(),
    host: 'auto',
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace' && argv[i + 1]) {
      args.workspace = argv[++i];
    } else if (arg === '--host' && argv[i + 1]) {
      args.host = argv[++i];
    } else if (arg === '--json') {
      args.json = true;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = await findWorkspaceRoot(path.resolve(args.workspace));
  const sourceRoot = scriptRootFromUrl(import.meta.url);
  const report = await checkWorkspaceState({
    workspaceRoot,
    host: normalizeHost(args.host),
    sourceRoot,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatWorkspaceCheckReport(report)}\n`);
  }

  process.exit(report.status === 'healthy' ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

