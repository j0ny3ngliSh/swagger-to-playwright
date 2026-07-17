import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const VALID_EVENTS = new Set(["generated", "copied"]);
const VALID_METHODS = new Set(["button", "selection"]);

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

  if (!body.event || !VALID_EVENTS.has(body.event)) {
    return new Response("Invalid event", { status: 400 });
  }

  const key =
    body.event === "copied" && body.method && VALID_METHODS.has(body.method)
      ? `activity:copied:${body.method}`
      : `activity:${body.event}`;

  await redis.incr(key);

  return new Response(null, { status: 204 });
}

export const config = { runtime: "edge" };
