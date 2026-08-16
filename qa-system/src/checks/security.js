import { emptyEvidence } from '../evidence/types.js';

/**
 * Read-only, non-destructive security checks, grounded in the OWASP Web Security
 * Testing Guide. Everything here inspects what the server already sends to any
 * browser: response headers, cookie flags, and the JavaScript and HTML delivered
 * to the client. Nothing is injected, nothing is brute forced, no other tenant
 * is touched. Findings are reported for remediation, never exploited.
 *
 * These run over plain HTTP, so they need no login and can run on their own
 * (`npm run security`) as well as inside a full run.
 */

function result(id, title, ok, severity, expected, actual, notes) {
  const evidence = emptyEvidence();
  if (notes) evidence.notes = notes;
  return {
    id,
    title,
    category: 'security',
    outcome: ok ? 'pass' : 'fail',
    severity,
    expected,
    actual,
    assertionExercised: true,
    evidence,
  };
}

// --- Header and cookie checks over one fetched response ------------------------

function checkCsp(headers) {
  const csp = headers.get('content-security-policy');
  const reportOnly = headers.get('content-security-policy-report-only');
  if (!csp && !reportOnly) {
    return result(
      'security.headers.csp',
      'Content-Security-Policy is present and enforced',
      false,
      'high',
      'An enforced CSP that restricts script and object sources',
      'No Content-Security-Policy header at all',
    );
  }
  if (!csp && reportOnly) {
    return result(
      'security.headers.csp',
      'Content-Security-Policy is present and enforced',
      false,
      'medium',
      'An enforced CSP (not report-only)',
      'CSP is Report-Only, so it is monitored but not enforced',
    );
  }
  // Enforced CSP present; flag the common weakening directives.
  const weaknesses = [];
  // The important one: a CSP with neither script-src nor default-src does not
  // restrict where scripts load from, so it gives no XSS mitigation at all -
  // even though a header is technically "present". (e.g. `frame-ancestors 'self'`
  // alone only stops framing.)
  if (!/\bscript-src\b/.test(csp) && !/\bdefault-src\b/.test(csp)) {
    weaknesses.push('no script-src or default-src, so script sources are unrestricted (no XSS mitigation)');
  }
  if (/'unsafe-inline'/.test(csp)) weaknesses.push("script/style allows 'unsafe-inline'");
  if (/'unsafe-eval'/.test(csp)) weaknesses.push("allows 'unsafe-eval'");
  if (/\bdefault-src\s+\*/.test(csp)) weaknesses.push('default-src is wildcard');
  return result(
    'security.headers.csp',
    'Content-Security-Policy is present and enforced',
    weaknesses.length === 0,
    weaknesses.length > 0 ? 'medium' : 'info',
    'An enforced CSP without unsafe-inline / unsafe-eval / wildcard sources',
    weaknesses.length === 0
      ? 'CSP enforced with no obvious weakening directives'
      : `CSP enforced but weakened: ${weaknesses.join(', ')}`,
    weaknesses.length > 0 ? [csp.slice(0, 300)] : undefined,
  );
}
function checkSimpleHeader(headers, id, header, title, severity, validate) {
  const value = headers.get(header);
  const present = value !== null && (validate ? validate(value) : true);
  return result(
    id,
    title,
    present,
    severity,
    `${header} is set${validate ? ' to a safe value' : ''}`,
    value ? `${header}: ${value}` : `${header} is absent`,
  );
}
function checkFrameProtection(headers) {
  const xfo = headers.get('x-frame-options');
  const csp = headers.get('content-security-policy') ?? '';
  const framed = /frame-ancestors/.test(csp);
  const ok = !!xfo || framed;
  return result(
    'security.headers.frame',
    'Clickjacking protection is present',
    ok,
    'medium',
    'X-Frame-Options or a CSP frame-ancestors directive',
    ok
      ? `Protected via ${xfo ? `X-Frame-Options: ${xfo}` : 'CSP frame-ancestors'}`
      : 'Neither X-Frame-Options nor CSP frame-ancestors is present',
  );
}
function checkPoweredBy(headers) {
  const value = headers.get('x-powered-by');
  return result(
    'security.headers.powered-by',
    'Server does not disclose its framework via X-Powered-By',
    !value,
    'low',
    'No X-Powered-By header (framework and version not advertised)',
    value ? `X-Powered-By: ${value} (discloses the stack; remove it)` : 'X-Powered-By is absent',
  );
}
function checkLegacyXss(headers) {
  const value = headers.get('x-xss-protection');
  // X-XSS-Protection is deprecated: modern browsers ignore it, and value 1 can
  // introduce issues in some legacy engines. The guidance is 0 (or absent) plus
  // a real CSP. Flag as info, not a hard failure.
  const ok = !value || value.trim().startsWith('0');
  return result(
    'security.headers.xss-legacy',
    'Deprecated X-XSS-Protection is not left enabled',
    ok,
    'info',
    'X-XSS-Protection absent or set to 0 (rely on CSP instead)',
    value ? `X-XSS-Protection: ${value} (deprecated; prefer 0 plus a CSP)` : 'X-XSS-Protection is absent',
  );
}
function checkCookies(headers) {
  // Node exposes multiple Set-Cookie headers via getSetCookie().
  const cookies = headers.getSetCookie?.() ?? [];
  if (cookies.length === 0) {
    return result(
      'security.cookies.flags',
      'Cookies use HttpOnly, Secure and SameSite',
      true,
      'info',
      'Session cookies carry HttpOnly, Secure and SameSite',
      'No Set-Cookie on this response (nothing to assess here)',
    );
  }
  const weak = cookies.filter((c) => {
    const lower = c.toLowerCase();
    return (
      !lower.includes('httponly') ||
      !lower.includes('secure') ||
      !lower.includes('samesite')
    );
  });
  return result(
    'security.cookies.flags',
    'Cookies use HttpOnly, Secure and SameSite',
    weak.length === 0,
    weak.length > 0 ? 'medium' : 'info',
    'Every Set-Cookie carries HttpOnly, Secure and SameSite',
    weak.length === 0
      ? `All ${cookies.length} cookie(s) carry the expected flags`
      : `${weak.length} of ${cookies.length} cookie(s) missing a flag`,
    weak.map((c) => c.split(';')[0] + '; ...'),
  );
}

// --- Client-delivered asset scan ----------------------------------------------

const SECRET_PATTERNS = [
  {
    label: 'Google API key',
    re: /AIza[0-9A-Za-z_\-]{35}/g,
  },
  {
    label: 'AWS access key id',
    re: /AKIA[0-9A-Z]{16}/g,
  },
  {
    label: 'Slack token',
    re: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
  },
  {
    label: 'Stripe live key',
    re: /sk_live_[0-9A-Za-z]{20,}/g,
  },
  {
    label: 'Generic private key block',
    re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  },
  {
    label: 'Bearer-style token literal',
    re: /["']?[A-Za-z0-9_]*(?:secret|token|apikey|api_key)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/gi,
  },
];

/**
 * Fetches the page and a sample of its same-origin scripts, then scans for
 * secret-shaped strings and production source maps. This reads only assets the
 * server already ships to every visitor.
 */
async function scanClientAssets(target) {
  const notes = [];
  let sourceMapsFound = 0;
  async function scan(url, body) {
    for (const { label, re } of SECRET_PATTERNS) {
      const matches = body.match(re);
      if (matches) {
        // Redact the value; report only that a match exists and where.
        notes.push(
          `${label} pattern in ${url} (${matches.length} match/es, value redacted)`,
        );
      }
    }
    if (/\/\/[#@]\s*sourceMappingURL=/.test(body) || /\.js\.map/.test(body)) {
      sourceMapsFound += 1;
      notes.push(`Source map reference in ${url}`);
    }
  }
  try {
    const res = await fetch(target, {
      redirect: 'follow',
    });
    const html = await res.text();
    await scan(target, html);
    const origin = new URL(target).origin;
    const scriptUrls = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
      .map((m) => m[1])
      .map((src) => (src.startsWith('http') ? src : new URL(src, target).href))
      .filter((src) => src.startsWith(origin))
      .slice(0, 5); // a sample is enough; do not hammer the origin

    for (const src of scriptUrls) {
      const js = await fetch(src)
        .then((r) => r.text())
        .catch(() => '');
      if (js) await scan(src, js);
    }
  } catch (error) {
    return result(
      'security.assets.exposure',
      'No secrets or source maps exposed to the client',
      false,
      'info',
      'Client assets fetch and scan cleanly',
      `Could not complete the asset scan: ${error instanceof Error ? error.message : error}`,
    );
  }
  const secretNotes = notes.filter((n) => !n.startsWith('Source map'));
  const ok = secretNotes.length === 0;
  return result(
    'security.assets.exposure',
    'No secrets or source maps exposed to the client',
    ok,
    secretNotes.length > 0 ? 'high' : sourceMapsFound > 0 ? 'low' : 'info',
    'No secret-shaped strings in client assets; no production source maps',
    ok
      ? sourceMapsFound > 0
        ? `No secrets found; ${sourceMapsFound} source map reference(s) present`
        : 'No secrets or source maps found in the sampled client assets'
      : `${secretNotes.length} secret-shaped string(s) found in client assets`,
    notes.length > 0 ? notes : undefined,
  );
}
export async function runSecurityChecks(target) {
  const results = [];
  const res = await fetch(target, {
    redirect: 'follow',
  });
  const headers = res.headers;
  results.push(checkCsp(headers));
  results.push(
    checkSimpleHeader(
      headers,
      'security.headers.hsts',
      'strict-transport-security',
      'HTTP Strict Transport Security is set',
      'medium',
    ),
  );
  results.push(
    checkSimpleHeader(
      headers,
      'security.headers.xcto',
      'x-content-type-options',
      'X-Content-Type-Options is nosniff',
      'low',
      (v) => v.toLowerCase() === 'nosniff',
    ),
  );
  results.push(
    checkSimpleHeader(
      headers,
      'security.headers.referrer',
      'referrer-policy',
      'Referrer-Policy is set',
      'low',
    ),
  );
  results.push(checkFrameProtection(headers));
  results.push(checkPoweredBy(headers));
  results.push(checkLegacyXss(headers));
  results.push(checkCookies(headers));
  results.push(await scanClientAssets(target));
  return results;
}
