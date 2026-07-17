# OpenAPI → Playwright

Paste or upload an OpenAPI/Swagger spec, pick an endpoint, get a ready-to-run Playwright test. No accounts, no login, no billing for users. It's a static frontend plus two tiny serverless endpoints used only for activity tracking (see below) — there is no user data, no database of users, nothing to sign up for.

## Flow

```
Upload openapi.yaml
      ↓
Choose endpoint
      ↓
Generate: describe() / test() / request / assertions / auth placeholder / payload
      ↓
Copy → Done
```

## Running locally

```
npm install
npm run dev
```

The `/api/track` and `/api/stats` endpoints (see below) need `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars to work — pull them with `vercel env pull` if you need activity tracking locally. Everything else (the actual tool) works without them.

## Why Vite

The core tool is a static, no-framework-needed page by design (the serverless functions in `api/` are add-on activity tracking, not part of the product itself). Vite was chosen anyway for two things a zero-build `<script>` tag setup doesn't give you:

- **Type-checked codegen logic.** The OpenAPI parsing and test-generation code (`src/openapi.ts`, `src/codegen.ts`) is the part most likely to have subtle bugs, so it's worth writing in checked TypeScript rather than plain JS.
- **A real npm dependency for YAML.** OpenAPI specs are usually YAML, not JSON, so the tool needs `js-yaml`. Vite lets that be a normal `import` instead of a CDN `<script>` tag or a hand-vendored file.

The output is still plain static files (`npm run build` → `dist/`), deployable anywhere for free — Vercel, Netlify, GitHub Pages, or a plain static host.

## Activity tracking

Two layers, both free:

- **Vercel Web Analytics** (`inject()` in `src/main.ts`) — pageview/visitor trends in the Vercel dashboard. Custom events (e.g. "did they click Copy?") are a Pro-plan-only feature there, so this layer is trend-watching only, not the funnel below.
- **Self-hosted funnel counter** (`api/track.ts`, `api/stats.ts`, backed by free-tier Upstash Redis) — tracks a real funnel of unique people, not raw event counts:
  - **visitors** — anyone who loaded the page (deduped by an anonymous ID in `localStorage`, not an IP or account)
  - **generated** — unique visitors who generated at least one test
  - **copied** — unique visitors who copied a test (via the Copy button or manual select-all)
  - **returned** — unique visitors seen on 2+ distinct calendar days

  Check it anytime at `/api/stats` (JSON), or `/api/stats?format=text` for a plain `N visitors / N generated / N copied / N returned` readout.

This exists because pageviews alone don't tell you if the tool is actually useful — the funnel does.
