import { NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_API_PREFIXES = ['/api/auth'];
const ALLOWED_SEC_FETCH_SITE = new Set(['same-origin', 'same-site', 'none']);
const STATIC_PATH_PREFIXES = ['/_next/static', '/_next/image', '/_next/data'];
const STATIC_FILE_PATTERN = /\.[^/]+$/;

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

function isExemptPath(pathname) {
  return EXEMPT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isSameOrigin(request, originHeader) {
  try {
    const originUrl = new URL(originHeader);
    const forwardedHost = request.headers.get('x-forwarded-host');
    const hostHeader = request.headers.get('host');
    const expectedHost = forwardedHost || hostHeader || request.nextUrl.host;

    const originHostname = originUrl.hostname;
    const targetHostname = expectedHost.split(':')[0];

    return originHostname === targetHostname;
  } catch {
    return false;
  }
}

function isStaticPath(pathname) {
  if (STATIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  return STATIC_FILE_PATTERN.test(pathname);
}

function generateNonce() {
  return crypto.randomUUID().replace(/-/g, '');
}

function buildContentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "script-src-attr 'none'",
    "style-src-attr 'none'",
  ].join('; ');
}

function handleApiRequest(request, pathname) {
  if (isExemptPath(pathname) || SAFE_METHODS.has(request.method)) {
    return NextResponse.next();
  }

  const originHeader = request.headers.get('origin');
  const secFetchSite = request.headers.get('sec-fetch-site');

  // Browser request with Origin must be same-origin for state-changing API calls.
  if (originHeader) {
    if (!isSameOrigin(request, originHeader)) {
      return NextResponse.json({ message: 'Cross-site request blocked' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // When Origin is absent, still block explicit cross-site browser fetch contexts.
  if (secFetchSite && !ALLOWED_SEC_FETCH_SITE.has(secFetchSite)) {
    return NextResponse.json({ message: 'Cross-site request blocked' }, { status: 403 });
  }

  return NextResponse.next();
}

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (isApiPath(pathname)) {
    return handleApiRequest(request, pathname);
  }

  if (isStaticPath(pathname)) {
    return NextResponse.next();
  }

  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  }

  return response;
}

export const config = {
  matcher: '/:path*',
};
