import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  test: { include: ["tests/core/**/*.test.ts"] },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
