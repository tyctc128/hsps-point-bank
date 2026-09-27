// 權限測試：對應 SDD 7.2 測試矩陣。模擬資料庫以相同規則在「伺服器端」（MockApi）強制執行。
import { describe, expect, it } from 'vitest'
import { MockApi } from '../../src/api/mock/mockApi'
import { MemoryStorage } from '../../src/api/mock/store'
import { makeWorld, expectCode, eventually, FB } from './helpers'

describe('權限：未登入', () => {
  it('未登入讀取任何資料皆被拒絕', async () => {
    const w = await makeWorld(1)
    const anon = FB ? w.device() : new MockApi({ store: w.store, sessionStorage: new MemoryStorage(), hashIterations: 1000 })
    await expectCode(anon.getMe(), 'UNAUTHENTICATED')
    await expectCode(anon.listStudents(), 'UNAUTHENTICATED')
    await expectCode(anon.listMyTransactions(), 'UNAUTHENTICATED')
    await expectCode(anon.listVisiblePresets(), 'UNAUTHENTICATED')
    await expectCode(anon.createPaymentCode(), 'UNAUTHENTICATED')
  })

  // Firebase 版的身分由 Firebase Auth 簽發，無法在瀏覽器偽造；見 tests/rules
  it.skipIf(FB)('偽造 session（不存在的 uid）被拒絕', async () => {
    const w = await makeWorld(1)
    const ss = new MemoryStorage()
    ss.setItem('hsps-bank-session', JSON.stringify({ uid: 'u_fake', role: 'teacher' }))
    const forged = new MockApi({ store: w.store, sessionStorage: ss, hashIterations: 1000 })
    await expectCode(forged.listStudents(), 'PERMISSION_DENIED')
  })

  it.skipIf(FB)('學生竄改 session 的 role 為 teacher 仍無教師權限（以資料庫角色為準）', async () => {
    const w = await makeWorld(1)
    const ss = new MemoryStorage()
    const api = new MockApi({ store: w.store, sessionStorage: ss, hashIterations: 1000 })
    const sess = await api.login('s01', 'pass1234')
    ss.setItem('hsps-bank-session', JSON.stringify({ ...sess, role: 'teacher' }))
    await expectCode(api.listStudents(), 'PERMISSION_DENIED')
    await expectCode(api.adjust({ uids: [sess.uid], kind: 'add', amount: 99999, title: '自己加點', note: '' }), 'PERMISSION_DENIED')
  })
})

describe('權限：學生不能執行教師操作', () => {
  it('所有教師專用方法都拒絕學生', async () => {
    const w = await makeWorld(2)
    const s = await w.as('s01')
    const me = w.byAccount('s01').uid
    const calls: [string, () => Promise<unknown>][] = [
      ['listStudents', () => s.listStudents()],
      ['getStudent', () => s.getStudent(me)],
      ['listTransactions', () => s.listTransactions()],
      ['listPending', () => s.listPending()],
      ['approveTransfer', () => s.approveTransfer('x')],
      ['rejectTransfer', () => s.rejectTransfer('x', '')],
      ['approveMany', () => s.approveMany(['x'])],
      ['adjust', () => s.adjust({ uids: [me], kind: 'add', amount: 1000, title: 'x', note: '' })],
      ['groupAward', () => s.groupAward({ awardDate: '2026-09-26', championIds: ['x'], runnerUpIds: [], championAmount: 1, runnerUpAmount: 1, excludedUids: [] })],
      ['listGroupAwards', () => s.listGroupAwards()],
      ['reverse', () => s.reverse('x', 'x')],
      ['reverseBatch', () => s.reverseBatch('x', 'x')],
      ['listPresets', () => s.listPresets()],
      ['savePreset', () => s.savePreset({ kind: 'add', name: 'x', description: '', amount: 1, icon: 'star', sortOrder: 1, active: true, showToStudents: true })],
      ['saveGroup', () => s.saveGroup({ name: 'x', color: '#000000', sortOrder: 1, active: true })],
      ['assignGroup', () => s.assignGroup(me, null)],
      ['importStudents', () => s.importStudents([])],
      ['updateStudent', () => s.updateStudent(me, { name: 'x' })],
      ['resetPassword', () => s.resetPassword(me, 'abcdefg')],
      ['saveSettings', () => s.saveSettings({ codeTtlMinutes: 5 })],
      ['exportAll', () => s.exportAll()],
      ['setStudentsActive', () => s.setStudentsActive([me], false)],
      ['deleteStudents', () => s.deleteStudents([me])],
      ['deletePreset', () => s.deletePreset('x')],
    ]
    for (const [name, call] of calls) {
      const e = await call().then(() => null, (err) => err)
      expect(e?.code, name).toBe('PERMISSION_DENIED')
    }
    expect(await w.balanceOf('s01')).toBe(0)
  })

  it('教師不能使用學生的收付款功能', async () => {
    const w = await makeWorld(1)
    await expectCode(w.teacher.createPaymentCode(), 'PERMISSION_DENIED')
    await expectCode(w.teacher.listMyTransactions(), 'PERMISSION_DENIED')
  })
})

describe('權限：學生之間的資料隔離', () => {
  it('學生看不到與自己無關的交易', async () => {
    const w = await makeWorld(3)
    await w.give('s01', 1000)
    const s1 = await w.as('s01')
    const s2 = await w.as('s02')
    const s3 = await w.as('s03')
    const code = await s2.createPaymentCode()
    const tx = await s1.submitTransfer({ codeId: code.id, amount: 100, category: 'buy', note: '私人交易' })
    await expectCode(s3.getTransaction(tx.id), 'PERMISSION_DENIED')
    expect((await s3.listMyTransactions()).length).toBe(0)
    const [reward] = await w.teacher.adjust({ uids: [w.byAccount('s01').uid], kind: 'add', amount: 5, title: 'x', note: '' })
    await expectCode(s2.getTransaction(reward.id), 'PERMISSION_DENIED')
  })

  it('學生只拿得到自己的帳戶資料', async () => {
    const w = await makeWorld(2)
    const s1 = await w.as('s01')
    const me = await s1.getMe()
    expect(me.account).toBe('s01')
    await expectCode(s1.getStudent(w.byAccount('s02').uid), 'PERMISSION_DENIED')
  })

  it('學生不能取消別人的收款碼', async () => {
    const w = await makeWorld(2)
    const s1 = await w.as('s01')
    const s2 = await w.as('s02')
    const code = await s2.createPaymentCode()
    await s1.cancelPaymentCode(code.id)
    expect((await s2.getPaymentCode(code.id)).used).toBe(false)
  })
})

describe('權限：加點項目與小確幸的可見性', () => {
  it('學生只看得到「啟用」且「顯示於前台」的項目', async () => {
    const w = await makeWorld(1)
    const s1 = await w.as('s01')
    const visible = await s1.listVisiblePresets()
    expect(visible.every((p) => p.active && p.showToStudents)).toBe(true)
    expect(visible.some((p) => p.name === '忘記帶作業')).toBe(false)

    const p = await w.teacher.savePreset({ kind: 'deduct', name: '當一天小老師', description: '協助老師帶一節課', amount: 15000, icon: 'star', sortOrder: 99, active: true, showToStudents: true })
    await eventually(async () => expect((await s1.listVisiblePresets()).some((x) => x.id === p.id)).toBe(true))
    await w.teacher.savePreset({ ...p, active: false })
    await eventually(async () => expect((await s1.listVisiblePresets()).some((x) => x.id === p.id)).toBe(false))
  })
})

describe('刪除加點項目與小確幸', () => {
  it('老師刪除後，學生不再看到；已發生的交易仍保留項目名稱；學生不能刪除', async () => {
    const w = await makeWorld(1)
    const s1 = await w.as('s01')
    const p = await w.teacher.savePreset({ kind: 'add', name: '整理教室', description: '', amount: 200, icon: 'star', sortOrder: 50, active: true, showToStudents: true })
    const [tx] = await w.teacher.adjust({ uids: [w.byAccount('s01').uid], kind: 'add', amount: p.amount, title: p.name, note: '', presetId: p.id })
    await expectCode(s1.deletePreset(p.id), 'PERMISSION_DENIED')
    await w.teacher.deletePreset(p.id)
    expect((await w.teacher.listPresets()).some((x) => x.id === p.id)).toBe(false)
    await eventually(async () => expect((await s1.listVisiblePresets()).some((x) => x.id === p.id)).toBe(false))
    const seen = await s1.getTransaction(tx.id)
    expect(seen.title).toBe('整理教室')
    expect(await w.balanceOf('s01')).toBe(200)
    await expectCode(w.teacher.deletePreset(p.id), 'NOT_FOUND')
  })
})

describe('資料保存', () => {
  it('匯出資料不含密碼雜湊', async () => {
    const w = await makeWorld(1)
    const dump = JSON.stringify(await w.teacher.exportAll())
    expect(dump).not.toContain('creds')
    expect(dump).not.toContain('hash')
    expect(dump).not.toContain('salt')
  })

  it('沒有任何刪除交易的操作介面（帳本只增不刪）；刪除操作只有學生帳號與加點項目', async () => {
    const w = await makeWorld(1)
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(w.teacher))
    expect(methods.filter((m) => /delete|remove/i.test(m)).sort()).toEqual(['deletePreset', 'deleteStudents'])
  })
})
