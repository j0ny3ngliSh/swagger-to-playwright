import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const VALID_EVENTS = new Set(["visit", "generated", "copied"]);
const VALID_METHODS = new Set(["button", "selection"]);
const MAX_ID_LENGTH = 100;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { event?: string; visitorId?: string; method?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { event, visitorId, method } = body;

  if (!event || !VALID_EVENTS.has(event)) {
    return new Response("Invalid event", { status: 400 });
  }
  if (!visitorId || typeof visitorId !== "string" || visitorId.length > MAX_ID_LENGTH) {
    return new Response("Invalid visitorId", { status: 400 });
  }

  await redis.sadd("visitors:all", visitorId);

  if (event === "visit") {
    const today = new Date().toISOString().slice(0, 10);
    await redis.sadd(`visitor-days:${visitorId}`, today);
    const distinctDays = await redis.scard(`visitor-days:${visitorId}`);
    if (distinctDays >= 2) {
      await redis.sadd("visitors:returned", visitorId);
    }
  } else if (event === "generated") {
    await redis.sadd("visitors:generated", visitorId);
    await redis.incr("activity:generated");
  } else if (event === "copied") {
    await redis.sadd("visitors:copied", visitorId);
    if (method && VALID_METHODS.has(method)) {
      await redis.incr(`activity:copied:${method}`);
    }
  }

  return new Response(null, { status: 204 });
}

export const config = { runtime: "edge" };
