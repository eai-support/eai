#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_APP_PREVIEW_PORT = 3001;
export const DEFAULT_PREVIEW_PORTS = [DEFAULT_APP_PREVIEW_PORT, 3000, 5173, 4173, 6006, 8080, 8000];
export const PREVIEW_SCRIPT_PRIORITY = ['dev', 'start', 'preview', 'serve', 'storybook', 'docs:dev'];
export const BUSINESS_SCENARIO_SCRIPT_PRIORITY = [
  'test:business-scenarios',
  'test:e2e',
  'test:playwright',
  'e2e',
  'playwright',
];
export const BUSINESS_SCENARIO_MANIFEST = 'business-scenarios.json';
export const UI_REVIEW_LOG_COLUMNS = [
  'Time',
  'Change Trigger',
  'Command',
  'URL',
  'Browser Target',
  'Screenshot',
  'Package Lane',
  'Coupling Status',
  'Storybook Story IDs',
  'Theme Override Points',
  'Self-Review',
  'Stakeholder Feedback',
  'User Feedback Applied',
  'Open Issues',
];

const __filename = fileURLToPath(import.meta.url);

export function detectPackageManagerFromNames(fileNames) {
  const names = new Set(fileNames);
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun';
  if (names.has('yarn.lock')) return 'yarn';
  if (names.has('package-lock.json') || names.has('npm-shrinkwrap.json')) return 'npm';
  return 'npm';
}

export async function detectPackageManager(workspaceRoot) {
  const entries = await fs.readdir(workspaceRoot).catch(() => []);
  return detectPackageManagerFromNames(entries);
}

export function selectPreviewScript(scripts = {}) {
  for (const scriptName of PREVIEW_SCRIPT_PRIORITY) {
    if (typeof scripts[scriptName] === 'string' && scripts[scriptName].trim()) {
      return scriptName;
    }
  }
  return null;
}

export function selectBusinessScenarioScript(scripts = {}) {
  for (const scriptName of BUSINESS_SCENARIO_SCRIPT_PRIORITY) {
    if (typeof scripts[scriptName] === 'string' && scripts[scriptName].trim()) {
      return scriptName;
    }
  }
  return null;
}

export function buildPackageScriptCommand(packageManager, scriptName) {
  if (!scriptName) return null;
  if (packageManager === 'pnpm') return `pnpm run ${scriptName}`;
  if (packageManager === 'yarn') return `yarn ${scriptName}`;
  if (packageManager === 'bun') return `bun run ${scriptName}`;
  return `npm run ${scriptName}`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function discoverRepoRunnerCommand(
  workspaceRoot,
  port = DEFAULT_APP_PREVIEW_PORT,
  platform = process.platform
) {
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error(`Preview port is invalid: ${port}`);
  }

  if (platform === 'win32') {
    if (await fileExists(path.join(workspaceRoot, 'run.bat'))) {
      return {
        command: `run.bat dev ${normalizedPort}`,
        source: 'repo-runner',
        packageManager: null,
        scriptName: null,
      };
    }
    if (await fileExists(path.join(workspaceRoot, 'run.ps1'))) {
      return {
        command: `powershell -NoProfile -ExecutionPolicy Bypass -File .\\run.ps1 dev ${normalizedPort}`,
        source: 'repo-runner',
        packageManager: null,
        scriptName: null,
      };
    }
  }

  if (await fileExists(path.join(workspaceRoot, 'run.sh'))) {
    return {
      command: `./run.sh dev ${normalizedPort}`,
      source: 'repo-runner',
      packageManager: null,
      scriptName: null,
    };
  }

  return {
    command: null,
    source: 'missing-repo-runner',
    packageManager: null,
    scriptName: null,
  };
}

export async function discoverPreviewCommand(workspaceRoot, explicitCommand = null) {
  if (explicitCommand?.trim()) {
    return {
      command: explicitCommand.trim(),
      source: 'explicit',
      packageManager: null,
      scriptName: null,
    };
  }

  const repoRunner = await discoverRepoRunnerCommand(workspaceRoot);
  if (repoRunner.command) {
    return repoRunner;
  }

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        command: null,
        source: 'missing-package-json',
        packageManager: null,
        scriptName: null,
      };
    }
    throw new Error(`Unable to read ${packageJsonPath}: ${error.message}`);
  }

  const scriptName = selectPreviewScript(packageJson.scripts);
  const packageManager = await detectPackageManager(workspaceRoot);
  return {
    command: buildPackageScriptCommand(packageManager, scriptName),
    source: scriptName ? 'package-json' : 'missing-preview-script',
    packageManager,
    scriptName,
  };
}

export function isBrowserScenarioCommand(command = '') {
  return /\b(playwright|cypress|puppeteer|webdriver|browser)\b/i.test(command);
}

export function validateBusinessScenarioManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be a JSON object.'], scenarioCount: 0 };
  }
  if (manifest.schemaVersion !== '1.0') {
    errors.push('schemaVersion must be "1.0".');
  }
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length === 0) {
    errors.push('scenarios must contain at least one business journey.');
  }

  const ids = new Set();
  for (const [index, scenario] of (manifest.scenarios ?? []).entries()) {
    const label = `scenarios[${index}]`;
    if (!scenario?.id || typeof scenario.id !== 'string') {
      errors.push(`${label}.id is required.`);
    } else if (ids.has(scenario.id)) {
      errors.push(`${label}.id duplicates "${scenario.id}".`);
    } else {
      ids.add(scenario.id);
    }
    if (!scenario?.userStory || typeof scenario.userStory !== 'string') {
      errors.push(`${label}.userStory is required.`);
    }
    if (!Array.isArray(scenario?.screens) || scenario.screens.length === 0) {
      errors.push(`${label}.screens must name at least one screen.`);
    }
    if (!Array.isArray(scenario?.testFiles) || scenario.testFiles.length === 0) {
      errors.push(`${label}.testFiles must name at least one executable browser test.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    scenarioCount: Array.isArray(manifest.scenarios) ? manifest.scenarios.length : 0,
  };
}

export async function loadBusinessScenarioManifest(workspaceRoot, featureDir) {
  if (!featureDir) {
    return {
      path: null,
      exists: false,
      valid: false,
      errors: ['A feature directory is required for business-scenario validation.'],
      scenarioCount: 0,
      manifest: null,
    };
  }

  const manifestPath = path.join(featureDir, BUSINESS_SCENARIO_MANIFEST);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    return {
      path: manifestPath,
      exists: error?.code !== 'ENOENT',
      valid: false,
      errors: [
        error?.code === 'ENOENT'
          ? `${BUSINESS_SCENARIO_MANIFEST} is missing.`
          : `${BUSINESS_SCENARIO_MANIFEST} is invalid JSON: ${error.message}`,
      ],
      scenarioCount: 0,
      manifest: null,
    };
  }

  const validation = validateBusinessScenarioManifest(manifest);
  const errors = [...validation.errors];
  const rootPrefix = `${path.resolve(workspaceRoot)}${path.sep}`;
  for (const scenario of manifest.scenarios ?? []) {
    for (const testFile of scenario.testFiles ?? []) {
      const resolvedTestFile = path.resolve(workspaceRoot, testFile);
      if (
        resolvedTestFile !== path.resolve(workspaceRoot) &&
        !resolvedTestFile.startsWith(rootPrefix)
      ) {
        errors.push(`${scenario.id} test file escapes the workspace: ${testFile}`);
        continue;
      }
      try {
        await fs.access(resolvedTestFile);
      } catch {
        errors.push(`${scenario.id} test file is missing: ${testFile}`);
      }
    }
  }

  return {
    path: manifestPath,
    exists: true,
    valid: errors.length === 0,
    errors,
    scenarioCount: validation.scenarioCount,
    manifest,
  };
}

export async function discoverBusinessScenarioCommand(
  workspaceRoot,
  explicitCommand = null,
  manifestCommand = null
) {
  const selectedExplicitCommand = explicitCommand?.trim() || manifestCommand?.trim();
  if (selectedExplicitCommand) {
    let browserRunner = isBrowserScenarioCommand(selectedExplicitCommand);
    if (!browserRunner) {
      const scriptMatch = selectedExplicitCommand.match(
        /^(?:npm|pnpm|bun)\s+run\s+([^\s]+)|^yarn\s+([^\s]+)/
      );
      const scriptName = scriptMatch?.[1] ?? scriptMatch?.[2];
      if (scriptName) {
        try {
          const packageJson = JSON.parse(
            await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf8')
          );
          browserRunner = isBrowserScenarioCommand(packageJson.scripts?.[scriptName] ?? '');
        } catch {
          browserRunner = false;
        }
      }
    }
    return {
      command: selectedExplicitCommand,
      source: explicitCommand?.trim() ? 'explicit' : 'manifest',
      packageManager: null,
      scriptName: null,
      browserRunner,
    };
  }

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  } catch (error) {
    return {
      command: null,
      source: error?.code === 'ENOENT' ? 'missing-package-json' : 'invalid-package-json',
      packageManager: null,
      scriptName: null,
      browserRunner: false,
    };
  }

  const scriptName = selectBusinessScenarioScript(packageJson.scripts);
  const packageManager = await detectPackageManager(workspaceRoot);
  const command = buildPackageScriptCommand(packageManager, scriptName);
  return {
    command,
    source: scriptName ? 'package-json' : 'missing-business-scenario-script',
    packageManager,
    scriptName,
    browserRunner: isBrowserScenarioCommand(packageJson.scripts?.[scriptName] ?? ''),
  };
}

export function extractPortsFromCommand(command = '') {
  const ports = new Set();
  const patterns = [
    /\bPORT=(\d{2,5})\b/g,
    /(?:^|\s)--port(?:=|\s+)(\d{2,5})\b/g,
    /(?:^|\s)-p(?:=|\s+)(\d{2,5})\b/g,
    /(?:^|\s)(?:\.\/|\.\\)?run\.(?:sh|bat|ps1)(?:\s+\S+)?\s+(\d{2,5})\b/g,
    /\blocalhost:(\d{2,5})\b/g,
    /\b127\.0\.0\.1:(\d{2,5})\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of command.matchAll(pattern)) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) {
        ports.add(port);
      }
    }
  }

  return [...ports];
}

export function buildCandidateUrls({ explicitUrl = null, command = null, ports = DEFAULT_PREVIEW_PORTS } = {}) {
  if (explicitUrl?.trim()) return [sanitizePreviewUrl(explicitUrl)];

  const commandPorts = extractPortsFromCommand(command ?? '');
  const orderedPorts = [...new Set([...commandPorts, ...ports])];
  return orderedPorts.map((port) => `http://localhost:${port}`);
}

export function buildOpenBrowserCommand(url, platform = process.platform) {
  const safeUrl = sanitizePreviewUrl(url);
  if (platform === 'darwin') return { command: 'open', args: [safeUrl] };
  if (platform === 'win32') return { command: 'explorer.exe', args: [safeUrl] };
  return { command: 'xdg-open', args: [safeUrl] };
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

export function sanitizePreviewUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw new Error(`Preview URL is invalid: ${value}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Preview URL must use http or https: ${parsed.protocol}`);
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(`Preview URL must be a local loopback URL: ${parsed.hostname}`);
  }

  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

function resolveRedirectTarget(baseUrl, location) {
  try {
    return new URL(location, baseUrl).href;
  } catch {
    return null;
  }
}

function isSafePreviewRedirect(baseUrl, location) {
  const target = resolveRedirectTarget(baseUrl, location);
  if (!target) return false;
  try {
    sanitizePreviewUrl(target);
    return true;
  } catch {
    return false;
  }
}

export function markdownCell(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\\|\r\n]/g, (character) => {
      if (character === '\\') return '\\\\';
      if (character === '|') return '\\|';
      return '<br>';
    })
    .trim();
}

export function resolveFeatureLogPaths(workspaceRoot, featureDir = null) {
  const baseDir = featureDir
    ? path.resolve(workspaceRoot, featureDir)
    : path.join(workspaceRoot, '.specify', 'logs', 'ui-preview');
  return {
    baseDir,
    previewDir: featureDir ? path.join(baseDir, 'preview') : baseDir,
    reviewLogPath: featureDir ? path.join(baseDir, 'ui-review-log.md') : null,
    processLogPath: path.join(baseDir, 'preview-server.log'),
    pidPath: path.join(baseDir, 'preview-server.pid'),
    scenarioLogPath: path.join(baseDir, 'business-scenarios.log'),
    scenarioReportPath: path.join(baseDir, 'business-scenario-report.json'),
  };
}

export async function waitForReachableUrl(urls, timeoutMs = 45000, intervalMs = 750) {
  const safeUrls = urls.map((url) => sanitizePreviewUrl(url));
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() <= deadline) {
    for (let index = 0; index < safeUrls.length; index += 1) {
      const url = safeUrls[index];
      let timer = null;
      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), Math.min(intervalMs, 5000));
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (location && !isSafePreviewRedirect(url, location)) {
            lastError = 'Unsafe redirect from local preview URL';
            continue;
          }
        }
        if (response.status < 500) {
          return { ok: true, urlIndex: index, status: response.status };
        }
        lastError = `HTTP ${response.status} from ${url}`;
      } catch (error) {
        lastError = `${url}: ${error.name === 'AbortError' ? 'timeout' : error.message}`;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { ok: false, urlIndex: null, status: null, error: lastError ?? 'No candidate URL responded' };
}

async function startPreviewServer(command, workspaceRoot, logPath, pidPath) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const out = createWriteStream(logPath, { flags: 'a' });
  out.write(`\n\n[${new Date().toISOString()}] Starting Gofer UI preview: ${command}\n`);

  const child = spawn(command, {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      BROWSER: process.env.BROWSER ?? 'none',
    },
    shell: true,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });

  child.unref();
  await fs.writeFile(pidPath, `${child.pid}\n`, 'utf8');
  return { pid: child.pid, logPath, pidPath };
}

async function runBusinessScenarioCommand(command, workspaceRoot, logPath, timeoutMs = 300000) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const out = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  out.write(`\n\n[${new Date().toISOString()}] Running business scenarios: ${command}\n`);

  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CI: process.env.CI ?? '1',
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    let settled = false;
    let timer = null;
    const finish = (report) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      out.end();
      resolve(report);
    };
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        ok: false,
        status: 'failed',
        exitCode: null,
        error: `Business-scenario command exceeded ${timeoutMs}ms.`,
        logPath,
      });
    }, timeoutMs);

    child.once('error', (error) => {
      finish({
        ok: false,
        status: 'failed',
        exitCode: null,
        error: error.message,
        logPath,
      });
    });
    child.once('exit', (code, signal) => {
      finish({
        ok: code === 0,
        status: code === 0 ? 'passed' : 'failed',
        exitCode: code,
        error:
          code === 0
            ? null
            : `Business-scenario command exited with ${
                code === null ? `signal ${signal}` : `code ${code}`
              }.`,
        logPath,
      });
    });
  });
}

async function openBrowser(url, mode) {
  if (mode === 'none') {
    return { attempted: false, ok: true, reason: 'open disabled' };
  }

  const { command, args } = buildOpenBrowserCommand(url);
  try {
    return await new Promise((resolve) => {
      let settled = false;
      const child = spawn(command, args, {
        stdio: 'ignore',
        windowsHide: true,
      });

      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve({
          attempted: true,
          command: [command, ...args].join(' '),
          ...result,
        });
      };

      const timer = setTimeout(() => {
        child.unref();
        finish({ ok: true, reason: 'browser opener still running after launch window' });
      }, 1500);

      child.once('error', (error) => {
        clearTimeout(timer);
        finish({ ok: false, error: error.message });
      });

      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) {
          finish({ ok: true, reason: 'browser opener exited successfully' });
          return;
        }
        finish({
          ok: false,
          error: `browser opener exited with ${code === null ? `signal ${signal}` : `code ${code}`}`,
        });
      });
    });
  } catch (error) {
    return { attempted: true, ok: false, error: error.message };
  }
}

async function captureScreenshot(url, outputPath) {
  const safeUrl = sanitizePreviewUrl(url);
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    return {
      ok: false,
      path: null,
      error: `Playwright is not available: ${error.message}`,
    };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(safeUrl, { waitUntil: 'networkidle', timeout: 30000 });
    sanitizePreviewUrl(page.url());
    await page.screenshot({ path: outputPath, fullPage: true });
    return { ok: true, path: outputPath };
  } catch (error) {
    return { ok: false, path: null, error: error.message };
  } finally {
    await browser?.close().catch(() => {});
  }
}

export function buildReviewLogRow({
  time = new Date().toISOString(),
  change,
  command,
  url,
  browserTarget,
  screenshotPath,
  packageLane = 'unspecified',
  couplingStatus = 'pending service-fit validation',
  storybookStoryIds = 'not recorded',
  themeOverridePoints = 'not recorded',
  selfReview,
  stakeholderFeedback = 'pending',
  changesAccepted = 'pending user feedback',
  openIssues,
}) {
  return [
    time,
    change,
    command,
    url,
    browserTarget,
    screenshotPath ?? 'not captured',
    packageLane,
    couplingStatus,
    storybookStoryIds,
    themeOverridePoints,
    selfReview,
    stakeholderFeedback,
    changesAccepted,
    openIssues,
  ]
    .map(markdownCell)
    .join(' | ');
}

function buildReviewLogHeader() {
  const separator = UI_REVIEW_LOG_COLUMNS.map(() => '---');
  return [
    '# UI Review Log',
    '',
    `| ${UI_REVIEW_LOG_COLUMNS.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
  ].join('\n') + '\n';
}

function buildPreviewSelfReview({ browser, screenshotPath, status, notes }) {
  const browserStatus =
    browser?.attempted === false
      ? 'Browser opening disabled by option.'
      : browser?.ok
        ? 'Browser opener launched successfully.'
        : `Browser opener failed: ${browser?.error ?? 'unknown error'}.`;
  const screenshotStatus = screenshotPath
    ? `Screenshot captured at ${screenshotPath}.`
    : `Screenshot not captured: ${notes}`;
  return `${browserStatus} ${screenshotStatus} Status: ${status}.`;
}

function buildPreviewOpenIssues({ browser, screenshotPath, status, notes }) {
  const issues = [];
  if (browser?.attempted !== false && !browser?.ok) {
    issues.push('Browser opener failed; use URL manually or rerun with --no-open.');
  }
  if (!screenshotPath) {
    issues.push(`Screenshot missing: ${notes}`);
  }
  if (status === 'blocked') {
    issues.push('Preview or required business-scenario evidence is blocked; inspect the scenario report and preview log.');
  }
  return issues.length > 0 ? issues.join(' ') : 'none';
}

function buildBrowserTargetLabel(openMode, browser) {
  if (openMode === 'none') return 'none';
  if (browser?.ok) return `${openMode} (${browser.reason ?? 'opened'})`;
  return `${openMode} (failed)`;
}

async function appendReviewLog({
  reviewLogPath,
  change,
  command,
  url,
  browserTarget,
  screenshotPath,
  status,
  notes,
  browser = null,
  packageLane,
  couplingStatus,
  storybookStoryIds,
  themeOverridePoints,
  stakeholderFeedback,
  changesAccepted,
}) {
  if (!reviewLogPath) return null;

  await fs.mkdir(path.dirname(reviewLogPath), { recursive: true });
  const handle = await fs.open(reviewLogPath, 'a+', 0o600);
  const header = buildReviewLogHeader();
  const row = buildReviewLogRow({
    change,
    command,
    url,
    browserTarget,
    screenshotPath,
    packageLane,
    couplingStatus,
    storybookStoryIds,
    themeOverridePoints,
    selfReview: buildPreviewSelfReview({ browser, screenshotPath, status, notes }),
    stakeholderFeedback,
    changesAccepted,
    openIssues: buildPreviewOpenIssues({ browser, screenshotPath, status, notes }),
  });

  try {
    const stats = await handle.stat();
    if (stats.size === 0) {
      await handle.writeFile(header, 'utf8');
    }
    await handle.writeFile(`| ${row} |\n`, 'utf8');
  } finally {
    await handle.close();
  }
  return reviewLogPath;
}

export function parseArgs(argv) {
  const options = {
    workspace: process.cwd(),
    featureDir: null,
    command: null,
    url: null,
    open: 'auto',
    screenshot: true,
    timeoutMs: 45000,
    scenarioTimeoutMs: 300000,
    scenarioCommand: null,
    scenarios: 'auto',
    change: 'manual preview refresh',
    json: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];

    if (arg === '--workspace') options.workspace = next();
    else if (arg === '--feature-dir') options.featureDir = next();
    else if (arg === '--command') options.command = next();
    else if (arg === '--url') options.url = next();
    else if (arg === '--open') options.open = next();
    else if (arg === '--no-open') options.open = 'none';
    else if (arg === '--screenshot') options.screenshot = true;
    else if (arg === '--no-screenshot') options.screenshot = false;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next());
    else if (arg === '--scenario-timeout-ms') options.scenarioTimeoutMs = Number(next());
    else if (arg === '--scenario-command') options.scenarioCommand = next();
    else if (arg === '--require-scenarios') options.scenarios = 'required';
    else if (arg === '--skip-scenarios') options.scenarios = 'skip';
    else if (arg === '--change') options.change = next();
    else if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!['auto', 'external', 'none'].includes(options.open)) {
    throw new Error('--open must be auto, external, or none');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be at least 1000');
  }
  if (!Number.isFinite(options.scenarioTimeoutMs) || options.scenarioTimeoutMs < 1000) {
    throw new Error('--scenario-timeout-ms must be at least 1000');
  }

  return options;
}

function helpText() {
  return `Gofer UI Preview

Starts or reuses a local UI preview, opens it quickly, captures evidence when
Playwright is available, and appends ui-review-log.md for app-delivery features.

Usage:
  node .specify/scripts/node/gofer-ui-preview.mjs [options]

Options:
  --workspace <path>        Workspace root. Defaults to cwd.
  --feature-dir <path>      Feature artifact directory, e.g. .specify/specs/my-feature.
  --command <cmd>           Explicit preview command, e.g. "./run.sh dev 3001".
  --url <url>               Existing preview URL. Skips server startup.
  --open <auto|external|none>
                            Open URL in the host/default browser. Defaults to auto.
  --no-open                 Do not open a browser.
  --screenshot              Capture screenshot evidence with Playwright. Default.
  --no-screenshot           Skip screenshot capture.
  --timeout-ms <ms>         URL readiness timeout. Defaults to 45000.
  --scenario-command <cmd>  Executable browser business-scenario command.
  --require-scenarios       Block unless a valid manifest and browser suite pass.
                            This is automatic when --feature-dir is present.
  --skip-scenarios          Explicitly skip scenario execution (early red work only).
  --scenario-timeout-ms <ms>
                            Scenario timeout. Defaults to 300000.
  --change <text>           Change trigger recorded in ui-review-log.md.
  --json                    Print machine-readable output.
  --dry-run                 Detect command/URLs only; do not start/open/capture.
`;
}

export async function runUiPreview(rawOptions) {
  const workspaceRoot = path.resolve(rawOptions.workspace);
  const paths = resolveFeatureLogPaths(workspaceRoot, rawOptions.featureDir);
  const featureDir = rawOptions.featureDir
    ? path.resolve(workspaceRoot, rawOptions.featureDir)
    : null;
  const scenariosRequired =
    rawOptions.scenarios !== 'skip' &&
    (rawOptions.scenarios === 'required' || Boolean(featureDir));
  const scenarioManifest =
    rawOptions.scenarios === 'skip'
      ? null
      : await loadBusinessScenarioManifest(workspaceRoot, featureDir);
  const scenarioCommandInfo =
    rawOptions.scenarios === 'skip'
      ? null
      : await discoverBusinessScenarioCommand(
          workspaceRoot,
          rawOptions.scenarioCommand,
          scenarioManifest?.manifest?.command
        );
  const commandInfo = rawOptions.url
    ? {
        command: rawOptions.command?.trim() || null,
        source: 'explicit-url',
        packageManager: null,
        scriptName: null,
      }
    : await discoverPreviewCommand(workspaceRoot, rawOptions.command);
  const candidateUrls = buildCandidateUrls({
    explicitUrl: rawOptions.url,
    command: commandInfo.command,
  });

  const baseReport = {
    status: 'planned',
    workspaceRoot,
    featureDir,
    command: commandInfo.command,
    commandSource: commandInfo.source,
    candidateUrls,
    selectedUrl: null,
    browser: null,
    screenshot: null,
    reviewLogPath: paths.reviewLogPath,
    server: null,
    businessScenarios: {
      required: scenariosRequired,
      manifest: scenarioManifest,
      command: scenarioCommandInfo,
      run: null,
      reportPath: paths.scenarioReportPath,
    },
    nextActions: [],
  };

  if (rawOptions.dryRun) {
    const scenarioReady =
      !scenariosRequired ||
      (scenarioManifest?.valid &&
        scenarioCommandInfo?.command &&
        scenarioCommandInfo?.browserRunner);
    return {
      ...baseReport,
      status:
        (commandInfo.command || rawOptions.url) && scenarioReady ? 'ready' : 'blocked',
      nextActions:
        (commandInfo.command || rawOptions.url) && scenarioReady
          ? ['Run without --dry-run after a UI-facing change.']
          : [
              'Provide a preview command/URL and a valid business-scenarios.json.',
              'Add a Playwright/Cypress/browser package script or pass --scenario-command.',
            ],
    };
  }

  if (!rawOptions.url && !commandInfo.command) {
    return {
      ...baseReport,
      status: 'blocked',
      nextActions: [
        'Pass --command or --url, add run.sh/run.bat, or add a package.json dev/start/preview script.',
        'Record the chosen preview command in ui-preview-brief.md.',
      ],
    };
  }

  let server = null;
  if (!rawOptions.url) {
    server = await startPreviewServer(commandInfo.command, workspaceRoot, paths.processLogPath, paths.pidPath);
  }

  const readiness = await waitForReachableUrl(candidateUrls, rawOptions.timeoutMs);
  if (!readiness.ok) {
    const report = {
      ...baseReport,
      status: 'blocked',
      server,
      nextActions: [
        `No preview URL became reachable. Check ${paths.processLogPath}.`,
        'Pass --url when the app uses a non-standard host or port.',
      ],
    };
    await appendReviewLog({
      reviewLogPath: paths.reviewLogPath,
      change: rawOptions.change,
      command: commandInfo.command ?? 'existing URL',
      url: candidateUrls.join(', '),
      browserTarget: rawOptions.open,
      screenshotPath: null,
      status: 'blocked',
      notes: 'No candidate URL became reachable before timeout.',
      browser: {
        attempted: rawOptions.open !== 'none',
        ok: false,
        error: 'preview URL not reachable',
      },
    });
    return report;
  }

  const selectedUrl = candidateUrls[readiness.urlIndex];
  const browser = await openBrowser(selectedUrl, rawOptions.open);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let screenshot = { ok: false, path: null, error: 'Screenshot disabled' };
  if (rawOptions.screenshot) {
    screenshot = await captureScreenshot(
      selectedUrl,
      path.join(paths.previewDir, `ui-preview-${timestamp}.png`)
    );
  }

  let scenarioRun = {
    ok: rawOptions.scenarios === 'skip',
    status: rawOptions.scenarios === 'skip' ? 'skipped' : 'not-run',
    exitCode: null,
    error: null,
    logPath: null,
  };
  const scenarioPreflightErrors = [];
  if (rawOptions.scenarios !== 'skip') {
    if (!scenarioManifest?.valid) {
      scenarioPreflightErrors.push(...(scenarioManifest?.errors ?? []));
    }
    if (!scenarioCommandInfo?.command) {
      scenarioPreflightErrors.push('No executable business-scenario command was found.');
    } else if (!scenarioCommandInfo.browserRunner) {
      scenarioPreflightErrors.push(
        'The business-scenario command does not use a recognized browser runner.'
      );
    }

    if (scenarioPreflightErrors.length === 0) {
      scenarioRun = await runBusinessScenarioCommand(
        scenarioCommandInfo.command,
        workspaceRoot,
        paths.scenarioLogPath,
        rawOptions.scenarioTimeoutMs
      );
    } else {
      scenarioRun = {
        ok: false,
        status: 'blocked',
        exitCode: null,
        error: scenarioPreflightErrors.join(' '),
        logPath: null,
      };
    }
  }

  const businessScenarios = {
    required: scenariosRequired,
    manifest: scenarioManifest,
    command: scenarioCommandInfo,
    run: scenarioRun,
    reportPath: paths.scenarioReportPath,
  };
  await fs.mkdir(path.dirname(paths.scenarioReportPath), { recursive: true });
  await fs.writeFile(
    paths.scenarioReportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        workspaceRoot,
        featureDir,
        selectedUrl,
        status:
          scenarioRun.ok || (!scenariosRequired && scenarioRun.status === 'not-run')
            ? 'passed'
            : 'blocked',
        manifestPath: scenarioManifest?.path ?? null,
        scenarioCount: scenarioManifest?.scenarioCount ?? 0,
        command: scenarioCommandInfo?.command ?? null,
        browserRunner: scenarioCommandInfo?.browserRunner ?? false,
        run: scenarioRun,
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );

  const scenarioBlocked =
    scenariosRequired &&
    (!scenarioManifest?.valid ||
      !scenarioCommandInfo?.command ||
      !scenarioCommandInfo?.browserRunner ||
      !scenarioRun.ok);
  const previewStatus =
    browser.ok && (screenshot.ok || !rawOptions.screenshot)
      ? 'shown'
      : 'shown-with-open-issues';
  const status = scenarioBlocked ? 'blocked' : previewStatus;

  const reviewLogPath = await appendReviewLog({
    reviewLogPath: paths.reviewLogPath,
    change: rawOptions.change,
    command: commandInfo.command ?? 'existing URL',
    url: selectedUrl,
    browserTarget: buildBrowserTargetLabel(rawOptions.open, browser),
    screenshotPath: screenshot.path,
    status,
    notes: [
      screenshot.ok ? 'Preview opened and screenshot captured.' : screenshot.error,
      `Business scenarios: ${scenarioRun.status}.`,
      scenarioRun.error,
    ]
      .filter(Boolean)
      .join(' '),
    browser,
  });

  return {
    ...baseReport,
    status,
    selectedUrl,
    browser,
    screenshot,
    reviewLogPath,
    server,
    businessScenarios,
    nextActions: [
      'Tell the user the preview URL and screenshot path.',
      scenarioBlocked
        ? 'Fix the business-scenario manifest or browser suite, then rerun this helper.'
        : 'After the next UI-facing change, rerun this helper and browser scenarios before reporting completion.',
    ],
  };
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Gofer UI preview: ${report.status}`);
  if (report.command) console.log(`Command: ${report.command}`);
  if (report.selectedUrl) console.log(`URL: ${report.selectedUrl}`);
  if (report.screenshot?.path) console.log(`Screenshot: ${report.screenshot.path}`);
  if (report.reviewLogPath) console.log(`Review log: ${report.reviewLogPath}`);
  if (report.businessScenarios?.reportPath) {
    console.log(`Business scenarios: ${report.businessScenarios.run?.status ?? 'not-run'}`);
    console.log(`Scenario report: ${report.businessScenarios.reportPath}`);
  }
  if (report.server?.logPath) console.log(`Server log: ${report.server.logPath}`);
  for (const action of report.nextActions ?? []) {
    console.log(`Next: ${action}`);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(helpText());
      return;
    }

    const report = await runUiPreview(options);
    printReport(report, options.json);
    process.exitCode = report.status === 'blocked' ? 2 : 0;
  } catch (error) {
    console.error(`Gofer UI preview failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await main();
}
