import { normalizeGuidanceIdentifier } from './catalog.js';
import type { ErrorGuidance } from './types.js';

const FORBIDDEN_PUBLIC_TERMS = [
  ['Config', 'urator'].join(''),
  ['Payload', 'CMS'].join(''),
  ['O', 'PA'].join(''),
  ['Re', 'go'].join(''),
  ['AI', 'Core'].join(''),
  ['Hy', 'PE'].join(''),
  'api.ae.',
  'dev-api.',
  'test-api.',
];

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(allStrings);
  }
  return [];
}

function serverCodeAliases(entry: ErrorGuidance): string[] {
  return (entry.match ?? []).flatMap((matcher) => (matcher.serverCode ? [matcher.serverCode] : []));
}

/** `errors explain` resolves a server code to one entry, so an alias must have exactly one owner. */
function validateServerCodeAliases(entries: readonly ErrorGuidance[]): string[] {
  const issues: string[] = [];
  const owners = new Map<string, string>();

  for (const entry of entries) {
    for (const alias of serverCodeAliases(entry)) {
      const normalized = normalizeGuidanceIdentifier(alias);
      const owner = owners.get(normalized);
      if (owner !== undefined && owner !== entry.code) {
        issues.push(`${entry.code} claims server code ${alias} already used by ${owner}.`);
        continue;
      }
      owners.set(normalized, entry.code);

      const shadowed = entries.find(
        (other) =>
          other.code !== entry.code &&
          (normalizeGuidanceIdentifier(other.code) === normalized ||
            normalizeGuidanceIdentifier(other.reasonCode) === normalized),
      );
      if (shadowed) {
        issues.push(`${entry.code} server code ${alias} shadows the code or reason of ${shadowed.code}.`);
      }
    }
  }

  return issues;
}

export function validateErrorGuidanceCatalog(entries: readonly ErrorGuidance[]): string[] {
  const issues: string[] = [];
  const codes = new Set<string>();
  const reasons = new Set<string>();

  for (const entry of entries) {
    if (codes.has(entry.code)) {
      issues.push(`Duplicate guidance code: ${entry.code}`);
    }
    codes.add(entry.code);

    if (reasons.has(entry.reasonCode)) {
      issues.push(`Duplicate guidance reasonCode: ${entry.reasonCode}`);
    }
    reasons.add(entry.reasonCode);

    if (!entry.publicSafe || !entry.safety.publicSafe) {
      issues.push(`${entry.code} must be marked public safe before packaging.`);
    }
    if (entry.why.length === 0) {
      issues.push(`${entry.code} must explain why the error might happen.`);
    }
    if (entry.diagnostics.length === 0 && entry.fixes.length === 0) {
      issues.push(`${entry.code} must include at least one diagnostic or fix command.`);
    }
    if (entry.retry.stopWhen.length === 0) {
      issues.push(`${entry.code} must include a stop condition.`);
    }
    if (entry.escalation.include.length === 0) {
      issues.push(`${entry.code} must say what evidence to escalate with.`);
    }

    const text = allStrings(entry).join('\n');
    for (const term of FORBIDDEN_PUBLIC_TERMS) {
      if (text.includes(term)) {
        issues.push(`${entry.code} contains forbidden public term: ${term}`);
      }
    }
  }

  return [...issues, ...validateServerCodeAliases(entries)];
}
