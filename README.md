# OpenAPI → Playwright

Generate ready-to-run API tests from your OpenAPI specification. No accounts, no login, no billing for users. It's a static frontend plus a handful of tiny serverless endpoints for activity tracking and an optional email signup (see below) — there's no account system, but email addresses from the "get updates" box are stored (see Email capture).

## Flow

```
Upload your Swagger/OpenAPI file (or click "Try with sample spec")
      ↓
Select an endpoint
      ↓
Generate a Starter Suite of Playwright tests
      ↓
Copy → Done
```

## The Starter Suite

Every generated file is a handful of tests per endpoint (`src/starter-suite.ts`), all conditionally generated from what the spec actually declares — nothing invented — grouped into four labeled sections in the output:
  - **✅ Happy Path** — the success case, always if the operation documents one; plus a "supports the pagination parameter" variant for `GET` list endpoints with a `page`/`limit`/`offset`-like query param
  - **🛡 Contract Validation** — not-found for a bad path parameter, only if the operation has one
  - **⚠ Input Validation** — missing required field, wrong data type, and invalid-enum-value tests, each only generated when the schema actually declares the relevant constraint (a `required` list, a primitive type, or an `enum`) — covers both request body properties and query parameters; wrong-path-param-format is included here too, only when that parameter's schema implies something meaningful to violate (a type, a `format`, a `pattern`, or an `enum` — not a bare unconstrained string)
  - **🔒 Authentication** — requires-authentication, only if the operation's `security` actually requires it

  For any validation/contract case, if the spec documents the expected error status (e.g. a `404` or `400` response), the test asserts it for real. If it doesn't, the generator emits a stub with a comment instead of guessing — it will not fabricate a status code or any other business logic the spec doesn't support. There's deliberately no coverage-scoring or AI-generated explanations here — this stays a straightforward, spec-driven generator, not a QA platform.

## Syntax highlighting

Hand-written, regex-based tokenizer (`src/highlight.ts`) — no external highlighting library. Colors match VS Code's default Dark+ theme. Covers both the spec input and the generated test output:

- **Generated test output** — read-only, straightforward: `outputCode.innerHTML` is set to the tokenized HTML.
- **Spec input** (still fully editable) — the `<textarea>` can't natively show colored text while staying typeable, so it sits on top of a highlighted `<pre>` with its own text made transparent (only the caret stays visible via `caret-color`). The two layers share the same font/padding/line-height so they align pixel-for-pixel, and scroll position is synced between them on every scroll event. This is the standard "highlighted textarea" trick and needed no new dependency.

This is a best-effort tokenizer, not a real parser — good enough for the OpenAPI/TypeScript content this app actually displays, with a couple of known, deliberate simplifications: a `#` inside an unquoted YAML scalar not preceded by whitespace could misfire as a comment start (rare in practice), and template-literal interpolations (`${...}`) are colored as part of the surrounding string rather than tokenized separately.

## Input validation

Upload, paste, and URL-fetch all funnel through the same check (`isOpenApiSpec` in `src/openapi.ts`): the content must parse as YAML/JSON *and* declare an `openapi` (v3) or `swagger` (v2) version field. Arbitrary YAML/JSON that happens to parse but isn't actually a spec is rejected with a clear message instead of failing later with a confusing "no operations found" error.

## Running locally

```
npm install
npm run dev
```

The `/api/track` and `/api/stats` endpoints (see below) need `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars to work — pull them with `vercel env pull` if you need activity tracking locally. Everything else (the actual tool) works without them.

## Why Vite

The core tool is a static, no-framework-needed page by design (the serverless functions in `api/` are add-on activity tracking, not part of the product itself). Vite was chosen anyway for two things a zero-build `<script>` tag setup doesn't give you:

- **Type-checked codegen logic.** The OpenAPI parsing and test-generation code (`src/openapi.ts`, `src/codegen.ts`, `src/starter-suite.ts`) is the part most likely to have subtle bugs, so it's worth writing in checked TypeScript rather than plain JS. Note: `codegen.ts` still exports the original single-happy-path-test generator and its shared helpers (reused by `starter-suite.ts`); the UI no longer offers it as a mode, but it's kept (and still covered by `tests/codegen.test.ts`) rather than deleted, since nothing asked for its removal.
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
  - **thumbs_up** / **thumbs_down** — unique visitors who rated the generated test with the 👍/👎 feedback widget
  - **missing_feedback** — the actual text people typed in response to "What was missing?" (only shown in the JSON response, not the text format — it's freeform content, not a count)

  Check it anytime at `/api/stats` (JSON), or `/api/stats?format=text` for a plain `N visitors / N generated / N copied / N returned / N tried sample / N thumbs up / N thumbs down / N missing-feedback notes` readout.

This exists because pageviews alone don't tell you if the tool is actually useful — the funnel does.

## Email capture

A "get updates" box (`src/main.ts`, styled in `src/style.css`) posts to `api/subscribe.ts`, which validates the address and adds it to a Redis set (`subscribers:emails`) in the same Upstash instance used for activity tracking. This is storage only — no emails are actually sent yet. Before using this list for anything, move it to a real email provider (Resend, ConvertKit, Mailchimp, etc.) per the TODO comment in `api/subscribe.ts`; sending campaign email straight from a hand-rolled Redis list isn't a good idea (deliverability, unsubscribe handling, compliance).
