import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@enterpriseaigroup/core/server';
import { readBoundedJsonBody, RequestBodyTooLargeError } from '@/lib/generated-workflow/bounded-body';
import { requestHasSameOrigin } from '@/lib/generated-workflow/public-guards';
import {
  createGeneratedOperationalRecord,
  OperationalCreateRejection,
  parseGeneratedOperationalCreateInput,
} from '@/lib/generated-demo/operational-create';
import { getGeneratedOperationalRuntime } from '@/lib/generated-demo/operational-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

/** Only the trusted host can submit one reviewed actor-authorized create. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!requestHasSameOrigin(request)) return failure(403, 'ORIGIN_REQUIRED');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return failure(415, 'JSON_REQUIRED');
  const resolved = getGeneratedOperationalRuntime();
  if (resolved.status !== 'ready') return failure(503, 'OPERATIONAL_BINDING_UNAVAILABLE');
  if (resolved.config.schemaVersion !== 'eai.generated_app_operational.v2')
    return failure(404, 'SELECTED_CREATE_UNAVAILABLE');
  const token = await getAccessToken();
  if (!token) return failure(401, 'AUTHENTICATION_REQUIRED');
  let input;
  try {
    input = parseGeneratedOperationalCreateInput(
      await readBoundedJsonBody(request, 16_384), resolved.createFields,
    );
  } catch (error) {
    return failure(error instanceof RequestBodyTooLargeError ? 413 : 400, 'INVALID_SELECTED_CREATE');
  }
  try {
    const created = await createGeneratedOperationalRecord(
      resolved.config, resolved.createFields, input, token, request.nextUrl.host,
    );
    return NextResponse.json(created, { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof OperationalCreateRejection)
      return failure(error.status,
        error.status === 429 ? 'CREATE_RATE_LIMITED' :
          error.status === 409 ? 'CREATE_SOURCE_NOT_READY' : 'CREATE_NOT_AUTHORIZED');
    return failure(503, 'AUTHORIZED_CREATE_UNAVAILABLE');
  }
}
