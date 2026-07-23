// Proxy endpoint: fetches a remote OpenAPI spec to avoid browser CORS restrictions.
// Only http/https URLs are allowed. Responses are capped at 2MB.
//
// SSRF guard: rejects literal loopback/private/link-local hostnames and IPs (including
// the 169.254.169.254 cloud metadata address). This does NOT protect against DNS
// rebinding (a public hostname that resolves to a private IP at fetch time) — doing
// that properly needs a DNS lookup + connect-time IP check, which isn't available in
// the edge runtime this function runs on. Blocking literal private targets stops the
// overwhelming majority of casual SSRF probing; full rebinding protection is a
// follow-up if this proxy ever handles more sensitive traffic.
//
// Also rate-limited (unlike a plain analytics event, each call makes an outbound
// fetch on our behalf) so this can't be scripted into a free anonymous HTTP proxy.
import { getIp, hashIp, createLimiter, checkRateLimit, rateLimitedResponse } from "./_lib/rate-limit";

const fetchSpecLimiter = createLimiter("fetch-spec", 5, "1 m");

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;

  // IPv4 literal private/reserved ranges (RFC 1918, loopback, link-local incl. cloud metadata).
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (incl. metadata IP)
    if (a === 0) return true; // 0.0.0.0/8
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) literals.
  if (/^\[?f[cd][0-9a-f]{2}:/.test(h) || /^\[?fe[89ab][0-9a-f]:/.test(h)) return true;

  return false;
}

function validateUrl(url: URL): string | undefined {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http/https URLs are allowed";
  }
  if (isBlockedHost(url.hostname)) {
    return "This host is not allowed";
  }
  return undefined;
}

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2_000_000;

// Follows redirects manually so every hop — not just the original URL — gets checked
// against the SSRF guard. A plain `fetch()` follows redirects transparently, which
// would let a request to an allowed host 302 its way to a private/internal address
// without ever being re-validated.
async function safeFetch(startUrl: URL): Promise<Response> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current.toString(), {
      headers: { Accept: "application/json, application/yaml, text/yaml, text/plain, */*" },
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });

    const isRedirect = res.status >= 300 && res.status < 400;
    if (!isRedirect) return res;

    const location = res.headers.get("location");
    if (!location) throw new Error("Redirect response had no Location header");

    const next = new URL(location, current);
    const rejection = validateUrl(next);
    if (rejection) throw new Error(`Redirect target rejected: ${rejection} (${next.hostname})`);

    current = next;
  }

  throw new Error("Too many redirects");
}

export default async function handler(req: Request): Promise<Response> {
  const id = await hashIp(getIp(req));
  const { allowed, reset } = await checkRateLimit(fetchSpecLimiter, id);
  if (!allowed) return rateLimitedResponse(reset);

  const rawUrl = new URL(req.url).searchParams.get("url");
  if (!rawUrl) return new Response("Missing url param", { status: 400 });

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  const rejection = validateUrl(target);
  if (rejection) return new Response(rejection, { status: 400 });

  let res: Response;
  try {
    res = await safeFetch(target);
  } catch (e: any) {
    return new Response(`Fetch failed: ${e?.message ?? "unknown error"}`, { status: 502 });
  }

  if (!res.ok) {
    return new Response(`Upstream returned ${res.status}`, { status: 502 });
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    return new Response("Spec too large (max 2 MB)", { status: 413 });
  }

  const text = await res.text();
  if (text.length > MAX_BYTES) {
    return new Response("Spec too large (max 2 MB)", { status: 413 });
  }

  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = { runtime: "edge" };
