/**
 * Structured error codes for consistent error handling across the CLI.
 *
 * Error code categories:
 * - E001-E099: Project errors (not in EAI project, config missing)
 * - E100-E199: Auth errors (not logged in, token expired)
 * - E200-E299: Platform errors (API unreachable, resource not found)
 * - E300-E399: Validation errors (invalid schema, missing field)
 */

import { findGuidanceByCode } from './error-guidance/catalog.js';
import { guidanceToJSON, formatGuidanceText } from './error-guidance/render.js';

export enum ErrorCode {
  // E001-E099: Project errors
  E001 = 'E001',
  E002 = 'E002',
  E003 = 'E003',
  E004 = 'E004',
  E005 = 'E005',
  E006 = 'E006',

  // E100-E199: Auth errors
  E101 = 'E101',
  E102 = 'E102',
  E103 = 'E103',
  E104 = 'E104',

  // E200-E299: Platform errors
  E201 = 'E201',
  E202 = 'E202',
  E203 = 'E203',
  E204 = 'E204',
  E205 = 'E205',
  E242 = 'E242',
  E243 = 'E243',
  E250 = 'E250',
  E260 = 'E260',
  E270 = 'E270',
  E280 = 'E280',

  // E300-E399: Validation errors
  E301 = 'E301',
  E302 = 'E302',
  E303 = 'E303',
  E304 = 'E304',
  E305 = 'E305',
}

export interface ErrorDefinition {
  code: ErrorCode;
  message: string;
  suggestion: string;
}

export const errorCatalog: Record<ErrorCode, Omit<ErrorDefinition, 'code'>> = {
  // Project errors (E001-E099)
  [ErrorCode.E001]: {
    message: 'Not in an EAI project',
    suggestion: 'Run `eai init` to create a new project or navigate to an existing EAI project directory',
  },
  [ErrorCode.E002]: {
    message: '{var} environment variable not set',
    suggestion: 'Set {var} in your environment or project config. Tenant selection comes from `eai login` and `eai tenant select`, not tenant IDs in .env.local',
  },
  [ErrorCode.E003]: {
    message: 'Configuration file not found: {file}',
    suggestion: 'Ensure {file} exists in your project. Run `eai init` if this is a new project',
  },
  [ErrorCode.E004]: {
    message: 'Object Types file not found or invalid',
    suggestion: 'Create src/eai.config/object-types.ts with your type definitions',
  },
  [ErrorCode.E005]: {
    message: 'Invalid project structure',
    suggestion: 'Run `eai verify` to check your project setup',
  },
  [ErrorCode.E006]: {
    message: 'Failed to load configuration: {details}',
    suggestion: 'Check your .env.local and eai.config.ts files for syntax errors',
  },

  // Auth errors (E100-E199)
  [ErrorCode.E101]: {
    message: 'Not logged in',
    suggestion: 'Run `eai login` to authenticate with the platform',
  },
  [ErrorCode.E102]: {
    message: 'Access token expired',
    suggestion: 'Run `eai login` to refresh your authentication',
  },
  [ErrorCode.E103]: {
    message: 'Invalid credentials',
    suggestion: 'Verify your credentials and try `eai login` again',
  },
  [ErrorCode.E104]: {
    message: 'Authentication failed: {details}',
    suggestion: 'Contact your administrator or try `eai login` again',
  },

  // Platform errors (E200-E299)
  [ErrorCode.E201]: {
    message: 'Platform API unreachable: {url}',
    suggestion: 'Check your network connection and verify BASE_URL_PUBLIC_API is correct',
  },
  [ErrorCode.E202]: {
    message: '{resource} not found',
    suggestion: 'Verify the {resource} ID or name and try again',
  },
  [ErrorCode.E203]: {
    message: 'Platform API error: {details}',
    suggestion: 'Check the error details above. If the issue persists, contact support',
  },
  [ErrorCode.E204]: {
    message: 'Permission denied',
    suggestion: 'You do not have permission to perform this action. Contact your administrator',
  },
  [ErrorCode.E205]: {
    message: 'Resource conflict: {details}',
    suggestion: 'The resource already exists or conflicts with existing data',
  },
  [ErrorCode.E242]: {
    message: 'Tenant app authorization is incomplete',
    suggestion: 'Run `eai whoami`, `eai tenant list --format json`, then `eai provision entra --force --debug`',
  },
  [ErrorCode.E243]: {
    message: 'Tenant app authorization returned a platform server error',
    suggestion: 'Retry `eai provision entra --force --debug` with bounded backoff, then escalate with the request ID if the 5xx repeats',
  },
  [ErrorCode.E250]: {
    message: 'Tenant plan does not allow this builder operation',
    suggestion: 'Run `eai workflow readiness --format json` and ask a tenant administrator to update the plan if required',
  },
  [ErrorCode.E260]: {
    message: 'Object Type validation failed',
    suggestion: 'Run `eai types validate`, fix the reported Object Type definitions, then run `eai types seed`',
  },
  [ErrorCode.E270]: {
    message: 'Object Type is not published for the active tenant',
    suggestion: 'Run `eai resources schema --format json`, then `eai types seed` if the type is missing',
  },
  [ErrorCode.E280]: {
    message: 'Workflow runtime binding requires operator assistance',
    suggestion: 'Run `eai workflow status <workflow-key> --format json`, then `eai workflow request <workflow-key> --reason "<reason>"` if status is operator_required',
  },

  // Validation errors (E300-E399)
  [ErrorCode.E301]: {
    message: 'Invalid schema: {details}',
    suggestion: 'Fix the schema errors listed above',
  },
  [ErrorCode.E302]: {
    message: 'Validation failed: {details}',
    suggestion: 'Correct the validation errors and try again',
  },
  [ErrorCode.E303]: {
    message: 'Required field missing: {field}',
    suggestion: 'Provide a value for {field}',
  },
  [ErrorCode.E304]: {
    message: 'Invalid format: {details}',
    suggestion: 'Valid formats are: {validFormats}',
  },
  [ErrorCode.E305]: {
    message: 'Invalid input: {details}',
    suggestion: 'Check your input and try again',
  },
};

/**
 * Interpolate context variables into error message template
 */
function interpolate(template: string, context?: Record<string, string>): string {
  if (!context) return template;

  return Object.entries(context).reduce((result, [key, value]) => {
    return result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }, template);
}

/**
 * Format error for text output
 */
export function formatError(
  code: ErrorCode,
  context?: Record<string, string>,
): string {
  const guidance = findGuidanceByCode(code);
  if (guidance) {
    return formatGuidanceText(guidance, context);
  }

  const def = errorCatalog[code];
  const message = interpolate(def.message, context);
  const suggestion = interpolate(def.suggestion, context);

  return `${message}\n\n${suggestion}\n\nError code: ${code}`;
}

/**
 * Format error for JSON output
 */
export function formatErrorJSON(
  code: ErrorCode,
  context?: Record<string, string>,
): object {
  const def = errorCatalog[code];
  const message = interpolate(def.message, context);
  const suggestion = interpolate(def.suggestion, context);
  const guidance = findGuidanceByCode(code);

  return {
    error: {
      code,
      message,
      suggestion,
      ...(guidance ? { guidance: guidanceToJSON(guidance, context) } : {}),
      exitCode: 1,
    },
  };
}

/**
 * Exit with error (text or JSON format)
 */
export function exitWithError(
  code: ErrorCode,
  context?: Record<string, string>,
  format?: 'text' | 'json',
): never {
  if (format === 'json') {
    console.error(JSON.stringify(formatErrorJSON(code, context), null, 2));
  } else {
    // Import error symbol only when needed (avoids circular dependency)
    const errorSymbol = '✗';
    const errorMessage = formatError(code, context);
    console.error(`${errorSymbol} ${errorMessage}`);
  }

  process.exit(1);
}
