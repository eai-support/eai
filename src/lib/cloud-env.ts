import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAzureCliInvocation } from './azure-cli.js';

const exec = promisify(execFile);

export interface CloudEnvPullOptions {
  environment?: string;
  label: string;
  includeSecrets?: boolean;
}

export interface CloudEnvPullResult {
  store: string;
  patches: Record<string, string>;
  secretRefs: Array<{ key: string; vaultUri: string }>;
}

export interface CloudEnvSetOptions {
  environment?: string;
  label: string;
  values: Record<string, string>;
}

function resolveStoreOverride(environment: string): string | undefined {
  const normalized = environment.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return process.env[`EAI_APP_CONFIG_STORE_${normalized}`];
}

export function resolveAppConfigStore(environment?: string): string {
  const environmentOverride = environment ? resolveStoreOverride(environment) : undefined;
  const store = environmentOverride || process.env.EAI_APP_CONFIG_STORE;
  if (!store) {
    throw new Error(
      'Cloud configuration store is not configured. Set EAI_APP_CONFIG_STORE or EAI_APP_CONFIG_STORE_<LABEL> before using cloud environment sync.',
    );
  }
  return store;
}

async function execAzureCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const invocation = getAzureCliInvocation(args);
  return exec(invocation.file, invocation.args);
}

export async function pullCloudEnvValues(options: CloudEnvPullOptions): Promise<CloudEnvPullResult> {
  const store = resolveAppConfigStore(options.environment);
  const includeSecrets = options.includeSecrets ?? false;

  const { stdout } = await execAzureCli([
    'appconfig', 'kv', 'list',
    '--name', store,
    '--label', options.label,
    '--output', 'json',
  ]);

  const kvPairs: Array<{ key: string; value: string; contentType?: string }> = JSON.parse(stdout);
  const patches: Record<string, string> = {};
  const secretRefs: Array<{ key: string; vaultUri: string }> = [];

  for (const kv of kvPairs) {
    if (kv.contentType === 'application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8') {
      try {
        const ref = JSON.parse(kv.value) as { uri?: string };
        if (typeof ref.uri === 'string' && ref.uri) {
          secretRefs.push({ key: kv.key, vaultUri: ref.uri });
          if (includeSecrets) {
            const { stdout: secretValue } = await execAzureCli([
              'keyvault', 'secret', 'show',
              '--id', ref.uri,
              '--query', 'value',
              '--output', 'tsv',
            ]);
            patches[kv.key] = secretValue.trim();
          }
          continue;
        }
      } catch {
        // Fall through and treat invalid Key Vault refs as plain values.
      }
    }

    patches[kv.key] = kv.value;
  }

  return {
    store,
    patches,
    secretRefs,
  };
}

export async function setCloudEnvValues(options: CloudEnvSetOptions): Promise<{ store: string; count: number }> {
  const store = resolveAppConfigStore(options.environment);
  let count = 0;

  for (const [key, value] of Object.entries(options.values)) {
    await execAzureCli([
      'appconfig', 'kv', 'set',
      '--name', store,
      '--key', key,
      '--value', value,
      '--label', options.label,
      '--yes',
    ]);
    count++;
  }

  return { store, count };
}
