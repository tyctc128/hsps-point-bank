// 收款碼：8 碼，字元集去除易混淆的 I、O、0、1（32 種字元，約 40 bits 隨機）
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/

export function newCodeId(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(8)
  return Array.from(bytes, (b) => CODE_ALPHABET[b & 31]).join('')
}

function defaultRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** 使用者輸入的代碼：轉大寫、移除空白與連字號 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code)
}

/** 從掃描結果取出代碼：只接受本站付款網址（#/pay?c=XXXX）或單純 8 碼，其餘一律忽略 */
export function extractCode(scanned: string, allowedOrigin?: string): string | null {
  const raw = scanned.trim()
  const plain = normalizeCode(raw)
  if (isValidCode(plain)) return plain
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (allowedOrigin && url.origin !== allowedOrigin) return null
  const hash = url.hash // "#/pay?c=ABCD2345"
  const m = hash.match(/^#\/pay\?(.*)$/)
  if (!m) return null
  const c = new URLSearchParams(m[1]).get('c')
  if (!c) return null
  const code = normalizeCode(c)
  return isValidCode(code) ? code : null
}

/** 產生其他 ID（交易、批次等） */
export function newId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return prefix + s
}
