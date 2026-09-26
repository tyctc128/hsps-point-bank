import { describe, expect, it } from 'vitest'
import { MockApi } from '../../src/api/mock/mockApi'
import { MemoryStorage, MockStore } from '../../src/api/mock/store'
import { makeWorld, expectCode, FB, STUDENT_PW, TEACHER_PW } from './helpers'

describe('帳號與登入', () => {
  it.skipIf(FB)('全新系統需要先建立教師帳號，且只能建立一次', async () => {
    const store = new MockStore(new MemoryStorage(), 'x', false)
    const api = new MockApi({ store, sessionStorage: new MemoryStorage(), hashIterations: 1000 })
    expect(await api.needsSetup()).toBe(true)
    await expectCode(api.setupTeacher('導師', 'short'), 'INVALID_ARGUMENT')
    await api.setupTeacher('導師', 'teacher-pass')
    expect(await api.needsSetup()).toBe(false)
    await expectCode(api.setupTeacher('另一位', 'teacher-pass2'), 'ALREADY_SETUP')
  })

  it('建立教師時自動產生 8 個組別與預設加點項目、小確幸', async () => {
    const w = await makeWorld(0)
    expect((await w.teacher.listGroups()).length).toBe(8)
    const presets = await w.teacher.listPresets()
    expect(presets.some((p) => p.kind === 'deduct' && p.showToStudents)).toBe(true)
    expect(presets.some((p) => p.kind === 'add')).toBe(true)
  })

  it('學生以帳號密碼登入；帳號不分大小寫', async () => {
    const w = await makeWorld(2)
    const a = w.device()
    const sess = await a.login('S01', STUDENT_PW)
    expect(sess.role).toBe('student')
    expect((await a.getMe()).account).toBe('s01')
  })

  it('帳號與密碼的全形英數視同半形（中文輸入法）', async () => {
    const w = await makeWorld(1)
    const sess = await w.device().login('ｓ０１', 'ｐａｓｓ１２３４')
    expect(sess.role).toBe('student')
  })

  it.skipIf(FB)('模擬資料庫診斷：回報學生數與帳號是否存在於此瀏覽器', async () => {
    const w = await makeWorld(3)
    const anon = w.device()
    expect(anon.mockDiagnostics!('S02')).toEqual({ studentCount: 3, accountExists: true })
    expect(anon.mockDiagnostics!('nobody')).toEqual({ studentCount: 3, accountExists: false })
  })

  it('密碼錯誤與帳號不存在顯示相同訊息（不透露哪一項錯）', async () => {
    const w = await makeWorld(1)
    const e1 = await w.device().login('s01', 'wrong-pw').catch((e) => e)
    const e2 = await w.device().login('nobody', 'wrong-pw').catch((e) => e)
    expect(e1.code).toBe('INVALID_CREDENTIALS')
    expect(e2.code).toBe('INVALID_CREDENTIALS')
    expect(e1.message).toBe(e2.message)
  })

  // Firebase 版由 Firebase Auth 內建節流處理
  it.skipIf(FB)('連續輸錯 5 次鎖定 1 分鐘', async () => {
    const w = await makeWorld(1)
    const a = w.device()
    for (let i = 0; i < 5; i++) await expectCode(a.login('s01', 'bad-pass'), 'INVALID_CREDENTIALS')
    await expectCode(a.login('s01', STUDENT_PW), 'TOO_MANY_ATTEMPTS')
    w.clock.t += 61_000
    await a.login('s01', STUDENT_PW)
  })

  it('停用的帳號不能登入，已登入者下一次操作即被拒絕', async () => {
    const w = await makeWorld(2)
    const s1 = await w.as('s01')
    await w.teacher.updateStudent(w.byAccount('s01').uid, { active: false })
    const e = await s1.getMe().then(() => null, (err) => err)
    expect(['ACCOUNT_DISABLED', 'UNAUTHENTICATED']).toContain(e?.code) // Firebase：即時監聽可能已先將其登出
    await expectCode(w.device().login('s01', STUDENT_PW), 'ACCOUNT_DISABLED')
  })

  it('學生可以修改自己的密碼（需舊密碼）', async () => {
    const w = await makeWorld(1)
    const a = await w.as('s01')
    await expectCode(a.changePassword('wrong', 'newpass99'), 'INVALID_CREDENTIALS')
    await expectCode(a.changePassword(STUDENT_PW, '123'), 'INVALID_ARGUMENT')
    await a.changePassword(STUDENT_PW, 'newpass99')
    await expectCode(w.device().login('s01', STUDENT_PW), 'INVALID_CREDENTIALS')
    await w.device().login('s01', 'newpass99')
  })

  it('老師可以重設學生密碼，並解除鎖定（Firebase 版需用管理工具）', async () => {
    const w = await makeWorld(1)
    if (FB) return expectCode(w.teacher.resetPassword(w.byAccount('s01').uid, 'reset888'), 'NOT_SUPPORTED')
    for (let i = 0; i < 5; i++) await expectCode(w.device().login('s01', 'bad-pass'), 'INVALID_CREDENTIALS')
    await w.teacher.resetPassword(w.byAccount('s01').uid, 'reset888')
    await w.device().login('s01', 'reset888')
  })

  it('匯入名冊：已存在的帳號略過，密碼以雜湊保存（資料庫中沒有明文）', async () => {
    const w = await makeWorld(2)
    const r = await w.teacher.importStudents([
      { seatNo: 3, account: 's01', password: 'abcdef1', name: '重複', group: null },
      { seatNo: 4, account: 'new01', password: 'abcdef1', name: '新同學', group: '第 9 組' },
    ])
    expect(r.created).toBe(1)
    expect(r.skipped.map((x) => x.account)).toEqual(['s01'])
    if (!FB) {
      const raw = w.storage.getItem('test-db')!
      expect(raw).not.toContain('abcdef1')
      expect(raw).not.toContain(STUDENT_PW)
      expect(raw).not.toContain(TEACHER_PW)
    }
    expect((await w.teacher.listGroups()).some((g) => g.name === '第 9 組')).toBe(true)
  })

  it('登出後不能再讀取資料', async () => {
    const w = await makeWorld(1)
    const a = await w.as('s01')
    await a.logout()
    await expectCode(a.getMe(), 'UNAUTHENTICATED')
  })
})
