// 教師端常用操作：統一處理確認、錯誤訊息與「復原」
import { api } from '../api'
import type { Transaction } from '../domain/types'
import { formatPoints } from '../domain/money'
import { confirmDialog, promptDialog, toast } from './feedback'

export async function approveTx(tx: Transaction): Promise<boolean> {
  try {
    await api.approveTransfer(tx.id)
    toast.ok(`已核准：${tx.fromName} → ${tx.toName} ${formatPoints(tx.amount)} 點`)
    return true
  } catch (e) {
    toast.error(e)
    return false
  }
}

export async function rejectTx(tx: Transaction): Promise<boolean> {
  const reason = await promptDialog({
    title: '駁回轉帳申請',
    message: `${tx.fromName} → ${tx.toName} ${formatPoints(tx.amount)} 點\n駁回後點數不會變動，學生看得到駁回原因。`,
    label: '駁回原因（選填）', placeholder: '例如：事由不清楚', required: false, okText: '駁回', danger: true,
  })
  if (reason === null) return false
  try {
    await api.rejectTransfer(tx.id, reason)
    toast.ok('已駁回')
    return true
  } catch (e) {
    toast.error(e)
    return false
  }
}

export async function reverseTx(tx: Transaction): Promise<boolean> {
  const reason = await promptDialog({
    title: '沖正這筆交易',
    message: `「${tx.title}」${formatPoints(tx.amount)} 點\n系統會新增一筆反向交易抵銷它，原交易保留並標示「已沖正」。`,
    label: '沖正原因', placeholder: '例如：老師誤扣', okText: '沖正', danger: true,
  })
  if (!reason) return false
  try {
    await api.reverse(tx.id, reason)
    toast.ok('已沖正')
    return true
  } catch (e) {
    toast.error(e)
    return false
  }
}

export async function reverseBatchById(batchId: string, count: number): Promise<boolean> {
  const reason = await promptDialog({
    title: '整批沖正',
    message: `這個批次共 ${count} 筆交易，將全部沖正（全部成功或全部不執行）。`,
    label: '沖正原因', placeholder: '例如：選錯組別', okText: '整批沖正', danger: true,
  })
  if (!reason) return false
  try {
    const r = await api.reverseBatch(batchId, reason)
    toast.ok(`已沖正 ${r.length} 筆`)
    return true
  } catch (e) {
    toast.error(e)
    return false
  }
}

/** 加扣點後提供「復原」：立即沖正剛剛那一筆或那一批 */
export function undoAction(txs: Transaction[]) {
  return {
    label: '復原',
    run: async () => {
      try {
        if (txs.length === 1) await api.reverse(txs[0].id, '老師復原')
        else if (txs[0]?.batchId) await api.reverseBatch(txs[0].batchId, '老師復原')
        toast.ok('已復原（沖正）')
      } catch (e) {
        toast.error(e)
      }
    },
  }
}

export { confirmDialog }
