// 所有日期以台北時間（UTC+8，無日光節約）計算與顯示
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function taipei(ms: number): Date {
  // 回傳一個「UTC 欄位 = 台北當地時間」的 Date，方便取年月日
  return new Date(ms + TZ_OFFSET_MS)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD */
export function dateKey(ms: number): string {
  const d = taipei(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 2026/09/26 */
export function formatDate(ms: number): string {
  return dateKey(ms).replace(/-/g, '/')
}

/** 09/26 */
export function formatShortDate(ms: number): string {
  const d = taipei(ms)
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
}

/** 14:05 */
export function formatTime(ms: number): string {
  const d = taipei(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 2026/09/26 14:05 */
export function formatDateTime(ms: number): string {
  return `${formatDate(ms)} ${formatTime(ms)}`
}

/** 今天 14:05 / 昨天 14:05 / 09/24 14:05 */
export function formatRelative(ms: number, now = Date.now()): string {
  const k = dateKey(ms)
  if (k === dateKey(now)) return `今天 ${formatTime(ms)}`
  if (k === dateKey(now - DAY_MS)) return `昨天 ${formatTime(ms)}`
  return `${formatShortDate(ms)} ${formatTime(ms)}`
}

/** 台北時間當天 00:00 的毫秒值 */
export function startOfDay(ms: number): number {
  const d = taipei(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TZ_OFFSET_MS
}

/** 台北時間本週一 00:00 */
export function startOfWeek(ms: number): number {
  const sod = startOfDay(ms)
  const dow = taipei(ms).getUTCDay() // 0 = 週日
  const back = (dow + 6) % 7
  return sod - back * DAY_MS
}

/** YYYY-MM-DD → 當天 00:00（台北） */
export function dateKeyToMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d) - TZ_OFFSET_MS
}

export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  return dateKey(dateKeyToMs(key)) === key
}
