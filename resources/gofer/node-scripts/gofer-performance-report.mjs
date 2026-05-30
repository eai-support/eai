#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_TOKEN_DIVISOR = 4;

const FILE_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.txt',
  '.mjs',
  '.js',
  '.ts',
  '.tsx',
  '.sh',
]);

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-repro',
  'coverage',
  'test-results',
  '.cache',
  '.pytest_cache',
  '.qagent',
  '.qagent-workspace',
]);

const BUCKETS = [
  {
    name: 'active-specs',
    label: 'Active specs',
    roots: ['.specify/specs'],
    include: (relativePath) => !relativePath.split('/').some((segment) => segment.startsWith('_')),
  },
  {
    name: 'archived-specs',
    label: 'Archived specs',
    roots: ['.specify/specs'],
    include: (relativePath) => relativePath.split('/').some((segment) => segment.startsWith('_')),
  },
  {
    name: 'memory',
    label: 'Memory',
    roots: ['.specify/memory'],
  },
  {
    name: 'system-files',
    label: 'System files',
    files: ['AGENTS.md', 'CLAUDE.md', 'README.md', '.specify/.gofer-version'],
  },
  {
    name: 'generated-surfaces',
    label: 'Generated command surfaces',
    roots: [
      '.claude/commands',
      '.agents/skills',
      '.system/skills',
      '.github/prompts',
      '.gemini',
      '.claude-plugin',
      '.codex-plugin',
      'extension/resources',
    ],
  },
  {
    name: 'hooks',
    label: 'Hook scripts',
    roots: ['.specify/scripts/hooks'],
  },
  {
    name: 'workflow-source',
    label: 'Generic workflow source',
    roots: ['src', 'extension/src/services', 'language-server/src'],
  },
];

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    json: false,
    tokenDivisor: DEFAULT_TOKEN_DIVISOR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      args.root = path.resolve(argv[index + 1] ?? '');
      index += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--token-divisor') {
      args.tokenDivisor = Number(argv[index + 1] ?? DEFAULT_TOKEN_DIVISOR);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function shouldReadFile(filePath) {
  return FILE_EXTENSIONS.has(path.extname(filePath));
}

function toPortablePath(value) {
  return value.split(path.sep).join('/');
}

function estimateTokens(chars, tokenDivisor) {
  return Math.ceil(chars / tokenDivisor);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root, relativeRoot = '') {
  const files = [];
  const absoluteRoot = path.join(root, relativeRoot);
  if (!(await pathExists(absoluteRoot))) {
    return files;
  }

  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const child = path.join(current, entry.name);
      const relativePath = toPortablePath(path.relative(root, child));
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(child);
        }
      } else if (entry.isFile() && shouldReadFile(child)) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

async function summarizeFiles(root, files, tokenDivisor) {
  let chars = 0;
  for (const relativePath of files) {
    try {
      const stat = await fs.stat(path.join(root, relativePath));
      chars += stat.size;
    } catch {
      // Ignore files removed during scan.
    }
  }
  return {
    filesScanned: files.length,
    chars,
    estimatedTokens: estimateTokens(chars, tokenDivisor),
  };
}

async function measureOperation(name, fn, operations) {
  const start = performance.now();
  const result = await fn();
  const durationMs = Math.round((performance.now() - start) * 100) / 100;
  operations.push({ name, durationMs });
  return { result, durationMs };
}

async function collectBucket(root, bucket, tokenDivisor, operations) {
  const { result: files, durationMs } = await measureOperation(
    `discover:${bucket.name}`,
    async () => {
      const found = [];
      for (const relativeRoot of bucket.roots ?? []) {
        found.push(...(await walkFiles(root, relativeRoot)));
      }
      for (const relativeFile of bucket.files ?? []) {
        if (await pathExists(path.join(root, relativeFile))) {
          found.push(relativeFile);
        }
      }
      const uniqueFiles = [...new Set(found)];
      return bucket.include ? uniqueFiles.filter((file) => bucket.include(file)) : uniqueFiles;
    },
    operations
  );

  const { result: summary } = await measureOperation(
    `estimate:${bucket.name}`,
    () => summarizeFiles(root, files, tokenDivisor),
    operations
  );

  return {
    name: bucket.name,
    label: bucket.label,
    ...summary,
    discoverMs: durationMs,
  };
}

async function generatePerformanceReport(options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const tokenDivisor = options.tokenDivisor ?? DEFAULT_TOKEN_DIVISOR;
  const startedAt = performance.now();
  const operations = [];
  const buckets = [];

  for (const bucket of BUCKETS) {
    buckets.push(await collectBucket(root, bucket, tokenDivisor, operations));
  }

  const totals = buckets.reduce(
    (acc, bucket) => ({
      filesScanned: acc.filesScanned + bucket.filesScanned,
      chars: acc.chars + bucket.chars,
      estimatedTokens: acc.estimatedTokens + bucket.estimatedTokens,
    }),
    { filesScanned: 0, chars: 0, estimatedTokens: 0 }
  );

  const wallClockMs = Math.round((performance.now() - startedAt) * 100) / 100;
  return {
    generatedAt: new Date().toISOString(),
    rootLabel: '${workspaceFolder}',
    wallClockMs,
    totals,
    buckets,
    topSlowOperations: operations
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 10),
  };
}

function formatMarkdown(report) {
  const lines = [
    '# Gofer Performance Baseline',
    '',
    `Generated: ${report.generatedAt}`,
    `Workspace: ${report.rootLabel}`,
    `Wall-clock: ${report.wallClockMs} ms`,
    `Files scanned: ${report.totals.filesScanned}`,
    `Estimated tokens: ${report.totals.estimatedTokens}`,
    '',
    '| Bucket | Files | Chars | Estimated Tokens | Discovery ms |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];

  for (const bucket of report.buckets) {
    lines.push(
      `| ${bucket.label} | ${bucket.filesScanned} | ${bucket.chars} | ${bucket.estimatedTokens} | ${bucket.discoverMs} |`
    );
  }

  lines.push('', '## Top Slow Operations', '', '| Operation | ms |', '| --- | ---: |');
  for (const operation of report.topSlowOperations) {
    lines.push(`| ${operation.name} | ${operation.durationMs} |`);
  }

  return lines.join('\n');
}

if (__filename === path.resolve(process.argv[1] ?? '')) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node .specify/scripts/node/gofer-performance-report.mjs [--root <path>] [--json]

Produces a repeatable Gofer performance baseline with wall-clock timing,
files scanned, token estimates, and top slow operations.`);
    process.exit(0);
  }

  const report = await generatePerformanceReport(args);
  console.log(args.json ? JSON.stringify(report, null, 2) : formatMarkdown(report));
}

export {
  BUCKETS,
  collectBucket,
  estimateTokens,
  formatMarkdown,
  generatePerformanceReport,
  parseArgs,
  walkFiles,
};
