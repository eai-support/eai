/**
 * eai publicapi — advanced authenticated access to PublicAPI V4 routes.
 */

import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { findProjectRoot } from '../lib/config.js';
import { PlatformAPIClient, parseApiError, type PlatformMethod } from '../lib/api.js';
import { normalizeFormat, makeSpinner } from '../lib/context.js';
import { findGuidance } from '../lib/error-guidance/match.js';
import { formatGuidanceText, guidanceToJSON } from '../lib/error-guidance/render.js';
import { resolveActiveTenantContext, resolvePublicApiUrl } from '../lib/tenant-context.js';
import * as out from '../lib/output.js';

interface PublicApiCommandOptions {
  tenantId?: string;
  data?: string;
  file?: string;
  param?: string[];
  includeHeaders?: boolean;
  format?: string;
  json?: boolean;
}

interface DecodedResponseBody {
  body: unknown;
  bodyKind: 'json' | 'text' | 'empty';
}

const METHODS: PlatformMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

export const publicApiCommand = new Command('publicapi')
  .description('Call authorized PublicAPI V4 routes directly')
  .addHelpText('after', `
Examples:
  eai publicapi get /v4/identity/me
  eai publicapi get /v4/platform/capabilities/catalog --format json
  eai publicapi post /v4/geo/resolve-location --data '{"query":"Copenhagen"}'
  eai publicapi patch /v4/identity/me/profile --file profile.json

Notes:
  - Only /v4 PublicAPI paths are accepted.
  - Existing named commands remain preferred for common workflows.
  - Authorization is still enforced by PublicAPI and platform tenant policy.
`);

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('PublicAPI path is required.');
  }
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!normalized.startsWith('/v4/')) {
    throw new Error('Only PublicAPI V4 paths are supported. Start the path with /v4/.');
  }
  return normalized;
}

function parseQueryParams(values?: string[]): Record<string, unknown> | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const params: Record<string, unknown> = {};
  for (const value of values) {
    const separatorIndex = value.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid query parameter "${value}". Use key=value.`);
    }
    const key = value.slice(0, separatorIndex);
    const paramValue = value.slice(separatorIndex + 1);
    const existing = params[key];
    if (existing === undefined) {
      params[key] = paramValue;
    } else if (Array.isArray(existing)) {
      existing.push(paramValue);
    } else {
      params[key] = [existing, paramValue];
    }
  }
  return params;
}

async function parseRequestBody(options: PublicApiCommandOptions): Promise<unknown> {
  if (options.data && options.file) {
    throw new Error('Use either --data or --file, not both.');
  }
  if (!options.data && !options.file) {
    return undefined;
  }

  const raw = options.data ?? await readFile(options.file as string, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Request body must be valid JSON: ${detail}`, { cause: error });
  }
}

async function decodeResponseBody(response: Response): Promise<DecodedResponseBody> {
  const text = await response.text();
  if (!text) {
    return { body: null, bodyKind: 'empty' };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      return { body: JSON.parse(text), bodyKind: 'json' };
    } catch {
      return { body: text, bodyKind: 'text' };
    }
  }

  return { body: text, bodyKind: 'text' };
}

async function resolveClient(options: PublicApiCommandOptions): Promise<{
  client: PlatformAPIClient;
  publicApiUrl: string;
  tenantId: string;
}> {
  const root = await findProjectRoot();
  const publicApiUrl = await resolvePublicApiUrl(root ?? undefined);
  const context = await resolveActiveTenantContext({
    projectRoot: root ?? undefined,
    publicApiUrl,
    tenantId: options.tenantId,
    interactive: !options.tenantId,
  });

  return {
    client: new PlatformAPIClient(context.publicApiUrl, context.activeTenant.id),
    publicApiUrl: context.publicApiUrl,
    tenantId: context.activeTenant.id,
  };
}

async function runPublicApiRequest(method: PlatformMethod, path: string, options: PublicApiCommandOptions): Promise<void> {
  const format = normalizeFormat(options);
  const spinner = makeSpinner(format, `${method} ${path}`);

  try {
    const requestPath = normalizePath(path);
    const params = parseQueryParams(options.param);
    const body = await parseRequestBody(options);
    const { client, publicApiUrl, tenantId } = await resolveClient(options);
    const response = await client.requestPublicApi(requestPath, { method, body, params });

    if (!response.ok) {
      const error = await parseApiError(response);
      const guidance = findGuidance({
        operation: `${method} ${requestPath}`,
        status: error.status,
        serverCode: error.code,
        message: error.message,
      });
      const failureMessage = `${method} ${requestPath} failed: ${error.status} ${error.message}`;
      if (spinner) {
        spinner.fail(failureMessage);
      } else if (format !== 'json') {
        out.error(failureMessage);
      }
      if (format === 'json') {
        out.json({
          ok: false,
          status: error.status,
          error: {
            code: error.code,
            message: error.message,
            bodyText: error.bodyText,
          },
          request: { method, path: requestPath, publicApiUrl, tenantId },
          ...(guidance ? { guidance: guidanceToJSON(guidance) } : {}),
        });
      } else if (guidance) {
        console.error(`\n${formatGuidanceText(guidance)}`);
      }
      process.exit(1);
    }

    const decoded = await decodeResponseBody(response);
    const result = {
      ok: true,
      status: response.status,
      request: { method, path: requestPath, publicApiUrl, tenantId },
      ...(options.includeHeaders
        ? { headers: Object.fromEntries(response.headers.entries()) }
        : {}),
      body: decoded.body,
    };

    if (format === 'json') {
      out.json(result);
      return;
    }

    spinner?.succeed(`${method} ${requestPath} -> ${response.status}`);
    if (decoded.bodyKind === 'empty') {
      return;
    }
    if (decoded.bodyKind === 'json') {
      out.json(decoded.body);
      return;
    }
    out.info(String(decoded.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner?.fail(message);
    if (format === 'json') {
      out.json({ ok: false, error: { message } });
    } else if (!spinner) {
      out.error(message);
    }
    process.exit(1);
  }
}

for (const method of METHODS) {
  publicApiCommand
    .command(`${method.toLowerCase()} <path>`)
    .description(`${method} an authorized PublicAPI V4 path`)
    .option('--tenant-id <tenantId>', 'Use a specific tenant instead of the active tenant')
    .option('--data <json>', 'JSON request body')
    .option('--file <path>', 'Read JSON request body from a file')
    .option('--param <key=value>', 'Query parameter (repeatable)', (value, previous: string[]) => [...previous, value], [])
    .option('--include-headers', 'Include response headers in JSON output')
    .option('--format <format>', 'Output format (text|json)', 'text')
    .option('--json', 'Shortcut for --format json')
    .action((path: string, options: PublicApiCommandOptions) => runPublicApiRequest(method, path, options));
}
