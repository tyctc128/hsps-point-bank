import type { Transaction } from '../domain/types'
import { CATEGORY_LABEL, TYPE_LABEL } from '../domain/types'
import { formatRelative } from '../domain/dates'

export interface TxView {
  title: string
  sub: string
  signed: number          // 對檢視者的方向：正 = 收入，負 = 支出（審核中 / 駁回也標方向，但不計入餘額）
  icon: string
  tone: 'in' | 'out' | 'wait' | 'gray'
  status: { text: string; cls: string } | null
  struck: boolean
}

function who(name: string | null, seat: number | null): string {
  if (!name) return '銀行'
  return seat ? `${name}（${seat} 號）` : name
}

/** 從某位學生（viewerUid）的角度描述一筆交易；viewerUid 為 null 時為教師視角 */
export function describeTx(tx: Transaction, viewerUid: string | null, now = Date.now()): TxView {
  const time = formatRelative(tx.createdAt, now)
  let signed: number
  if (viewerUid) signed = tx.toUid === viewerUid ? tx.amount : tx.fromUid === viewerUid ? -tx.amount : 0
  else signed = tx.toUid && !tx.fromUid ? tx.amount : tx.fromUid && !tx.toUid ? -tx.amount : tx.amount

  let title = tx.title
  const parts: string[] = []
  let icon = signed >= 0 ? 'star' : 'gift'

  if (tx.type === 'transfer') {
    icon = signed >= 0 ? 'arrow-left' : 'arrow-right'
    if (!viewerUid) title = `${who(tx.fromName, tx.fromSeatNo)} → ${who(tx.toName, tx.toSeatNo)}`
    else title = signed < 0 ? `轉帳給 ${who(tx.toName, tx.toSeatNo)}` : `收到 ${who(tx.fromName, tx.fromSeatNo)}`
    if (tx.category) parts.push(CATEGORY_LABEL[tx.category])
    if (tx.note) parts.push(tx.note)
  } else if (tx.type === 'groupReward') {
    icon = 'trophy'
    if (!viewerUid) title = `${tx.title} → ${who(tx.toName, tx.toSeatNo)}`
    if (tx.note) parts.push(tx.note)
  } else if (tx.type === 'reversal') {
    icon = 'undo'
    if (!viewerUid) {
      const target = tx.fromUid && tx.toUid ? `${who(tx.fromName, tx.fromSeatNo)} → ${who(tx.toName, tx.toSeatNo)}` : who(tx.toName ?? tx.fromName, tx.toSeatNo ?? tx.fromSeatNo)
      title = `${tx.title}（${target}）`
    }
    parts.push(tx.note ? `更正：${tx.note}` : '老師更正')
  } else {
    if (!viewerUid) title = `${tx.title} → ${who(tx.toName ?? tx.fromName, tx.toSeatNo ?? tx.fromSeatNo)}`
    parts.push(tx.note || (tx.type === 'reward' ? '老師加點' : '老師扣點'))
  }
  parts.push(time)

  let tone: TxView['tone'] = signed >= 0 ? 'in' : 'out'
  let status: TxView['status'] = null
  if (tx.status === 'pending') { tone = 'wait'; status = { text: '審核中', cls: 'amber' } }
  else if (tx.status === 'rejected') { tone = 'gray'; status = { text: '已駁回', cls: 'gray' } }
  if (tx.reversedBy) { tone = 'gray'; status = { text: '已沖正', cls: 'gray' } }

  return { title, sub: parts.join(' · '), signed, icon, tone, status, struck: !!tx.reversedBy || tx.status === 'rejected' }
}

export { TYPE_LABEL }
