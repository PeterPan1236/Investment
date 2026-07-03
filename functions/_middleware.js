const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const ipRequestCounts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  // Prune expired windows so the map cannot grow without bound.
  if (ipRequestCounts.size > 1000) {
    for (const [key, value] of ipRequestCounts) {
      if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) ipRequestCounts.delete(key);
    }
  }
  const rec = ipRequestCounts.get(ip);
  if (!rec || now - rec.windowStart >= RATE_LIMIT_WINDOW_MS) {
    ipRequestCounts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT_MAX;
}

function isAllowedCorsOrigin(origin, configuredOrigins) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const configuredOrigins = (env.CORS_ORIGIN || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  if (request.method === 'OPTIONS' && origin) {
    const preflightHeaders = new Headers();
    if (isAllowedCorsOrigin(origin, configuredOrigins)) {
      preflightHeaders.set('Access-Control-Allow-Origin', origin);
      preflightHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      preflightHeaders.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'Content-Type');
      preflightHeaders.set('Access-Control-Max-Age', '86400');
      preflightHeaders.set('Vary', 'Origin');
    }
    return new Response(null, { status: 204, headers: preflightHeaders });
  }

  if (url.pathname.startsWith('/api/')) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(ip)) {
      return Response.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
    }
  }

  const response = await next();
  const headers = new Headers(response.headers);

  if (isAllowedCorsOrigin(origin, configuredOrigins) && origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );

  return new Response(response.body, { status: response.status, headers });
}
