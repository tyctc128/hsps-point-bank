import { defineConfig, devices } from '@playwright/test'

// 端對端測試：對「正式建置版」（含 CSP）執行，分別模擬教師電腦（Chromium）與學生 iPad（WebKit / Safari）
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/playwright',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    // Windows 上的 WebKit 執行較慢（真實 iPad Safari 不受影響），放寬時限
    { name: 'ipad-webkit', timeout: 150_000, expect: { timeout: 20_000 }, use: { ...devices['iPad Pro 11 landscape'] } },
  ],
  webServer: {
    command: 'npx vite build --mode mock --outDir dist-mock && npx vite preview --outDir dist-mock --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
