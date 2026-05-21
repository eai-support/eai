/**
 * Structured error codes for consistent error handling across the CLI.
 *
 * Error code categories:
 * - E001-E099: Project errors (not in EAI project, config missing)
 * - E100-E199: Auth errors (not logged in, token expired)
 * - E200-E299: Platform errors (API unreachable, resource not found)
 * - E300-E399: Validation errors (invalid schema, missing field)
 */

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
  const def = errorCatalog[code];
  const message = interpolate(def.message, context);
  const suggestion = interpolate(def.suggestion, context);

  return `${message}\n\n${suggestion}\n\nError code: ${code}`;
}

/**
 * Numeric exit code for an `ErrorCode`.
 *
 * Default behaviour is unchanged: every error exits with code 1, so existing
 * shell scripts and CI matchers (`|| exit 1`) keep working.
 *
 * Set `EAI_STABLE_EXIT_CODES=1` to opt in to category-based exit codes:
 *   E0xx → 1     (project/config — kept at 1 for legacy parity)
 *   E1xx → 101   (auth)
 *   E2xx → 201   (platform)
 *   E3xx → 121   (validation — stays under 128 so it does not collide with
 *                 the POSIX "terminated by signal N" range 128+N)
 *
 * Important: every returned code is in the 0-255 range. POSIX `wait(2)`
 * truncates exit status to the low 8 bits, so returning `305` for E305 would
 * leave `$?` showing `49` while the JSON envelope claims `305`. By returning
 * category codes that already fit in 8 bits, the JSON `exitCode` field and
 * the actual subprocess status reported by the OS are guaranteed to agree.
 *
 * Test runners use the opt-in form so they can assert on the category from
 * the exit code alone, without parsing JSON. The JSON error envelope always
 * carries the precise `Exxx` code regardless of this flag (via the `code`
 * field); only the numeric `exitCode` is folded to the category bucket.
 */
export function exitCodeFor(code: ErrorCode): number {
  if (process.env.EAI_STABLE_EXIT_CODES !== '1') return 1;
  const n = Number.parseInt(code.slice(1), 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (n < 100) return 1;     // E0xx — project / config
  if (n < 200) return 101;   // E1xx — auth
  if (n < 300) return 201;   // E2xx — platform
  if (n < 400) return 121;   // E3xx — validation (below signal range 128+)
  return 1;                  // unknown category → generic failure
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

  return {
    error: {
      code,
      message,
      suggestion,
      exitCode: exitCodeFor(code),
    },
  };
}

/**
 * Detect `--format json` from process.argv when callers do not thread the
 * format option through every helper. Lets shared exit paths (E001 in a deep
 * helper, etc.) honour `--format json` without rewiring the entire call chain.
 */
function detectFormatFromArgv(): 'text' | 'json' {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') return 'json';
    if (arg === '--format=json') return 'json';
    if (arg === '--format' && argv[i + 1] === 'json') return 'json';
  }
  return 'text';
}

/**
 * Exit with error (text or JSON format)
 */
export function exitWithError(
  code: ErrorCode,
  context?: Record<string, string>,
  format?: 'text' | 'json',
): never {
  const effectiveFormat = format ?? detectFormatFromArgv();
  if (effectiveFormat === 'json') {
    console.error(JSON.stringify(formatErrorJSON(code, context), null, 2));
  } else {
    // Import error symbol only when needed (avoids circular dependency)
    const errorSymbol = '✗';
    const errorMessage = formatError(code, context);
    console.error(`${errorSymbol} ${errorMessage}`);
  }

  process.exit(exitCodeFor(code));
}
