# swagger-to-playwright

Free browser tool: paste an OpenAPI spec → pick an endpoint → copy a Playwright API test.  
Live on Vercel. No login, no account, no backend for the core feature.

## Stack

- **Frontend:** Vite + TypeScript (client-side codegen, no framework)
- **Edge functions:** `api/track.ts` (funnel), `api/subscribe.ts` (email capture), `api/stats.ts`
- **Storage:** Upstash Redis (`KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars)
- **Tests:** Vitest (`npm test`) — 58 tests across 3 files
- **Deploy:** Vercel, auto-deploys on push to `main`

## Key source files

| File | Purpose |
|------|---------|
| `src/openapi.ts` | Spec parsing, `resolveSchema` (handles `$ref` + `allOf`), `listOperations`, `getBaseUrl` |
| `src/codegen.ts` | `exampleForSchema`, `generateTest` (single-test generator, kept for backward compat) |
| `src/starter-suite.ts` | `generateStarterSuite` — the main product output, 4-category test suite |
| `src/main.ts` | UI wiring, file upload, email capture handler |
| `api/subscribe.ts` | Stores subscriber emails in Redis set `subscribers:emails` |

## Test categories generated per endpoint

1. **✅ Happy Path** — always; plus pagination variant for list GETs
2. **🛡 Contract Validation** — 404 for bad path param (only if path param exists)
3. **⚠ Input Validation** — missing required field, wrong type, invalid enum (only when spec declares them)
4. **🔒 Authentication** — no-token test (only when `security` is declared)

## Commands

```bash
npm run dev       # local dev server
npm test          # run vitest
npm run build     # production build → dist/
npx tsc --noEmit  # type-check only
```

## Current known gaps (next tasks)

- [ ] Wire Resend/ConvertKit to `api/subscribe.ts` — emails captured but not sent
- [x] Add GitHub Actions CI running `vitest run` on push (`.github/workflows/test.yml`) — `tsc --noEmit` isn't wired into CI yet, only run manually
- [ ] Rate-limit `/api/subscribe` (one attempt per IP per hour)
- [ ] `oneOf`/`anyOf` support in `resolveSchema`
- [ ] Auth scheme type awareness (currently always emits `Bearer`)
- [ ] Bulk export — download all endpoints as one `.spec.ts` file
- [ ] Textarea size guard (reject specs > ~1MB before parsing)

## Monetization path

Free: 1 endpoint at a time, copy-paste output  
Paid: bulk export + `playwright.config.ts` + GitHub Actions workflow (CI-ready in 10 min)  
Later: team workspace (saved specs, shared suites)

## Activity tracking

Check funnel anytime: `/api/stats` (JSON) or `/api/stats?format=text`  
Subscriber list: `redis.smembers("subscribers:emails")`
