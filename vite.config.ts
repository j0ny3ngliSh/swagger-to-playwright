import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Skip deleting old dist files before building.
    // The dist/ folder contents are managed by Vercel in CI; locally the
    // macOS volume mount doesn't permit unlinking previously-built files.
    emptyOutDir: false,
    rollupOptions: {
      // Two entry points: the main tool (index.html) and the unlisted
      // daily-stats view (stats.html). Without this, only index.html would
      // get bundled and stats.html would 404 in production.
      input: {
        main: "index.html",
        stats: "stats.html",
      },
    },
  },
});
