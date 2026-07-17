# OpenAPI → Playwright

Paste or upload an OpenAPI/Swagger spec, pick an endpoint, get a ready-to-run Playwright test. No accounts, no login, no billing for users. It's a static frontend plus two tiny serverless endpoints used only for activity tracking (see below) — there is no user data, no database of users, nothing to sign up for.

## Flow

```
Upload openapi.yaml (or click "Try with sample spec")
      ↓
Choose endpoint
      ↓
Pick output mode: single happy-path test, or Starter Suite
      ↓
Generate
      ↓
Copy → Done
```

## Output modes

- **Single test** (`src/codegen.ts`) — one happy-path test: `describe()`/`test()`, request call, assertions, auth placeholder, payload.
- **Starter suite** (`src/starter-suite.ts`) — a handful of tests per endpoint, all conditionally generated from what the spec actually declares — nothing invented — grouped into four labeled sections in the output:
  - **✅ Happy Path** — the success case, always if the operation documents one; plus a "supports the pagination parameter" variant for `GET` list endpoints with a `page`/`limit`/`offset`-like query param
  - **🛡 Contract Validation** — not-found for a bad path parameter, only if the operation has one
  - **⚠ Input Validation** — missing required field, wrong data type, and invalid-enum-value tests, each only generated when the schema actually declares the relevant constraint (a `required` list, a primitive type, or an `enum`) — covers both request body properties and query parameters; wrong-path-param-format is included here too, only when that parameter's schema implies something meaningful to violate (a type, a `format`, a `pattern`, or an `enum` — not a bare unconstrained string)
  - **🔒 Authentication** — requires-authentication, only if the operation's `security` actually requires it

  For any validation/contract case, if the spec documents the expected error status (e.g. a `404` or `400` response), the test asserts it for real. If it doesn't, the generator emits a stub with a comment instead of guessing — it will not fabricate a status code or any other business logic the spec doesn't support. There's deliberately no coverage-scoring or AI-generated explanations here — this stays a straightforward, spec-driven generator, not a QA platform.

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
  - **visitors** — anyone who loaded the page, deduped by a SHA-256 hash of their IP (the raw IP is never stored — hashed server-side in `api/track.ts` before touching Redis). Note: this undercounts distinct people behind a shared/NAT'd IP (offices, some mobile carriers) and overcounts people whose IP changes between visits — it's a reasonable proxy, not exact.
  - **generated** — unique visitors (by that same IP hash) who generated at least one test
  - **copied** — unique visitors who copied a test (via the Copy button or manual select-all)
  - **returned** — visitors seen on 2+ separate visits, even within the same day (not gated by calendar day)
  - **tried_sample** — unique visitors who clicked "Try with sample spec" (`src/sample-spec.ts`), added to see whether not having a spec handy was the reason visitors weren't generating tests

  Check it anytime at `/api/stats` (JSON), or `/api/stats?format=text` for a plain `N visitors / N generated / N copied / N returned / N tried sample` readout.

This exists because pageviews alone don't tell you if the tool is actually useful — the funnel does.
