// 測試世界：一個共用的資料庫 + 多台「裝置」（各自登入）。
// BANK_BACKEND=firebase 時改用 Firebase 模擬器 + 正式的 firestore.rules（npm run test:firebase）。
import { MockApi } from '../../src/api/mock/mockApi'
import { MemoryStorage, MockStore } from '../../src/api/mock/store'
import type { BankApi } from '../../src/api/types'
import type { RosterRow } from '../../src/domain/roster'
import type { User } from '../../src/domain/types'

export const FB = process.env.BANK_BACKEND === 'firebase'
export const T0 = Date.UTC(2026, 8, 26, 1, 0, 0) // 2026-09-26 09:00 台北
export const TEACHER_PW = 'teacher-pass'
export const STUDENT_PW = 'pass1234'
export const EMU = { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 }
export const PROJECT = 'demo-hsps-point-bank'
export const STUDENT_DOMAIN = 'students.test.local'
export const TEACHER_EMAIL = 'teacher@example.com'

type Api = BankApi & { mockDiagnostics?: MockApi['mockDiagnostics'] }

const opened: { dispose: () => Promise<void> }[] = []
let seq = 0

/** 每個測試結束後關閉 Firebase 連線（setup 檔會呼叫） */
export async function disposeDevices() {
  const list = opened.splice(0)
  await Promise.all(list.map((d) => d.dispose().catch(() => {})))
}

async function clearEmulators() {
  await fetch(`http://${EMU.host}:${EMU.firestorePort}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://${EMU.host}:${EMU.authPort}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
}

export async function makeWorld(studentCount = 8) {
  const clock = { t: T0 }
  let device: () => Api
  let storage: MemoryStorage | null = null
  let store: MockStore | null = null

  if (FB) {
    await clearEmulators()
    const { FirebaseApi } = await import('../../src/api/firebase/firebaseApi')
    const admin = await import('../../scripts/admin-core')
    process.env.FIRESTORE_EMULATOR_HOST = `${EMU.host}:${EMU.firestorePort}`
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMU.host}:${EMU.authPort}`
    const ctx = admin.connect({ projectId: PROJECT, studentDomain: STUDENT_DOMAIN, teacherEmail: TEACHER_EMAIL, appName: `admin-${++seq}` })
    await admin.initTeacher(ctx, { name: '導師', password: TEACHER_PW })
    await admin.close(ctx)
    device = () => {
      const api = new FirebaseApi({
        config: { apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com`, appId: '1:1:web:1' },
        studentEmailDomain: STUDENT_DOMAIN, teacherEmail: TEACHER_EMAIL, appName: `dev-${++seq}`, emulator: EMU, persist: false,
      })
      opened.push(api)
      return api
    }
  } else {
    storage = new MemoryStorage()
    store = new MockStore(storage, 'test-db', false)
    const st = store
    device = () => new MockApi({ store: st, sessionStorage: new MemoryStorage(), now: () => clock.t, hashIterations: 1000 })
    await (device() as MockApi).setupTeacher('導師', TEACHER_PW)
  }

  const teacher = device()
  await teacher.login('teacher', TEACHER_PW)

  const roster: RosterRow[] = Array.from({ length: studentCount }, (_, i) => ({
    seatNo: i + 1,
    account: `s${String(i + 1).padStart(2, '0')}`,
    password: STUDENT_PW,
    name: `測試${i + 1}號`,
    group: `第 ${(i % 4) + 1} 組`,
  }))
  if (roster.length) await teacher.importStudents(roster)
  const students = await teacher.listStudents()

  async function as(account: string) {
    const api = device()
    await api.login(account, STUDENT_PW)
    return api
  }

  function byAccount(acc: string): User {
    const u = students.find((s) => s.account === acc)
    if (!u) throw new Error('no student ' + acc)
    return u
  }

  async function balanceOf(acc: string): Promise<number> {
    return (await teacher.getStudent(byAccount(acc).uid)).balance
  }

  async function give(acc: string, amount: number) {
    await teacher.adjust({ uids: [byAccount(acc).uid], kind: 'add', amount, title: '測試加點', note: '' })
  }

  return { storage: storage!, store: store!, clock, device, teacher, students, as, byAccount, balanceOf, give }
}

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p
  } catch (e) {
    const got = (e as { code?: string }).code
    if (got !== code) throw new Error(`預期錯誤 ${code}，實際為 ${got}：${(e as Error).message}`)
    return
  }
  throw new Error(`預期錯誤 ${code}，但操作成功了`)
}

/** 跨裝置的即時同步需要一點時間（Firebase）：重試直到斷言成立 */
export async function eventually(fn: () => Promise<void> | void, timeoutMs = 8000) {
  const start = Date.now()
  for (;;) {
    try {
      await fn()
      return
    } catch (e) {
      if (Date.now() - start > timeoutMs) throw e
      await new Promise((r) => setTimeout(r, 150))
    }
  }
}
