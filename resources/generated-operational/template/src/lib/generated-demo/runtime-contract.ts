import { createHash } from 'node:crypto';
import type { GeneratedDemoArtifact } from './contract';

export type GeneratedDemoRuntimeResolution =
  | { status: 'unconfigured' }
  | { status: 'invalid'; errors: string[] }
  | { status: 'ready'; artifact: GeneratedDemoArtifact };

const APP_KEY_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SOURCE_PATH_PATTERN =
  /^src\/generated\/[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(?:ts|tsx|css)$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonSafe(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonSafe);
  return record(value) && Object.values(value).every(jsonSafe);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function demoArtifactDigest(value: unknown): `sha256:${string}` {
  if (!jsonSafe(value)) throw new Error('demo artifact must be JSON-safe');
  return `sha256:${createHash('sha256')
    .update(`${canonical(value)}\n`, 'utf8')
    .digest('hex')}`;
}

/** Binds the hosted demo to the exact accepted brief, source, fixtures and definition proposal. */
export function resolveGeneratedDemoRuntime(
  value: unknown,
  expectedAppKey: string,
): GeneratedDemoRuntimeResolution {
  if (value === null || value === undefined) return { status: 'unconfigured' };
  const errors: string[] = [];
  if (
    !record(value) ||
    value.schemaVersion !== 'eai.generated_app_artifact.v2'
  ) {
    return { status: 'invalid', errors: ['artifact schema is unsupported'] };
  }

  const definition = value.appDefinition;
  if (
    !record(definition) ||
    definition.schemaVersion !== 'eai.generated_app_definition.v2'
  ) {
    errors.push('app definition schema is unsupported');
  } else {
    if (
      typeof definition.appKey !== 'string' ||
      !APP_KEY_PATTERN.test(definition.appKey) ||
      definition.appKey !== expectedAppKey
    ) {
      errors.push('app key does not match deployed identity');
    }
    if (
      typeof definition.appName !== 'string' ||
      !definition.appName.trim() ||
      definition.appName.length > 120
    ) {
      errors.push('app name is invalid');
    }
    if (definition.entryPath !== 'src/generated/app.tsx')
      errors.push('source entry is unsupported');
    const card = definition.businessCard;
    if (
      !record(card) ||
      !['description', 'goal', 'audience', 'outcome'].every(
        (key) =>
          typeof card[key] === 'string' &&
          Boolean((card[key] as string).trim()) &&
          (card[key] as string).length <= 2000,
      )
    ) {
      errors.push('consultant brief is invalid');
    } else {
      for (const name of [
        'valueHypothesis',
        'successMeasure',
        'recommendedFirstSlice',
      ]) {
        if (
          card[name] !== undefined &&
          (typeof card[name] !== 'string' ||
            (card[name] as string).length > 2000)
        ) {
          errors.push('consultant brief is invalid');
        }
      }
      if (
        card.assumptions !== undefined &&
        (!Array.isArray(card.assumptions) ||
          card.assumptions.length > 20 ||
          !card.assumptions.every(
            (assumption) =>
              typeof assumption === 'string' &&
              Boolean(assumption.trim()) &&
              assumption.length <= 500,
          ))
      ) {
        errors.push('consultant brief is invalid');
      }
    }
    const views = definition.views;
    const steps = record(definition.workflow)
      ? definition.workflow.steps
      : undefined;
    if (
      !Array.isArray(views) ||
      views.length < 1 ||
      views.length > 100 ||
      !Array.isArray(steps) ||
      steps.length < 1 ||
      steps.length > 100
    ) {
      errors.push('workflow views and steps are invalid');
    } else {
      const viewIds = new Set<string>();
      const stepIds = new Set<string>();
      const componentIds = new Set<string>();
      const dataBindings: Array<Record<string, unknown>> = [];
      let trustedSlotCount = 0;
      for (const view of views) {
        if (
          !record(view) ||
          typeof view.id !== 'string' ||
          !ID_PATTERN.test(view.id) ||
          viewIds.has(view.id) ||
          typeof view.title !== 'string' ||
          !view.title.trim() ||
          view.title.length > 120 ||
          !Array.isArray(view.componentIds) ||
          !view.componentIds.every(
            (id) => typeof id === 'string' && ID_PATTERN.test(id),
          )
        ) {
          errors.push('view is invalid or duplicated');
          continue;
        }
        viewIds.add(view.id);
        for (const id of view.componentIds as string[]) {
          if (componentIds.has(id)) errors.push('component id is duplicated');
          componentIds.add(id);
        }
        if (view.dataBindings !== undefined) {
          if (!Array.isArray(view.dataBindings) || view.dataBindings.length > 16) {
            errors.push('view data bindings are invalid');
          } else {
            const boundComponents = new Set<string>();
            for (const binding of view.dataBindings) {
              if (!record(binding) ||
                  Object.keys(binding).sort().join('|') !== 'componentId|fixtureCollection|objectTypeSlug' ||
                  typeof binding.componentId !== 'string' ||
                  !(view.componentIds as string[]).includes(binding.componentId) ||
                  boundComponents.has(binding.componentId) ||
                  typeof binding.fixtureCollection !== 'string' ||
                  !ID_PATTERN.test(binding.fixtureCollection) ||
                  typeof binding.objectTypeSlug !== 'string' ||
                  !ID_PATTERN.test(binding.objectTypeSlug)) {
                errors.push('view data binding does not name an accepted component');
                continue;
              }
              boundComponents.add(binding.componentId);
              dataBindings.push(binding);
            }
          }
        }
        if (view.trustedLayout !== undefined) {
          const layout = view.trustedLayout;
          if (!record(layout) || Object.keys(layout).sort().join('|') !== 'columns|slots' ||
              ![1, 2, 3].includes(layout.columns as number) ||
              !Array.isArray(layout.slots) || layout.slots.length > 16) {
            errors.push('view trusted layout is invalid');
          } else {
            trustedSlotCount += layout.slots.length;
            const slotIds = new Set<string>();
            for (const slot of layout.slots) {
              if (!record(slot) ||
                  Object.keys(slot).some((key) => !['componentId', 'kind', 'title', 'columnSpan', 'text'].includes(key)) ||
                  typeof slot.componentId !== 'string' ||
                  !(view.componentIds as string[]).includes(slot.componentId) ||
                  slotIds.has(slot.componentId) ||
                  (slot.kind !== 'read-table' && slot.kind !== 'static-copy') ||
                  typeof slot.title !== 'string' || !slot.title.trim() || slot.title.length > 120 ||
                  (slot.columnSpan !== undefined && (![1, 2, 3].includes(slot.columnSpan as number) ||
                    (slot.columnSpan as number) > (layout.columns as number))) ||
                  (slot.kind === 'static-copy' && (typeof slot.text !== 'string' ||
                    !slot.text.trim() || slot.text.length > 2000)) ||
                  (slot.kind === 'read-table' && (slot.text !== undefined ||
                    !Array.isArray(view.dataBindings) ||
                    !view.dataBindings.some((binding: unknown) => record(binding) && binding.componentId === slot.componentId)))) {
                errors.push('view trusted layout contains an invalid slot');
                continue;
              }
              slotIds.add(slot.componentId);
            }
          }
        }
      }
      for (const step of steps) {
        if (
          !record(step) ||
          typeof step.id !== 'string' ||
          !ID_PATTERN.test(step.id) ||
          stepIds.has(step.id) ||
          typeof step.title !== 'string' ||
          !step.title.trim() ||
          step.title.length > 120 ||
          !viewIds.has(String(step.viewId))
        ) {
          errors.push('workflow step is invalid or duplicated');
          continue;
        }
        stepIds.add(step.id);
      }
      if (dataBindings.length > 128) errors.push('view data bindings exceed artifact limit');
      if (trustedSlotCount > 128) errors.push('view trusted layout slots exceed artifact limit');
      for (const binding of dataBindings) {
        if (!record(value.previewFixtures) ||
            !record(value.previewFixtures.collections) ||
            !Object.hasOwn(value.previewFixtures.collections, String(binding.fixtureCollection)) ||
            !Array.isArray(value.objectTypeDefinitions) ||
            value.objectTypeDefinitions.filter((item: unknown) =>
              record(item) && item.slug === binding.objectTypeSlug).length !== 1) {
          errors.push('view data binding is outside accepted fixtures or Object Types');
        }
      }
    }
  }

  const source = value.sourceBundle;
  if (
    !record(source) ||
    source.schemaVersion !== 'eai.generated_app_source.v1' ||
    !Array.isArray(source.files) ||
    source.files.length < 1 ||
    source.files.length > 64
  ) {
    errors.push('source bundle is invalid');
  } else {
    const paths = new Set<string>();
    let bytes = 0;
    for (const file of source.files) {
      if (
        !record(file) ||
        typeof file.path !== 'string' ||
        !SOURCE_PATH_PATTERN.test(file.path) ||
        file.path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        paths.has(file.path) ||
        typeof file.content !== 'string' ||
        !file.content.trim()
      ) {
        errors.push('source file is invalid or duplicated');
        continue;
      }
      paths.add(file.path);
      const fileBytes = Buffer.byteLength(file.content, 'utf8');
      if (fileBytes > 128_000) errors.push('source file exceeds size budget');
      bytes += fileBytes;
    }
    if (!paths.has('src/generated/app.tsx'))
      errors.push('source entry is missing');
    if (bytes > 1_000_000) errors.push('source bundle exceeds size budget');
  }

  const fixtures = value.previewFixtures;
  if (
    !record(fixtures) ||
    fixtures.schemaVersion !== 'eai.generated_app_fixtures.v1' ||
    !record(fixtures.collections) ||
    !record(fixtures.actions) ||
    !jsonSafe(fixtures)
  ) {
    errors.push('demo fixtures are invalid');
  } else {
    if (Buffer.byteLength(canonical(fixtures), 'utf8') > 500_000)
      errors.push('demo fixtures exceed size budget');
    for (const [name, rows] of Object.entries(fixtures.collections)) {
      if (
        !ID_PATTERN.test(name) ||
        !Array.isArray(rows) ||
        rows.length > 1000 ||
        !rows.every(record)
      )
        errors.push('demo collection is invalid');
    }
    for (const [name, action] of Object.entries(fixtures.actions)) {
      if (
        !ID_PATTERN.test(name) ||
        !record(action) ||
        !['none', 'session-local'].includes(String(action.effect)) ||
        typeof action.message !== 'string' ||
        action.message.length > 500
      )
        errors.push('demo action is invalid');
    }
  }

  const definitions = value.objectTypeDefinitions;
  if (
    !Array.isArray(definitions) ||
    definitions.length > 100 ||
    !definitions.every(record) ||
    !jsonSafe(definitions)
  ) {
    errors.push('object type definitions are invalid');
  } else if (Buffer.byteLength(canonical(definitions), 'utf8') > 500_000) {
    errors.push('object type definitions exceed size budget');
  } else if (
    definitions.some((item) =>
      ['sampleRows', 'fixtureRows', 'seedData', 'records'].some(
        (key) => key in item,
      ),
    )
  ) {
    errors.push('object type definitions contain sample records');
  }

  const digests = value.digests;
  if (!record(digests)) {
    errors.push('artifact digests are missing');
  } else {
    for (const name of [
      'appDefinition',
      'sourceBundle',
      'previewFixtures',
      'objectTypeDefinitions',
    ] as const) {
      const digest = digests[name];
      if (
        typeof digest !== 'string' ||
        !DIGEST_PATTERN.test(digest) ||
        !jsonSafe(value[name]) ||
        digest !== demoArtifactDigest(value[name])
      ) {
        errors.push(`${name} digest does not match`);
      }
    }
  }

  return errors.length
    ? { status: 'invalid', errors }
    : { status: 'ready', artifact: value as unknown as GeneratedDemoArtifact };
}
