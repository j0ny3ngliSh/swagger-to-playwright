import { Redis } from "@upstash/redis";

// TODO: Replace Redis storage with a dedicated email provider (Resend, ConvertKit, Mailchimp)
// when you're ready to send actual emails. For now, emails land in the same
// Upstash Redis instance used for activity tracking — check with:
//   redis.smembers("subscribers:emails")
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

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
