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

function tailorResourceMutationGuidance(
  guidance: ErrorGuidance,
  operation: string | undefined,
): ErrorGuidance {
  if (guidance.code !== 'E276') return guidance;

  const normalizedOperation = normalize(operation);
  const versionDiagnostic = {
    command: 'eai --version',
    purpose: 'Record the installed CLI version before retrying or escalating.',
    mutates: false,
  };
  const updateCli = {
    command: 'eai update',
    purpose: 'Install the current CLI contract implementation before one bounded retry.',
    mutates: true,
    when: 'Run when the installed CLI is not current.',
  };

  if (normalizedOperation.includes('resources.create')) {
    return {
      ...guidance,
      why: [
        'The maintained eai resources create client already sends POST with {"data": {...}}.',
        'A contract rejection from this command usually indicates CLI/server version skew or a client/server defect, not a body the developer should manually reshape.',
      ],
      diagnostics: [versionDiagnostic],
      fixes: [
        updateCli,
        {
          command: 'eai resources create <type> --data \'<json>\'',
          purpose: 'Retry the maintained create command once after confirming the CLI is current.',
          mutates: true,
        },
      ],
    };
  }

  if (normalizedOperation.includes('resources.update')) {
    return {
      ...guidance,
      why: [
        'The maintained eai resources update client already sends PUT with {"data": {...}, "version": n}.',
        'The version must be refreshed after any action or concurrent mutation; a continued contract rejection on a current CLI is a client/server defect.',
      ],
      diagnostics: [
        versionDiagnostic,
        {
          command: 'eai resources get <type> <id> --format json',
          purpose: 'Read the current resource version immediately before the update.',
          mutates: false,
        },
      ],
      fixes: [
        updateCli,
        {
          command:
            'eai resources update <type> <id> --data \'<json>\' --version <current-version>',
          purpose: 'Retry once through the maintained version-aware update command.',
          mutates: true,
        },
      ],
    };
  }

  if (normalizedOperation.includes('resources.action')) {
    return {
      ...guidance,
      why: [
        'The maintained resource action client already sends POST with {"params": {...}}.',
        'Any follow-up update must use the version returned by the action; a continued contract rejection on a current client is a client/server defect.',
      ],
      diagnostics: [versionDiagnostic],
      fixes: [
        updateCli,
        {
          command: 'Use the action result version for the next resource update',
          purpose: 'Avoid reusing the pre-action optimistic-lock version.',
          mutates: false,
        },
      ],
    };
  }

  return guidance;
}

export function findGuidance(input: GuidanceLookupInput): ErrorGuidance | undefined {
  let guidance: ErrorGuidance | undefined;
  if (input.code) {
    guidance = findGuidanceByCode(input.code);
  }
  if (!guidance && input.reasonCode) {
    guidance = findGuidanceByCodeOrReason(input.reasonCode);
  }
  guidance ??= listErrorGuidance().find((entry) => matchEntry(entry, input));
  return guidance ? tailorResourceMutationGuidance(guidance, input.operation) : undefined;
}
