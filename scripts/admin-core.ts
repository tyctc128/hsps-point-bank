// 管理工具核心（Firebase Admin SDK）：只在老師電腦執行，需要 scripts/service-account.json（機密，勿上傳）。
// 也用於測試時在模擬器上建立教師帳號。
import { initializeApp, cert, deleteApp, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { RosterRow } from '../src/domain/roster'

// 初始資料（與網頁模擬資料庫共用同一份）
const seed = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../src/api/seed-data.json', import.meta.url)), 'utf8')) as {
  presets: Record<string, unknown>[]
  groupColors: string[]
  groupCount: number
  settings: Record<string, unknown>
}

export interface AdminCtx {
  app: App
  auth: Auth
  db: Firestore
  studentDomain: string
  teacherEmail: string
}

export function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** 服務帳戶金鑰：scripts/service-account.json，或從 Firebase Console 下載的 *firebase-adminsdk*.json */
export function findKeyFile(): string {
  const dir = path.join(process.cwd(), 'scripts')
  const named = path.join(dir, 'service-account.json')
  if (fs.existsSync(named)) return named
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /firebase-adminsdk.*\.json$/.test(f)) : undefined
  return found ? path.join(dir, found) : named
}

/** 連線到正式 Firebase（使用服務帳戶金鑰）或模擬器（設定 FIREBASE_AUTH_EMULATOR_HOST 等環境變數時） */
export function connect(opts: { projectId?: string; studentDomain: string; teacherEmail: string; appName?: string; keyFile?: string }): AdminCtx {
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST
  let app: App
  if (emulator) {
    app = initializeApp({ projectId: opts.projectId }, opts.appName ?? 'admin')
  } else {
    const keyFile = opts.keyFile ?? findKeyFile()
    if (!fs.existsSync(keyFile)) {
      throw new Error(`找不到服務帳戶金鑰：${keyFile}\nFirebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰，存成 scripts/service-account.json`)
    }
    const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
    app = initializeApp({ credential: cert(key), projectId: key.project_id }, opts.appName ?? 'admin')
  }
  return { app, auth: getAuth(app), db: getFirestore(app), studentDomain: opts.studentDomain, teacherEmail: opts.teacherEmail.toLowerCase() }
}

export async function close(ctx: AdminCtx) {
  await deleteApp(ctx.app)
}

/** 產生好記又不易猜的密碼（教師用）：12 碼英數 */
export function randomPassword(len = 12): string {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.randomBytes(len), (b) => A[b % A.length]).join('')
}

async function upsertAuthUser(auth: Auth, email: string, password: string | null, displayName: string): Promise<{ uid: string; created: boolean }> {
  try {
    const u = await auth.getUserByEmail(email)
    if (password) await auth.updateUser(u.uid, { password, displayName })
    return { uid: u.uid, created: false }
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e
    if (!password) throw new Error(`找不到登入帳號 ${email}`)
    const u = await auth.createUser({ email, password, displayName })
    return { uid: u.uid, created: true }
  }
}

/** 建立（或更新）教師帳號，並在首次建置時寫入預設加點項目、小確幸、8 個組別與系統設定 */
export async function initTeacher(ctx: AdminCtx, opts: { name: string; password: string | null }): Promise<{ uid: string; created: boolean }> {
  const { uid, created } = await upsertAuthUser(ctx.auth, ctx.teacherEmail, opts.password, opts.name)
  const now = Date.now()
  await ctx.db.doc(`users/${uid}`).set({
    uid, role: 'teacher', account: 'teacher', name: opts.name, seatNo: 0, groupId: null, balance: 0,
    active: true, createdAt: now, updatedAt: now,
  }, { merge: true })
  const presets = await ctx.db.collection('presets').limit(1).get()
  if (presets.empty) {
    const b = ctx.db.batch()
    for (const p of seed.presets) b.set(ctx.db.collection('presets').doc(), p)
    await b.commit()
  }
  const groups = await ctx.db.collection('groups').limit(1).get()
  if (groups.empty) {
    const b = ctx.db.batch()
    for (let i = 1; i <= seed.groupCount; i++) {
      b.set(ctx.db.collection('groups').doc(), { name: `第 ${i} 組`, color: seed.groupColors[i - 1], sortOrder: i, active: true })
    }
    await b.commit()
  }
  const settings = await ctx.db.doc('settings/app').get()
  if (!settings.exists) await ctx.db.doc('settings/app').set(seed.settings)
  return { uid, created }
}

/** 由名冊建立學生帳號（已存在的帳號略過）。回傳建立與略過的清單 */
export async function importRoster(ctx: AdminCtx, rows: RosterRow[]) {
  const existing = new Set((await ctx.db.collection('users').where('role', '==', 'student').get()).docs.map((d) => String(d.data().account).toLowerCase()))
  const groupsSnap = await ctx.db.collection('groups').get()
  const groupByName = new Map(groupsSnap.docs.map((d) => [d.data().name as string, d.id]))
  const created: string[] = []
  const skipped: { account: string; reason: string }[] = []
  for (const r of rows) {
    const acc = r.account.toLowerCase()
    if (existing.has(acc)) { skipped.push({ account: r.account, reason: '帳號已存在' }); continue }
    let groupId: string | null = null
    if (r.group) {
      groupId = groupByName.get(r.group) ?? null
      if (!groupId) {
        const ref = ctx.db.collection('groups').doc()
        await ref.set({ name: r.group, color: '#06C755', sortOrder: groupByName.size + 1, active: true })
        groupByName.set(r.group, ref.id)
        groupId = ref.id
      }
    }
    const { uid } = await upsertAuthUser(ctx.auth, `${acc}@${ctx.studentDomain}`, r.password, r.name)
    const now = Date.now()
    await ctx.db.doc(`users/${uid}`).set({
      uid, role: 'student', account: acc, name: r.name, seatNo: r.seatNo, groupId, balance: 0,
      active: true, createdAt: now, updatedAt: now,
    })
    existing.add(acc)
    created.push(r.account)
  }
  return { created, skipped }
}

export async function resetPassword(ctx: AdminCtx, account: string, newPassword: string) {
  if (newPassword.length < 6) throw new Error('密碼至少 6 碼')
  const email = account.includes('@') ? account.toLowerCase() : `${account.toLowerCase()}@${ctx.studentDomain}`
  const u = await ctx.auth.getUserByEmail(email)
  await ctx.auth.updateUser(u.uid, { password: newPassword })
  return u.uid
}

/** 刪除「名冊已刪除、但登入帳號還在」的學生登入帳號 */
export async function deleteOrphans(ctx: AdminCtx, dryRun: boolean) {
  const orphans: string[] = []
  let token: string | undefined
  do {
    const page = await ctx.auth.listUsers(1000, token)
    for (const u of page.users) {
      if (!u.email?.endsWith(`@${ctx.studentDomain}`)) continue
      const d = await ctx.db.doc(`users/${u.uid}`).get()
      if (!d.exists) orphans.push(u.email)
      if (!d.exists && !dryRun) await ctx.auth.deleteUser(u.uid)
    }
    token = page.pageToken
  } while (token)
  return orphans
}

/** 以 Admin SDK 發布 firestore.rules（不需要 firebase login） */
export async function deployRules(ctx: AdminCtx, file = 'firestore.rules') {
  const { getSecurityRules } = await import('firebase-admin/security-rules')
  const source = fs.readFileSync(file, 'utf8')
  const ruleset = await getSecurityRules(ctx.app).releaseFirestoreRulesetFromSource(source)
  return ruleset.name
}

export async function backup(ctx: AdminCtx, dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  const out: Record<string, unknown> = {}
  for (const col of ['users', 'transactions', 'presets', 'groups', 'groupAwards', 'settings']) {
    const snap = await ctx.db.collection(col).get()
    out[col] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const file = path.join(dir, `backup-${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  return file
}
