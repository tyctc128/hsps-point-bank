import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

// 正式建置才加入 CSP（開發伺服器需要 WebSocket 與 inline 樣式，不適用）
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.google.com https://www.gstatic.com",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://www.google.com",
  "frame-src https://www.google.com https://*.firebaseapp.com",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
].join('; ')

function cspPlugin(mode: string): Plugin {
  // 模擬器模式需要連到本機 Firebase 模擬器
  const csp = mode === 'emulator'
    ? CSP.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099 ws://127.0.0.1:8080")
    : CSP
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)
    },
  }
}

// base 使用相對路徑，部署到 GitHub Pages 任何 repo 名稱都能運作（路由採 hash 模式）
// npm run ipad：以 HTTPS 開放區網連線，讓平板可以連進來並使用相機（自簽憑證）
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [vue(), cspPlugin(mode), ...(mode === 'ipad' ? [basicSsl()] : [])],
  server: mode === 'ipad' ? { host: true, port: 5443, strictPort: true } : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/vitest.json' },
  },
}))
