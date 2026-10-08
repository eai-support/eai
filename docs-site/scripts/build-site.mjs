import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultSite = fileURLToPath(new URL('..', import.meta.url));
const canonicalRelative = 'registry/@enterpriseai/cli';
const aliases = [
  'registry/%40enterpriseai%2Fcli',
  'registry/@enterpriseai%2fcli',
  'registry/@enterpriseai%2Fcli',
];

export function buildSite(site = defaultSite, runCompiler = (directory, staticDirectory) =>
  spawnSync(process.execPath, [path.join(directory, 'node_modules/@docusaurus/core/bin/docusaurus.mjs'), 'build'], {
    cwd: directory,
    env: { ...process.env, EAI_DOCS_BUILD_STATIC_DIR: staticDirectory },
    stdio: 'inherit',
  })) {
  const staticSource = path.join(site, 'static');
  const canonical = readFileSync(path.join(staticSource, canonicalRelative));
  for (const alias of aliases) {
    if (!readFileSync(path.join(staticSource, alias)).equals(canonical)) {
      throw new Error(`Static registry alias differs from the canonical packument: ${alias}`);
    }
  }

  const temporary = mkdtempSync(path.join(tmpdir(), 'eai-docs-static-'));
  const preparedStatic = path.join(temporary, 'static');
  try {
    cpSync(staticSource, preparedStatic, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(staticSource, source).replaceAll(path.sep, '/');
        return !/^registry\/@enterpriseai%2fcli$/i.test(relative);
      },
    });
    mkdirSync(path.join(preparedStatic, 'registry'), { recursive: true });
    writeFileSync(path.join(preparedStatic, aliases[1]), canonical);

    const result = runCompiler(site, preparedStatic);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Docusaurus build failed with status ${result.status ?? 'unknown'}`);

    const builtRegistry = path.join(site, 'build/registry');
    for (const relative of [canonicalRelative, aliases[0], aliases[1]]) {
      if (!readFileSync(path.join(site, 'build', relative)).equals(canonical)) {
        throw new Error(`Built registry packument differs from canonical bytes: ${relative}`);
      }
    }
    writeFileSync(path.join(builtRegistry, path.basename(aliases[2])), canonical);
    if (!readFileSync(path.join(builtRegistry, path.basename(aliases[2]))).equals(canonical)) {
      throw new Error('Built uppercase registry alias differs from canonical bytes');
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 2) throw new Error('Docs build does not accept alternate output arguments');
  buildSite();
}
