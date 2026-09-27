// 測試後還原（管理工具 backup / restore）：只在 Firebase 模擬器執行
import { describe, expect, it } from 'vitest'
import { makeWorld, FB, PROJECT, STUDENT_DOMAIN, TEACHER_EMAIL, STUDENT_PW } from './helpers'

describe.skipIf(!FB)('測試後還原：備份 → 各種操作 → 還原，資料完全回到備份時', () => {
  it('交易、點數、收款碼、小組獎勵、分組、刪除的學生都還原', async () => {
    const w = await makeWorld(4)
    await w.give('s01', 1000) // 基準點：s01 有 1000 點、1 筆交易
    const admin = await import('../../scripts/admin-core')
    const ctx = admin.connect({ projectId: PROJECT, studentDomain: STUDENT_DOMAIN, teacherEmail: TEACHER_EMAIL, appName: `restore-${Date.now()}` })
    const baseline = await admin.snapshot(ctx)

    // ---- 模擬測試：轉帳 + 核准、批次加點、小組獎勵、沖正、改分組、刪除學生、留下未使用的收款碼 ----
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 300, category: 'buy', note: '測試' })
    await w.teacher.approveTransfer(tx.id)
    await w.teacher.adjust({ uids: w.students.map((s) => s.uid), kind: 'add', amount: 50, title: '測試批次', note: '' })
    const g = (await w.teacher.listGroups())[0]
    const award = await w.teacher.groupAward({ awardDate: '2026-09-27', championIds: [g.id], runnerUpIds: [], championAmount: 500, runnerUpAmount: 300, excludedUids: [] })
    await w.teacher.reverse(tx.id, '測試沖正')
    await w.teacher.assignGroup(w.byAccount('s03').uid, null)
    await payee.createPaymentCode()
    await w.teacher.deleteStudents([w.byAccount('s04').uid])
    expect(award.recipients.length).toBeGreaterThan(0)
    const changed = await admin.snapshot(ctx)
    expect(Object.keys(changed.transactions).length).toBeGreaterThan(Object.keys(baseline.transactions).length)

    // ---- 還原 ----
    const r = await admin.restore(ctx, baseline)
    expect(r.missingLogins).toEqual([])
    const after = await admin.snapshot(ctx)
    for (const col of admin.BACKUP_COLLECTIONS) {
      expect(after[col], col).toEqual(baseline[col])
    }
    await admin.close(ctx)

    // 被刪除的學生可以再次登入；點數回到基準點
    const s4 = w.device()
    await s4.login('s04', STUDENT_PW)
    expect((await s4.getMe()).balance).toBe(0)
    const s1 = w.device()
    await s1.login('s01', STUDENT_PW)
    expect((await s1.getMe()).balance).toBe(1000)
    expect((await s1.listMyTransactions()).length).toBe(1)
  })
})
