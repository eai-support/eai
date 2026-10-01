import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

// API routes that require authentication
const PROTECTED_API_ROUTES = ['/api/eai/v4/identity/'];

// Routes that should bypass auth check
const PUBLIC_ROUTES = [
  '/api/auth',
  '/api/eai/config',
  '/api/eai/stream',
  '/_next',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);

  // Skip public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Protect API routes
  if (PROTECTED_API_ROUTES.some((route) => pathname.startsWith(route))) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
