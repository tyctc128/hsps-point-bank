// Firestore Security Rules 測試（對應 SDD 7.2 測試矩陣）：直接以各種身分對模擬器發出請求，繞過前端程式，驗證規則本身。
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import * as fs from 'node:fs'
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { EMU, PROJECT } from '../api/helpers'

let env: RulesTestEnvironment
const now = () => Date.now()

const user = (uid: string, role: 'student' | 'teacher', extra: Record<string, unknown> = {}) => ({
  uid, role, account: uid, name: `N-${uid}`, seatNo: role === 'teacher' ? 0 : Number(uid.replace(/\D/g, '')) || 9,
  groupId: null, balance: 0, active: true, createdAt: now(), updatedAt: now(), ...extra,
})

const code = (toUid: string, extra: Record<string, unknown> = {}) => ({
  toUid, toName: `N-${toUid}`, toSeatNo: Number(toUid.replace(/\D/g, '')), createdAt: now(), expiresAt: now() + 180_000,
  used: false, usedBy: null, txId: null, ...extra,
})

/** 學生 s1 付給 s2 的合法轉帳申請 */
const transfer = (codeId: string, extra: Record<string, unknown> = {}) => ({
  type: 'transfer', amount: 100, status: 'pending',
  fromUid: 's1', fromName: 'N-s1', fromSeatNo: 1, toUid: 's2', toName: 'N-s2', toSeatNo: 2,
  participants: ['s1', 's2'], title: '轉帳給 N-s2', note: '買書籤', category: 'buy', presetId: null, batchId: null,
  group: null, codeId, reversalOf: null, reversedBy: null, rejectReason: null,
  createdBy: 's1', createdAt: now(), decidedBy: null, decidedAt: null, ...extra,
})

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: EMU.host, port: EMU.firestorePort },
  })
})
afterAll(async () => { await env?.cleanup() })

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/t1'), user('t1', 'teacher'))
    await setDoc(doc(db, 'users/s1'), user('s1', 'student', { balance: 1000 }))
    await setDoc(doc(db, 'users/s2'), user('s2', 'student'))
    await setDoc(doc(db, 'users/s3'), user('s3', 'student', { active: false }))
    await setDoc(doc(db, 'groups/g1'), { name: '第 1 組', color: '#06C755', sortOrder: 1, active: true })
    await setDoc(doc(db, 'settings/app'), { className: 'x', codeTtlMinutes: 3, championAmount: 500, runnerUpAmount: 300 })
    await setDoc(doc(db, 'presets/p1'), { kind: 'deduct', name: '小確幸', description: '', amount: 800, icon: 'gift', sortOrder: 1, active: true, showToStudents: true })
    await setDoc(doc(db, 'presets/p2'), { kind: 'deduct', name: '僅老師', description: '', amount: 300, icon: 'alert', sortOrder: 2, active: true, showToStudents: false })
    await setDoc(doc(db, 'paymentCodes/CODE2345'), code('s2'))
    await setDoc(doc(db, 'paymentCodes/EXPD2345'), code('s2', { createdAt: now() - 600_000, expiresAt: now() - 1000 }))
    await setDoc(doc(db, 'paymentCodes/DSBL2345'), code('s3'))
    await setDoc(doc(db, 'transactions/r1'), { ...transfer('X'), type: 'reward', status: 'approved', fromUid: null, fromName: null, fromSeatNo: null, toUid: 's2', participants: ['s2'], title: '表現優良', category: null, codeId: null, createdBy: 't1' })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()

async function submit(db: ReturnType<typeof as>, txId: string, codeId: string, tx: Record<string, any>, markCode = true, codePatch?: Record<string, any>) {
  const b = writeBatch(db)
  b.set(doc(db, `transactions/${txId}`), tx)
  if (markCode) b.update(doc(db, `paymentCodes/${codeId}`), codePatch ?? { used: true, usedBy: 's1', txId })
  return b.commit()
}

describe('身分與帳戶', () => {
  it('未登入：任何讀取都被拒絕', async () => {
    await assertFails(getDoc(doc(anon(), 'users/s1')))
    await assertFails(getDoc(doc(anon(), 'transactions/r1')))
    await assertFails(getDocs(collection(anon(), 'groups')))
  })
  it('不在名冊中的登入帳號（自行註冊）無任何權限', async () => {
    await assertFails(getDocs(collection(as('stranger'), 'groups')))
    await assertFails(getDoc(doc(as('stranger'), 'settings/app')))
  })
  it('停用的學生：只能讀自己的帳戶，其他一律拒絕', async () => {
    await assertSucceeds(getDoc(doc(as('s3'), 'users/s3')))
    await assertFails(getDocs(collection(as('s3'), 'groups')))
  })
  it('學生只能讀自己的帳戶', async () => {
    await assertSucceeds(getDoc(doc(as('s1'), 'users/s1')))
    await assertFails(getDoc(doc(as('s1'), 'users/s2')))
    await assertFails(getDocs(query(collection(as('s1'), 'users'), where('role', '==', 'student'))))
  })
  it('學生不能修改自己的點數、角色、組別', async () => {
    await assertFails(updateDoc(doc(as('s1'), 'users/s1'), { balance: 99999 }))
    await assertFails(updateDoc(doc(as('s1'), 'users/s1'), { role: 'teacher' }))
    await assertFails(updateDoc(doc(as('s1'), 'users/s1'), { groupId: 'g1' }))
  })
  it('教師可以讀寫學生帳戶、刪除學生帳戶；不能刪除教師帳戶；學生不能刪除任何帳戶', async () => {
    await assertSucceeds(getDocs(query(collection(as('t1'), 'users'), where('role', '==', 'student'))))
    await assertSucceeds(updateDoc(doc(as('t1'), 'users/s1'), { balance: 1500 }))
    await assertFails(deleteDoc(doc(as('s1'), 'users/s2')))
    await assertFails(deleteDoc(doc(as('t1'), 'users/t1')))
    await assertSucceeds(deleteDoc(doc(as('t1'), 'users/s2')))
  })
})

describe('轉帳申請（學生建立）', () => {
  it('合法申請：交易 + 收款碼標記在同一批次 → 允許', async () => {
    await assertSucceeds(submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345')))
  })
  it('只建立交易、沒有標記收款碼 → 拒絕', async () => {
    await assertFails(submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345'), false))
  })
  it('只標記收款碼、沒有建立交易 → 拒絕', async () => {
    await assertFails(updateDoc(doc(as('s1'), 'paymentCodes/CODE2345'), { used: true, usedBy: 's1', txId: 'nothing' }))
  })
  it('收款碼已使用（截圖重用）→ 拒絕', async () => {
    await assertSucceeds(submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345')))
    await assertFails(submit(as('s1'), 'tx2', 'CODE2345', transfer('CODE2345')))
  })
  it('收款碼已過期（依伺服器時間）→ 拒絕', async () => {
    await assertFails(submit(as('s1'), 'tx1', 'EXPD2345', transfer('EXPD2345')))
  })
  it('收款人帳號已停用 → 拒絕', async () => {
    await assertFails(submit(as('s1'), 'tx1', 'DSBL2345', transfer('DSBL2345', { toUid: 's3', toName: 'N-s3', toSeatNo: 3, participants: ['s1', 's3'] })))
  })
  it('交易上的收款人與收款碼不一致 → 拒絕', async () => {
    await assertFails(submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345', { toUid: 't1', participants: ['s1', 't1'] })))
  })
  it('冒用他人當付款人 → 拒絕', async () => {
    await assertFails(submit(as('s2'), 'tx1', 'CODE2345', transfer('CODE2345'), true, { used: true, usedBy: 's2', txId: 'tx1' }))
  })
  it('付款給自己 → 拒絕', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'paymentCodes/SELF2345'), code('s1')) })
    await assertFails(submit(as('s1'), 'tx1', 'SELF2345', transfer('SELF2345', { toUid: 's1', toName: 'N-s1', toSeatNo: 1, participants: ['s1', 's1'] })))
  })
  it('直接建立「已完成」的轉帳、或建立加點交易 → 拒絕', async () => {
    await assertFails(submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345', { status: 'approved' })))
    await assertFails(setDoc(doc(as('s1'), 'transactions/tx9'), { ...transfer('CODE2345'), type: 'reward', fromUid: null, participants: ['s1'] }))
  })
  it('金額：0、負數、小數、字串、超過餘額 → 拒絕', async () => {
    for (const amount of [0, -5, 1.5, '100', 1001]) {
      await assertFails(submit(as('s1'), `tx-${String(amount)}`, 'CODE2345', transfer('CODE2345', { amount })))
    }
  })
  it('事由空白或超過 50 字、分類不在清單 → 拒絕', async () => {
    await assertFails(submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345', { note: '' })))
    await assertFails(submit(as('s1'), 'tx2', 'CODE2345', transfer('CODE2345', { note: '字'.repeat(51) })))
    await assertFails(submit(as('s1'), 'tx3', 'CODE2345', transfer('CODE2345', { category: 'steal' })))
  })
  it('夾帶餘額快照、偽造建立時間 → 拒絕', async () => {
    await assertFails(submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345', { balanceAfter: { s1: 900 } })))
    await assertFails(submit(as('s1'), 'tx2', 'CODE2345', transfer('CODE2345', { createdAt: now() - 3_600_000 })))
  })
})

describe('收款碼', () => {
  it('學生只能為自己建立收款碼，且有效期限不超過 10 分鐘', async () => {
    await assertSucceeds(setDoc(doc(as('s1'), 'paymentCodes/ABCD2345'), code('s1')))
    await assertFails(setDoc(doc(as('s1'), 'paymentCodes/ABCE2345'), code('s2')))
    await assertFails(setDoc(doc(as('s1'), 'paymentCodes/ABCF2345'), code('s1', { expiresAt: now() + 3_600_000 })))
    await assertFails(setDoc(doc(as('s1'), 'paymentCodes/ABCG2345'), code('s1', { toName: '假名字' })))
    await assertFails(setDoc(doc(as('s1'), 'paymentCodes/bad-id'), code('s1')))
  })
  it('既有代碼不能被覆寫（碰撞時視為更新而拒絕）', async () => {
    await assertFails(setDoc(doc(as('s2'), 'paymentCodes/CODE2345'), code('s2')))
  })
  it('學生不能列舉收款碼；教師可以', async () => {
    await assertFails(getDocs(collection(as('s1'), 'paymentCodes')))
    await assertSucceeds(getDocs(collection(as('t1'), 'paymentCodes')))
  })
  it('只有收款人能刪除自己未使用的收款碼（教師亦可）', async () => {
    await assertFails(deleteDoc(doc(as('s1'), 'paymentCodes/CODE2345')))
    await assertSucceeds(deleteDoc(doc(as('s2'), 'paymentCodes/CODE2345')))
    await assertSucceeds(deleteDoc(doc(as('t1'), 'paymentCodes/EXPD2345')))
  })
})

describe('帳本：讀取、審核、沖正、只增不刪', () => {
  it('學生只能讀與自己有關的交易', async () => {
    await assertSucceeds(getDoc(doc(as('s2'), 'transactions/r1')))
    await assertFails(getDoc(doc(as('s1'), 'transactions/r1')))
    await assertSucceeds(getDocs(query(collection(as('s1'), 'transactions'), where('participants', 'array-contains', 's1'))))
    await assertFails(getDocs(collection(as('s1'), 'transactions')))
  })
  it('任何人都不能刪除交易', async () => {
    await assertFails(deleteDoc(doc(as('s2'), 'transactions/r1')))
    await assertFails(deleteDoc(doc(as('t1'), 'transactions/r1')))
  })
  it('學生不能修改交易（例如自己核准）', async () => {
    await submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345'))
    await assertFails(updateDoc(doc(as('s1'), 'transactions/tx1'), { status: 'approved' }))
    await assertFails(updateDoc(doc(as('s2'), 'transactions/tx1'), { status: 'approved' }))
  })
  it('教師：可核准審核中的申請；不能改金額或對象；已完成不能改回審核中', async () => {
    await submit(as('s1'), 'tx1', 'CODE2345', transfer('CODE2345'))
    await assertFails(updateDoc(doc(as('t1'), 'transactions/tx1'), { amount: 5 }))
    await assertFails(updateDoc(doc(as('t1'), 'transactions/tx1'), { toUid: 't1' }))
    await assertSucceeds(updateDoc(doc(as('t1'), 'transactions/tx1'), { status: 'approved', decidedBy: 't1', decidedAt: now() }))
    await assertFails(updateDoc(doc(as('t1'), 'transactions/tx1'), { status: 'pending' }))
  })
  it('沖正標記只能設定一次', async () => {
    await assertSucceeds(updateDoc(doc(as('t1'), 'transactions/r1'), { reversedBy: 'rev1' }))
    await assertFails(updateDoc(doc(as('t1'), 'transactions/r1'), { reversedBy: 'rev2' }))
  })
})

describe('加點項目與小確幸', () => {
  it('學生只能讀「啟用且顯示於前台」的項目，查詢必須帶條件', async () => {
    await assertSucceeds(getDoc(doc(as('s1'), 'presets/p1')))
    await assertFails(getDoc(doc(as('s1'), 'presets/p2')))
    await assertSucceeds(getDocs(query(collection(as('s1'), 'presets'), where('showToStudents', '==', true), where('active', '==', true))))
    await assertFails(getDocs(collection(as('s1'), 'presets')))
  })
  it('只有教師能新增或修改項目與設定', async () => {
    await assertFails(setDoc(doc(as('s1'), 'presets/p3'), { kind: 'add', name: 'x', amount: 1 }))
    await assertFails(setDoc(doc(as('s1'), 'settings/app'), { codeTtlMinutes: 10 }))
    await assertSucceeds(setDoc(doc(as('t1'), 'presets/p3'), { kind: 'add', name: 'x', description: '', amount: 1, icon: 'star', sortOrder: 3, active: true, showToStudents: true }))
    await assertFails(getDocs(collection(as('s1'), 'groupAwards')))
  })
})
