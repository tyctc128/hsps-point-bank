// FirebaseApi：以 Firebase Auth + Cloud Firestore 實作 BankApi（與 MockApi 同一介面、同一套業務規則）。
// ・讀取：以 onSnapshot 維護記憶體快取（對應 SDD 8.2），畫面重新整理時不重複計費讀取。
// ・寫入：所有點數異動使用 runTransaction / writeBatch，全有全無；權限由 firestore.rules 在伺服器端把關。
// ・時間欄位：毫秒數（int），規則要求與伺服器時間相差 5 分鐘內。
import { deleteApp, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import {
  browserLocalPersistence, connectAuthEmulator, createUserWithEmailAndPassword, EmailAuthProvider,
  inMemoryPersistence, initializeAuth, onAuthStateChanged, reauthenticateWithCredential, signInWithEmailAndPassword,
  signOut, updatePassword, type Auth, type User as FbUser,
} from 'firebase/auth'
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, initializeFirestore, memoryLocalCache,
  onSnapshot, query, runTransaction, setDoc, where, writeBatch, type DocumentData, type DocumentSnapshot, type Firestore,
  type Query, type Unsubscribe,
} from 'firebase/firestore'
import type {
  Group, GroupAward, PaymentCode, Preset, Settings, Transaction, User,
} from '../../domain/types'
import { DEFAULT_SETTINGS } from '../../domain/types'
import { DESCRIPTION_MAX, formatPoints, NOTE_MAX } from '../../domain/money'
import { isValidCode, newCodeId, normalizeCode } from '../../domain/codes'
import { isValidDateKey } from '../../domain/dates'
import { ACCOUNT_PATTERN, PASSWORD_MIN, toHalfWidth, type RosterRow } from '../../domain/roster'
import {
  BankError, type AdjustInput, type BankApi, type DeleteResult, type GroupAwardInput, type ImportResult,
  type ItemResult, type Session, type TransferInput, type TxFilter,
} from '../types'
import { CATEGORIES, assertAmount, assertText, baseTx, isInt } from '../shared'

export interface FirebaseApiOptions {
  config: FirebaseOptions
  studentEmailDomain: string
  teacherEmail: string
  appName?: string
  /** 連線到本機模擬器（測試用），例如 { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 } */
  emulator?: { host: string; firestorePort: number; authPort: number }
  /** 瀏覽器保持登入（預設 true；Node 測試環境請設 false） */
  persist?: boolean
  /** 教師端即時同步的交易範圍（天）；更早的交易在需要時才讀取 */
  teacherWindowDays?: number
}

const DAY = 86_400_000

type Col = 'users' | 'transactions' | 'paymentCodes' | 'presets' | 'groups' | 'groupAwards' | 'settings'

function withId<T>(id: string, data: DocumentData): T {
  return { ...data, id } as T
}

function strip<T extends { id: string }>(o: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = o
  return rest
}

/** Firebase 錯誤 → BankError */
function mapError(e: unknown): unknown {
  if (e instanceof BankError) return e
  const code = (e as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/invalid-login-credentials':
      return new BankError('INVALID_CREDENTIALS', '帳號或密碼錯誤')
    case 'auth/too-many-requests':
      return new BankError('TOO_MANY_ATTEMPTS', '嘗試次數過多，請稍後再試')
    case 'auth/network-request-failed':
    case 'unavailable':
      return new BankError('UNAVAILABLE', '網路連線中斷，請稍後再試')
    case 'permission-denied':
      return new BankError('PERMISSION_DENIED', '沒有權限執行此操作')
    case 'not-found':
      return new BankError('NOT_FOUND', '找不到資料')
    case 'aborted':
    case 'failed-precondition':
      return new BankError('CONFLICT', '資料同時被修改，請再試一次')
    default:
      return e
  }
}

export class FirebaseApi implements BankApi {
  readonly backend = 'firebase' as const
  readonly app: FirebaseApp
  readonly auth: Auth
  readonly db: Firestore
  private opts: FirebaseApiOptions
  private importApp: FirebaseApp | null = null

  private sess: Session | null = null
  private me: User | null = null
  private attachedUid: string | null = null
  private subs: Unsubscribe[] = []
  private listeners = new Set<() => void>()
  private loaded = new Map<string, Promise<void>>()
  private readyPromise: Promise<void>
  private olderLoaded = false
  private windowStart = 0
  private lastCodeId: string | null = null
  private codeSub: Unsubscribe | null = null

  private cache = {
    users: new Map<string, User>(),
    txs: new Map<string, Transaction>(),
    presets: new Map<string, Preset>(),
    groups: new Map<string, Group>(),
    awards: new Map<string, GroupAward>(),
    settings: null as Settings | null,
  }

  constructor(opts: FirebaseApiOptions) {
    this.opts = opts
    this.app = initializeApp(opts.config, opts.appName ?? '[DEFAULT]')
    this.auth = initializeAuth(this.app, { persistence: opts.persist === false ? inMemoryPersistence : browserLocalPersistence })
    this.db = initializeFirestore(this.app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true })
    if (opts.emulator) {
      connectAuthEmulator(this.auth, `http://${opts.emulator.host}:${opts.emulator.authPort}`, { disableWarnings: true })
      connectFirestoreEmulator(this.db, opts.emulator.host, opts.emulator.firestorePort)
    }
    let first = true
    this.readyPromise = new Promise((resolve) => {
      onAuthStateChanged(this.auth, (u) => {
        this.attach(u).catch(() => {}).finally(() => {
          if (first) { first = false; resolve() }
        })
      })
    })
  }

  /** 測試用：關閉連線與監聽 */
  async dispose(): Promise<void> {
    this.detach()
    await deleteApp(this.app).catch(() => {})
    if (this.importApp) await deleteApp(this.importApp).catch(() => {})
  }

  // ------------------------------------------------------------------ 連線狀態與快取
  ready(): Promise<void> {
    return this.readyPromise
  }

  currentSession(): Session | null {
    return this.sess
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit() {
    for (const cb of [...this.listeners]) {
      try { cb() } catch (e) { console.error(e) }
    }
  }

  private emailFor(account: string): string {
    const a = toHalfWidth(String(account ?? '')).trim().toLowerCase()
    if (a.includes('@')) return a
    if (a === 'teacher') return this.opts.teacherEmail.toLowerCase()
    return `${a}@${this.opts.studentEmailDomain}`
  }

  private detach() {
    for (const u of this.subs) u()
    this.subs = []
    this.codeSub?.()
    this.codeSub = null
    this.loaded.clear()
    this.cache.users.clear()
    this.cache.txs.clear()
    this.cache.presets.clear()
    this.cache.groups.clear()
    this.cache.awards.clear()
    this.cache.settings = null
    this.olderLoaded = false
    this.attachedUid = null
    this.sess = null
    this.me = null
  }

  private attaching: { uid: string | null; p: Promise<void> } | null = null

  /** 登入後：讀取本人帳戶並依角色開始即時同步（登入與自動還原可能同時觸發，只執行一次） */
  private attach(u: FbUser | null): Promise<void> {
    const uid = u?.uid ?? null
    if (uid && this.attachedUid === uid) return Promise.resolve()
    if (this.attaching && this.attaching.uid === uid) return this.attaching.p
    const p = this.attachInner(u).finally(() => { if (this.attaching?.p === p) this.attaching = null })
    this.attaching = { uid, p }
    return p
  }

  private async attachInner(u: FbUser | null): Promise<void> {
    this.detach()
    if (!u) { this.emit(); return }
    const snap = await getDoc(doc(this.db, 'users', u.uid))
    if (!snap.exists()) {
      await signOut(this.auth)
      throw new BankError('INVALID_CREDENTIALS', '帳號或密碼錯誤')
    }
    const me = withId<User>(u.uid, snap.data())
    me.uid = u.uid
    if (!me.active) {
      await signOut(this.auth)
      throw new BankError('ACCOUNT_DISABLED', '帳號已停用，請洽老師')
    }
    this.attachedUid = u.uid
    this.me = me
    this.sess = { uid: u.uid, role: me.role }
    this.startListeners(me)
    this.emit()
  }

  private listen<T>(key: string, q: Query | ReturnType<typeof doc>, apply: (snap: any) => void) {
    let resolve!: () => void
    this.loaded.set(key, new Promise<void>((r) => (resolve = r)))
    const unsub = onSnapshot(q as any, (snap: any) => {
      apply(snap)
      resolve()
      this.emit()
    }, (err: unknown) => {
      console.warn(`[firebase] ${key}`, err)
      resolve()
    })
    this.subs.push(unsub)
  }

  private applyChanges<T>(map: Map<string, T>, snap: any, fix?: (id: string, v: T) => T) {
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') map.delete(ch.doc.id)
      else {
        const v = withId<T>(ch.doc.id, ch.doc.data())
        map.set(ch.doc.id, fix ? fix(ch.doc.id, v) : v)
      }
    }
  }

  private startListeners(me: User) {
    const db = this.db
    const fixUser = (id: string, v: User) => ({ ...v, uid: id })

    this.listen('me', doc(db, 'users', me.uid), (snap) => {
      if (!snap.exists() || !snap.data().active) {
        // 帳號被刪除或停用：立即登出
        signOut(this.auth).catch(() => {})
        this.detach()
        return
      }
      this.me = fixUser(me.uid, withId<User>(me.uid, snap.data()))
      if (me.role === 'teacher') this.cache.users.set(me.uid, this.me)
    })
    this.listen('groups', collection(db, 'groups'), (snap) => this.applyChanges(this.cache.groups, snap))
    this.listen('settings', doc(db, 'settings', 'app'), (snap) => {
      this.cache.settings = snap.exists() ? { ...DEFAULT_SETTINGS, ...(snap.data() as Settings) } : { ...DEFAULT_SETTINGS }
    })

    if (me.role === 'student') {
      this.listen('txs', query(collection(db, 'transactions'), where('participants', 'array-contains', me.uid)),
        (snap) => this.applyChanges(this.cache.txs, snap))
      this.listen('presets', query(collection(db, 'presets'), where('showToStudents', '==', true), where('active', '==', true)),
        (snap) => this.applyChanges(this.cache.presets, snap))
    } else {
      const days = this.opts.teacherWindowDays ?? 60
      this.windowStart = Date.now() - days * DAY
      this.listen('users', query(collection(db, 'users'), where('role', '==', 'student')),
        (snap) => this.applyChanges(this.cache.users, snap, fixUser))
      this.listen('txs', query(collection(db, 'transactions'), where('createdAt', '>=', this.windowStart)),
        (snap) => this.applyChanges(this.cache.txs, snap))
      // 審核中的申請：交易核准或駁回後會「離開」這個查詢，但交易本身並未刪除 → 不從快取移除，
      // 若不在即時同步的時間範圍內，改讀一次最新狀態
      this.listen('pending', query(collection(db, 'transactions'), where('status', '==', 'pending')), (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type !== 'removed') {
            this.cache.txs.set(ch.doc.id, withId<Transaction>(ch.doc.id, ch.doc.data()))
          } else if ((ch.doc.data().createdAt as number) < this.windowStart) {
            getDoc(ch.doc.ref).then((d) => {
              if (d.exists()) { this.cache.txs.set(d.id, withId<Transaction>(d.id, d.data() as DocumentData)); this.emit() }
            }).catch(() => {})
          }
        }
      })
      this.listen('presets', collection(db, 'presets'), (snap) => this.applyChanges(this.cache.presets, snap))
      this.listen('awards', collection(db, 'groupAwards'), (snap) => this.applyChanges(this.cache.awards, snap))
    }
  }

  private async wait(...keys: string[]) {
    await this.readyPromise
    await Promise.all(keys.map((k) => this.loaded.get(k) ?? Promise.resolve()))
  }

  /** 自己寫入後立即更新快取（即時監聽的範圍外的舊交易也能正確顯示） */
  private applyLocal(col: 'users' | 'txs' | 'presets' | 'groups' | 'awards', id: string, value: any | null) {
    const map = this.cache[col] as Map<string, any>
    if (value === null) map.delete(id)
    else map.set(id, col === 'users' ? { ...value, uid: id } : { ...value, id })
    this.emit()
  }

  private async net<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw mapError(e)
    }
  }

  private requireMe(): User {
    if (!this.sess || !this.me) throw new BankError('UNAUTHENTICATED', '請先登入')
    return this.me
  }
  private requireTeacher(): User {
    const u = this.requireMe()
    if (u.role !== 'teacher') throw new BankError('PERMISSION_DENIED', '沒有權限執行此操作')
    return u
  }
  private requireStudent(): User {
    const u = this.requireMe()
    if (u.role !== 'student') throw new BankError('PERMISSION_DENIED', '沒有權限執行此操作')
    return u
  }

  private ref(col: Col, id: string) {
    return doc(this.db, col, id)
  }
  private newTxId(): string {
    return doc(collection(this.db, 'transactions')).id
  }

  // ------------------------------------------------------------------ 系統
  async needsSetup(): Promise<boolean> {
    return false // 教師帳號以管理工具建立（npm run admin -- init-teacher）
  }

  async setupTeacher(): Promise<void> {
    throw new BankError('NOT_SUPPORTED', '請在老師電腦執行管理工具建立教師帳號：npm run admin -- init-teacher')
  }

  // ------------------------------------------------------------------ 登入
  async login(account: string, password: string): Promise<Session> {
    return this.net(async () => {
      await this.readyPromise
      if (this.auth.currentUser) await signOut(this.auth)
      const cred = await signInWithEmailAndPassword(this.auth, this.emailFor(account), toHalfWidth(String(password ?? '')))
      await this.attach(cred.user)
      return { ...this.sess! }
    })
  }

  async logout(): Promise<void> {
    this.detach()
    await signOut(this.auth).catch(() => {})
    this.emit()
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const me = this.requireMe()
    const min = me.role === 'teacher' ? 8 : PASSWORD_MIN
    if (typeof newPassword !== 'string' || newPassword.length < min) throw new BankError('INVALID_ARGUMENT', `新密碼至少 ${min} 碼`)
    const u = this.auth.currentUser
    if (!u?.email) throw new BankError('UNAUTHENTICATED', '請先登入')
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, toHalfWidth(oldPassword)))
    } catch {
      throw new BankError('INVALID_CREDENTIALS', '舊密碼錯誤')
    }
    await this.net(() => updatePassword(u, toHalfWidth(newPassword)))
  }

  // ------------------------------------------------------------------ 共用讀取
  async getMe(): Promise<User> {
    return this.net(async () => {
      await this.readyPromise
      const me = this.requireMe()
      const snap = await getDoc(this.ref('users', me.uid))
      if (!snap.exists()) throw new BankError('PERMISSION_DENIED', '帳號不存在')
      const u = { ...withId<User>(me.uid, snap.data()), uid: me.uid }
      if (!u.active) throw new BankError('ACCOUNT_DISABLED', '帳號已停用，請洽老師')
      this.me = u
      return { ...u }
    })
  }

  async getSettings(): Promise<Settings> {
    this.requireMe()
    await this.wait('settings')
    return { ...(this.cache.settings ?? DEFAULT_SETTINGS) }
  }

  async listGroups(): Promise<Group[]> {
    this.requireMe()
    await this.wait('groups')
    return [...this.cache.groups.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  // ------------------------------------------------------------------ 學生
  async listMyTransactions(max = 500): Promise<Transaction[]> {
    this.requireStudent()
    await this.wait('txs')
    return [...this.cache.txs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, max)
  }

  async getTransaction(id: string): Promise<Transaction> {
    return this.net(async () => {
      const me = this.requireMe()
      let snap
      try {
        snap = await getDoc(this.ref('transactions', id))
      } catch (e) {
        if ((e as { code?: string }).code === 'permission-denied') throw new BankError('PERMISSION_DENIED', '沒有權限查看這筆交易')
        throw e
      }
      if (!snap.exists()) throw new BankError('NOT_FOUND', '找不到這筆交易')
      const tx = withId<Transaction>(id, snap.data())
      if (me.role !== 'teacher' && !tx.participants.includes(me.uid)) throw new BankError('PERMISSION_DENIED', '沒有權限查看這筆交易')
      return tx
    })
  }

  async listVisiblePresets(): Promise<Preset[]> {
    this.requireMe()
    await this.wait('presets')
    return [...this.cache.presets.values()].filter((p) => p.active && p.showToStudents).sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async createPaymentCode(): Promise<PaymentCode> {
    return this.net(async () => {
      const me = this.requireStudent()
      await this.wait('settings')
      // 清除自己上一張未使用的收款碼
      if (this.lastCodeId) await deleteDoc(this.ref('paymentCodes', this.lastCodeId)).catch(() => {})
      const t = Date.now()
      const ttl = Math.min(10, Math.max(1, this.cache.settings?.codeTtlMinutes ?? 3)) * 60_000
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = newCodeId()
        const code: PaymentCode = { id, toUid: me.uid, toName: me.name, toSeatNo: me.seatNo, createdAt: t, expiresAt: t + ttl, used: false, usedBy: null, txId: null }
        try {
          // 若 ID 已存在，規則會視為 update 而拒絕 → 換一個 ID
          await setDoc(this.ref('paymentCodes', id), strip(code))
        } catch (e) {
          if ((e as { code?: string }).code === 'permission-denied' && attempt < 4) continue
          throw e
        }
        this.lastCodeId = id
        // 監聽這張收款碼：被使用時收款畫面即時更新
        this.codeSub?.()
        this.codeSub = onSnapshot(this.ref('paymentCodes', id), () => this.emit(), () => {})
        return code
      }
      throw new BankError('CONFLICT', '產生收款碼失敗，請再試一次')
    })
  }

  async getPaymentCode(codeId: string): Promise<PaymentCode> {
    return this.net(async () => {
      this.requireStudent()
      const id = normalizeCode(String(codeId ?? ''))
      if (!isValidCode(id)) throw new BankError('CODE_INVALID', '此收款碼已使用或已失效，請對方重新產生')
      const snap = await getDoc(this.ref('paymentCodes', id)).catch(() => null)
      if (!snap || !snap.exists()) throw new BankError('CODE_INVALID', '此收款碼已使用或已失效，請對方重新產生')
      return withId<PaymentCode>(id, snap.data())
    })
  }

  async cancelPaymentCode(codeId: string): Promise<void> {
    if (!this.sess) return
    if (this.lastCodeId === codeId) { this.lastCodeId = null; this.codeSub?.(); this.codeSub = null }
    await deleteDoc(this.ref('paymentCodes', codeId)).catch(() => {}) // 已使用的收款碼規則不允許刪除，忽略
  }

  async submitTransfer(input: TransferInput): Promise<Transaction> {
    return this.net(async () => {
      const u = await this.getMe() // 最新餘額
      if (u.role !== 'student') throw new BankError('PERMISSION_DENIED', '沒有權限執行此操作')
      const code = await this.getPaymentCode(input?.codeId)
      const t = Date.now()
      if (code.used || t >= code.expiresAt) throw new BankError('CODE_INVALID', '此收款碼已使用或已失效，請對方重新產生')
      if (code.toUid === u.uid) throw new BankError('SELF_TRANSFER', '不能付款給自己')
      assertAmount(input.amount)
      if (input.amount > u.balance) throw new BankError('INSUFFICIENT_BALANCE', `點數不足（目前 ${formatPoints(u.balance)} 點）`)
      if (!CATEGORIES.includes(input.category)) throw new BankError('INVALID_ARGUMENT', '請選擇分類')
      const note = assertText(input.note, '事由', NOTE_MAX)
      const tx = baseTx({
        id: this.newTxId(), type: 'transfer', amount: input.amount, status: 'pending',
        fromUid: u.uid, fromName: u.name, fromSeatNo: u.seatNo,
        toUid: code.toUid, toName: code.toName, toSeatNo: code.toSeatNo,
        participants: [u.uid, code.toUid],
        title: `轉帳給 ${code.toName}`, note, category: input.category, codeId: code.id,
        createdBy: u.uid, createdAt: t,
      })
      const batch = writeBatch(this.db)
      batch.set(this.ref('transactions', tx.id), strip(tx))
      batch.update(this.ref('paymentCodes', code.id), { used: true, usedBy: u.uid, txId: tx.id })
      try {
        await batch.commit()
      } catch (e) {
        // 規則拒絕：多半是收款碼剛被別人使用、已過期，或收款人帳號已停用
        if ((e as { code?: string }).code === 'permission-denied') {
          const again = await getDoc(this.ref('paymentCodes', code.id)).catch(() => null)
          if (!again?.exists() || again.data().used || Date.now() >= again.data().expiresAt) {
            throw new BankError('CODE_INVALID', '此收款碼已使用或已失效，請對方重新產生')
          }
          throw new BankError('RECIPIENT_DISABLED', '收款人帳號無法使用，或資料不符，請重新掃描')
        }
        throw e
      }
      this.applyLocal('txs', tx.id, strip(tx))
      return tx
    })
  }

  // ------------------------------------------------------------------ 教師：讀取
  async listStudents(): Promise<User[]> {
    this.requireTeacher()
    await this.wait('users')
    return [...this.cache.users.values()].filter((u) => u.role === 'student').sort((a, b) => a.seatNo - b.seatNo)
  }

  async getStudent(uid: string): Promise<User> {
    this.requireTeacher()
    await this.wait('users')
    const u = this.cache.users.get(uid)
    if (!u || u.role !== 'student') throw new BankError('NOT_FOUND', '找不到這位學生')
    return { ...u }
  }

  private async ensureOlder(from?: number) {
    if (this.olderLoaded) return
    if (from !== undefined && from >= this.windowStart) return
    const snap = await getDocs(collection(this.db, 'transactions'))
    for (const d of snap.docs) this.cache.txs.set(d.id, withId<Transaction>(d.id, d.data()))
    this.olderLoaded = true
  }

  async listTransactions(f: TxFilter = {}): Promise<Transaction[]> {
    return this.net(async () => {
      this.requireTeacher()
      await this.wait('txs', 'pending')
      await this.ensureOlder(f.batchId || f.uid ? undefined : f.from)
      let list = [...this.cache.txs.values()]
      if (f.from !== undefined) list = list.filter((t) => t.createdAt >= f.from!)
      if (f.to !== undefined) list = list.filter((t) => t.createdAt < f.to!)
      if (f.type) list = list.filter((t) => t.type === f.type)
      if (f.uid) list = list.filter((t) => t.participants.includes(f.uid!))
      if (f.status) list = list.filter((t) => t.status === f.status)
      if (f.batchId) list = list.filter((t) => t.batchId === f.batchId)
      list.sort((a, b) => b.createdAt - a.createdAt)
      return f.limit ? list.slice(0, f.limit) : list
    })
  }

  async listPending(): Promise<Transaction[]> {
    this.requireTeacher()
    await this.wait('pending')
    return [...this.cache.txs.values()].filter((t) => t.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
  }

  // ------------------------------------------------------------------ 教師：轉帳審核
  async approveTransfer(txId: string): Promise<Transaction> {
    return this.net(async () => {
      const teacher = this.requireTeacher()
      const out = await runTransaction(this.db, async (t) => {
        const txSnap = await t.get(this.ref('transactions', txId))
        if (!txSnap.exists() || txSnap.data().type !== 'transfer') throw new BankError('NOT_FOUND', '找不到這筆申請')
        const tx = withId<Transaction>(txId, txSnap.data())
        if (tx.status !== 'pending') throw new BankError('ALREADY_DECIDED', '這筆申請已經處理過了')
        const fromSnap = await t.get(this.ref('users', tx.fromUid!))
        const toSnap = await t.get(this.ref('users', tx.toUid!))
        if (!fromSnap.exists() || !toSnap.exists()) throw new BankError('NOT_FOUND', '找不到這位學生')
        const from = fromSnap.data() as User
        const to = toSnap.data() as User
        if (from.balance < tx.amount) {
          throw new BankError('INSUFFICIENT_BALANCE', `${from.name} 的點數不足（目前 ${formatPoints(from.balance)} 點）`)
        }
        const now = Date.now()
        t.update(fromSnap.ref, { balance: from.balance - tx.amount, updatedAt: now })
        t.update(toSnap.ref, { balance: to.balance + tx.amount, updatedAt: now })
        t.update(txSnap.ref, { status: 'approved', decidedBy: teacher.uid, decidedAt: now })
        return {
          tx: { ...tx, status: 'approved' as const, decidedBy: teacher.uid, decidedAt: now },
          from: { ...from, balance: from.balance - tx.amount, updatedAt: now },
          to: { ...to, balance: to.balance + tx.amount, updatedAt: now },
        }
      })
      this.applyLocal('users', out.tx.fromUid!, out.from)
      this.applyLocal('users', out.tx.toUid!, out.to)
      this.applyLocal('txs', txId, out.tx)
      return out.tx
    })
  }

  async rejectTransfer(txId: string, reason: string): Promise<Transaction> {
    return this.net(async () => {
      const teacher = this.requireTeacher()
      const r = assertText(reason ?? '', '駁回原因', NOTE_MAX, false) || null
      const tx = await runTransaction(this.db, async (t) => {
        const snap = await t.get(this.ref('transactions', txId))
        if (!snap.exists() || snap.data().type !== 'transfer') throw new BankError('NOT_FOUND', '找不到這筆申請')
        const tx = withId<Transaction>(txId, snap.data())
        if (tx.status !== 'pending') throw new BankError('ALREADY_DECIDED', '這筆申請已經處理過了')
        const patch = { status: 'rejected' as const, rejectReason: r, decidedBy: teacher.uid, decidedAt: Date.now() }
        t.update(snap.ref, patch)
        return { ...tx, ...patch }
      })
      this.applyLocal('txs', txId, tx)
      return tx
    })
  }

  async approveMany(txIds: string[]): Promise<ItemResult[]> {
    this.requireTeacher()
    // 依送出時間先後處理；快取尚未同步到的申請直接向伺服器讀取
    const created = new Map<string, number>()
    for (const id of txIds) {
      let t = this.cache.txs.get(id)?.createdAt
      if (t === undefined) {
        const s = await getDoc(this.ref('transactions', id)).catch(() => null)
        t = s?.exists() ? (s.data().createdAt as number) : 0
      }
      created.set(id, t)
    }
    const ordered = [...txIds].sort((a, b) => created.get(a)! - created.get(b)!)
    const results: ItemResult[] = []
    for (const id of ordered) {
      try {
        await this.approveTransfer(id)
        results.push({ id, ok: true })
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return results
  }

  // ------------------------------------------------------------------ 教師：加扣點、小組獎勵
  async adjust(input: AdjustInput): Promise<Transaction[]> {
    return this.net(async () => {
      const teacher = this.requireTeacher()
      const uids = [...new Set(input.uids ?? [])]
      if (uids.length === 0) throw new BankError('INVALID_ARGUMENT', '請選擇學生')
      if (input.kind !== 'add' && input.kind !== 'deduct') throw new BankError('INVALID_ARGUMENT', '請選擇加點或扣點')
      assertAmount(input.amount)
      const title = assertText(input.title, '項目名稱', 20)
      const note = assertText(input.note ?? '', '事由', NOTE_MAX, false)
      const batchId = uids.length > 1 ? `b_${this.newTxId()}` : null
      const out = await runTransaction(this.db, async (t) => {
        const snaps: DocumentSnapshot[] = []
        for (const uid of uids) snaps.push(await t.get(this.ref('users', uid)))
        const students = snaps.map((s) => {
          if (!s.exists() || s.data().role !== 'student') throw new BankError('NOT_FOUND', '找不到這位學生')
          return { ...(s.data() as User), uid: s.id }
        })
        if (input.kind === 'deduct') {
          const short = students.filter((u) => u.balance < input.amount)
          if (short.length) {
            throw new BankError('INSUFFICIENT_BALANCE',
              `點數不足：${short.map((u) => `${u.name}（${formatPoints(u.balance)}）`).join('、')}`, short.map((u) => u.uid))
          }
        }
        const now = Date.now()
        return students.map((u, i) => {
          const tx = baseTx({
            id: this.newTxId(), type: input.kind === 'add' ? 'reward' : 'penalty', amount: input.amount,
            fromUid: input.kind === 'deduct' ? u.uid : null, fromName: input.kind === 'deduct' ? u.name : null,
            fromSeatNo: input.kind === 'deduct' ? u.seatNo : null,
            toUid: input.kind === 'add' ? u.uid : null, toName: input.kind === 'add' ? u.name : null,
            toSeatNo: input.kind === 'add' ? u.seatNo : null,
            participants: [u.uid], title, note, presetId: input.presetId ?? null, batchId,
            createdBy: teacher.uid, createdAt: now, decidedBy: teacher.uid, decidedAt: now,
          })
          const balance = u.balance + (input.kind === 'add' ? input.amount : -input.amount)
          t.update(snaps[i].ref, { balance, updatedAt: now })
          t.set(this.ref('transactions', tx.id), strip(tx))
          return { tx, user: { ...u, balance, updatedAt: now } }
        })
      })
      for (const o of out) { this.applyLocal('users', o.user.uid, o.user); this.applyLocal('txs', o.tx.id, o.tx) }
      return out.map((o) => o.tx)
    })
  }

  async groupAward(input: GroupAwardInput): Promise<GroupAward> {
    return this.net(async () => {
      const teacher = this.requireTeacher()
      await this.wait('users', 'groups', 'awards')
      if (!isValidDateKey(input.awardDate)) throw new BankError('INVALID_ARGUMENT', '日期格式錯誤')
      const champ = [...new Set(input.championIds ?? [])]
      const runner = [...new Set(input.runnerUpIds ?? [])]
      if (champ.length === 0 && runner.length === 0) throw new BankError('INVALID_ARGUMENT', '請至少選擇一個冠軍或亞軍組別')
      if (champ.some((id) => runner.includes(id))) throw new BankError('INVALID_ARGUMENT', '同一組不能同時是冠軍和亞軍')
      for (const id of [...champ, ...runner]) if (!this.cache.groups.get(id)) throw new BankError('NOT_FOUND', '找不到組別')
      if (champ.length) assertAmount(input.championAmount)
      if (runner.length) assertAmount(input.runnerUpAmount)
      const awardsSnap = await getDocs(query(collection(this.db, 'groupAwards'), where('awardDate', '==', input.awardDate)))
      const dup = awardsSnap.docs.some((d) => !d.data().reversed)
      if (dup && !input.confirmDuplicate) throw new BankError('DUPLICATE_AWARD', `${input.awardDate} 已發放過小組獎勵`)

      const excluded = new Set(input.excludedUids ?? [])
      const plan: { uid: string; gid: string; rank: 1 | 2; amount: number; tied: boolean }[] = []
      const add = (ids: string[], rank: 1 | 2, amount: number) => {
        for (const gid of ids) {
          const members = [...this.cache.users.values()]
            .filter((u) => u.role === 'student' && u.active && u.groupId === gid && !excluded.has(u.uid))
            .sort((a, b) => a.seatNo - b.seatNo)
          for (const u of members) plan.push({ uid: u.uid, gid, rank, amount, tied: ids.length > 1 })
        }
      }
      add(champ, 1, input.championAmount)
      add(runner, 2, input.runnerUpAmount)
      if (plan.length === 0) throw new BankError('INVALID_ARGUMENT', '選擇的組別沒有可發放的學生')

      const batchId = `b_${this.newTxId()}`
      const out = await runTransaction(this.db, async (t) => {
        const snaps: DocumentSnapshot[] = []
        for (const p of plan) snaps.push(await t.get(this.ref('users', p.uid)))
        const now = Date.now()
        const txs: Transaction[] = []
        const users: User[] = []
        let total = 0
        plan.forEach((p, i) => {
          const s = snaps[i]
          if (!s.exists()) throw new BankError('CONFLICT', '學生資料已變更，請重新整理後再試')
          const u = { ...(s.data() as User), uid: s.id }
          if (!u.active || u.groupId !== p.gid) throw new BankError('CONFLICT', '分組已變更，請重新整理後再試')
          const g = this.cache.groups.get(p.gid)!
          const tx = baseTx({
            id: this.newTxId(), type: 'groupReward', amount: p.amount,
            toUid: u.uid, toName: u.name, toSeatNo: u.seatNo, participants: [u.uid],
            title: `小組${p.rank === 1 ? '冠軍' : '亞軍'}（${g.name}）`,
            note: p.tied ? `並列${p.rank === 1 ? '冠軍' : '亞軍'}` : '',
            batchId, group: { id: g.id, name: g.name, rank: p.rank, tied: p.tied, awardDate: input.awardDate },
            createdBy: teacher.uid, createdAt: now, decidedBy: teacher.uid, decidedAt: now,
          })
          t.update(s.ref, { balance: u.balance + p.amount, updatedAt: now })
          t.set(this.ref('transactions', tx.id), strip(tx))
          txs.push(tx)
          users.push({ ...u, balance: u.balance + p.amount, updatedAt: now })
          total += p.amount
        })
        const rec: GroupAward = {
          id: batchId, awardDate: input.awardDate,
          champions: champ.map((id) => ({ id, name: this.cache.groups.get(id)!.name })),
          runnersUp: runner.map((id) => ({ id, name: this.cache.groups.get(id)!.name })),
          championAmount: champ.length ? input.championAmount : 0,
          runnerUpAmount: runner.length ? input.runnerUpAmount : 0,
          recipients: plan.map((p) => p.uid), excluded: [...excluded], total, reversed: false,
          createdBy: teacher.uid, createdAt: now,
        }
        t.set(this.ref('groupAwards', batchId), strip(rec))
        return { txs, users, rec }
      })
      for (const u of out.users) this.applyLocal('users', u.uid, u)
      for (const tx of out.txs) this.applyLocal('txs', tx.id, tx)
      this.applyLocal('awards', out.rec.id, out.rec)
      return out.rec
    })
  }

  async listGroupAwards(): Promise<GroupAward[]> {
    this.requireTeacher()
    await this.wait('awards')
    return [...this.cache.awards.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  // ------------------------------------------------------------------ 教師：沖正
  /** 在同一個 Firestore 交易中沖正多筆（先讀後寫） */
  private async reverseMany(txIds: string[], reason: string, batchIdForAward: string | null): Promise<Transaction[]> {
    const teacher = this.requireTeacher()
    const r = assertText(reason, '沖正原因', NOTE_MAX)
    const out = await runTransaction(this.db, async (t) => {
      const origs: Transaction[] = []
      for (const id of txIds) {
        const s = await t.get(this.ref('transactions', id))
        if (!s.exists()) throw new BankError('NOT_FOUND', '找不到這筆交易')
        origs.push(withId<Transaction>(id, s.data()))
      }
      for (const o of origs) {
        if (o.type === 'reversal') throw new BankError('CANNOT_REVERSE_REVERSAL', '沖正交易不能再沖正')
        if (o.status !== 'approved') throw new BankError('NOT_APPROVED', '只有已完成的交易可以沖正；審核中的申請請直接駁回')
        if (o.reversedBy) throw new BankError('ALREADY_REVERSED', '這筆交易已經沖正過了')
      }
      const uids = [...new Set(origs.flatMap((o) => [o.fromUid, o.toUid]).filter((x): x is string => !!x))]
      const users = new Map<string, User & { ref: any }>()
      for (const uid of uids) {
        const s = await t.get(this.ref('users', uid))
        if (!s.exists()) throw new BankError('NOT_FOUND', '找不到這位學生')
        users.set(uid, { ...(s.data() as User), uid, ref: s.ref })
      }
      let awardSnap = null
      if (batchIdForAward) awardSnap = await t.get(this.ref('groupAwards', batchIdForAward))
      // ---- 以下只寫入 ----
      const now = Date.now()
      const revs: Transaction[] = []
      for (const o of origs) {
        const newFrom = o.toUid ? users.get(o.toUid)! : null
        const newTo = o.fromUid ? users.get(o.fromUid)! : null
        if (newFrom && newFrom.balance < o.amount) {
          throw new BankError('NEGATIVE_AFTER_REVERSAL', `${newFrom.name} 的點數不足（目前 ${formatPoints(newFrom.balance)} 點），無法沖正`)
        }
        const rev = baseTx({
          id: this.newTxId(), type: 'reversal', amount: o.amount,
          fromUid: newFrom?.uid ?? null, fromName: newFrom?.name ?? null, fromSeatNo: newFrom?.seatNo ?? null,
          toUid: newTo?.uid ?? null, toName: newTo?.name ?? null, toSeatNo: newTo?.seatNo ?? null,
          participants: [...o.participants], title: `沖正：${o.title}`, note: r,
          category: o.category, batchId: null, reversalOf: o.id,
          createdBy: teacher.uid, createdAt: now, decidedBy: teacher.uid, decidedAt: now,
        })
        if (newFrom) newFrom.balance -= o.amount
        if (newTo) newTo.balance += o.amount
        o.reversedBy = rev.id
        revs.push(rev)
      }
      for (const u of users.values()) t.update(u.ref, { balance: u.balance, updatedAt: now })
      for (const o of origs) t.update(this.ref('transactions', o.id), { reversedBy: o.reversedBy })
      for (const rev of revs) t.set(this.ref('transactions', rev.id), strip(rev))
      if (awardSnap?.exists()) t.update(awardSnap.ref, { reversed: true })
      return { revs, origs, users: [...users.values()].map(({ ref: _r, ...u }) => ({ ...u, updatedAt: now })), award: awardSnap?.exists() ? withId<GroupAward>(awardSnap.id, { ...awardSnap.data(), reversed: true }) : null }
    })
    for (const u of out.users) this.applyLocal('users', u.uid, u)
    for (const o of out.origs) this.applyLocal('txs', o.id, o)
    for (const rv of out.revs) this.applyLocal('txs', rv.id, rv)
    if (out.award) this.applyLocal('awards', out.award.id, out.award)
    return out.revs
  }

  async reverse(txId: string, reason: string): Promise<Transaction> {
    return this.net(async () => (await this.reverseMany([txId], reason, null))[0])
  }

  async reverseBatch(batchId: string, reason: string): Promise<Transaction[]> {
    return this.net(async () => {
      this.requireTeacher()
      assertText(reason, '沖正原因', NOTE_MAX)
      const snap = await getDocs(query(collection(this.db, 'transactions'), where('batchId', '==', batchId)))
      const ids = snap.docs
        .map((d) => withId<Transaction>(d.id, d.data()))
        .filter((x) => x.type !== 'reversal' && x.status === 'approved' && !x.reversedBy)
        .map((x) => x.id)
      if (ids.length === 0) throw new BankError('NOT_FOUND', '這個批次沒有可沖正的交易')
      return this.reverseMany(ids, reason, batchId)
    })
  }

  // ------------------------------------------------------------------ 教師：加點項目與小確幸、分組
  async listPresets(): Promise<Preset[]> {
    this.requireTeacher()
    await this.wait('presets')
    return [...this.cache.presets.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async savePreset(p: Omit<Preset, 'id'> & { id?: string }): Promise<Preset> {
    return this.net(async () => {
      this.requireTeacher()
      await this.wait('presets')
      if (p.kind !== 'add' && p.kind !== 'deduct') throw new BankError('INVALID_ARGUMENT', '請選擇類型')
      assertAmount(p.amount)
      const preset: Preset = {
        id: p.id && this.cache.presets.has(p.id) ? p.id : doc(collection(this.db, 'presets')).id,
        kind: p.kind,
        name: assertText(p.name, '名稱', 20),
        description: assertText(p.description ?? '', '說明', DESCRIPTION_MAX, false),
        amount: p.amount,
        icon: typeof p.icon === 'string' && p.icon ? p.icon.slice(0, 20) : 'star',
        sortOrder: isInt(p.sortOrder) ? p.sortOrder : this.cache.presets.size + 1,
        active: !!p.active,
        showToStudents: !!p.showToStudents,
      }
      await setDoc(this.ref('presets', preset.id), strip(preset))
      this.applyLocal('presets', preset.id, preset)
      return preset
    })
  }

  async saveGroup(g: Omit<Group, 'id'> & { id?: string }): Promise<Group> {
    return this.net(async () => {
      this.requireTeacher()
      await this.wait('groups', 'users')
      const name = assertText(g.name, '組名', 12)
      if ([...this.cache.groups.values()].some((x) => x.name === name && x.id !== g.id)) throw new BankError('INVALID_ARGUMENT', `已有名為「${name}」的組別`)
      const group: Group = {
        id: g.id && this.cache.groups.has(g.id) ? g.id : doc(collection(this.db, 'groups')).id,
        name,
        color: /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : '#06C755',
        sortOrder: isInt(g.sortOrder) ? g.sortOrder : this.cache.groups.size + 1,
        active: g.active !== false,
      }
      const batch = writeBatch(this.db)
      batch.set(this.ref('groups', group.id), strip(group))
      const moved: User[] = []
      if (!group.active) {
        for (const u of this.cache.users.values()) {
          if (u.groupId === group.id) { batch.update(this.ref('users', u.uid), { groupId: null }); moved.push({ ...u, groupId: null }) }
        }
      }
      await batch.commit()
      this.applyLocal('groups', group.id, group)
      for (const u of moved) this.applyLocal('users', u.uid, u)
      return group
    })
  }

  async assignGroup(uid: string, groupId: string | null): Promise<void> {
    return this.net(async () => {
      this.requireTeacher()
      const u = await this.getStudent(uid)
      if (groupId !== null && (!this.cache.groups.get(groupId) || !this.cache.groups.get(groupId)!.active)) throw new BankError('NOT_FOUND', '找不到組別')
      const now = Date.now()
      await setDoc(this.ref('users', uid), { groupId, updatedAt: now }, { merge: true })
      this.applyLocal('users', uid, { ...u, groupId, updatedAt: now })
    })
  }

  // ------------------------------------------------------------------ 教師：帳號
  private importAuth(): Auth {
    if (!this.importApp) {
      this.importApp = initializeApp(this.opts.config, `${this.opts.appName ?? 'main'}-import`)
    }
    const a = initializeAuthOnce(this.importApp)
    if (this.opts.emulator && !(a as any)._bankEmu) {
      connectAuthEmulator(a, `http://${this.opts.emulator.host}:${this.opts.emulator.authPort}`, { disableWarnings: true })
      ;(a as any)._bankEmu = true
    }
    return a
  }

  async importStudents(rows: RosterRow[]): Promise<ImportResult> {
    return this.net(async () => {
      this.requireTeacher()
      await this.wait('users', 'groups')
      const skipped: ImportResult['skipped'] = []
      const existing = new Set([...this.cache.users.values()].map((u) => u.account.toLowerCase()))
      const created: { r: RosterRow; uid: string }[] = []
      const sec = this.importAuth()
      for (const r of rows) {
        const acc = r.account.toLowerCase()
        if (!ACCOUNT_PATTERN.test(r.account)) { skipped.push({ account: r.account, reason: '帳號格式錯誤' }); continue }
        if (r.password.length < PASSWORD_MIN) { skipped.push({ account: r.account, reason: '密碼太短' }); continue }
        if (existing.has(acc)) { skipped.push({ account: r.account, reason: '帳號已存在' }); continue }
        const email = `${acc}@${this.opts.studentEmailDomain}`
        let uid: string
        try {
          uid = (await createUserWithEmailAndPassword(sec, email, r.password)).user.uid
        } catch (e) {
          if ((e as { code?: string }).code !== 'auth/email-already-in-use') {
            skipped.push({ account: r.account, reason: `建立登入帳號失敗（${(e as { code?: string }).code ?? e}）` })
            continue
          }
          // 登入帳號已存在（例如先前刪除了名冊資料）：以名冊密碼登入取得 uid 後重建
          try {
            uid = (await signInWithEmailAndPassword(sec, email, r.password)).user.uid
          } catch {
            skipped.push({ account: r.account, reason: '登入帳號已存在且密碼不同，請用管理工具刪除後再匯入' })
            continue
          }
        }
        await signOut(sec).catch(() => {})
        existing.add(acc)
        created.push({ r, uid })
      }
      if (!created.length) return { created: 0, skipped }

      const batch = writeBatch(this.db)
      const now = Date.now()
      const groupByName = new Map([...this.cache.groups.values()].map((g) => [g.name, g]))
      const newGroups: Group[] = []
      const newUsers: User[] = []
      for (const { r, uid } of created) {
        let groupId: string | null = null
        if (r.group) {
          let g = groupByName.get(r.group)
          if (!g) {
            g = { id: doc(collection(this.db, 'groups')).id, name: r.group.slice(0, 12), color: '#06C755', sortOrder: groupByName.size + 1, active: true }
            groupByName.set(g.name, g)
            newGroups.push(g)
            batch.set(this.ref('groups', g.id), strip(g))
          }
          groupId = g.id
        }
        const u: User = {
          uid, role: 'student', account: r.account.toLowerCase(), name: r.name.slice(0, 20), seatNo: r.seatNo,
          groupId, balance: 0, active: true, createdAt: now, updatedAt: now,
        }
        batch.set(this.ref('users', uid), u)
        newUsers.push(u)
      }
      await batch.commit()
      for (const g of newGroups) this.applyLocal('groups', g.id, g)
      for (const u of newUsers) this.applyLocal('users', u.uid, u)
      return { created: created.length, skipped }
    })
  }

  async updateStudent(uid: string, patch: { name?: string; seatNo?: number; active?: boolean }): Promise<User> {
    return this.net(async () => {
      this.requireTeacher()
      const u = await this.getStudent(uid)
      const next = { ...u }
      if (patch.name !== undefined) next.name = assertText(patch.name, '姓名', 20)
      if (patch.seatNo !== undefined) {
        if (!isInt(patch.seatNo) || patch.seatNo <= 0) throw new BankError('INVALID_ARGUMENT', '座號須為正整數')
        next.seatNo = patch.seatNo
      }
      if (patch.active !== undefined) next.active = !!patch.active
      next.updatedAt = Date.now()
      await setDoc(this.ref('users', uid), { name: next.name, seatNo: next.seatNo, active: next.active, updatedAt: next.updatedAt }, { merge: true })
      this.applyLocal('users', uid, next)
      return next
    })
  }

  async setStudentsActive(uids: string[], active: boolean): Promise<number> {
    return this.net(async () => {
      this.requireTeacher()
      await this.wait('users')
      const list = [...new Set(uids ?? [])].map((uid) => {
        const u = this.cache.users.get(uid)
        if (!u || u.role !== 'student') throw new BankError('NOT_FOUND', '找不到這位學生')
        return u
      })
      if (!list.length) throw new BankError('INVALID_ARGUMENT', '請選擇學生')
      const now = Date.now()
      const batch = writeBatch(this.db)
      for (const u of list) batch.update(this.ref('users', u.uid), { active: !!active, updatedAt: now })
      await batch.commit()
      for (const u of list) this.applyLocal('users', u.uid, { ...u, active: !!active, updatedAt: now })
      return list.length
    })
  }

  async deleteStudents(uids: string[]): Promise<DeleteResult> {
    return this.net(async () => {
      const teacher = this.requireTeacher()
      const ids = [...new Set(uids ?? [])]
      if (!ids.length) throw new BankError('INVALID_ARGUMENT', '請選擇學生')
      // 先找出相關的審核中轉帳與收款碼（交易內不能查詢，只能讀取指定文件）
      const pendingSnap = await getDocs(query(collection(this.db, 'transactions'), where('status', '==', 'pending')))
      const pendingIds = pendingSnap.docs.filter((d) => (d.data().participants as string[]).some((p) => ids.includes(p))).map((d) => d.id)
      const codeIds: string[] = []
      for (let i = 0; i < ids.length; i += 30) {
        const s = await getDocs(query(collection(this.db, 'paymentCodes'), where('toUid', 'in', ids.slice(i, i + 30))))
        codeIds.push(...s.docs.map((d) => d.id))
      }
      const out = await runTransaction(this.db, async (t) => {
        const users: User[] = []
        for (const uid of ids) {
          const s = await t.get(this.ref('users', uid))
          if (!s.exists() || s.data().role !== 'student') throw new BankError('NOT_FOUND', '找不到這位學生')
          users.push({ ...(s.data() as User), uid })
        }
        const pend: Transaction[] = []
        for (const id of pendingIds) {
          const s = await t.get(this.ref('transactions', id))
          if (s.exists() && s.data().status === 'pending') pend.push(withId<Transaction>(id, s.data()))
        }
        const now = Date.now()
        const rejected = pend.map((p) => ({ ...p, status: 'rejected' as const, rejectReason: '帳號已刪除', decidedBy: teacher.uid, decidedAt: now }))
        for (const p of rejected) t.update(this.ref('transactions', p.id), { status: p.status, rejectReason: p.rejectReason, decidedBy: p.decidedBy, decidedAt: p.decidedAt })
        for (const c of codeIds) t.delete(this.ref('paymentCodes', c))
        for (const u of users) t.delete(this.ref('users', u.uid))
        return { users, rejected }
      })
      for (const u of out.users) this.applyLocal('users', u.uid, null)
      for (const p of out.rejected) this.applyLocal('txs', p.id, p)
      return { deleted: out.users.length, rejectedPending: out.rejected.length, forfeitedPoints: out.users.reduce((a, u) => a + u.balance, 0) }
    })
  }

  async resetPassword(): Promise<void> {
    this.requireTeacher()
    throw new BankError('NOT_SUPPORTED', '免費方案無法在網頁上重設學生密碼。請在老師電腦執行：npm run admin -- reset-password <帳號> <新密碼>')
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.net(async () => {
      this.requireTeacher()
      await this.wait('settings')
      const next = { ...(this.cache.settings ?? DEFAULT_SETTINGS), ...patch }
      if (!isInt(next.codeTtlMinutes) || next.codeTtlMinutes < 1 || next.codeTtlMinutes > 10) throw new BankError('INVALID_ARGUMENT', '收款碼有效時間須為 1～10 分鐘')
      assertAmount(next.championAmount)
      assertAmount(next.runnerUpAmount)
      next.className = assertText(next.className, '班級名稱', 20)
      await setDoc(this.ref('settings', 'app'), next)
      this.cache.settings = next
      this.emit()
      return { ...next }
    })
  }

  async exportAll(): Promise<Record<string, unknown>> {
    return this.net(async () => {
      this.requireTeacher()
      const all = async (col: Col) => Object.fromEntries((await getDocs(collection(this.db, col))).docs.map((d) => [d.id, { ...d.data(), id: d.id }]))
      return {
        users: await all('users'), transactions: await all('transactions'), presets: await all('presets'),
        groups: await all('groups'), groupAwards: await all('groupAwards'), settings: (await getDoc(this.ref('settings', 'app'))).data() ?? DEFAULT_SETTINGS,
        exportedAt: Date.now(),
      }
    })
  }
}

// 匯入用的第二個 Firebase App：只初始化一次 Auth
const authOnce = new WeakMap<FirebaseApp, Auth>()
function initializeAuthOnce(app: FirebaseApp): Auth {
  let a = authOnce.get(app)
  if (!a) {
    a = initializeAuth(app, { persistence: inMemoryPersistence })
    authOnce.set(app, a)
  }
  return a
}
