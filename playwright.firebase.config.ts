import { defineConfig, devices } from '@playwright/test'

// Firebase 版端對端測試：正式畫面（emulator 模式建置）＋ Firebase 模擬器。每位使用者使用獨立的瀏覽器環境（模擬不同裝置）。
export default defineConfig({
  testDir: 'tests/e2e-firebase',
  outputDir: 'test-results/playwright-firebase',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  globalSetup: './tests/e2e-firebase/global-setup.ts',
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-firebase.json' }]],
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  projects: [
    { name: 'firebase-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: [
    {
      command: 'npx firebase emulators:start --project demo-hsps-point-bank --only auth,firestore',
      port: 8080,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'npx vite build --mode emulator --outDir dist-emulator && npx vite preview --outDir dist-emulator --port 4174 --strictPort',
      url: 'http://localhost:4174',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
