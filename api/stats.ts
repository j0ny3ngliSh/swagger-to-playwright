import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(): Promise<Response> {
  const [generated, copiedButton, copiedSelection] = await Promise.all([
    redis.get<number>("activity:generated"),
    redis.get<number>("activity:copied:button"),
    redis.get<number>("activity:copied:selection"),
  ]);

  return new Response(
    JSON.stringify({
      generated: generated ?? 0,
      copied_button: copiedButton ?? 0,
      copied_selection: copiedSelection ?? 0,
    }),
    { headers: { "content-type": "application/json" } },
  );
}

export const config = { runtime: "edge" };
