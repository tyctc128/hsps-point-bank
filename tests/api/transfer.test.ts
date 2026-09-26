import { describe, expect, it } from 'vitest'
import { makeWorld, expectCode, eventually, FB } from './helpers'

async function setup() {
  const w = await makeWorld(4)
  await w.give('s01', 1000) // 付款人
  const payer = await w.as('s01')
  const payee = await w.as('s02')
  return { w, payer, payee }
}

describe('QR 轉帳：送出申請', () => {
  it('收款碼為 8 碼、預設 3 分鐘有效', async () => {
    const { w, payee } = await setup()
    const code = await payee.createPaymentCode()
    expect(code.id).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(code.expiresAt - code.createdAt).toBe(3 * 60_000)
    expect(code.toName).toBe(w.byAccount('s02').name)
  })

  it('送出後為審核中，雙方餘額都不變', async () => {
    const { w, payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 200, category: 'buy', note: '買手作書籤' })
    expect(tx.status).toBe('pending')
    expect(await w.balanceOf('s01')).toBe(1000)
    expect(await w.balanceOf('s02')).toBe(0)
  })

  it('付款人與收款人都看得到同一筆交易的完整細目（對象、事由、金額、狀態）', async () => {
    const { payer, payee, w } = await setup()
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 200, category: 'buy', note: '買手作書籤' })
    const a = await payer.getTransaction(tx.id)
    const b = await payee.getTransaction(tx.id)
    for (const t of [a, b]) {
      expect(t.fromName).toBe(w.byAccount('s01').name)
      expect(t.fromSeatNo).toBe(1)
      expect(t.toName).toBe(w.byAccount('s02').name)
      expect(t.toSeatNo).toBe(2)
      expect(t.note).toBe('買手作書籤')
      expect(t.category).toBe('buy')
      expect(t.amount).toBe(200)
      expect(t.status).toBe('pending')
    }
    await eventually(async () => expect((await payee.listMyTransactions()).map((t) => t.id)).toContain(tx.id))
  })

  it('交易資料中不含任何餘額資訊（保護隱私）', async () => {
    const { payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 200, category: 'gift', note: '生日禮物' })
    const seen = JSON.stringify(await payee.getTransaction(tx.id))
    expect(seen).not.toMatch(/balance/i)
  })

  it('收款碼只能使用一次（截圖轉傳無效）', async () => {
    const { w, payer, payee } = await setup()
    await w.give('s03', 500)
    const other = await w.as('s03')
    const code = await payee.createPaymentCode()
    await payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: '第一次' })
    await expectCode(other.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: '第二次' }), 'CODE_INVALID')
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: '重送' }), 'CODE_INVALID')
    await eventually(async () => expect((await w.teacher.listPending()).length).toBe(1))
  })

  // Firebase 版的過期檢查由 firestore.rules 以伺服器時間執行，見 tests/rules
  it.skipIf(FB)('收款碼過期後無法使用', async () => {
    const { w, payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    w.clock.t += 3 * 60_000
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: 'x' }), 'CODE_INVALID')
  })

  it('收款人離開頁面時取消收款碼，之後無法使用', async () => {
    const { payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    await payee.cancelPaymentCode(code.id)
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: 'x' }), 'CODE_INVALID')
  })

  it('不存在或格式錯誤的代碼', async () => {
    const { payer } = await setup()
    await expectCode(payer.getPaymentCode('ZZZZZZZZ'), 'CODE_INVALID')
    await expectCode(payer.getPaymentCode('<script>'), 'CODE_INVALID')
    await expectCode(payer.submitTransfer({ codeId: 'IO01IO01', amount: 1, category: 'buy', note: 'x' }), 'CODE_INVALID')
  })

  it('手動輸入代碼可忽略大小寫與空白', async () => {
    const { payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    const got = await payer.getPaymentCode(` ${code.id.slice(0, 4).toLowerCase()} ${code.id.slice(4)} `)
    expect(got.id).toBe(code.id)
  })

  it('不能付款給自己', async () => {
    const { payer } = await setup()
    const code = await payer.createPaymentCode()
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: 'x' }), 'SELF_TRANSFER')
  })

  it('金額必須是正整數且不超過餘額', async () => {
    const { payer, payee } = await setup()
    for (const amount of [0, -5, 1.5, NaN, '100' as unknown as number]) {
      const code = await payee.createPaymentCode()
      await expectCode(payer.submitTransfer({ codeId: code.id, amount, category: 'buy', note: 'x' }), 'INVALID_ARGUMENT')
    }
    const code = await payee.createPaymentCode()
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 1001, category: 'buy', note: 'x' }), 'INSUFFICIENT_BALANCE')
  })

  it('分類必選、事由必填且最多 50 字', async () => {
    const { payer, payee } = await setup()
    let code = await payee.createPaymentCode()
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 10, category: 'xxx' as never, note: 'x' }), 'INVALID_ARGUMENT')
    code = await payee.createPaymentCode()
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 10, category: 'buy', note: '   ' }), 'INVALID_ARGUMENT')
    code = await payee.createPaymentCode()
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 10, category: 'buy', note: '字'.repeat(51) }), 'INVALID_ARGUMENT')
  })

  it('失敗的申請不會消耗收款碼（全有全無）', async () => {
    const { payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 99999, category: 'buy', note: 'x' }), 'INSUFFICIENT_BALANCE')
    const again = await payee.getPaymentCode(code.id)
    expect(again.used).toBe(false)
    await payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: 'x' })
  })

  it('收款人帳號被停用時無法付款給他', async () => {
    const { w, payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    await w.teacher.updateStudent(w.byAccount('s02').uid, { active: false })
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: 'x' }), 'RECIPIENT_DISABLED')
  })
})

describe('QR 轉帳：教師審核', () => {
  it('核准後付款人扣點、收款人加點、狀態為已完成', async () => {
    const { w, payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 200, category: 'buy', note: '書籤' })
    const done = await w.teacher.approveTransfer(tx.id)
    expect(done.status).toBe('approved')
    expect(done.decidedBy).toBeTruthy()
    expect(await w.balanceOf('s01')).toBe(800)
    expect(await w.balanceOf('s02')).toBe(200)
    expect((await payee.getTransaction(tx.id)).status).toBe('approved')
  })

  it('同一筆重複核准只生效一次', async () => {
    const { w, payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 200, category: 'buy', note: 'x' })
    await w.teacher.approveTransfer(tx.id)
    await expectCode(w.teacher.approveTransfer(tx.id), 'ALREADY_DECIDED')
    await expectCode(w.teacher.rejectTransfer(tx.id, 'x'), 'ALREADY_DECIDED')
    expect(await w.balanceOf('s01')).toBe(800)
  })

  it('兩台教師裝置同時核准同一筆，只成功一次', async () => {
    const { w, payer, payee } = await setup()
    const t2 = w.device()
    await t2.login('teacher', 'teacher-pass')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 300, category: 'buy', note: 'x' })
    const results = await Promise.allSettled([w.teacher.approveTransfer(tx.id), t2.approveTransfer(tx.id)])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1)
    expect(await w.balanceOf('s01')).toBe(700)
    expect(await w.balanceOf('s02')).toBe(300)
  })

  it('多筆申請總額超過餘額：逐筆核准，到餘額不足那筆被擋下', async () => {
    const { w, payer, payee } = await setup()
    const ids: string[] = []
    for (const amount of [600, 300, 200]) {
      const code = await payee.createPaymentCode()
      ids.push((await payer.submitTransfer({ codeId: code.id, amount, category: 'buy', note: 'x' })).id)
    }
    await w.teacher.approveTransfer(ids[0])
    await w.teacher.approveTransfer(ids[1])
    await expectCode(w.teacher.approveTransfer(ids[2]), 'INSUFFICIENT_BALANCE')
    expect(await w.balanceOf('s01')).toBe(100)
    expect((await w.teacher.getTransaction(ids[2])).status).toBe('pending')
  })

  it('核准所選：依送出順序逐筆處理並回報各自結果', async () => {
    const { w, payer, payee } = await setup()
    const ids: string[] = []
    for (const amount of [700, 400]) {
      w.clock.t += 1000
      const code = await payee.createPaymentCode()
      ids.push((await payer.submitTransfer({ codeId: code.id, amount, category: 'buy', note: 'x' })).id)
    }
    const res = await w.teacher.approveMany([ids[1], ids[0]])
    expect(res.find((r) => r.id === ids[0])!.ok).toBe(true)
    expect(res.find((r) => r.id === ids[1])!.ok).toBe(false)
  })

  it('駁回後餘額不變，學生看得到駁回原因', async () => {
    const { w, payer, payee } = await setup()
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 200, category: 'other', note: 'x' })
    await w.teacher.rejectTransfer(tx.id, '事由不清楚')
    expect(await w.balanceOf('s01')).toBe(1000)
    const seen = await payer.getTransaction(tx.id)
    expect(seen.status).toBe('rejected')
    expect(seen.rejectReason).toBe('事由不清楚')
  })
})
