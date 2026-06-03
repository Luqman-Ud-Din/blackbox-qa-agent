import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './.tmp/qa-20260601-001',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'json',
  use: { trace: 'on', screenshot: 'only-on-failure' }
});
