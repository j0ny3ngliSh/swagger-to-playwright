import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Skip deleting old dist files before building.
    // The dist/ folder contents are managed by Vercel in CI; locally the
    // macOS volume mount doesn't permit unlinking previously-built files.
    emptyOutDir: false,
  },
});
