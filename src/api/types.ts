// BankApi：前端唯一依賴的資料存取介面。
// 目前實作：MockApi（瀏覽器內模擬資料庫）。之後移植 Firebase 時只要實作同一個介面（FirebaseApi）。
import type {
  Group, GroupAward, PaymentCode, Preset, PresetKind, Settings, Transaction,
  TransferCategory, TxType, User,
} from '../domain/types'
import type { RosterRow } from '../domain/roster'

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'TOO_MANY_ATTEMPTS'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'ALREADY_DECIDED'
  | 'CODE_INVALID'
  | 'SELF_TRANSFER'
  | 'RECIPIENT_DISABLED'
  | 'NOT_APPROVED'
  | 'ALREADY_REVERSED'
  | 'CANNOT_REVERSE_REVERSAL'
  | 'NEGATIVE_AFTER_REVERSAL'
  | 'DUPLICATE_AWARD'
  | 'ALREADY_SETUP'
  | 'CONFLICT'
  | 'NOT_SUPPORTED'
  | 'UNAVAILABLE'

export class BankError extends Error {
  constructor(public code: ErrorCode, message: string, public detail?: unknown) {
    super(message)
    this.name = 'BankError'
  }
}

export interface Session {
  uid: string
  role: 'student' | 'teacher'
}

export interface TransferInput {
  codeId: string
  amount: number
  category: TransferCategory
  note: string
}

export interface AdjustInput {
  uids: string[]
  kind: PresetKind
  amount: number
  title: string
  note: string
  presetId?: string | null
}

export interface GroupAwardInput {
  awardDate: string
  championIds: string[]
  runnerUpIds: string[]
  championAmount: number
  runnerUpAmount: number
  excludedUids: string[]
  confirmDuplicate?: boolean
}

export interface TxFilter {
  from?: number
  to?: number
  type?: TxType
  uid?: string
  status?: Transaction['status']
  batchId?: string
  limit?: number
}

export interface ItemResult {
  id: string
  ok: boolean
  error?: string
}

export interface DeleteResult {
  deleted: number
  rejectedPending: number
  forfeitedPoints: number
}

export interface ImportResult {
  created: number
  skipped: { account: string; reason: string }[]
}

export interface BankApi {
  readonly backend: 'mock' | 'firebase'

  // ---------- 系統 ----------
  needsSetup(): Promise<boolean>
  setupTeacher(name: string, password: string): Promise<void>

  // ---------- 登入 ----------
  login(account: string, password: string): Promise<Session>
  logout(): Promise<void>
  currentSession(): Session | null
  /** 等待登入狀態還原完成（Firebase 重新整理頁面後需要時間還原登入） */
  ready(): Promise<void>
  changePassword(oldPassword: string, newPassword: string): Promise<void>

  // ---------- 即時同步：任何資料變動時呼叫 ----------
  onChange(cb: () => void): () => void

  // ---------- 共用讀取 ----------
  getMe(): Promise<User>
  getSettings(): Promise<Settings>
  listGroups(): Promise<Group[]>

  // ---------- 學生 ----------
  listMyTransactions(limit?: number): Promise<Transaction[]>
  getTransaction(id: string): Promise<Transaction>
  listVisiblePresets(): Promise<Preset[]>
  createPaymentCode(): Promise<PaymentCode>
  getPaymentCode(codeId: string): Promise<PaymentCode>
  cancelPaymentCode(codeId: string): Promise<void>
  submitTransfer(input: TransferInput): Promise<Transaction>

  // ---------- 教師 ----------
  listStudents(): Promise<User[]>
  getStudent(uid: string): Promise<User>
  listTransactions(filter?: TxFilter): Promise<Transaction[]>
  listPending(): Promise<Transaction[]>
  approveTransfer(txId: string): Promise<Transaction>
  rejectTransfer(txId: string, reason: string): Promise<Transaction>
  approveMany(txIds: string[]): Promise<ItemResult[]>
  adjust(input: AdjustInput): Promise<Transaction[]>
  groupAward(input: GroupAwardInput): Promise<GroupAward>
  listGroupAwards(): Promise<GroupAward[]>
  reverse(txId: string, reason: string): Promise<Transaction>
  reverseBatch(batchId: string, reason: string): Promise<Transaction[]>

  listPresets(): Promise<Preset[]>
  savePreset(p: Omit<Preset, 'id'> & { id?: string }): Promise<Preset>
  /** 刪除加點項目 / 小確幸；已發生的交易保留原本的項目名稱，不受影響 */
  deletePreset(id: string): Promise<void>

  saveGroup(g: Omit<Group, 'id'> & { id?: string }): Promise<Group>
  assignGroup(uid: string, groupId: string | null): Promise<void>

  importStudents(rows: RosterRow[]): Promise<ImportResult>
  updateStudent(uid: string, patch: { name?: string; seatNo?: number; active?: boolean }): Promise<User>
  setStudentsActive(uids: string[], active: boolean): Promise<number>
  /** 刪除學生帳號（登入資料一併刪除）；交易紀錄保留，涉及的審核中轉帳自動駁回。全有全無。 */
  deleteStudents(uids: string[]): Promise<DeleteResult>
  resetPassword(uid: string, newPassword: string): Promise<void>
  saveSettings(s: Partial<Settings>): Promise<Settings>

  exportAll(): Promise<Record<string, unknown>>

  /** 僅模擬資料庫：協助判斷「在別的網址 / 瀏覽器匯入」這類問題 */
  mockDiagnostics?(account?: string): { studentCount: number; accountExists: boolean | null }
}
