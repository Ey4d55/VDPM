import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the built site works from any static host or sub-path
// (GitHub Pages, Zenodo archive, a local folder opened through a server).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2022", sourcemap: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
