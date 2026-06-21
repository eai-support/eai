import {
  findGuidanceByCode,
  findGuidanceByCodeOrReason,
  listErrorGuidance,
} from './catalog.js';
import type { ErrorGuidance, GuidanceLookupInput } from './types.js';

function normalize(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

function operationMatches(expected: string | undefined, actual: string | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return normalize(actual).includes(normalize(expected));
}

function matchEntry(entry: ErrorGuidance, input: GuidanceLookupInput): boolean {
  if (!entry.match) return false;
  const message = normalize(input.message);
  const serverCode = normalize(input.serverCode);

  return entry.match.some((matcher) => {
    if (matcher.status !== undefined && matcher.status !== input.status) {
      return false;
    }
    if (matcher.operation && !operationMatches(matcher.operation, input.operation)) {
      return false;
    }
    if (matcher.serverCode && normalize(matcher.serverCode) !== serverCode) {
      return false;
    }
    if (matcher.messageIncludes?.length) {
      return matcher.messageIncludes.some((needle) => message.includes(normalize(needle)));
    }
    return true;
  });
}

export function findGuidance(input: GuidanceLookupInput): ErrorGuidance | undefined {
  if (input.code) {
    const byCode = findGuidanceByCode(input.code);
    if (byCode) return byCode;
  }
  if (input.reasonCode) {
    const byReason = findGuidanceByCodeOrReason(input.reasonCode);
    if (byReason) return byReason;
  }
  return listErrorGuidance().find((entry) => matchEntry(entry, input));
}

