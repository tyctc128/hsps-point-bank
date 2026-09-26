// 模擬資料庫的密碼雜湊（PBKDF2-SHA256）。正式版改由 Firebase Auth 在伺服器端處理。
import { toHalfWidth } from '../../domain/roster'

export interface PasswordHash {
  salt: string
  hash: string
  iter: number
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(password: string, salt: Uint8Array, iter: number): Promise<string> {
  // 全形英數一律視為半形（避免中文輸入法造成密碼不符）
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(toHalfWidth(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256)
  return toB64(bits)
}

export async function hashPassword(password: string, iter = 100_000): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { salt: toB64(salt), hash: await derive(password, salt, iter), iter }
}

export async function verifyPassword(password: string, h: PasswordHash): Promise<boolean> {
  const got = await derive(password, fromB64(h.salt), h.iter)
  // 固定時間比較
  if (got.length !== h.hash.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ h.hash.charCodeAt(i)
  return diff === 0
}
