// Click-through tests of the real UI on the web build (npm run build:web),
// where web/shim.js stands in for the Go backend with the demo garden.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 20000,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 820 } },
  webServer: { command: 'python3 -m http.server 4173 --bind 127.0.0.1 -d ../build/web', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
