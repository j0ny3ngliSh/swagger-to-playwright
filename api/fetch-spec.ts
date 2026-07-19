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

export default async function handler(req: Request): Promise<Response> {
  const rawUrl = new URL(req.url).searchParams.get("url");
  if (!rawUrl) return new Response("Missing url param", { status: 400 });

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new Response("Only http/https URLs are allowed", { status: 400 });
  }

  if (isBlockedHost(target.hostname)) {
    return new Response("This host is not allowed", { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(target.toString(), {
      headers: { Accept: "application/json, application/yaml, text/yaml, text/plain, */*" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e: any) {
    return new Response(`Fetch failed: ${e?.message ?? "unknown error"}`, { status: 502 });
  }

  if (!res.ok) {
    return new Response(`Upstream returned ${res.status}`, { status: 502 });
  }

  const text = await res.text();
  if (text.length > 2_000_000) {
    return new Response("Spec too large (max 2 MB)", { status: 413 });
  }

  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = { runtime: "edge" };
