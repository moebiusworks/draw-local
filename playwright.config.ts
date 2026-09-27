import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const testRoot = path.join(os.tmpdir(), "draw-local-playwright");

export default defineConfig({
  testDir: "./src/client",
  testMatch: "*.browser.test.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    env: {
      ...process.env,
      DRAW_LOCAL_HOST: "127.0.0.1",
      DRAW_LOCAL_PORT: "8797",
      DRAW_LOCAL_WEB_HOST: "127.0.0.1",
      DRAW_LOCAL_WEB_PORT: "4173",
      DRAW_LOCAL_ROOT: `${testRoot}/project`,
      XDG_CONFIG_HOME: `${testRoot}/config`,
      XDG_DATA_HOME: `${testRoot}/data`,
    },
  },
});
