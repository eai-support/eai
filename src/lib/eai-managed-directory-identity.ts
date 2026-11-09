import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";

export interface ManagedDirectoryIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly systemAliasTarget?: {
    readonly path: string;
    readonly dev: number;
    readonly ino: number;
  };
}

/** Fixed aliases created by macOS itself; caller-created root links are excluded. */
export function managedSystemAliasTarget(
  path: string,
  platform = process.platform,
): string | undefined {
  if (platform !== "darwin") return undefined;
  if (path === "/tmp") return "/private/tmp";
  if (path === "/var") return "/private/var";
  return undefined;
}

function sameIdentity(
  status: Stats,
  identity: { readonly dev: number; readonly ino: number },
): boolean {
  return status.dev === identity.dev && status.ino === identity.ino;
}

/** Bind a regular directory or one exact macOS system alias and its target. */
export async function bindManagedDirectoryIdentity(
  path: string,
  filesystemRoot: string,
  status: Stats,
  errorMessage: string,
): Promise<ManagedDirectoryIdentity> {
  if (status.isDirectory() && !status.isSymbolicLink()) {
    return { path, dev: status.dev, ino: status.ino };
  }
  const expectedTarget =
    status.isSymbolicLink() && dirname(path) === filesystemRoot
      ? managedSystemAliasTarget(path)
      : undefined;
  if (!expectedTarget || (await realpath(path)) !== expectedTarget) {
    throw new Error(errorMessage);
  }
  const [reboundAlias, target] = await Promise.all([
    lstat(path),
    lstat(expectedTarget),
  ]);
  if (
    !reboundAlias.isSymbolicLink() ||
    !sameIdentity(reboundAlias, status) ||
    !target.isDirectory() ||
    target.isSymbolicLink() ||
    (await realpath(path)) !== expectedTarget
  ) {
    throw new Error(errorMessage);
  }
  return {
    path,
    dev: status.dev,
    ino: status.ino,
    systemAliasTarget: {
      path: expectedTarget,
      dev: target.dev,
      ino: target.ino,
    },
  };
}

/** Revalidate the directory plus both sides of an allowed system alias. */
export async function assertManagedDirectoryIdentity(
  identity: ManagedDirectoryIdentity,
  errorMessage: string,
): Promise<void> {
  const status = await lstat(identity.path);
  if (!identity.systemAliasTarget) {
    if (
      !status.isDirectory() ||
      status.isSymbolicLink() ||
      !sameIdentity(status, identity)
    ) {
      throw new Error(errorMessage);
    }
    return;
  }
  const target = await lstat(identity.systemAliasTarget.path);
  if (
    !status.isSymbolicLink() ||
    !sameIdentity(status, identity) ||
    managedSystemAliasTarget(identity.path) !== identity.systemAliasTarget.path ||
    (await realpath(identity.path)) !== identity.systemAliasTarget.path ||
    !target.isDirectory() ||
    target.isSymbolicLink() ||
    !sameIdentity(target, identity.systemAliasTarget)
  ) {
    throw new Error(errorMessage);
  }
}
