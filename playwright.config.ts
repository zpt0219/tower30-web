import { defineConfig } from "@playwright/test";
import { artifactDirectory } from "./scripts/artifacts";
const artifactDir = artifactDirectory();
const externalBase = process.env.TOWER_E2E_BASE_URL;
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: `${artifactDir}/playwright`,
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: `${artifactDir}/e2e-results.json` }],
  ],
  use: {
    baseURL: externalBase ?? "http://127.0.0.1:5173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 720 } } },
    {
      name: "mobile-landscape",
      use: {
        viewport: { width: 1000, height: 450 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: externalBase
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: true,
      },
});
