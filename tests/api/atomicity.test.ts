// 全有全無（BR-17）：在寫回前模擬失敗 / 斷線，驗證資料庫完全維持原狀。
import { describe, expect, it } from 'vitest'
import { makeWorld, expectCode, FB } from './helpers'

async function snapshotUnchanged(w: Awaited<ReturnType<typeof makeWorld>>, op: () => Promise<unknown>) {
  const before = w.storage.getItem('test-db')
  w.store.faults.failBeforeCommit = true
  try {
    await expectCode(op(), 'UNAVAILABLE')
  } finally {
    w.store.faults.failBeforeCommit = false
  }
  expect(w.storage.getItem('test-db')).toBe(before)
}

// 以「寫回前模擬斷線」驗證模擬資料庫；Firebase 版的原子性由 Firestore 交易保證，並在 tests/rules 驗證批次寫入的綁定
describe.skipIf(FB)('原子性：中途失敗時資料不變', () => {
  it('送出轉帳：交易與收款碼標記都不會只完成一半', async () => {
    const w = await makeWorld(2)
    await w.give('s01', 1000)
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    await snapshotUnchanged(w, () => payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: 'x' }))
    expect((await payee.getPaymentCode(code.id)).used).toBe(false)
    expect((await w.teacher.listPending()).length).toBe(0)
  })

  it('核准轉帳：不會出現「付款人扣了、收款人沒加」', async () => {
    const w = await makeWorld(2)
    await w.give('s01', 1000)
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 400, category: 'buy', note: 'x' })
    await snapshotUnchanged(w, () => w.teacher.approveTransfer(tx.id))
    expect(await w.balanceOf('s01')).toBe(1000)
    expect(await w.balanceOf('s02')).toBe(0)
    expect((await w.teacher.getTransaction(tx.id)).status).toBe('pending')
    await w.teacher.approveTransfer(tx.id) // 恢復連線後可正常核准
    expect(await w.balanceOf('s01')).toBe(600)
    expect(await w.balanceOf('s02')).toBe(400)
  })

  it('批次加點、小組獎勵、整批沖正', async () => {
    const w = await makeWorld(4)
    const all = w.students.map((s) => s.uid)
    await snapshotUnchanged(w, () => w.teacher.adjust({ uids: all, kind: 'add', amount: 100, title: 'x', note: '' }))
    const g = (await w.teacher.listGroups())[0].id
    await snapshotUnchanged(w, () => w.teacher.groupAward({ awardDate: '2026-09-26', championIds: [g], runnerUpIds: [], championAmount: 500, runnerUpAmount: 300, excludedUids: [] }))
    const award = await w.teacher.groupAward({ awardDate: '2026-09-26', championIds: [g], runnerUpIds: [], championAmount: 500, runnerUpAmount: 300, excludedUids: [] })
    await snapshotUnchanged(w, () => w.teacher.reverseBatch(award.id, 'x'))
  })

  it('業務規則失敗（例如餘額不足）同樣不留下任何部分結果', async () => {
    const w = await makeWorld(3)
    await w.give('s01', 1000)
    const before = w.storage.getItem('test-db')
    await expectCode(w.teacher.adjust({ uids: w.students.map((s) => s.uid), kind: 'deduct', amount: 500, title: 'x', note: '' }), 'INSUFFICIENT_BALANCE')
    expect(w.storage.getItem('test-db')).toBe(before)
  })
})
