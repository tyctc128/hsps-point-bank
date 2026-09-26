import { describe, expect, it } from 'vitest'
import { makeWorld, expectCode } from './helpers'
import { eventually, FB } from './helpers'
import { reconcile } from '../../src/domain/ledger'

describe('加扣點與批次', () => {
  it('個別加點與扣點', async () => {
    const w = await makeWorld(2)
    const uid = w.byAccount('s01').uid
    await w.teacher.adjust({ uids: [uid], kind: 'add', amount: 3000, title: '表現優良', note: '' })
    await w.teacher.adjust({ uids: [uid], kind: 'deduct', amount: 800, title: '午休看課外書', note: '' })
    expect(await w.balanceOf('s01')).toBe(2200)
    const txs = await w.teacher.listTransactions({ uid })
    expect(txs.map((t) => t.type).sort()).toEqual(['penalty', 'reward'])
    expect(txs.every((t) => t.batchId === null)).toBe(true)
  })

  it('批次加點：每人一筆交易，共用批次編號', async () => {
    const w = await makeWorld(6)
    const txs = await w.teacher.adjust({ uids: w.students.map((s) => s.uid), kind: 'add', amount: 1000, title: '開學禮', note: '' })
    expect(txs.length).toBe(6)
    expect(new Set(txs.map((t) => t.batchId)).size).toBe(1)
    for (const s of w.students) expect(await w.balanceOf(s.account)).toBe(1000)
  })

  it('批次扣點時有人點數不足：整批不執行，並列出不足名單', async () => {
    const w = await makeWorld(3)
    await w.give('s01', 500)
    await w.give('s02', 100)
    const err = await w.teacher.adjust({ uids: w.students.map((s) => s.uid), kind: 'deduct', amount: 300, title: '扣點', note: '' }).catch((e) => e)
    expect(err.code).toBe('INSUFFICIENT_BALANCE')
    expect(err.detail).toEqual([w.byAccount('s02').uid, w.byAccount('s03').uid])
    expect(await w.balanceOf('s01')).toBe(500) // 全部不變
    expect(await w.balanceOf('s02')).toBe(100)
  })

  it('金額與項目名稱驗證', async () => {
    const w = await makeWorld(1)
    const uid = w.byAccount('s01').uid
    await expectCode(w.teacher.adjust({ uids: [], kind: 'add', amount: 10, title: 'x', note: '' }), 'INVALID_ARGUMENT')
    await expectCode(w.teacher.adjust({ uids: [uid], kind: 'add', amount: 0, title: 'x', note: '' }), 'INVALID_ARGUMENT')
    await expectCode(w.teacher.adjust({ uids: [uid], kind: 'add', amount: 1_000_001, title: 'x', note: '' }), 'INVALID_ARGUMENT')
    await expectCode(w.teacher.adjust({ uids: [uid], kind: 'add', amount: 10, title: ' ', note: '' }), 'INVALID_ARGUMENT')
    await expectCode(w.teacher.adjust({ uids: ['nobody'], kind: 'add', amount: 10, title: 'x', note: '' }), 'NOT_FOUND')
  })
})

describe('小組獎勵', () => {
  async function groupsOf(w: Awaited<ReturnType<typeof makeWorld>>) {
    const gs = await w.teacher.listGroups()
    return (n: number) => gs.find((g) => g.name === `第 ${n} 組`)!.id
  }

  it('並列冠軍 + 亞軍 + 請假排除', async () => {
    const w = await makeWorld(8) // 每組 2 人：第1組 s01,s05；第2組 s02,s06；第3組 s03,s07；第4組 s04,s08
    const g = await groupsOf(w)
    const award = await w.teacher.groupAward({
      awardDate: '2026-09-26', championIds: [g(1), g(2)], runnerUpIds: [g(3)],
      championAmount: 500, runnerUpAmount: 300, excludedUids: [w.byAccount('s06').uid],
    })
    expect(award.recipients.length).toBe(5)
    expect(award.total).toBe(3 * 500 + 2 * 300)
    expect(await w.balanceOf('s01')).toBe(500)
    expect(await w.balanceOf('s06')).toBe(0) // 請假
    expect(await w.balanceOf('s03')).toBe(300)
    expect(await w.balanceOf('s04')).toBe(0)
    const tx = (await (await w.as('s01')).listMyTransactions())[0]
    expect(tx.title).toBe('小組冠軍（第 1 組）')
    expect(tx.group?.tied).toBe(true)
  })

  it('同一組不能同時是冠軍和亞軍', async () => {
    const w = await makeWorld(4)
    const g = await groupsOf(w)
    await expectCode(w.teacher.groupAward({ awardDate: '2026-09-26', championIds: [g(1)], runnerUpIds: [g(1)], championAmount: 500, runnerUpAmount: 300, excludedUids: [] }), 'INVALID_ARGUMENT')
  })

  it('同一天重複發放需要確認', async () => {
    const w = await makeWorld(4)
    const g = await groupsOf(w)
    const input = { awardDate: '2026-09-26', championIds: [g(1)], runnerUpIds: [], championAmount: 500, runnerUpAmount: 300, excludedUids: [] }
    await w.teacher.groupAward(input)
    await expectCode(w.teacher.groupAward(input), 'DUPLICATE_AWARD')
    await w.teacher.groupAward({ ...input, confirmDuplicate: true })
    expect(await w.balanceOf('s01')).toBe(1000)
  })

  it('整批沖正後可以同日重新發放，餘額全部還原', async () => {
    const w = await makeWorld(4)
    const g = await groupsOf(w)
    const input = { awardDate: '2026-09-26', championIds: [g(1), g(2)], runnerUpIds: [], championAmount: 500, runnerUpAmount: 300, excludedUids: [] }
    const a = await w.teacher.groupAward(input)
    await w.teacher.reverseBatch(a.id, '選錯組別')
    for (const s of w.students) expect(await w.balanceOf(s.account)).toBe(0)
    expect((await w.teacher.listGroupAwards())[0].reversed).toBe(true)
    await w.teacher.groupAward(input) // 不需確認
  })
})

describe('沖正', () => {
  it('沖正產生反向交易，原交易標記已沖正', async () => {
    const w = await makeWorld(1)
    const uid = w.byAccount('s01').uid
    await w.give('s01', 1000)
    const [tx] = await w.teacher.adjust({ uids: [uid], kind: 'deduct', amount: 300, title: '上課講話', note: '' })
    const rev = await w.teacher.reverse(tx.id, '老師誤扣')
    expect(rev.type).toBe('reversal')
    expect(rev.reversalOf).toBe(tx.id)
    expect(rev.toUid).toBe(uid)
    expect((await w.teacher.getTransaction(tx.id)).reversedBy).toBe(rev.id)
    expect(await w.balanceOf('s01')).toBe(1000)
  })

  it('同一筆不能沖正兩次；沖正交易不能再沖正；審核中不能沖正', async () => {
    const w = await makeWorld(2)
    await w.give('s01', 1000)
    const [tx] = await w.teacher.adjust({ uids: [w.byAccount('s01').uid], kind: 'add', amount: 100, title: 'x', note: '' })
    const rev = await w.teacher.reverse(tx.id, '錯誤')
    await expectCode(w.teacher.reverse(tx.id, '再一次'), 'ALREADY_REVERSED')
    await expectCode(w.teacher.reverse(rev.id, '再一次'), 'CANNOT_REVERSE_REVERSAL')
    const payee = await w.as('s02')
    const payer = await w.as('s01')
    const code = await payee.createPaymentCode()
    const p = await payer.submitTransfer({ codeId: code.id, amount: 10, category: 'buy', note: 'x' })
    await expectCode(w.teacher.reverse(p.id, 'x'), 'NOT_APPROVED')
  })

  it('沖正轉帳：收款人已把點數花掉時，阻擋沖正（避免負數）', async () => {
    const w = await makeWorld(2)
    await w.give('s01', 1000)
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 500, category: 'buy', note: 'x' })
    await w.teacher.approveTransfer(tx.id)
    await w.teacher.adjust({ uids: [w.byAccount('s02').uid], kind: 'deduct', amount: 400, title: '小確幸', note: '' })
    await expectCode(w.teacher.reverse(tx.id, '交易取消'), 'NEGATIVE_AFTER_REVERSAL')
    expect(await w.balanceOf('s01')).toBe(500)
    expect(await w.balanceOf('s02')).toBe(100)
  })

  it('沖正轉帳：雙方餘額還原，雙方都看得到沖正紀錄', async () => {
    const w = await makeWorld(2)
    await w.give('s01', 1000)
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 500, category: 'buy', note: 'x' })
    await w.teacher.approveTransfer(tx.id)
    const rev = await w.teacher.reverse(tx.id, '交易取消')
    expect(await w.balanceOf('s01')).toBe(1000)
    expect(await w.balanceOf('s02')).toBe(0)
    await eventually(async () => expect((await payer.listMyTransactions()).some((t) => t.id === rev.id)).toBe(true))
    await eventually(async () => expect((await payee.listMyTransactions()).some((t) => t.id === rev.id)).toBe(true))
  })

  it('對帳：經過各種操作後，每位學生交易加總 = 餘額', async () => {
    const w = await makeWorld(4)
    const all = w.students.map((s) => s.uid)
    await w.teacher.adjust({ uids: all, kind: 'add', amount: 1000, title: '開學禮', note: '' })
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 250, category: 'repay', note: '還錢' })
    await w.teacher.approveTransfer(tx.id)
    const [d] = await w.teacher.adjust({ uids: [all[2]], kind: 'deduct', amount: 300, title: '扣點', note: '' })
    await w.teacher.reverse(d.id, '誤扣')
    // Firebase：等即時同步事件都到齊（曾有「核准後交易被誤從快取移除」的問題，此處為回歸測試）
    if (FB) await new Promise((r) => setTimeout(r, 2000))
    const rows = reconcile(await w.teacher.listStudents(), await w.teacher.listTransactions())
    expect(rows.every((r) => r.ok)).toBe(true)
  })
})
