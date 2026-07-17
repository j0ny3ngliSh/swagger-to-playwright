import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export default async function handler(req: Request): Promise<Response> {
  const [visitors, generated, copied, returned, copiedButton, copiedSelection] = await Promise.all([
    redis.scard("visitors:all"),
    redis.scard("visitors:generated"),
    redis.scard("visitors:copied"),
    redis.scard("visitors:returned"),
    redis.get<number>("activity:copied:button"),
    redis.get<number>("activity:copied:selection"),
  ]);

  const stats = {
    visitors,
    generated,
    copied,
    returned,
    copied_button_events: copiedButton ?? 0,
    copied_selection_events: copiedSelection ?? 0,
  };

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "text") {
    const text = `${visitors} visitors\n${generated} generated\n${copied} copied\n${returned} returned\n`;
    return new Response(text, { headers: { "content-type": "text/plain" } });
  }

  return new Response(JSON.stringify(stats), {
    headers: { "content-type": "application/json" },
  });
}

export const config = { runtime: "edge" };
