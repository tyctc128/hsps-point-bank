// 模擬資料庫：整份資料以單一 JSON 存在 localStorage。
// transact() 在記憶體副本上執行所有修改，全部成功才一次寫回 → 全有全無（對應 Firestore runTransaction）。
import type {
  Group, GroupAward, PaymentCode, Preset, Settings, Transaction, User,
} from '../../domain/types'
import { DEFAULT_SETTINGS } from '../../domain/types'
import type { PasswordHash } from './crypto'
import { BankError } from '../types'

export interface Credential extends PasswordHash {
  uid: string
}

export interface DbState {
  schema: 1
  rev: number
  users: Record<string, User>
  creds: Record<string, Credential>          // key = 帳號（小寫）
  transactions: Record<string, Transaction>
  paymentCodes: Record<string, PaymentCode>
  presets: Record<string, Preset>
  groups: Record<string, Group>
  groupAwards: Record<string, GroupAward>
  settings: Settings
  loginAttempts: Record<string, { count: number; lockedUntil: number }>
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function emptyState(): DbState {
  return {
    schema: 1,
    rev: 0,
    users: {},
    creds: {},
    transactions: {},
    paymentCodes: {},
    presets: {},
    groups: {},
    groupAwards: {},
    settings: { ...DEFAULT_SETTINGS },
    loginAttempts: {},
  }
}

export class MemoryStorage implements StorageLike {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

export interface StoreFaults {
  /** 測試用：在寫回前拋出錯誤，模擬中途失敗 / 斷線 */
  failBeforeCommit?: boolean
}

export class MockStore {
  private cacheRaw: string | null = null
  private cacheState: DbState | null = null
  private listeners = new Set<() => void>()
  private channel: BroadcastChannel | null = null
  faults: StoreFaults = {}

  constructor(private storage: StorageLike, private key = 'hsps-bank-db', broadcast = true) {
    if (broadcast && typeof BroadcastChannel !== 'undefined' && typeof window !== 'undefined') {
      this.channel = new BroadcastChannel(`${key}-changes`)
      this.channel.onmessage = () => this.emit()
      window.addEventListener('storage', (e) => { if (e.key === key) this.emit() })
    }
  }

  /** 讀取目前狀態（唯讀，請勿修改回傳值） */
  read(): DbState {
    const raw = this.storage.getItem(this.key)
    if (raw === null) return emptyState()
    if (raw !== this.cacheRaw) {
      this.cacheState = JSON.parse(raw) as DbState
      this.cacheRaw = raw
    }
    return this.cacheState!
  }

  /**
   * 原子交易：fn 在深拷貝上修改；fn 拋錯或寫回前失敗時，資料完全不變。
   * 寫回前再次比對版本號，若他處（其他分頁）已修改則以最新資料重試，最多 5 次。
   */
  transact<T>(fn: (draft: DbState) => T): T {
    for (let attempt = 0; attempt < 5; attempt++) {
      const base = this.read()
      const draft: DbState = structuredClone(base)
      const result = fn(draft)
      if (this.faults.failBeforeCommit) throw new BankError('UNAVAILABLE', '連線中斷（模擬）')
      if (this.read().rev !== base.rev) continue // 衝突，重試
      draft.rev = base.rev + 1
      const raw = JSON.stringify(draft)
      this.storage.setItem(this.key, raw)
      this.cacheRaw = raw
      this.cacheState = draft
      this.emit()
      this.channel?.postMessage(draft.rev)
      return result
    }
    throw new BankError('CONFLICT', '資料同時被修改，請再試一次')
  }

  reset(): void {
    this.storage.removeItem(this.key)
    this.cacheRaw = null
    this.cacheState = null
    this.emit()
    this.channel?.postMessage('reset')
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit() {
    for (const cb of [...this.listeners]) {
      try { cb() } catch (e) { console.error(e) }
    }
  }
}
