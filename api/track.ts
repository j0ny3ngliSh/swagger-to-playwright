import { redis, getIp, hashIp, createLimiter, checkRateLimit, rateLimitedResponse } from "./_lib/rate-limit";
import { saddDaily, utcDateString } from "./_lib/daily";

const VALID_EVENTS = new Set([
  "visit", "generated", "copied", "tried_sample",
  "thumbs_up", "thumbs_down", "fetched_url", "tried_example",
  "suite_downloaded",
]);
const VALID_METHODS = new Set(["button", "selection"]);
const VALID_EXAMPLES = new Set(["petstore", "notion", "spotify"]);
// Bounds the Redis hash of spec versions to plausible OpenAPI/Swagger version
// strings only — anything else (or missing) buckets under "other" so a client
// can't grow the hash with arbitrary keys.
const SPEC_VERSION_PATTERN = /^[\w.-]{1,20}$/;

// Generous — this fires on ordinary page interactions (visit, copy, generate,
// etc.), not just suite downloads, so it only needs to catch scripted floods.
const trackLimiter = createLimiter("track", 20, "1 m");

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

  let body: { event?: string; method?: string; endpointCount?: number; specVersion?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { event, method, endpointCount, specVersion } = body;
  if (!event || !VALID_EVENTS.has(event)) {
    return new Response("Invalid event", { status: 400 });
  }

  const id = await hashIp(getIp(req));

  const { allowed, reset } = await checkRateLimit(trackLimiter, id);
  if (!allowed) return rateLimitedResponse(reset);

  const today = utcDateString();

  await redis.sadd("visitors:all", id);
  await saddDaily(`visitors:${today}`, id);

  if (event === "visit") {
    const visitCount = await redis.incr(`visitor-visits:${id}`);
    if (visitCount >= 2) {
      await redis.sadd("visitors:returned", id);
      await saddDaily(`visitors:returned:${today}`, id);
    }
  } else if (event === "generated") {
    await redis.sadd("visitors:generated", id);
    await redis.incr("activity:generated");
    await saddDaily(`visitors:generated:${today}`, id);
  } else if (event === "copied") {
    await redis.sadd("visitors:copied", id);
    await saddDaily(`visitors:copied:${today}`, id);
    if (method && VALID_METHODS.has(method)) {
      await redis.incr(`activity:copied:${method}`);
    }
  } else if (event === "tried_sample") {
    await redis.sadd("visitors:tried_sample", id);
    await saddDaily(`visitors:tried_sample:${today}`, id);
  } else if (event === "thumbs_up") {
    await redis.sadd("visitors:thumbs_up", id);
    await redis.incr("feedback:thumbs_up");
    await saddDaily(`visitors:thumbs_up:${today}`, id);
  } else if (event === "thumbs_down") {
    await redis.sadd("visitors:thumbs_down", id);
    await redis.incr("feedback:thumbs_down");
    await saddDaily(`visitors:thumbs_down:${today}`, id);
  } else if (event === "fetched_url") {
    await redis.sadd("visitors:fetched_url", id);
  } else if (event === "tried_example") {
    await redis.sadd("visitors:tried_example", id);
    if (method && VALID_EXAMPLES.has(method)) {
      await redis.incr(`activity:tried_example:${method}`);
    }
  } else if (event === "suite_downloaded") {
    await redis.sadd("visitors:suite_downloaded", id);
    await redis.incr("activity:suite_downloaded");
    await saddDaily(`visitors:suite_downloaded:${today}`, id);
    if (typeof endpointCount === "number" && Number.isInteger(endpointCount) && endpointCount > 0) {
      await redis.incrby("activity:suite_downloaded:endpoints_total", Math.min(endpointCount, 5000));
    }
    const versionKey =
      typeof specVersion === "string" && SPEC_VERSION_PATTERN.test(specVersion) ? specVersion : "other";
    await redis.hincrby("activity:suite_downloaded:versions", versionKey, 1);
  }

  return new Response(null, { status: 204 });
}

export const config = { runtime: "edge" };
