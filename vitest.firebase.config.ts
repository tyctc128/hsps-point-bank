// Firebase 模擬器測試：同一批 API 測試改對 Firebase 模擬器 + 正式 firestore.rules 執行，另加權限規則單元測試。
// 執行：npm run test:firebase（會自動啟動與關閉模擬器）
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts', 'tests/api/**/*.test.ts'],
    setupFiles: ['tests/setup.ts', 'tests/setup-firebase.ts'],
    env: { BANK_BACKEND: 'firebase' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/vitest-firebase.json' },
  },
})
