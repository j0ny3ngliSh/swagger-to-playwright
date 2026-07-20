import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(
      "This endpoint only accepts POST requests from the app itself — it's not meant to be visited directly.",
      { status: 405, headers: { "content-type": "text/plain" } },
    );
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
  if (!text) return new Response("Missing text", { status: 400 });

  // Stored as a Redis list, newest first. Read with:
  //   redis.lrange("feedback:missing", 0, -1)
  await redis.lpush("feedback:missing", JSON.stringify({ text, ts: Date.now() }));

  return new Response(null, { status: 204 });
}

export const config = { runtime: "edge" };
