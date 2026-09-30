import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@enterpriseaigroup/core/server';
import { getGeneratedOperationalRuntime } from '@/lib/generated-demo/operational-runtime';
import { readGeneratedOperationalRows } from '@/lib/generated-demo/operational-read';

export const dynamic = 'force-dynamic';

/** Read-only, same-origin projection; no credentials or platform URL enter the demo frame. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };
  const runtime = getGeneratedOperationalRuntime();
  if (runtime.status !== 'ready') {
    return NextResponse.json({ error: 'OPERATIONAL_BINDING_UNAVAILABLE' }, {
      status: 503, headers,
    });
  }
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, {
    status: 401, headers,
  });
  try {
    const rows = await readGeneratedOperationalRows(
      runtime.config,
      token,
      request.nextUrl.host,
      runtime.projectedFields,
    );
    return NextResponse.json(rows, { headers });
  } catch {
    // Do not reveal tenant, Object Type, routing, or provider details to a caller.
    return NextResponse.json({ error: 'AUTHORIZED_READ_UNAVAILABLE' }, {
      status: 503, headers,
    });
  }
}
