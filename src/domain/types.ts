// 資料模型：與 SDD 第 4 章一致。模擬資料庫與未來的 Firestore 使用同一組型別。

export type Role = 'student' | 'teacher'

export interface User {
  uid: string
  role: Role
  account: string        // 登入帳號（學生為學號帳號，例如 hs000001；教師為 teacher）
  name: string
  seatNo: number         // 座號（教師為 0）
  groupId: string | null
  balance: number        // 餘額：帳本加總的快取，只有教師操作能改變
  active: boolean
  createdAt: number
  updatedAt: number
}

export type TxType = 'reward' | 'penalty' | 'transfer' | 'groupReward' | 'reversal'
export type TxStatus = 'pending' | 'approved' | 'rejected'
export type TransferCategory = 'buy' | 'repay' | 'gift' | 'other'

export interface GroupInfo {
  id: string
  name: string
  rank: 1 | 2
  tied: boolean
  awardDate: string      // YYYY-MM-DD（Asia/Taipei）
}

export interface Transaction {
  id: string
  type: TxType
  amount: number                 // 一律正整數；方向由 from / to 決定
  fromUid: string | null         // null = 銀行（加點）
  toUid: string | null           // null = 銀行（扣點）
  fromName: string | null
  toName: string | null
  fromSeatNo: number | null
  toSeatNo: number | null
  participants: string[]         // 涉及的學生 uid
  status: TxStatus
  title: string                  // 摘要
  note: string                   // 事由
  category: TransferCategory | null
  presetId: string | null
  batchId: string | null
  group: GroupInfo | null
  codeId: string | null
  reversalOf: string | null
  reversedBy: string | null
  rejectReason: string | null
  createdBy: string
  createdAt: number
  decidedBy: string | null
  decidedAt: number | null
}

export interface PaymentCode {
  id: string
  toUid: string
  toName: string
  toSeatNo: number
  createdAt: number
  expiresAt: number
  used: boolean
  usedBy: string | null
  txId: string | null
}

export type PresetKind = 'add' | 'deduct'

/** 加點項目與小確幸（kind = deduct 且 showToStudents = true 者即為前台的「小確幸」） */
export interface Preset {
  id: string
  kind: PresetKind
  name: string
  description: string
  amount: number
  icon: string
  sortOrder: number
  active: boolean
  showToStudents: boolean
}

export interface Group {
  id: string
  name: string
  color: string
  sortOrder: number
  active: boolean
}

export interface GroupAward {
  id: string            // = batchId
  awardDate: string
  champions: { id: string; name: string }[]
  runnersUp: { id: string; name: string }[]
  championAmount: number
  runnerUpAmount: number
  recipients: string[]
  excluded: string[]
  total: number
  reversed: boolean
  createdBy: string
  createdAt: number
}

export interface Settings {
  className: string
  codeTtlMinutes: number
  championAmount: number
  runnerUpAmount: number
}

export const CATEGORY_LABEL: Record<TransferCategory, string> = {
  buy: '買東西',
  repay: '還錢',
  gift: '贈送',
  other: '其他',
}

export const TYPE_LABEL: Record<TxType, string> = {
  reward: '加點',
  penalty: '扣點',
  transfer: '轉帳',
  groupReward: '小組獎勵',
  reversal: '沖正',
}

export const STATUS_LABEL: Record<TxStatus, string> = {
  pending: '審核中',
  approved: '已完成',
  rejected: '已駁回',
}

export const DEFAULT_SETTINGS: Settings = {
  className: 'HSPS 班級',
  codeTtlMinutes: 3,
  championAmount: 500,
  runnerUpAmount: 300,
}
