import operationalConfig from '@/eai.config/generated-operational.json';
import { generatedWorkflowAppKey } from '@/lib/generated-workflow/runtime';
import { getGeneratedDemoRuntime } from './runtime';
import {
  resolveGeneratedOperationalRuntime,
  type GeneratedOperationalResolution,
} from './operational-contract';

/** A missing server-owned tenant identity never enables a live data binding. */
export function getGeneratedOperationalRuntime(): GeneratedOperationalResolution {
  const config: unknown = operationalConfig;
  if (config === null) return { status: 'unconfigured' };
  if (process.env.EAI_GENERATED_OPERATIONAL_READ_ENABLED !== 'true') {
    return { status: 'invalid', errors: ['operational reads are not enabled'] };
  }
  if (typeof config === 'object' && 'schemaVersion' in config && config.schemaVersion ===
      'eai.generated_app_operational.v2' &&
      process.env.EAI_GENERATED_OPERATIONAL_CREATE_ENABLED !== 'true') {
    return { status: 'invalid', errors: ['operational creates are not enabled'] };
  }
  const demo = getGeneratedDemoRuntime();
  if (demo.status !== 'ready')
    return { status: 'invalid', errors: ['accepted demo artifact is unavailable'] };
  return resolveGeneratedOperationalRuntime(
    config,
    demo.artifact,
    process.env.EAI_TENANT_ID || process.env.TENANT_DEFAULT_ID,
    generatedWorkflowAppKey(),
  );
}
