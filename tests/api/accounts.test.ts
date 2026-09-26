import { describe, expect, it } from 'vitest'
import { makeWorld, expectCode, FB, STUDENT_PW } from './helpers'
import { reconcile } from '../../src/domain/ledger'

describe('批次停用 / 啟用與刪除學生帳號', () => {
  it('批次停用後無法登入，批次啟用後恢復', async () => {
    const w = await makeWorld(3)
    const uids = ['s01', 's02'].map((a) => w.byAccount(a).uid)
    expect(await w.teacher.setStudentsActive(uids, false)).toBe(2)
    await expectCode(w.device().login('s01', STUDENT_PW), 'ACCOUNT_DISABLED')
    await expectCode(w.device().login('s02', STUDENT_PW), 'ACCOUNT_DISABLED')
    await w.device().login('s03', STUDENT_PW)
    await w.teacher.setStudentsActive(uids, true)
    await w.device().login('s01', STUDENT_PW)
  })

  it('批次刪除：帳號與登入資料移除，已登入的裝置立即失效', async () => {
    const w = await makeWorld(4)
    const s1 = await w.as('s01')
    const r = await w.teacher.deleteStudents(['s01', 's02'].map((a) => w.byAccount(a).uid))
    expect(r.deleted).toBe(2)
    expect((await w.teacher.listStudents()).map((u) => u.account)).toEqual(['s03', 's04'])
    await expectCode(w.device().login('s01', STUDENT_PW), 'INVALID_CREDENTIALS')
    const e = await s1.getMe().then(() => null, (err) => err)
    expect(['PERMISSION_DENIED', 'UNAUTHENTICATED']).toContain(e?.code)
    if (!FB) {
      const db = JSON.parse(w.storage.getItem('test-db')!)
      expect(db.creds.s01).toBeUndefined()
      expect(Object.values(db.users).some((u: any) => u.account === 's01')).toBe(false)
    }
  })

  it('刪除後交易紀錄保留：對方明細仍看得到姓名與座號；對帳仍一致', async () => {
    const w = await makeWorld(3)
    await w.give('s01', 1000)
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 300, category: 'buy', note: '買書籤' })
    await w.teacher.approveTransfer(tx.id)

    await w.teacher.deleteStudents([w.byAccount('s01').uid])
    const seen = await payee.getTransaction(tx.id)
    expect(seen.fromName).toBe('測試1號')
    expect(seen.fromSeatNo).toBe(1)
    expect(await w.balanceOf('s02')).toBe(300)
    expect((await w.teacher.listTransactions()).length).toBe(2) // 加點 + 轉帳，都保留
    const rows = reconcile(await w.teacher.listStudents(), await w.teacher.listTransactions())
    expect(rows.every((x) => x.ok)).toBe(true)
  })

  it('刪除時自動駁回相關的審核中轉帳，並回報被刪除的點數', async () => {
    const w = await makeWorld(3)
    await w.give('s01', 800)
    const payer = await w.as('s01')
    const payee = await w.as('s02')
    const code = await payee.createPaymentCode()
    const tx = await payer.submitTransfer({ codeId: code.id, amount: 100, category: 'gift', note: 'x' })
    const r = await w.teacher.deleteStudents([w.byAccount('s01').uid])
    expect(r).toEqual({ deleted: 1, rejectedPending: 1, forfeitedPoints: 800 })
    const t = await payee.getTransaction(tx.id)
    expect(t.status).toBe('rejected')
    expect(t.rejectReason).toBe('帳號已刪除')
    expect((await w.teacher.listPending()).length).toBe(0)
  })

  it('刪除學生的收款碼一併失效', async () => {
    const w = await makeWorld(2)
    await w.give('s02', 500)
    const payee = await w.as('s01')
    const payer = await w.as('s02')
    const code = await payee.createPaymentCode()
    await w.teacher.deleteStudents([w.byAccount('s01').uid])
    await expectCode(payer.submitTransfer({ codeId: code.id, amount: 10, category: 'buy', note: 'x' }), 'CODE_INVALID')
  })

  it('批次刪除全有全無：清單中有不存在的學生時，整批都不刪', async () => {
    const w = await makeWorld(2)
    const before = FB ? null : w.storage.getItem('test-db')
    await expectCode(w.teacher.deleteStudents([w.byAccount('s01').uid, 'u_nobody']), 'NOT_FOUND')
    if (!FB) expect(w.storage.getItem('test-db')).toBe(before)
    expect((await w.teacher.listStudents()).length).toBe(2)
    await expectCode(w.teacher.deleteStudents([]), 'INVALID_ARGUMENT')
  })

  it('不能用刪除學生的操作刪除教師帳號', async () => {
    const w = await makeWorld(1)
    const me = await w.teacher.getMe()
    await expectCode(w.teacher.deleteStudents([me.uid]), 'NOT_FOUND')
  })

  it('刪除後可用同一帳號重新匯入（例如名冊打錯重建）', async () => {
    const w = await makeWorld(1)
    await w.teacher.deleteStudents([w.byAccount('s01').uid])
    if (FB) {
      // Firebase：登入帳號仍在，用原密碼可重建；新密碼需先用管理工具刪除登入帳號
      const r1 = await w.teacher.importStudents([{ seatNo: 1, account: 's01', password: 'newpass1', name: '重建', group: null }])
      expect(r1.created).toBe(0)
      expect(r1.skipped[0].reason).toMatch('管理工具')
      const r2 = await w.teacher.importStudents([{ seatNo: 1, account: 's01', password: STUDENT_PW, name: '重建', group: null }])
      expect(r2.created).toBe(1)
      await w.device().login('s01', STUDENT_PW)
      return
    }
    const r = await w.teacher.importStudents([{ seatNo: 1, account: 's01', password: 'newpass1', name: '重建', group: null }])
    expect(r.created).toBe(1)
    await w.device().login('s01', 'newpass1')
  })
})
