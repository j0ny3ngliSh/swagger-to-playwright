// TODO: Replace Redis storage with a dedicated email provider (Resend, ConvertKit, Mailchimp)
// when you're ready to send actual emails. For now, emails land in the same
// Upstash Redis instance used for activity tracking — check with:
//   redis.smembers("subscribers:emails")
import { redis, getIp, hashIp, createLimiter, checkRateLimit, rateLimitedResponse } from "./_lib/rate-limit";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const subscribeLimiter = createLimiter("subscribe", 1, "1 h");

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(
      "This endpoint only accepts POST requests from the app itself — it's not meant to be visited directly.",
      { status: 405, headers: { "content-type": "text/plain" } },
    );
  }

  const id = await hashIp(getIp(req));
  const { allowed, reset } = await checkRateLimit(subscribeLimiter, id);
  if (!allowed) return rateLimitedResponse(reset);

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_REGEX.test(email)) {
    return new Response("Invalid email", { status: 400 });
  }

  await redis.sadd("subscribers:emails", email);

  return new Response(null, { status: 204 });
}

export const config = { runtime: "edge" };
