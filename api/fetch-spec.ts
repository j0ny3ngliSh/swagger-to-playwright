// Proxy endpoint: fetches a remote OpenAPI spec to avoid browser CORS restrictions.
// Only http/https URLs are allowed. Responses are capped at 2MB.

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
