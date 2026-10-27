import { defineConfig } from '@playwright/test';
export default defineConfig({
  timeout: 60000,
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:1420', viewport: { width: 1360, height: 940 } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: true },
  reporter: 'list',
});
