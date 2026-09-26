import type { Transaction, User } from './types'

/** 某筆交易對某位學生餘額的影響（只有已完成的交易才算） */
export function deltaFor(tx: Transaction, uid: string): number {
  if (tx.status !== 'approved') return 0
  let d = 0
  if (tx.toUid === uid) d += tx.amount
  if (tx.fromUid === uid) d -= tx.amount
  return d
}

/** 交易是否算作本人的收入（用於顯示方向；審核中也適用） */
export function isIncomingFor(tx: Transaction, uid: string): boolean {
  return tx.toUid === uid && tx.fromUid !== uid
}

/**
 * 由目前餘額往回推算每筆交易後的結餘（交易文件不存餘額快照，以保護隱私）。
 * txs 必須依時間由新到舊排序，且包含最新的所有已完成交易。
 */
export function runningBalances(txs: Transaction[], currentBalance: number, uid: string): Map<string, number> {
  const out = new Map<string, number>()
  let bal = currentBalance
  for (const tx of txs) {
    if (tx.status !== 'approved') continue
    out.set(tx.id, bal)
    bal -= deltaFor(tx, uid)
  }
  return out
}

export interface ReconcileRow {
  uid: string
  name: string
  seatNo: number
  balance: number
  ledgerSum: number
  ok: boolean
}

/** 對帳：每位學生的「已完成交易加總」應等於帳戶餘額 */
export function reconcile(users: User[], txs: Transaction[]): ReconcileRow[] {
  const sums = new Map<string, number>()
  for (const tx of txs) {
    for (const uid of tx.participants) {
      sums.set(uid, (sums.get(uid) ?? 0) + deltaFor(tx, uid))
    }
  }
  return users
    .filter((u) => u.role === 'student')
    .map((u) => {
      const ledgerSum = sums.get(u.uid) ?? 0
      return { uid: u.uid, name: u.name, seatNo: u.seatNo, balance: u.balance, ledgerSum, ok: ledgerSum === u.balance }
    })
    .sort((a, b) => a.seatNo - b.seatNo)
}

/** 期間內收入與支出小計 */
export function periodTotals(txs: Transaction[], uid: string, since: number): { income: number; expense: number } {
  let income = 0
  let expense = 0
  for (const tx of txs) {
    if (tx.createdAt < since) continue
    const d = deltaFor(tx, uid)
    if (d > 0) income += d
    else expense -= d
  }
  return { income, expense }
}
