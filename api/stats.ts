import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

interface MissingFeedbackEntry {
  text: string;
  ts: number;
}

export default async function handler(req: Request): Promise<Response> {
  const [
    visitors,
    generated,
    copied,
    returned,
    triedSample,
    copiedButton,
    copiedSelection,
    thumbsUp,
    thumbsDown,
    missingFeedbackRaw,
    triedExample,
    suiteDownloaded,
    suiteDownloadedEndpointsTotal,
    suiteDownloadedVersions,
  ] = await Promise.all([
    redis.scard("visitors:all"),
    redis.scard("visitors:generated"),
    redis.scard("visitors:copied"),
    redis.scard("visitors:returned"),
    redis.scard("visitors:tried_sample"),
    redis.get<number>("activity:copied:button"),
    redis.get<number>("activity:copied:selection"),
    redis.scard("visitors:thumbs_up"),
    redis.scard("visitors:thumbs_down"),
    redis.lrange("feedback:missing", 0, -1),
    redis.scard("visitors:tried_example"),
    redis.scard("visitors:suite_downloaded"),
    redis.get<number>("activity:suite_downloaded:endpoints_total"),
    redis.hgetall<Record<string, number>>("activity:suite_downloaded:versions"),
  ]);

  const missingFeedback: MissingFeedbackEntry[] = (missingFeedbackRaw ?? []).map((entry) =>
    typeof entry === "string" ? JSON.parse(entry) : entry,
  );

  const stats = {
    visitors,
    generated,
    copied,
    returned,
    tried_sample: triedSample,
    copied_button_events: copiedButton ?? 0,
    copied_selection_events: copiedSelection ?? 0,
    thumbs_up: thumbsUp,
    thumbs_down: thumbsDown,
    missing_feedback: missingFeedback,
    tried_example: triedExample,
    suite_downloaded: suiteDownloaded,
    suite_downloaded_endpoints_total: suiteDownloadedEndpointsTotal ?? 0,
    suite_downloaded_versions: suiteDownloadedVersions ?? {},
  };

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "text") {
    const text = `${visitors} visitors\n${generated} generated\n${copied} copied\n${returned} returned\n${triedSample} tried sample\n${thumbsUp} thumbs up\n${thumbsDown} thumbs down\n${missingFeedback.length} missing-feedback notes\n${triedExample} tried real API example\n${suiteDownloaded} suite downloads (${suiteDownloadedEndpointsTotal ?? 0} endpoints total)\n`;
    return new Response(text, { headers: { "content-type": "text/plain" } });
  }

  return new Response(JSON.stringify(stats), {
    headers: { "content-type": "application/json" },
  });
}

export const config = { runtime: "edge" };
