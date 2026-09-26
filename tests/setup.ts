import { webcrypto } from 'node:crypto'

// jsdom 環境可能沒有 crypto.subtle，改用 Node 內建的 WebCrypto
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
