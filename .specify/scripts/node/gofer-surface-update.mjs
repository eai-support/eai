#!/usr/bin/env node

/**
 * Plans and runs user-level Gofer install and update actions for supported hosts.
 * This script is intentionally independent of a repository scaffold.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { cleanupLocalSettings } from './gofer-local-settings-cleanup.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY_URL = 'https://github.com/eai-support/eai-gofer';
const VS_CODE_EXTENSION_ID = 'EnterpriseAI.gofer';
export const SUPPORTED_HOSTS = Object.freeze([
  'claude',
  'codex',
  'copilot',
  'antigravity',
  'grok',
  'vscode',
]);
export const INVOCATION_PREFIXES = Object.freeze({
  claude: '/',
  codex: '$',
  copilot: '/',
  antigravity: '/',
  grok: '/',
  vscode: '/',
});
const LEGACY_HOST_ALIASES = Object.freeze({
  gemini: 'antigravity',
});
const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_PLUGIN_ROOT = path.resolve(path.dirname(scriptPath), '..', '..', '..');
const ALWAYS_ON_EAI_START = '<!-- gofer:always-on-eai:start -->';
const ALWAYS_ON_EAI_END = '<!-- gofer:always-on-eai:end -->';
const ALWAYS_ON_EAI_SECTION = `## Always-On EAI Contract
${ALWAYS_ON_EAI_START}

Apply Gofer to every request. The user does not need to type \`/eai\` or \`$eai\`.

1. Preserve the user's request. Do not add a visible command prefix.
2. Use Gofer's internal routing. Do not make the user choose a pipeline stage.
3. Use concise, business-first ASD-STE100 style.
4. Check workspace health before meaningful repo work, tool use, or a pipeline stage. Do not repeat setup on every message.
5. Use Gofer maintenance only when the user explicitly asks to install or update Gofer.
${ALWAYS_ON_EAI_END}`;
const ALWAYS_ON_EAI_MARKER = /## Always-On EAI Contract\r?\n<!-- gofer:always-on-eai:start -->[\s\S]*?<!-- gofer:always-on-eai:end -->/;
const MAX_DIAGNOSTIC_CHARACTERS = 4096;
const VS_CODE_INSTRUCTIONS_FRONTMATTER = `---
name: EAI Gofer
description: Apply the EAI Gofer delivery contract to every workspace request.
applyTo: '**'
---`;
const LEGACY_VS_CODE_INSTRUCTIONS_KEY = 'github.copilot.chat.codeGeneration.instructions';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeDiagnostic(value, { home = os.homedir() } = {}) {
  if (value === undefined || value === null) return '';
  let output = String(value)
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1<redacted>@')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(
      /\b((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|credential)\s*[:=]\s*)[^\s,;]+/gi,
      '$1<redacted>'
    );

  if (home && path.isAbsolute(home)) {
    output = output.replace(new RegExp(escapeRegExp(path.resolve(home)), 'gi'), '<home>');
  }
  output = output
    .replace(/\b[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi, '<home>')
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '<home>')
    .replace(/\/(?:private\/)?tmp\/[^\s"']+/g, '<local-path>')
    .replace(/\/var\/folders\/[^\s"']+/g, '<local-path>')
    .replace(/(^|[\s"'[(=])[A-Za-z]:[\\/][^\s"'\]),;]+/gm, '$1<local-path>')
    .replace(/(^|[\s"'[(=])\/(?!\/)[^\s"'\]),;]+/gm, '$1<local-path>')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  if (output.length > MAX_DIAGNOSTIC_CHARACTERS) {
    return `${output.slice(0, MAX_DIAGNOSTIC_CHARACTERS)}…<truncated>`;
  }
  return output;
}

function sanitizeLocalPath(value) {
  if (!value) return undefined;
  return `<local-path>/${path.basename(String(value))}`;
}

export function sanitizeSurfaceUpdateOutput(value, options = {}, key = '') {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    if (/(?:path|root|cwd|directory)$/i.test(key) && isLocalMarketplacePath(value)) {
      return sanitizeLocalPath(value);
    }
    return sanitizeDiagnostic(value, options);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeSurfaceUpdateOutput(entry, options));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [
          entryKey,
          /(?:password|secret|token|credential|api[-_]?key)/i.test(entryKey)
            ? '<redacted>'
            : sanitizeSurfaceUpdateOutput(entryValue, options, entryKey),
        ])
    );
  }
  return value;
}

function command(command, args, label) {
  return { command, args, label };
}

export function getAlwaysOnInstructionPath(host, {
  home = os.homedir(),
  platform = process.platform,
  env = process.env,
} = {}) {
  if (host === 'claude') return path.join(home, '.claude', 'CLAUDE.md');
  if (host === 'codex') return path.join(home, '.codex', 'AGENTS.md');
  if (host === 'copilot') return path.join(home, '.copilot', 'copilot-instructions.md');
  if (host === 'antigravity') return path.join(home, '.gemini', 'GEMINI.md');
  if (host === 'vscode') return path.join(home, '.copilot', 'instructions', 'eai-gofer.instructions.md');
  throw new Error(`Unsupported host: ${host}`);
}

function getLegacyVsCodeSettingsPath({ home, platform, env }) {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  }
  if (platform === 'win32') {
    return path.join(
      env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      'Code',
      'User',
      'settings.json'
    );
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Code', 'User', 'settings.json');
}

export function getBundledAlwaysOnSkillPath(host, {
  pluginRoot = DEFAULT_PLUGIN_ROOT,
} = {}) {
  if (host !== 'grok') throw new Error(`Unsupported bundled-skill host: ${host}`);
  return path.join(pluginRoot, 'skills', 'eai', 'SKILL.md');
}

function verifyAlwaysOnSkill(content, host) {
  if (
    !content.includes(ALWAYS_ON_EAI_START) ||
    !content.includes(ALWAYS_ON_EAI_END) ||
    !content.includes('Apply this contract to every request')
  ) {
    throw new Error(`The bundled ${host} EAI skill does not contain the always-on contract.`);
  }
}

export function upsertAlwaysOnEaiSection(content) {
  if (ALWAYS_ON_EAI_MARKER.test(content)) {
    return content.replace(ALWAYS_ON_EAI_MARKER, ALWAYS_ON_EAI_SECTION);
  }
  const separator = content.length === 0 ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${ALWAYS_ON_EAI_SECTION}\n`;
}

function upsertVsCodeInstructionFile(content) {
  const withContract = upsertAlwaysOnEaiSection(content);
  const frontmatter = withContract.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    return `${VS_CODE_INSTRUCTIONS_FRONTMATTER}\n\n${withContract}`;
  }
  const body = frontmatter[1];
  const updatedBody = /^applyTo\s*:/m.test(body)
    ? body.replace(/^applyTo\s*:.*$/m, "applyTo: '**'")
    : `${body}\napplyTo: '**'`;
  return `${withContract.slice(0, frontmatter.index)}---\n${updatedBody}\n---${withContract.slice((frontmatter.index ?? 0) + frontmatter[0].length)}`;
}

function skipJsoncWhitespaceAndComments(content, start) {
  let index = start;
  while (index < content.length) {
    if (/\s/.test(content[index])) {
      index += 1;
      continue;
    }
    if (content[index] === '/' && content[index + 1] === '/') {
      index += 2;
      while (index < content.length && !['\n', '\r'].includes(content[index])) index += 1;
      continue;
    }
    if (content[index] === '/' && content[index + 1] === '*') {
      index += 2;
      while (index < content.length && !(content[index] === '*' && content[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    break;
  }
  return index;
}

function parseJsoncObject(content) {
  const output = [];
  let index = 0;
  let quote = '';
  let escaped = false;
  while (index < content.length) {
    const character = content[index];
    const next = content[index + 1];
    if (quote) {
      output.push(character);
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      index += 1;
      continue;
    }
    if (character === '"') {
      quote = character;
      output.push(character);
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      index += 2;
      while (index < content.length && !['\n', '\r'].includes(content[index])) index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < content.length && !(content[index] === '*' && content[index + 1] === '/')) {
        if (['\n', '\r'].includes(content[index])) output.push(content[index]);
        index += 1;
      }
      index += 2;
      continue;
    }
    if (character === ',') {
      const lookahead = skipJsoncWhitespaceAndComments(content, index + 1);
      if (content[lookahead] === '}' || content[lookahead] === ']') {
        index += 1;
        continue;
      }
    }
    output.push(character);
    index += 1;
  }
  const parsed = JSON.parse(output.join(''));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('VS Code settings.json must contain a JSON object.');
  }
  return parsed;
}

function findJsonStringEnd(content, start) {
  let escaped = false;
  for (let index = start + 1; index < content.length; index += 1) {
    if (escaped) escaped = false;
    else if (content[index] === '\\') escaped = true;
    else if (content[index] === '"') return index + 1;
  }
  throw new Error('VS Code settings.json contains an unterminated string.');
}

function findJsoncValueEnd(content, start) {
  const opening = content[start];
  if (opening === '"') return findJsonStringEnd(content, start);
  if (opening !== '[' && opening !== '{') {
    let index = start;
    while (index < content.length && !',}]'.includes(content[index])) index += 1;
    return index;
  }
  const closing = opening === '[' ? ']' : '}';
  let depth = 0;
  let index = start;
  while (index < content.length) {
    if (content[index] === '"') {
      index = findJsonStringEnd(content, index);
      continue;
    }
    if (content[index] === '/' && ['/', '*'].includes(content[index + 1])) {
      index = skipJsoncWhitespaceAndComments(content, index);
      continue;
    }
    if (content[index] === opening) depth += 1;
    if (content[index] === closing) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  throw new Error('VS Code settings.json contains an unterminated value.');
}

function findJsoncPropertyRange(content, key) {
  let depth = 0;
  for (let index = 0; index < content.length;) {
    if (content[index] === '"') {
      const stringStart = index;
      const stringEnd = findJsonStringEnd(content, index);
      const next = skipJsoncWhitespaceAndComments(content, stringEnd);
      if (depth === 1 && content[next] === ':' && JSON.parse(content.slice(stringStart, stringEnd)) === key) {
        const valueStart = skipJsoncWhitespaceAndComments(content, next + 1);
        const valueEnd = findJsoncValueEnd(content, valueStart);
        const afterValue = skipJsoncWhitespaceAndComments(content, valueEnd);
        if (content[afterValue] === ',') {
          return { removeStart: stringStart, removeEnd: afterValue + 1, valueStart, valueEnd };
        }
        let beforeKey = stringStart - 1;
        while (beforeKey >= 0 && /\s/.test(content[beforeKey])) beforeKey -= 1;
        if (content[beforeKey] === ',') {
          return { removeStart: beforeKey, removeEnd: valueEnd, valueStart, valueEnd };
        }
        return { removeStart: stringStart, removeEnd: valueEnd, valueStart, valueEnd };
      }
      index = stringEnd;
      continue;
    }
    if (content[index] === '/' && ['/', '*'].includes(content[index + 1])) {
      index = skipJsoncWhitespaceAndComments(content, index);
      continue;
    }
    if (content[index] === '{' || content[index] === '[') depth += 1;
    if (content[index] === '}' || content[index] === ']') depth -= 1;
    index += 1;
  }
  return undefined;
}

function removeLegacyVsCodeGoferInstruction(content) {
  const settings = parseJsoncObject(content);
  const instructions = settings[LEGACY_VS_CODE_INSTRUCTIONS_KEY];
  if (!Array.isArray(instructions)) return content;
  const retained = instructions.filter(
    (entry) => typeof entry?.text !== 'string' || !entry.text.includes(ALWAYS_ON_EAI_START)
  );
  if (retained.length === instructions.length) return content;
  const range = findJsoncPropertyRange(content, LEGACY_VS_CODE_INSTRUCTIONS_KEY);
  if (!range) throw new Error('Could not safely locate the legacy VS Code Gofer setting.');
  if (retained.length === 0) {
    return `${content.slice(0, range.removeStart)}${content.slice(range.removeEnd)}`;
  }
  return `${content.slice(0, range.valueStart)}${JSON.stringify(retained, null, 2)}${content.slice(range.valueEnd)}`;
}

function getInstructionSecurityRoot(host, { home, platform, env }) {
  return home;
}

async function assertNoSymlinkComponents(targetPath, securityRoot, fileSystem) {
  if (!path.isAbsolute(targetPath) || !path.isAbsolute(securityRoot)) {
    throw new Error('Refusing to update a non-absolute user instruction target.');
  }

  const relativeTarget = path.relative(securityRoot, targetPath);
  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error('Refusing to update a user instruction target outside its configuration root.');
  }

  const components = relativeTarget.split(path.sep).filter(Boolean);
  let currentPath = securityRoot;
  try {
    const rootStatus = await fileSystem.lstat(currentPath);
    if (rootStatus.isSymbolicLink()) {
      throw new Error('Refusing to update a user instruction target through a symbolic link.');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const component of components) {
    currentPath = path.join(currentPath, component);
    try {
      const status = await fileSystem.lstat(currentPath);
      if (status.isSymbolicLink()) {
        throw new Error('Refusing to update a user instruction target through a symbolic link.');
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function readText(targetPath, securityRoot, fileSystem) {
  await assertNoSymlinkComponents(targetPath, securityRoot, fileSystem);
  let handle;
  try {
    const status = await fileSystem.lstat(targetPath);
    if (!status.isFile()) {
      throw new Error('Refusing to update a user instruction target that is not a regular file.');
    }
    handle = await fileSystem.open(
      targetPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile() || !sameFileIdentity(
      { exists: true, dev: status.dev, ino: status.ino },
      { exists: true, dev: openedStatus.dev, ino: openedStatus.ino }
    )) {
      throw new Error('Refusing to read a user instruction target that changed during the update.');
    }
    return {
      content: await handle.readFile('utf8'),
      exists: true,
      mode: openedStatus.mode & 0o777,
      dev: openedStatus.dev,
      ino: openedStatus.ino,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { content: '', exists: false, mode: 0o600, dev: undefined, ino: undefined };
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function sameFileIdentity(left, right) {
  if (!left.exists || !right.exists) return left.exists === right.exists;
  if (left.dev === undefined || left.ino === undefined || right.dev === undefined || right.ino === undefined) {
    return true;
  }
  return left.dev === right.dev && left.ino === right.ino;
}

async function writeOpenFileContent(handle, content) {
  const bytes = Buffer.from(content, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (bytesWritten === 0) throw new Error('Unable to make progress while writing instructions.');
    offset += bytesWritten;
  }
}

async function readPathIdentity(targetPath, fileSystem) {
  try {
    const status = await fileSystem.lstat(targetPath);
    return {
      exists: true,
      file: status.isFile(),
      symlink: status.isSymbolicLink(),
      dev: status.dev,
      ino: status.ino,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, file: false, symlink: false, dev: undefined, ino: undefined };
    }
    throw error;
  }
}

async function unlinkOnlyIfIdentityMatches(candidatePath, expected, fileSystem) {
  try {
    const current = await readPathIdentity(candidatePath, fileSystem);
    if (current.exists && sameFileIdentity(expected, current)) {
      await fileSystem.unlink(candidatePath);
    }
  } catch {
    // Preserve the primary fail-closed error. Never unlink an unverified path.
  }
}

async function writeText(targetPath, content, securityRoot, fileSystem, original, platform) {
  const parentPath = path.dirname(targetPath);
  await fileSystem.mkdir(parentPath, { recursive: true });
  await assertNoSymlinkComponents(targetPath, securityRoot, fileSystem);
  const parentBeforeOpen = await fileSystem.lstat(parentPath);
  if (parentBeforeOpen.isSymbolicLink() || !parentBeforeOpen.isDirectory()) {
    throw new Error('Refusing to update instructions through an unsafe parent directory.');
  }
  const parentHandle = await fileSystem.open(
    parentPath,
    fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0)
  );
  const parentStatus = await parentHandle.stat();
  if (!parentStatus.isDirectory()) {
    await parentHandle.close();
    throw new Error('Refusing to update instructions through a non-directory parent.');
  }
  if (!sameFileIdentity(
    { exists: true, dev: parentBeforeOpen.dev, ino: parentBeforeOpen.ino },
    { exists: true, dev: parentStatus.dev, ino: parentStatus.ino }
  )) {
    await parentHandle.close();
    throw new Error('Refusing to update instructions through a parent that changed while opening.');
  }
  let temporaryHandle;
  let temporaryPath;
  let temporaryIdentity;
  let renamed = false;
  try {
    const beforeCreateParent = await fileSystem.lstat(parentPath);
    if (!sameFileIdentity(
      { exists: true, dev: parentStatus.dev, ino: parentStatus.ino },
      { exists: true, dev: beforeCreateParent.dev, ino: beforeCreateParent.ino }
    )) {
      throw new Error('Refusing to replace instructions through a parent that changed during the update.');
    }

    const temporaryName = `.${path.basename(targetPath)}.gofer-${randomBytes(16).toString('hex')}.tmp`;
    temporaryPath = path.join(parentPath, temporaryName);
    temporaryHandle = await fileSystem.open(
      temporaryPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    const temporaryStatus = await temporaryHandle.stat();
    if (!temporaryStatus.isFile()) {
      throw new Error('Refusing to create a non-file instruction replacement.');
    }
    temporaryIdentity = {
      exists: true,
      dev: temporaryStatus.dev,
      ino: temporaryStatus.ino,
    };

    const afterCreateParent = await fileSystem.lstat(parentPath);
    if (!sameFileIdentity(
      { exists: true, dev: parentStatus.dev, ino: parentStatus.ino },
      { exists: true, dev: afterCreateParent.dev, ino: afterCreateParent.ino }
    )) {
      throw new Error('Refusing to replace instructions through a parent that changed during the update.');
    }

    await writeOpenFileContent(temporaryHandle, content);
    await temporaryHandle.chmod(original.mode);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;

    const currentTarget = await readPathIdentity(targetPath, fileSystem);
    if (
      currentTarget.symlink ||
      (currentTarget.exists && !currentTarget.file) ||
      !sameFileIdentity(original, currentTarget)
    ) {
      throw new Error('Refusing to replace a user instruction target that changed during the update.');
    }
    const beforeRenameParent = await fileSystem.lstat(parentPath);
    if (!sameFileIdentity(
      { exists: true, dev: parentStatus.dev, ino: parentStatus.ino },
      { exists: true, dev: beforeRenameParent.dev, ino: beforeRenameParent.ino }
    )) {
      throw new Error('Refusing to replace instructions through a parent that changed during the update.');
    }

    await fileSystem.rename(temporaryPath, targetPath);
    renamed = true;

    const [afterRenameParent, installedTarget] = await Promise.all([
      fileSystem.lstat(parentPath),
      readPathIdentity(targetPath, fileSystem),
    ]);
    if (
      !sameFileIdentity(
        { exists: true, dev: parentStatus.dev, ino: parentStatus.ino },
        { exists: true, dev: afterRenameParent.dev, ino: afterRenameParent.ino }
      ) ||
      !sameFileIdentity(temporaryIdentity, installedTarget)
    ) {
      await unlinkOnlyIfIdentityMatches(targetPath, temporaryIdentity, fileSystem);
      throw new Error('Refusing to keep instructions after the parent changed during the update.');
    }

    if (platform !== 'win32') {
      await parentHandle.sync();
    }
  } catch (error) {
    if (!renamed && temporaryPath && temporaryIdentity) {
      await unlinkOnlyIfIdentityMatches(temporaryPath, temporaryIdentity, fileSystem);
    }
    throw error;
  } finally {
    await temporaryHandle?.close();
    await parentHandle.close();
  }
}

export async function configureAlwaysOnInstructions(hosts, {
  home = os.homedir(),
  platform = process.platform,
  env = process.env,
  fileSystem = fs,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
} = {}) {
  const results = [];
  for (const host of [...new Set(hosts)]) {
    let targetPath;
    try {
      if (host === 'grok') {
        targetPath = getBundledAlwaysOnSkillPath(host, { pluginRoot });
        const content = await fileSystem.readFile(targetPath, 'utf8');
        verifyAlwaysOnSkill(content, host);
        results.push({
          host,
          targetPath: sanitizeLocalPath(targetPath),
          ok: true,
          managedByPlugin: true,
        });
        continue;
      }

      targetPath = getAlwaysOnInstructionPath(host, { home, platform, env });
      const securityRoot = getInstructionSecurityRoot(host, { home, platform, env });
      const original = await readText(targetPath, securityRoot, fileSystem);
      const existing = original.content;
      if (host === 'vscode') {
        const updated = upsertVsCodeInstructionFile(existing);
        if (updated !== existing) {
          await writeText(targetPath, updated, securityRoot, fileSystem, original, platform);
        }
        const legacySettingsPath = getLegacyVsCodeSettingsPath({ home, platform, env });
        const legacyOriginal = await readText(legacySettingsPath, securityRoot, fileSystem);
        if (legacyOriginal.exists) {
          const migratedSettings = removeLegacyVsCodeGoferInstruction(legacyOriginal.content);
          if (migratedSettings !== legacyOriginal.content) {
            await writeText(
              legacySettingsPath,
              migratedSettings,
              securityRoot,
              fileSystem,
              legacyOriginal,
              platform
            );
          }
        }
      } else {
        const updated = upsertAlwaysOnEaiSection(existing);
        if (updated !== existing) {
          await writeText(targetPath, updated, securityRoot, fileSystem, original, platform);
        }
      }
      results.push({ host, targetPath: sanitizeLocalPath(targetPath), ok: true });
    } catch (error) {
      results.push({
        host,
        targetPath: sanitizeLocalPath(targetPath),
        ok: false,
        managedByPlugin: host === 'grok',
        error: sanitizeDiagnostic(error instanceof Error ? error.message : String(error), { home }),
      });
    }
  }
  return results;
}

const SURFACE_ACTIONS = {
  claude: {
    install: [
      command('claude', ['plugin', 'marketplace', 'add', REPOSITORY_URL, '--scope', 'user', '--sparse', '.claude-plugin', '--sparse', 'plugins/eai-gofer'], 'Add the EAI Gofer marketplace'),
      command('claude', ['plugin', 'install', 'eai-gofer@eai-gofer', '--scope', 'user'], 'Install EAI Gofer'),
    ],
    update: [
      command('claude', ['plugin', 'marketplace', 'update', 'eai-gofer'], 'Refresh the EAI Gofer marketplace'),
      command('claude', ['plugin', 'update', 'eai-gofer@eai-gofer', '--scope', 'user'], 'Update EAI Gofer'),
    ],
    refresh: 'Run /reload-plugins, then start a new Claude Code conversation.',
  },
  codex: {
    install: [
      command('codex', ['plugin', 'marketplace', 'add', REPOSITORY_URL, '--sparse', '.agents/plugins', '--sparse', 'plugins/eai-gofer'], 'Add the EAI Gofer marketplace'),
      command('codex', ['plugin', 'add', 'eai-gofer@eai-gofer'], 'Install EAI Gofer'),
    ],
    update: [
      command('codex', ['plugin', 'marketplace', 'upgrade', 'eai-gofer'], 'Refresh the EAI Gofer marketplace'),
      command('codex', ['plugin', 'add', 'eai-gofer@eai-gofer'], 'Apply the refreshed EAI Gofer plugin'),
    ],
    refresh: 'Start a new Codex task or restart Codex so it loads the refreshed plugin.',
  },
  copilot: {
    install: [
      command('copilot', ['plugin', 'marketplace', 'add', REPOSITORY_URL], 'Add the EAI Gofer marketplace'),
      command('copilot', ['plugin', 'install', 'eai-gofer@eai-gofer'], 'Install EAI Gofer'),
    ],
    update: [
      command('copilot', ['plugin', 'marketplace', 'update', 'eai-gofer'], 'Refresh the EAI Gofer marketplace'),
      command('copilot', ['plugin', 'update', 'eai-gofer@eai-gofer'], 'Update EAI Gofer'),
    ],
    refresh: 'Run /restart in Copilot CLI or start a new Copilot app chat.',
  },
  antigravity: {
    install: [
      command('agy', ['plugin', 'install', REPOSITORY_URL], 'Install EAI Gofer'),
    ],
    update: [
      command('agy', ['plugin', 'install', REPOSITORY_URL], 'Reinstall the current EAI Gofer plugin'),
    ],
    refresh: 'Start a new Antigravity session so it loads the installed plugin.',
  },
  grok: {
    install: [
      command('grok', ['plugin', 'install', '--trust', REPOSITORY_URL], 'Install EAI Gofer'),
    ],
    update: [
      command('grok', ['plugin', 'update', 'eai-gofer'], 'Update EAI Gofer'),
    ],
    refresh: 'Start a new Grok Build session so it loads the updated plugin.',
  },
  vscode: {
    install: [
      command('code', ['--install-extension', VS_CODE_EXTENSION_ID, '--force'], 'Install or update the EAI Gofer VS Code extension'),
    ],
    update: [
      command('code', ['--install-extension', VS_CODE_EXTENSION_ID, '--force'], 'Install or update the EAI Gofer VS Code extension'),
    ],
    refresh: 'Run Developer: Reload Window in VS Code.',
  },
};

export function parseArgs(argv) {
  const result = { action: 'inspect', host: 'auto', execute: false, json: false, help: false };
  if (argv.includes('--help') || argv.includes('-h')) return { ...result, help: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const nextValue = argv[index + 1];
    if (value === '--action') {
      if (!nextValue || nextValue.startsWith('-')) throw new Error('Missing value for --action.');
      result.action = argv[++index];
    } else if (value === '--host') {
      if (!nextValue || nextValue.startsWith('-')) throw new Error('Missing value for --host.');
      result.host = argv[++index];
    }
    else if (value === '--execute') result.execute = true;
    else if (value === '--json') result.json = true;
    else if (value === '--help' || value === '-h') result.help = true;
    else throw new Error('Unsupported option. Use --action, --host, --execute, --json, or --help.');
  }
  if (!['inspect', 'install', 'update'].includes(result.action)) {
    throw new Error(`Unsupported action: ${result.action}. Use inspect, install, or update.`);
  }
  result.host = LEGACY_HOST_ALIASES[result.host] || result.host;
  if (!['auto', 'all', ...SUPPORTED_HOSTS].includes(result.host)) {
    throw new Error(`Unsupported host: ${result.host}. Use auto, all, ${SUPPORTED_HOSTS.join(', ')}`);
  }
  return result;
}

export function resolveHosts(host, currentHost = process.env.GOFER_HOST) {
  const normalizedHost = LEGACY_HOST_ALIASES[host] || host;
  const normalizedCurrentHost = LEGACY_HOST_ALIASES[currentHost] || currentHost;
  if (normalizedHost === 'all') return [...SUPPORTED_HOSTS];
  if (normalizedHost !== 'auto') {
    if (!SUPPORTED_HOSTS.includes(normalizedHost)) {
      throw new Error(`Unsupported host: ${normalizedHost}. Use auto, all, ${SUPPORTED_HOSTS.join(', ')}`);
    }
    return [normalizedHost];
  }
  if (SUPPORTED_HOSTS.includes(normalizedCurrentHost)) return [normalizedCurrentHost];
  return [];
}

export function buildSurfacePlan({ action, host, currentHost }) {
  if (!['inspect', 'install', 'update'].includes(action)) {
    throw new Error(`Unsupported action: ${action}. Use inspect, install, or update.`);
  }
  const selectedHosts = resolveHosts(host, currentHost);
  if (selectedHosts.length === 0) {
    throw new Error(`Use --host with ${SUPPORTED_HOSTS.join(', ')}, or all.`);
  }
  return selectedHosts.map((surface) => ({
    host: surface,
    action,
    commands: action === 'inspect' ? [] : SURFACE_ACTIONS[surface][action],
    refresh: SURFACE_ACTIONS[surface].refresh,
  }));
}

export async function inspectHost(host, execute = execFileAsync) {
  const normalizedHost = LEGACY_HOST_ALIASES[host] || host;
  if (!SUPPORTED_HOSTS.includes(normalizedHost)) {
    throw new Error(`Unsupported host: ${normalizedHost}. Use ${SUPPORTED_HOSTS.join(', ')}`);
  }
  const executable = executableForHost(normalizedHost);
  const listArgs = {
    claude: ['plugin', 'list'],
    codex: ['plugin', 'list', '--json'],
    copilot: ['plugin', 'list'],
    antigravity: ['plugin', 'list'],
    grok: ['plugin', 'list'],
    vscode: ['--list-extensions', '--show-versions'],
  }[normalizedHost];
  try {
    const version = await execute(executable, ['--version'], { windowsHide: true });
    const listing = await execute(executable, listArgs, { windowsHide: true });
    return {
      host: normalizedHost,
      available: true,
      version: sanitizeDiagnostic(version.stdout.trim().split('\n')[0]),
      installed: pluginListingHasGofer(normalizedHost, listing.stdout),
    };
  } catch (error) {
    return {
      host: normalizedHost,
      available: false,
      installed: false,
      error: sanitizeDiagnostic(error?.code ?? error?.message ?? String(error)),
    };
  }
}

function isExactGoferIdentifier(host, value) {
  const candidate = String(value).trim().replace(/[,:;]$/, '');
  const version = String.raw`v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?`;
  if (host === 'vscode') {
    return new RegExp(`^EnterpriseAI\\.gofer(?:@${version})?$`, 'i').test(candidate);
  }
  return new RegExp(`^eai-gofer(?:@(?:eai-gofer|${version}))?$`, 'i').test(candidate);
}

function structuredListingContainsGofer(host, value) {
  if (typeof value === 'string') return isExactGoferIdentifier(host, value);
  if (Array.isArray(value)) {
    return value.some((entry) => structuredListingContainsGofer(host, entry));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => structuredListingContainsGofer(host, entry));
  }
  return false;
}

export function pluginListingHasGofer(host, output) {
  const normalizedHost = LEGACY_HOST_ALIASES[host] || host;
  if (!SUPPORTED_HOSTS.includes(normalizedHost)) return false;

  if (normalizedHost === 'codex') {
    try {
      return structuredListingContainsGofer(normalizedHost, JSON.parse(String(output)));
    } catch {
      return false;
    }
  }

  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[*+\-✓✔•]+\s*/, ''))
    .filter(Boolean)
    .some((line) => {
      const candidate = normalizedHost === 'vscode' ? line : line.split(/\s+/, 1)[0];
      return isExactGoferIdentifier(normalizedHost, candidate);
    });
}

export async function inspectHosts(hosts, inspect = inspectHost) {
  return Promise.all(hosts.map((host) => inspect(host)));
}

function executableForHost(host) {
  if (host === 'vscode') return 'code';
  if (host === 'antigravity') return 'agy';
  return host;
}

function isLocalMarketplacePath(value) {
  return /^(?:[A-Za-z]:[\\/]|[/~])/.test(value.trim());
}

function isOfficialRepositoryUrl(value) {
  const normalized = value.trim().replace(/\.git$/, '').replace(/\/$/, '');
  return [
    'https://github.com/eai-support/eai-gofer',
    'git@github.com:eai-support/eai-gofer',
    'ssh://git@github.com/eai-support/eai-gofer',
  ].includes(normalized);
}

export async function inspectLocalCodexMarketplace(root, execute = execFileAsync) {
  try {
    const [status, remote, branch] = await Promise.all([
      execute('git', ['-C', root, 'status', '--porcelain'], { windowsHide: true }),
      execute('git', ['-C', root, 'remote', 'get-url', 'origin'], { windowsHide: true }),
      execute('git', ['-C', root, 'branch', '--show-current'], { windowsHide: true }),
    ]);
    return {
      root,
      clean: status.stdout.trim().length === 0,
      official: isOfficialRepositoryUrl(remote.stdout),
      branch: sanitizeDiagnostic(branch.stdout.trim()),
    };
  } catch (error) {
    return {
      root,
      clean: false,
      official: false,
      branch: '',
      error: sanitizeDiagnostic(error?.stderr?.trim() ?? error?.message ?? String(error)),
    };
  }
}

export async function inspectCodexMarketplace(execute = execFileAsync) {
  try {
    const result = await execute('codex', ['plugin', 'marketplace', 'list'], {
      windowsHide: true,
    });
    const marketplace = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('eai-gofer'));
    const root = marketplace?.replace(/^eai-gofer\s+/, '').trim();

    if (!root) {
      return { type: 'unknown' };
    }

    return {
      type: isLocalMarketplacePath(root) ? 'local' : 'git',
      root,
    };
  } catch {
    return { type: 'unknown' };
  }
}

export async function runPlan(
  plan,
  {
    inspect = inspectHost,
    inspectMarketplace = inspectCodexMarketplace,
    inspectLocalMarketplace = inspectLocalCodexMarketplace,
    execute = execFileAsync,
    cleanup = cleanupLocalSettings,
    configureInstructions = configureAlwaysOnInstructions,
  } = {}
) {
  if (!Array.isArray(plan)) {
    throw new Error('Surface plan must be an array.');
  }
  for (const surface of plan) {
    if (!surface || !SUPPORTED_HOSTS.includes(surface.host)) {
      throw new Error(`Unsupported host: ${surface?.host}. Use ${SUPPORTED_HOSTS.join(', ')}`);
    }
    if (!['install', 'update'].includes(surface.action)) {
      throw new Error(`Unsupported executable action: ${surface.action}. Use install or update.`);
    }
  }

  const executablePlan = plan.map((surface) => {
    const canonicalCommands = SURFACE_ACTIONS[surface.host][surface.action];
    if (JSON.stringify(surface.commands) !== JSON.stringify(canonicalCommands)) {
      throw new Error(
        `Surface plan for ${surface.host} must exactly match the packaged ${surface.action} action.`
      );
    }
    return {
      ...surface,
      commands: canonicalCommands.map((step) => ({ ...step, args: [...step.args] })),
    };
  });

  const results = [];
  let completedUpdate = false;
  let planFailed = false;
  const configuredHosts = [];

  for (const surface of executablePlan) {
    const availability = await inspect(surface.host);
    if (!availability.available) {
      planFailed = true;
      results.push({
        host: surface.host,
        skipped: true,
        ok: false,
        label: 'Inspect host availability',
        reason: `${executableForHost(surface.host)} is not installed or is not on PATH.`,
      });
      continue;
    }
    if (surface.host === 'codex' && surface.action === 'update') {
      const marketplace = await inspectMarketplace(execute);
      if (marketplace.type === 'local') {
        const local = await inspectLocalMarketplace(marketplace.root, execute);
        if (!local.clean || !local.official || local.branch !== 'main') {
          const reasons = [
            !local.clean ? 'it has uncommitted changes' : '',
            !local.official ? 'its origin is not the official EAI Gofer repository' : '',
            local.branch !== 'main' ? `it is on ${local.branch || 'a detached branch'}, not main` : '',
          ].filter(Boolean).join('; ');
          results.push({
            host: surface.host,
            label: 'Update local EAI Gofer marketplace',
            ok: false,
            error:
              `EAI Gofer uses the local marketplace at ${sanitizeLocalPath(marketplace.root)}, but it was not updated because ${sanitizeDiagnostic(reasons)}. ` +
              'The always-on EAI instruction was refreshed. Commit, stash, or switch the local checkout to a clean official main branch, or replace it with the public Git marketplace, then restart Codex.',
          });
          planFailed = true;
          configuredHosts.push(surface.host);
          continue;
        }
        surface.commands = [
          command('git', ['-C', marketplace.root, 'fetch', 'origin', 'main'], 'Fetch the local EAI Gofer marketplace'),
          command('git', ['-C', marketplace.root, 'merge', '--ff-only', 'origin/main'], 'Fast-forward the local EAI Gofer marketplace'),
          command('codex', ['plugin', 'add', 'eai-gofer@eai-gofer'], 'Apply the refreshed EAI Gofer plugin'),
        ];
      }
      if (marketplace.type !== 'git' && marketplace.type !== 'local') {
        results.push({
          host: surface.host,
          label: 'Inspect Codex EAI Gofer marketplace',
          ok: false,
          error:
            'Could not confirm the Codex marketplace source. Update stopped to protect local Gofer work and settings.',
        });
        planFailed = true;
        continue;
      }
    }
    let completedSurface = true;
    for (const step of surface.commands) {
      try {
        const result = await execute(step.command, step.args, { windowsHide: true });
        results.push({
          host: surface.host,
          label: step.label,
          ok: true,
          stdout: sanitizeDiagnostic(result.stdout.trim()),
        });
      } catch (error) {
        results.push({
          host: surface.host,
          label: step.label,
          ok: false,
          error: sanitizeDiagnostic(error?.stderr?.trim() ?? error?.message ?? String(error)),
        });
        completedSurface = false;
        planFailed = true;
        break;
      }
    }
    completedUpdate ||= completedSurface && surface.commands.length > 0;
    if (completedSurface && surface.commands.length > 0) {
      configuredHosts.push(surface.host);
    }
  }

  if (configuredHosts.length > 0) {
    const instructionResults = await configureInstructions(configuredHosts);
    for (const entry of instructionResults) {
      if (!entry.ok) planFailed = true;
      results.push({
        host: entry.host,
        label: entry.managedByPlugin
          ? 'Verify bundled always-on Gofer skill'
          : 'Enable always-on Gofer instructions',
        ok: entry.ok,
        targetPath: sanitizeLocalPath(entry.targetPath),
        error: sanitizeDiagnostic(entry.error),
      });
    }
  }

  if (completedUpdate && !planFailed) {
    try {
      const report = await cleanup({ apply: true });
      results.push({
        host: 'local',
        label: 'Archive stale Gofer surface entries',
        ok: true,
        archived: report.removed.length,
        archiveRoot: sanitizeLocalPath(report.archiveRoot),
      });
    } catch (error) {
      results.push({
        host: 'local',
        label: 'Archive stale Gofer surface entries',
        ok: false,
        error: sanitizeDiagnostic(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return results;
}

export function formatSurfaceUpdateReport(result) {
  result = sanitizeSurfaceUpdateOutput(result);
  const lines = [
    `Action: ${result.action}`,
    `Mode: ${result.execute ? 'execute' : 'plan only'}`,
  ];

  if (result.action === 'inspect') {
    for (const host of result.hosts) {
      const status = host.available
        ? `available${host.installed ? ', Gofer installed' : ', Gofer not installed'}`
        : `not available${host.error ? `: ${host.error}` : ''}`;
      lines.push(`${host.host}: ${status}`);
    }
    return lines.join('\n');
  }

  for (const surface of result.plan) {
    lines.push(`${surface.host}: ${surface.commands.map((step) => step.label).join('; ')}`);
    lines.push(`${surface.host}: reload - ${surface.refresh}`);
  }
  for (const entry of result.results) {
    if (entry.skipped) lines.push(`${entry.host}: skipped - ${entry.reason}`);
    else if (entry.ok) lines.push(`${entry.host}: ${entry.label} completed${entry.note ? ` - ${entry.note}` : ''}`);
    else lines.push(`${entry.host}: ${entry.label} failed - ${entry.error}`);
  }

  return lines.join('\n');
}

function printUsage() {
  process.stdout.write(`Usage: node gofer-surface-update.mjs --action <inspect|install|update> --host <${SUPPORTED_HOSTS.join('|')}|all> [--execute] [--json]\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const selectedHosts = resolveHosts(args.host);
  if (selectedHosts.length === 0) {
    throw new Error('Use --host when running this helper outside a Gofer surface.');
  }
  if (args.action === 'inspect') {
    const report = await inspectHosts(selectedHosts);
    const result = { action: 'inspect', execute: false, hosts: report };
    process.stdout.write(
      `${args.json ? JSON.stringify(sanitizeSurfaceUpdateOutput(result), null, 2) : formatSurfaceUpdateReport(result)}\n`
    );
    return;
  }
  const plan = buildSurfacePlan(args);
  const result = {
    action: args.action,
    execute: args.execute,
    plan,
    results: args.execute ? await runPlan(plan) : [],
  };
  process.stdout.write(
    `${args.json ? JSON.stringify(sanitizeSurfaceUpdateOutput(result), null, 2) : formatSurfaceUpdateReport(result)}\n`
  );
  if (args.execute && result.results.some((entry) => entry.ok === false)) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${sanitizeDiagnostic(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  });
}
