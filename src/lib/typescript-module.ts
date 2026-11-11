import { readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, extname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

const nativeImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<Record<string, unknown>>;

async function importNativeModule(specifier: string): Promise<Record<string, unknown>> {
  try { return await nativeImport(specifier); }
  catch (error) {
    if (!(error instanceof TypeError) || (error as NodeJS.ErrnoException).code !== 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING') throw error;
    // VM hosts may omit Function's import callback. Keep their transforms out of user modules.
    const { compileFunction, constants } = await import('node:vm');
    const importer = compileFunction('return import(specifier)', ['specifier'], {
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    }) as typeof nativeImport;
    return importer(specifier);
  }
}

function diagnosticText(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const source = diagnostic.file.text.split(/\r?\n/)[line] ?? '';
  return `${diagnostic.file.fileName}:${line + 1}:${character + 1}: ${message}\n${source}\n${' '.repeat(character)}^`;
}

/** Evaluate a fresh local module graph with compiler erasure and source-relative imports. */
export async function importTypeScriptModule(filename: string, projectRoot: string): Promise<Record<string, unknown>> {
  const generation = randomUUID();
  // Node resolves symlinks before invoking load hooks (including /var on macOS).
  // Use that same filesystem identity for configuration lookup and containment.
  const canonicalRoot = realpathSync(projectRoot);
  const canonicalFilename = realpathSync(filename);
  const configPath = ts.findConfigFile(dirname(canonicalFilename), ts.sys.fileExists);
  let compilerOptions: ts.CompilerOptions = {};
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(diagnosticText(config.error));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
    // Missing framework plugins/types do not prevent transpiling a configuration module.
    compilerOptions = parsed.options;
  }
  const ownedPath = (url: string): string | undefined => {
    if (!url.startsWith('file:')) return undefined;
    const path = fileURLToPath(url);
    let canonicalPath: string;
    try { canonicalPath = realpathSync(path); }
    catch { return undefined; }
    const fromRoot = relative(canonicalRoot, canonicalPath);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined;
    if (path.split(sep).includes('node_modules') || canonicalPath.split(sep).includes('node_modules')) return undefined;
    return canonicalPath;
  };
  const generationUrl = (url: string): string => {
    const value = new URL(url);
    value.searchParams.set('eaiObjectTypes', generation);
    return value.href;
  };
  const sourceMapsEnabled = process.sourceMapsEnabled;
  process.setSourceMapsEnabled(true);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const sourceGraph = context.parentURL?.includes(`eaiObjectTypes=${generation}`);
      if (!sourceGraph) return nextResolve(specifier, context);
      let resolved;
      try {
        resolved = nextResolve(specifier, context);
      } catch (error) {
        const match = ts.resolveModuleName(specifier, fileURLToPath(context.parentURL!), compilerOptions, ts.sys).resolvedModule;
        if (!match || match.resolvedFileName.endsWith('.d.ts')) throw error;
        resolved = { url: pathToFileURL(match.resolvedFileName).href, shortCircuit: true };
      }
      return ownedPath(resolved.url) ? { ...resolved, url: generationUrl(resolved.url) } : resolved;
    },
    load(url, context, nextLoad) {
      if (!url.includes(`eaiObjectTypes=${generation}`)) return nextLoad(url, context);
      const path = ownedPath(url);
      if (!path || !/\.[cm]?tsx?$/.test(extname(path))) return nextLoad(url, context);
      const source = readFileSync(path, 'utf8');
      const result = ts.transpileModule(source, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: {
          ...compilerOptions,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          target: ts.ScriptTarget.ES2022,
          declaration: false,
          declarationMap: false,
          sourceMap: false,
          inlineSourceMap: true,
          inlineSources: true,
          noEmit: false,
        },
      });
      const errors = result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? [];
      if (errors.length) throw new Error(errors.map(diagnosticText).join('\n'));
      return { format: 'module', source: result.outputText, shortCircuit: true };
    },
  });
  try {
    return await importNativeModule(generationUrl(pathToFileURL(canonicalFilename).href));
  } catch (error) {
    const rawDetail = error instanceof Error ? error.stack ?? error.message : String(error);
    const detail = rawDetail.replace(new RegExp(`[?&]eaiObjectTypes=${generation}`, 'g'), '');
    const frame = detail.match(/(?:file:\/\/\/|\/)[^()\n]*?\.[cm]?tsx?(?:\?[^:\n]*)?:(\d+):(\d+)/);
    let snippet = '';
    if (frame) {
      const location = frame[0].replace(/:\d+:\d+$/, '');
      const sourceUrl = location.startsWith('file:') ? location : pathToFileURL(location).href;
      const sourcePath = ownedPath(sourceUrl);
      if (sourcePath) {
        try {
          const line = readFileSync(sourcePath, 'utf8').split(/\r?\n/)[Number(frame[1]) - 1];
          if (line !== undefined) snippet = `\n${line.slice(0, 1000)}\n${' '.repeat(Math.min(Number(frame[2]) - 1, 200))}^`;
        } catch { /* Retain the original failure when the source is no longer readable. */ }
      }
    }
    throw new Error(`Failed to load Object Types from ${filename}\n${detail}${snippet}`, { cause: error });
  } finally {
    hooks.deregister();
    process.setSourceMapsEnabled(sourceMapsEnabled);
  }
}
