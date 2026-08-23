export function getNpmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Windows exposes npm through a .cmd launcher. Node can resolve that launcher
 * only through cmd.exe, while npm remains a native executable on Unix hosts.
 */
export function getNpmExecOptions(
  platform: NodeJS.Platform = process.platform,
): { shell: boolean } {
  return { shell: platform === 'win32' };
}
