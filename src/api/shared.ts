// 模擬資料庫與 Firebase 版共用的驗證與建構函式（業務規則只寫一次）
import type { Transaction, TransferCategory } from '../domain/types'
import { MAX_AMOUNT, formatPoints } from '../domain/money'
import { BankError } from './types'

export const CATEGORIES: TransferCategory[] = ['buy', 'repay', 'gift', 'other']

export function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

export function assertAmount(n: unknown): asserts n is number {
  if (!isInt(n) || n <= 0 || n > MAX_AMOUNT) {
    throw new BankError('INVALID_ARGUMENT', `點數必須是 1～${formatPoints(MAX_AMOUNT)} 的整數`)
  }
}

export function assertText(s: unknown, label: string, max: number, required = true): string {
  if (typeof s !== 'string') throw new BankError('INVALID_ARGUMENT', `${label}格式錯誤`)
  const t = s.trim()
  if (required && !t) throw new BankError('INVALID_ARGUMENT', `請填寫${label}`)
  if (t.length > max) throw new BankError('INVALID_ARGUMENT', `${label}最多 ${max} 字`)
  return t
}

export function baseTx(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount' | 'title' | 'createdBy' | 'createdAt'>): Transaction {
  return {
    fromUid: null, toUid: null, fromName: null, toName: null, fromSeatNo: null, toSeatNo: null,
    participants: [], status: 'approved', note: '', category: null, presetId: null, batchId: null,
    group: null, codeId: null, reversalOf: null, reversedBy: null, rejectReason: null,
    decidedBy: null, decidedAt: null,
    ...partial,
  }
}
