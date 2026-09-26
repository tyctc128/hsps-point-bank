export const MAX_AMOUNT = 1_000_000
export const NOTE_MAX = 50
export const DESCRIPTION_MAX = 60

const fmt = new Intl.NumberFormat('zh-TW')

/** 12800 → "12,800" */
export function formatPoints(n: number): string {
  return fmt.format(n)
}

/** 帶正負號：+3,000 / −800（使用數學減號，色弱也能辨識） */
export function formatSigned(n: number): string {
  if (n > 0) return `+${fmt.format(n)}`
  if (n < 0) return `−${fmt.format(-n)}`
  return '0'
}

/** 金額驗證：正整數、不超過上限。回傳錯誤訊息或 null。 */
export function validateAmount(value: unknown, opts: { max?: number } = {}): string | null {
  if (value === '' || value === null || value === undefined) return '請輸入點數'
  const n = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return '點數必須是數字'
  if (!Number.isInteger(n)) return '點數必須是整數'
  if (n <= 0) return '點數必須大於 0'
  if (n > MAX_AMOUNT) return `點數不可超過 ${formatPoints(MAX_AMOUNT)}`
  if (opts.max !== undefined && n > opts.max) return `點數不足（目前 ${formatPoints(opts.max)} 點）`
  return null
}

export function parseAmount(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value)
  return n
}

export function validateNote(note: string, required = true): string | null {
  const t = note.trim()
  if (required && t.length === 0) return '請填寫事由'
  if (t.length > NOTE_MAX) return `事由最多 ${NOTE_MAX} 字`
  return null
}
