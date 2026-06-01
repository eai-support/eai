#!/usr/bin/env node
/**
 * Anti-drift guard for the published API reference.
 *
 * The API reference (`.tech-docs/api-reference.md`) and its sibling docs are
 * hand-curated, but their route paths must track `src/lib/api.ts`. When the
 * CLI migrated PublicAPI v3 -> v4 the docs silently kept the dead `/v3/*`
 * routes. This script fails CI/release when a doc references an API version or
 * domain prefix that the code no longer uses, so that class of drift cannot
 * ship again.
 *
 * It deliberately does NOT regenerate the prose — it verifies the volatile
 * part (route version + domain) against the source of truth.
 *
 * Modes:
 *   (default)          verify + print a summary; exit 1 on drift
 *   --check            verify quietly; exit 1 on drift (used by CI/release)
 *   --print-endpoints  print the route templates extracted from api.ts; exit 0
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const API_TS = path.join(ROOT, 'src/lib/api.ts');

// Live reference docs whose routes must match code. `changelog.md` is excluded
// on purpose: historical entries may legitimately cite retired endpoints.
const DOC_FILES = [
  '.tech-docs/api-reference.md',
  '.tech-docs/dependencies.md',
  '.tech-docs/data-model.md',
  '.tech-docs/architecture.md',
  '.tech-docs/review/code-quality.md',
  '.tech-docs/review/patterns.md',
];

const ROUTE_TOKEN = /\/v(\d+)\/([a-z0-9-]+)/g;

function readApiSource() {
  if (!fs.existsSync(API_TS)) {
    console.error(`✗ Cannot find ${path.relative(ROOT, API_TS)} — is this the eai CLI repo?`);
    process.exit(2);
  }
  return fs.readFileSync(API_TS, 'utf8');
}

/** Authoritative version + domain prefixes the CLI actually calls. */
function extractCodeContract(apiSrc) {
  const constMap = {}; // PUBLIC_X_PATH -> '/v4/data/resources'
  const versions = new Set();
  const domains = new Set();

  // 1. Route path constants: const PUBLIC_DATA_RESOURCES_PATH = '/v4/data/resources';
  const constRe = /const\s+(PUBLIC_\w+_PATH)\s*=\s*['"`](\/v\d+\/[^'"`]+)['"`]/g;
  let m;
  while ((m = constRe.exec(apiSrc)) !== null) {
    constMap[m[1]] = m[2];
    const seg = m[2].split('/').filter(Boolean); // [v4, data, resources]
    versions.add(`v${seg[0].replace(/^v/, '')}`);
    domains.add(seg[1]);
  }

  // 2. Any inline literal /vN/<domain> routes, so we don't miss non-const ones.
  let lit;
  const litRe = new RegExp(ROUTE_TOKEN.source, 'g');
  while ((lit = litRe.exec(apiSrc)) !== null) {
    versions.add(`v${lit[1]}`);
    domains.add(lit[2]);
  }

  return { constMap, versions, domains };
}

/** Best-effort route templates for the --print-endpoints helper. */
function extractRouteTemplates(apiSrc, constMap) {
  const routes = new Set();
  const tmplRe = /\$\{(PUBLIC_\w+_PATH)\}([^`'"]*)/g;
  let m;
  while ((m = tmplRe.exec(apiSrc)) !== null) {
    const base = constMap[m[1]];
    if (!base) continue;
    const suffix = m[2]
      .replace(/\$\{[^}]*\}/g, '{param}') // ${this.tenantId}, ${encodeURIComponent(id)} -> {param}
      .replace(/\$\{.*$/, '') // drop any dangling ${qs ? ...} ternary fragment
      .replace(/`.*$/, '') // drop anything past a stray nested backtick
      .split('?')[0] // drop query strings
      .replace(/\/+$/, '');
    routes.add(base + suffix);
  }
  // Bare constants used on their own (e.g. `${PUBLIC_WORKFLOWS_PATH}`) already
  // covered above; add the prefixes themselves for completeness.
  Object.values(constMap).forEach((p) => routes.add(p));
  return [...routes].sort();
}

function verify(contract) {
  const findings = [];
  for (const rel of DOC_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      const re = new RegExp(ROUTE_TOKEN.source, 'g');
      let m;
      while ((m = re.exec(line)) !== null) {
        const ver = `v${m[1]}`;
        const domain = m[2];
        if (!contract.versions.has(ver)) {
          findings.push({
            rel,
            line: idx + 1,
            token: m[0],
            reason: `API version ${ver} is not used by src/lib/api.ts (code uses ${[...contract.versions].sort().join(', ')})`,
          });
        } else if (!contract.domains.has(domain)) {
          findings.push({
            rel,
            line: idx + 1,
            token: m[0],
            reason: `"/${ver}/${domain}" is not a known PublicAPI domain (valid: ${[...contract.domains].sort().join(', ')})`,
          });
        }
      }
    });
  }
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const apiSrc = readApiSource();
  const contract = extractCodeContract(apiSrc);

  if (args.includes('--print-endpoints')) {
    console.log('# Route templates derived from src/lib/api.ts\n');
    extractRouteTemplates(apiSrc, contract.constMap).forEach((r) => console.log(r));
    return;
  }

  const findings = verify(contract);
  const quiet = args.includes('--check');

  if (findings.length > 0) {
    console.error('✗ API reference route drift detected:\n');
    for (const f of findings) {
      console.error(`  ${f.rel}:${f.line}  ${f.token}\n      ${f.reason}`);
    }
    console.error(`\n${findings.length} stale route reference(s). Update the docs to match src/lib/api.ts.`);
    console.error('Run `node scripts/verify-api-reference.cjs --print-endpoints` to see the current routes.');
    process.exit(1);
  }

  if (!quiet) {
    console.log('✓ API reference routes align with src/lib/api.ts');
    console.log(`  versions: ${[...contract.versions].sort().join(', ')}`);
    console.log(`  domains:  ${[...contract.domains].sort().join(', ')}`);
    console.log(`  checked:  ${DOC_FILES.length} docs`);
  }
}

main();
