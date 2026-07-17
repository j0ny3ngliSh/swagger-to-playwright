import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const VALID_EVENTS = new Set(["visit", "generated", "copied", "tried_sample"]);
const VALID_METHODS = new Set(["button", "selection"]);

function getIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Hashed rather than stored raw, so no actual IP addresses sit in Redis.
async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { event?: string; method?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { event, method } = body;
  if (!event || !VALID_EVENTS.has(event)) {
    return new Response("Invalid event", { status: 400 });
  }

  const id = await hashIp(getIp(req));

  await redis.sadd("visitors:all", id);

  if (event === "visit") {
    const visitCount = await redis.incr(`visitor-visits:${id}`);
    if (visitCount >= 2) {
      await redis.sadd("visitors:returned", id);
    }
  } else if (event === "generated") {
    await redis.sadd("visitors:generated", id);
    await redis.incr("activity:generated");
  } else if (event === "copied") {
    await redis.sadd("visitors:copied", id);
    if (method && VALID_METHODS.has(method)) {
      await redis.incr(`activity:copied:${method}`);
    }
  } else if (event === "tried_sample") {
    await redis.sadd("visitors:tried_sample", id);
  }

  return new Response(null, { status: 204 });
}

export const config = { runtime: "edge" };
