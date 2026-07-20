import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const VALID_EVENTS = new Set([
  "visit", "generated", "copied", "tried_sample",
  "thumbs_up", "thumbs_down", "fetched_url", "tried_example",
]);
const VALID_METHODS = new Set(["button", "selection"]);
const VALID_EXAMPLES = new Set(["petstore", "notion", "spotify"]);

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
    // Not a bug: this is an internal, POST-only analytics endpoint the app calls via
    // fetch(). Visiting it directly in a browser sends GET, which lands here — this
    // message exists so that looks intentional rather than broken.
    return new Response(
      "This endpoint only accepts POST requests from the app itself — it's not meant to be visited directly.",
      { status: 405, headers: { "content-type": "text/plain" } },
    );
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
  } else if (event === "thumbs_up") {
    await redis.sadd("visitors:thumbs_up", id);
    await redis.incr("feedback:thumbs_up");
  } else if (event === "thumbs_down") {
    await redis.sadd("visitors:thumbs_down", id);
    await redis.incr("feedback:thumbs_down");
  } else if (event === "fetched_url") {
    await redis.sadd("visitors:fetched_url", id);
  } else if (event === "tried_example") {
    await redis.sadd("visitors:tried_example", id);
    if (method && VALID_EXAMPLES.has(method)) {
      await redis.incr(`activity:tried_example:${method}`);
    }
  }

  return new Response(null, { status: 204 });
}

export const config = { runtime: "edge" };
