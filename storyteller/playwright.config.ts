import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests run against the real server (app, API and pictures) with a
 * throwaway data folder, an administrator account and rate limits off.
 */
export const ADMIN = { username: 'admin', password: 'admin-password-1' };

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm run build && node dist-server/main.js',
    url: 'http://localhost:4173/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: '4173',
      HOST: '127.0.0.1',
      STORYTELLER_EPHEMERAL: '1',
      RATE_LIMITS: 'off',
      ADMIN_USERNAME: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
    },
  },
});
