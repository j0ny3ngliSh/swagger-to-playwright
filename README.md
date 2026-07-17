# OpenAPI → Playwright

Paste or upload an OpenAPI/Swagger spec, pick an endpoint, get a ready-to-run Playwright test. No accounts, no backend, no database, no billing.

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

## Why Vite

This is a static, backend-free tool by design, so it doesn't need a framework. Vite was chosen anyway for two things a zero-build `<script>` tag setup doesn't give you:

- **Type-checked codegen logic.** The OpenAPI parsing and test-generation code (`src/openapi.ts`, `src/codegen.ts`) is the part most likely to have subtle bugs, so it's worth writing in checked TypeScript rather than plain JS.
- **A real npm dependency for YAML.** OpenAPI specs are usually YAML, not JSON, so the tool needs `js-yaml`. Vite lets that be a normal `import` instead of a CDN `<script>` tag or a hand-vendored file.

The output is still plain static files (`npm run build` → `dist/`), deployable anywhere for free — Vercel, Netlify, GitHub Pages, or a plain static host.
