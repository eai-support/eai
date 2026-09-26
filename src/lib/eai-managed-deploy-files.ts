import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EAI_MANAGED_EVIDENCE_SCRIPT_PATH,
  EAI_MANAGED_WORKFLOW_PATH,
  type CanonicalInstallResult,
} from './eai-managed-deploy-contract.js';
import {
  assertRegularTarget,
  fileMatches,
  isContained,
  prepareProjectTarget,
  writeAtomically,
} from './eai-managed-deploy-filesystem.js';

const GOVERNED_ROOT_FILES = ['eai.config.ts', 'eai.runtime.json'] as const;
const GOVERNED_CONFIG_ROOT = 'src/eai.config';
const GENERATED_CONFIG_FILES = new Set([
  'src/eai.config/object-types.json',
  'src/eai.config/object-types.provisioning.json',
]);

async function assertGovernedAncestors(root: string, relativePath: string): Promise<boolean> {
  const rootStatus = await lstat(root);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error('Application root must be a no-follow directory.');
  }
  const components = relativePath.split('/').filter(Boolean);
  let current = root;
  for (const component of components.slice(0, -1)) {
    current = join(current, component);
    let status;
    try {
      status = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new Error(`Governed configuration ancestor must be a regular directory: ${relativePath}`);
    }
  }
  return true;
}

async function governedAncestorIdentities(
  root: string,
  relativePath: string,
): Promise<Array<{ path: string; dev: number; ino: number }>> {
  if (!await assertGovernedAncestors(root, relativePath)) return [];
  const identities: Array<{ path: string; dev: number; ino: number }> = [];
  const components = relativePath.split('/').filter(Boolean);
  let current = root;
  for (const component of ['', ...components.slice(0, -1)]) {
    if (component) current = join(current, component);
    const status = await lstat(current);
    identities.push({ path: current, dev: status.dev, ino: status.ino });
  }
  return identities;
}

async function assertGovernedAncestorIdentities(
  identities: ReadonlyArray<{ path: string; dev: number; ino: number }>,
  relativePath: string,
): Promise<void> {
  for (const identity of identities) {
    const status = await lstat(identity.path);
    if (!status.isDirectory() || status.isSymbolicLink()
      || status.dev !== identity.dev || status.ino !== identity.ino) {
      throw new Error(`Governed configuration path changed before its no-follow read: ${relativePath}`);
    }
  }
}

/** Resolve packaged resources from both source and compiled CLI module locations. */
export function canonicalManagedDeployResourceRoot(): string {
  return fileURLToPath(new URL('../../resources/deploy/eai-app-template/', import.meta.url));
}

/** Install the reviewed workflow and evidence collector as one versioned pair. */
export async function installCanonicalManagedDeployFiles(
  projectRoot: string,
  workflowPath = EAI_MANAGED_WORKFLOW_PATH,
): Promise<CanonicalInstallResult> {
  const canonicalRoot = canonicalManagedDeployResourceRoot();
  const files = [
    { source: join(canonicalRoot, EAI_MANAGED_WORKFLOW_PATH), target: workflowPath },
    { source: join(canonicalRoot, EAI_MANAGED_EVIDENCE_SCRIPT_PATH), target: EAI_MANAGED_EVIDENCE_SCRIPT_PATH },
  ];
  const result: CanonicalInstallResult = { changed: [], unchanged: [], pendingUpdates: [] };

  for (const file of files) {
    const source = resolve(canonicalRoot, file.source);
    const target = resolve(projectRoot, file.target);
    if (!isContained(canonicalRoot, source) || !isContained(projectRoot, target)) {
      throw new Error('Canonical deployment file resolved outside its allowed root.');
    }
    await prepareProjectTarget(resolve(projectRoot), target);
    if (await fileMatches(source, target)) {
      result.unchanged.push(file.target);
      continue;
    }
    let targetExists = true;
    try {
      await access(target);
    } catch {
      targetExists = false;
    }
    if (targetExists) {
      const candidate = `${target}.eai-update`;
      await assertRegularTarget(candidate);
      await writeAtomically(candidate, await readFile(source));
      result.pendingUpdates.push(`${file.target}.eai-update`);
    } else {
      await writeAtomically(target, await readFile(source));
      result.changed.push(file.target);
    }
  }
  return result;
}

/** Match the canonical workflow's ordered config hashing algorithm. */
export async function buildManagedDeployConfigHash(projectRoot: string): Promise<string> {
  const root = resolve(projectRoot);
  const paths: string[] = [];
  for (const relativePath of GOVERNED_ROOT_FILES) {
    await assertGovernedAncestors(root, relativePath);
    const path = join(root, relativePath);
    try {
      const status = await lstat(path);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new Error(`Governed configuration must be a regular file: ${relativePath}`);
      }
      paths.push(relativePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async function visit(relativeDirectory: string): Promise<void> {
    if (!await assertGovernedAncestors(root, relativeDirectory)) return;
    const directory = join(root, relativeDirectory);
    let status;
    try {
      status = await lstat(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error(`Governed configuration root must be a regular directory: ${relativeDirectory}`);
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      const entryStatus = await lstat(join(root, relativePath));
      if (entryStatus.isSymbolicLink()) {
        throw new Error(`Governed configuration cannot be a symlink: ${relativePath}`);
      }
      if (entryStatus.isDirectory()) await visit(relativePath);
      else if (!entryStatus.isFile()) {
        throw new Error(`Governed configuration entry must be a regular file or directory: ${relativePath}`);
      } else if (!GENERATED_CONFIG_FILES.has(relativePath)) paths.push(relativePath);
    }
  }
  await visit(GOVERNED_CONFIG_ROOT);
  if (!paths.includes('eai.runtime.json')) {
    throw new Error('eai.runtime.json is required for EAI managed deployment.');
  }

  const hash = createHash('sha256');
  for (const relativePath of [...new Set(paths)].sort()) {
    const ancestors = await governedAncestorIdentities(root, relativePath);
    if (!ancestors.length) {
      throw new Error(`Governed configuration ancestor does not exist: ${relativePath}`);
    }
    hash.update(relativePath);
    hash.update('\0');
    const path = join(root, relativePath);
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error(`Governed configuration must be a regular file: ${relativePath}`);
    }
    const [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(path)]);
    if (!isContained(canonicalRoot, canonicalPath)) {
      throw new Error(`Governed configuration file resolved outside the application root: ${relativePath}`);
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const status = await handle.stat();
      if (!status.isFile() || status.dev !== before.dev || status.ino !== before.ino) {
        throw new Error(`Governed configuration changed before its no-follow read: ${relativePath}`);
      }
      await assertGovernedAncestorIdentities(ancestors, relativePath);
      const [rebound, reboundRoot, reboundPath] = await Promise.all([
        lstat(path),
        realpath(root),
        realpath(path),
      ]);
      if (rebound.isSymbolicLink() || rebound.dev !== status.dev || rebound.ino !== status.ino
        || !isContained(reboundRoot, reboundPath)) {
        throw new Error(`Governed configuration path changed before its no-follow read: ${relativePath}`);
      }
      hash.update(await handle.readFile());
    } finally {
      await handle.close();
    }
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}
