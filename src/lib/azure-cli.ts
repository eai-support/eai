export interface CommandInvocation {
  readonly file: string;
  readonly args: string[];
}

export function getAzureCliInvocation(
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CommandInvocation {
  if (platform === 'win32') {
    return {
      file: 'cmd.exe',
      args: ['/c', 'az', ...args],
    };
  }

  return {
    file: 'az',
    args,
  };
}
