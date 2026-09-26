// Excel 匯入 / 匯出（SheetJS）。匯入的名冊只在瀏覽器內解析，不會上傳到任何地方。
import * as XLSX from 'xlsx'
import type { Group, Transaction, User } from '../domain/types'
import { CATEGORY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../domain/types'
import { formatDateTime } from '../domain/dates'
import { dateKey } from '../domain/dates'

export async function readSheet(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false })
}

function download(rows: Record<string, unknown>[], sheet: string, filename: string, format: 'xlsx' | 'csv') {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, filename, { bookType: format })
}

export function exportTransactions(txs: Transaction[], format: 'xlsx' | 'csv' = 'xlsx') {
  const rows = txs.map((t) => ({
    時間: formatDateTime(t.createdAt),
    類型: TYPE_LABEL[t.type],
    摘要: t.title,
    付款方: t.fromName ? `${t.fromName}${t.fromSeatNo ? `（${t.fromSeatNo}）` : ''}` : '銀行',
    收款方: t.toName ? `${t.toName}${t.toSeatNo ? `（${t.toSeatNo}）` : ''}` : '銀行',
    點數: t.amount,
    分類: t.category ? CATEGORY_LABEL[t.category] : '',
    事由: t.note,
    狀態: t.reversedBy ? '已沖正' : STATUS_LABEL[t.status],
    駁回原因: t.rejectReason ?? '',
    小組: t.group ? `${t.group.name}（${t.group.rank === 1 ? '冠軍' : '亞軍'}）` : '',
    批次編號: t.batchId ?? '',
    交易編號: t.id,
    沖正原交易: t.reversalOf ?? '',
    審核時間: t.decidedAt ? formatDateTime(t.decidedAt) : '',
  }))
  download(rows, '交易紀錄', `交易紀錄_${dateKey(Date.now())}.${format}`, format)
}

export function exportStudents(users: User[], groups: Group[]) {
  const gName = new Map(groups.map((g) => [g.id, g.name]))
  const rows = users.map((u) => ({ 座號: u.seatNo, 姓名: u.name, 帳號: u.account, 組別: gName.get(u.groupId ?? '') ?? '', 點數: u.balance, 狀態: u.active ? '使用中' : '已停用' }))
  download(rows, '學生帳戶', `學生帳戶_${dateKey(Date.now())}.xlsx`, 'xlsx')
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
