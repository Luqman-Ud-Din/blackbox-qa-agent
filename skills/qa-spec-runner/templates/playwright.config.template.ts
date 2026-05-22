// AUTO-GENERATED at audit run time by qa-spec-runner — do not edit.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'audit.spec.ts',
  fullyParallel: <<FULLY_PARALLEL>>,
  workers: <<WORKERS>>,
  retries: 0,
  timeout: <<TIMEOUT_MS>>,
  reporter: [['list']],
  use: {
    headless: <<HEADLESS>>,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    ignoreHTTPSErrors: true,
  },
  projects: [
    <<PROJECTS>>
  ],
});
