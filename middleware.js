import { NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// NextAuth maintains its own CSRF token for /api/auth/* endpoints. We exempt
// only the NextAuth-managed subpaths and explicitly NOT the custom routes
// (register.js, switch-org.js) that live in the same directory but reuse the
// app's session model. This was the M11 finding: a blanket /api/auth prefix
// exemption let our own state-changing endpoints bypass CSRF checks.
const NEXTAUTH_EXEMPT_PATHS = new Set([
  '/api/auth/signin',
  '/api/auth/signout',
  '/api/auth/session',
  '/api/auth/csrf',
  '/api/auth/providers',
  '/api/auth/error',
  '/api/auth/verify-request',
  '/api/auth/_log',
]);
const NEXTAUTH_EXEMPT_PREFIXES = [
  '/api/auth/signin/',
  '/api/auth/signout/',
  '/api/auth/callback/',
];

// Endpoints that authenticate via their own non-cookie mechanism (HMAC for
// Vexa webhooks, X-Bridge-Secret for internal bridge). They are routinely
// called by non-browser clients that never send Origin or sec-fetch-site,
// so the CSRF middleware would falsely block them.
const NON_BROWSER_AUTH_PREFIXES = [
  '/api/webhooks/',
  '/api/internal/',
];
const ALLOWED_SEC_FETCH_SITE = new Set(['same-origin', 'same-site', 'none']);
const STATIC_PATH_PREFIXES = ['/_next/static', '/_next/image', '/_next/data'];
const STATIC_FILE_PATTERN = /\.[^/]+$/;

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

function isExemptPath(pathname) {
  if (NEXTAUTH_EXEMPT_PATHS.has(pathname)) return true;
  if (NEXTAUTH_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (NON_BROWSER_AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return false;
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

  // M11: state-changing requests must carry at least one trustworthy CSRF
  // signal. Modern browsers always send sec-fetch-site; cross-site fetches
  // also send Origin. Requests with neither are either non-browser clients
  // or attacker-controlled flows that strip headers — block them.
  if (!originHeader && !secFetchSite) {
    return NextResponse.json({ message: 'Cross-site request blocked' }, { status: 403 });
  }

  if (originHeader && !isSameOrigin(request, originHeader)) {
    return NextResponse.json({ message: 'Cross-site request blocked' }, { status: 403 });
  }

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
