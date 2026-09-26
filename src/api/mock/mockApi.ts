// MockApi：在瀏覽器內模擬「Firebase Auth + Firestore + Security Rules」。
// 每個方法都先依資料庫中的角色與狀態檢查權限（等同 Security Rules），
// 所有寫入都經過 store.transact()，保證全有全無。
import type {
  Group, GroupAward, PaymentCode, Preset, Settings, Transaction, User,
} from '../../domain/types'
import { NOTE_MAX, DESCRIPTION_MAX, formatPoints } from '../../domain/money'
import { CATEGORIES, assertAmount, assertText, baseTx, isInt } from '../shared'
import { isValidCode, newCodeId, newId, normalizeCode } from '../../domain/codes'
import { isValidDateKey } from '../../domain/dates'
import { ACCOUNT_PATTERN, PASSWORD_MIN, toHalfWidth, type RosterRow } from '../../domain/roster'
import {
  BankError, type AdjustInput, type BankApi, type GroupAwardInput, type ImportResult,
  type DeleteResult, type ItemResult, type Session, type TransferInput, type TxFilter,
} from '../types'
import { MockStore, type DbState, type StorageLike } from './store'
import { hashPassword, verifyPassword } from './crypto'
import seed from '../seed-data.json'

export interface MockApiOptions {
  store: MockStore
  sessionStorage: StorageLike
  now?: () => number
  latencyMs?: number
  hashIterations?: number
}

const SESSION_KEY = 'hsps-bank-session'
const MAX_LOGIN_FAILS = 5
const LOCK_MS = 60_000
export class MockApi implements BankApi {
  readonly backend = 'mock' as const
  private store: MockStore
  private ss: StorageLike
  private now: () => number
  private latency: number
  private iter: number

  constructor(opts: MockApiOptions) {
    this.store = opts.store
    this.ss = opts.sessionStorage
    this.now = opts.now ?? (() => Date.now())
    this.latency = opts.latencyMs ?? 0
    this.iter = opts.hashIterations ?? 100_000
  }

  private async net<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency))
    return fn()
  }

  // ------------------------------------------------------------------ 權限（等同 Security Rules）
  currentSession(): Session | null {
    const raw = this.ss.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  }

  private me(s: DbState): User {
    const sess = this.currentSession()
    if (!sess) throw new BankError('UNAUTHENTICATED', '請先登入')
    const u = s.users[sess.uid]
    if (!u) throw new BankError('PERMISSION_DENIED', '帳號不存在')
    if (!u.active) throw new BankError('ACCOUNT_DISABLED', '帳號已停用，請洽老師')
    return u
  }

  private teacher(s: DbState): User {
    const u = this.me(s)
    if (u.role !== 'teacher') throw new BankError('PERMISSION_DENIED', '沒有權限執行此操作')
    return u
  }

  private student(s: DbState): User {
    const u = this.me(s)
    if (u.role !== 'student') throw new BankError('PERMISSION_DENIED', '沒有權限執行此操作')
    return u
  }

  private studentByUid(s: DbState, uid: string): User {
    const u = s.users[uid]
    if (!u || u.role !== 'student') throw new BankError('NOT_FOUND', '找不到這位學生')
    return u
  }

  async ready(): Promise<void> {}

  onChange(cb: () => void): () => void {
    return this.store.subscribe(cb)
  }

  // ------------------------------------------------------------------ 系統
  async needsSetup(): Promise<boolean> {
    return this.net(() => !Object.values(this.store.read().users).some((u) => u.role === 'teacher'))
  }

  async setupTeacher(name: string, password: string): Promise<void> {
    await this.net(() => undefined)
    const n = assertText(name, '姓名', 20)
    if (typeof password !== 'string' || password.length < 8) throw new BankError('INVALID_ARGUMENT', '教師密碼至少 8 碼')
    const h = await hashPassword(password, this.iter)
    const t = this.now()
    this.store.transact((s) => {
      if (Object.values(s.users).some((u) => u.role === 'teacher')) throw new BankError('ALREADY_SETUP', '系統已建立教師帳號')
      const uid = newId('u_')
      s.users[uid] = { uid, role: 'teacher', account: 'teacher', name: n, seatNo: 0, groupId: null, balance: 0, active: true, createdAt: t, updatedAt: t }
      s.creds['teacher'] = { uid, ...h }
      if (Object.keys(s.presets).length === 0) seedPresets(s)
      if (Object.keys(s.groups).length === 0) seedGroups(s)
    })
  }

  // ------------------------------------------------------------------ 登入
  async login(account: string, password: string): Promise<Session> {
    await this.net(() => undefined)
    // 與名冊匯入相同的正規化：全形轉半形、去除前後空白（避免中文輸入法打成全形）
    const key = toHalfWidth(String(account ?? '')).trim().toLowerCase()
    const s0 = this.store.read()
    const att = s0.loginAttempts[key]
    if (att && att.lockedUntil > this.now()) throw new BankError('TOO_MANY_ATTEMPTS', '嘗試次數過多，請 1 分鐘後再試')
    const cred = s0.creds[key]
    const ok = cred ? await verifyPassword(String(password ?? ''), cred) : false
    if (!ok) {
      this.store.transact((s) => {
        const a = s.loginAttempts[key] ?? { count: 0, lockedUntil: 0 }
        a.count += 1
        if (a.count >= MAX_LOGIN_FAILS) { a.lockedUntil = this.now() + LOCK_MS; a.count = 0 }
        s.loginAttempts[key] = a
      })
      throw new BankError('INVALID_CREDENTIALS', '帳號或密碼錯誤')
    }
    const user = this.store.read().users[cred!.uid]
    if (!user) throw new BankError('INVALID_CREDENTIALS', '帳號或密碼錯誤')
    if (!user.active) throw new BankError('ACCOUNT_DISABLED', '帳號已停用，請洽老師')
    if (s0.loginAttempts[key]) this.store.transact((s) => { delete s.loginAttempts[key] })
    const sess: Session = { uid: user.uid, role: user.role }
    this.ss.setItem(SESSION_KEY, JSON.stringify(sess))
    return sess
  }

  mockDiagnostics(account?: string): { studentCount: number; accountExists: boolean | null } {
    const s = this.store.read()
    const studentCount = Object.values(s.users).filter((u) => u.role === 'student').length
    const key = account ? toHalfWidth(account).trim().toLowerCase() : ''
    return { studentCount, accountExists: key ? !!s.creds[key] : null }
  }

  async logout(): Promise<void> {
    this.ss.removeItem(SESSION_KEY)
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.net(() => undefined)
    const s = this.store.read()
    const u = this.me(s)
    const cred = s.creds[u.account.toLowerCase()]
    if (!cred || !(await verifyPassword(oldPassword, cred))) throw new BankError('INVALID_CREDENTIALS', '舊密碼錯誤')
    const min = u.role === 'teacher' ? 8 : PASSWORD_MIN
    if (typeof newPassword !== 'string' || newPassword.length < min) throw new BankError('INVALID_ARGUMENT', `新密碼至少 ${min} 碼`)
    const h = await hashPassword(newPassword, this.iter)
    this.store.transact((d) => { d.creds[u.account.toLowerCase()] = { uid: u.uid, ...h } })
  }

  // ------------------------------------------------------------------ 共用讀取
  async getMe(): Promise<User> {
    return this.net(() => ({ ...this.me(this.store.read()) }))
  }

  async getSettings(): Promise<Settings> {
    return this.net(() => {
      const s = this.store.read()
      this.me(s)
      return { ...s.settings }
    })
  }

  async listGroups(): Promise<Group[]> {
    return this.net(() => {
      const s = this.store.read()
      this.me(s)
      return Object.values(s.groups).sort((a, b) => a.sortOrder - b.sortOrder)
    })
  }

  // ------------------------------------------------------------------ 學生
  async listMyTransactions(limit = 500): Promise<Transaction[]> {
    return this.net(() => {
      const s = this.store.read()
      const u = this.student(s)
      return Object.values(s.transactions)
        .filter((t) => t.participants.includes(u.uid))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
    })
  }

  async getTransaction(id: string): Promise<Transaction> {
    return this.net(() => {
      const s = this.store.read()
      const u = this.me(s)
      const tx = s.transactions[id]
      if (!tx) throw new BankError('NOT_FOUND', '找不到這筆交易')
      if (u.role !== 'teacher' && !tx.participants.includes(u.uid)) throw new BankError('PERMISSION_DENIED', '沒有權限查看這筆交易')
      return { ...tx }
    })
  }

  async listVisiblePresets(): Promise<Preset[]> {
    return this.net(() => {
      const s = this.store.read()
      this.me(s)
      return Object.values(s.presets).filter((p) => p.active && p.showToStudents).sort((a, b) => a.sortOrder - b.sortOrder)
    })
  }

  async createPaymentCode(): Promise<PaymentCode> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const u = this.student(s)
      const t = this.now()
      // 清掃：自己過期或未使用的舊收款碼
      for (const c of Object.values(s.paymentCodes)) {
        if (c.toUid === u.uid && !c.used) delete s.paymentCodes[c.id]
        else if (c.expiresAt < t - 24 * 3600_000) delete s.paymentCodes[c.id]
      }
      let id = newCodeId()
      while (s.paymentCodes[id]) id = newCodeId()
      const ttl = Math.min(10, Math.max(1, s.settings.codeTtlMinutes)) * 60_000
      const code: PaymentCode = { id, toUid: u.uid, toName: u.name, toSeatNo: u.seatNo, createdAt: t, expiresAt: t + ttl, used: false, usedBy: null, txId: null }
      s.paymentCodes[id] = code
      return { ...code }
    })
  }

  async getPaymentCode(codeId: string): Promise<PaymentCode> {
    return this.net(() => {
      const s = this.store.read()
      this.student(s)
      const id = normalizeCode(String(codeId ?? ''))
      const c = isValidCode(id) ? s.paymentCodes[id] : undefined
      if (!c) throw new BankError('CODE_INVALID', '此收款碼已使用或已失效，請對方重新產生')
      return { ...c }
    })
  }

  async cancelPaymentCode(codeId: string): Promise<void> {
    await this.net(() => undefined)
    this.store.transact((s) => {
      const u = this.student(s)
      const c = s.paymentCodes[codeId]
      if (c && c.toUid === u.uid && !c.used) delete s.paymentCodes[codeId]
    })
  }

  async submitTransfer(input: TransferInput): Promise<Transaction> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const u = this.student(s)
      const t = this.now()
      const id = normalizeCode(String(input?.codeId ?? ''))
      const code = isValidCode(id) ? s.paymentCodes[id] : undefined
      if (!code || code.used || t >= code.expiresAt) throw new BankError('CODE_INVALID', '此收款碼已使用或已失效，請對方重新產生')
      if (code.toUid === u.uid) throw new BankError('SELF_TRANSFER', '不能付款給自己')
      const to = s.users[code.toUid]
      if (!to || !to.active || to.role !== 'student') throw new BankError('RECIPIENT_DISABLED', '收款人帳號無法使用')
      assertAmount(input.amount)
      if (input.amount > u.balance) throw new BankError('INSUFFICIENT_BALANCE', `點數不足（目前 ${formatPoints(u.balance)} 點）`)
      if (!CATEGORIES.includes(input.category)) throw new BankError('INVALID_ARGUMENT', '請選擇分類')
      const note = assertText(input.note, '事由', NOTE_MAX)

      const tx = baseTx({
        id: newId('t_'), type: 'transfer', amount: input.amount, status: 'pending',
        fromUid: u.uid, fromName: u.name, fromSeatNo: u.seatNo,
        toUid: to.uid, toName: code.toName, toSeatNo: code.toSeatNo,
        participants: [u.uid, to.uid],
        title: `轉帳給 ${code.toName}`, note, category: input.category, codeId: code.id,
        createdBy: u.uid, createdAt: t,
      })
      s.transactions[tx.id] = tx
      // 同一個交易內標記收款碼已使用：兩者一起成功或一起失敗
      code.used = true
      code.usedBy = u.uid
      code.txId = tx.id
      return { ...tx }
    })
  }

  // ------------------------------------------------------------------ 教師：讀取
  async listStudents(): Promise<User[]> {
    return this.net(() => {
      const s = this.store.read()
      this.teacher(s)
      return Object.values(s.users).filter((u) => u.role === 'student').sort((a, b) => a.seatNo - b.seatNo)
    })
  }

  async getStudent(uid: string): Promise<User> {
    return this.net(() => {
      const s = this.store.read()
      this.teacher(s)
      return { ...this.studentByUid(s, uid) }
    })
  }

  async listTransactions(f: TxFilter = {}): Promise<Transaction[]> {
    return this.net(() => {
      const s = this.store.read()
      this.teacher(s)
      let list = Object.values(s.transactions)
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
    return this.net(() => {
      const s = this.store.read()
      this.teacher(s)
      return Object.values(s.transactions).filter((t) => t.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
    })
  }

  // ------------------------------------------------------------------ 教師：轉帳審核
  async approveTransfer(txId: string): Promise<Transaction> {
    await this.net(() => undefined)
    return this.approveSync(txId)
  }

  private approveSync(txId: string): Transaction {
    return this.store.transact((s) => {
      const teacher = this.teacher(s)
      const tx = s.transactions[txId]
      if (!tx || tx.type !== 'transfer') throw new BankError('NOT_FOUND', '找不到這筆申請')
      if (tx.status !== 'pending') throw new BankError('ALREADY_DECIDED', '這筆申請已經處理過了')
      const from = this.studentByUid(s, tx.fromUid!)
      const to = this.studentByUid(s, tx.toUid!)
      if (from.balance < tx.amount) {
        throw new BankError('INSUFFICIENT_BALANCE', `${from.name} 的點數不足（目前 ${formatPoints(from.balance)} 點）`)
      }
      const t = this.now()
      from.balance -= tx.amount
      from.updatedAt = t
      to.balance += tx.amount
      to.updatedAt = t
      tx.status = 'approved'
      tx.decidedBy = teacher.uid
      tx.decidedAt = t
      return { ...tx }
    })
  }

  async rejectTransfer(txId: string, reason: string): Promise<Transaction> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const teacher = this.teacher(s)
      const tx = s.transactions[txId]
      if (!tx || tx.type !== 'transfer') throw new BankError('NOT_FOUND', '找不到這筆申請')
      if (tx.status !== 'pending') throw new BankError('ALREADY_DECIDED', '這筆申請已經處理過了')
      tx.status = 'rejected'
      tx.rejectReason = assertText(reason ?? '', '駁回原因', NOTE_MAX, false) || null
      tx.decidedBy = teacher.uid
      tx.decidedAt = this.now()
      return { ...tx }
    })
  }

  async approveMany(txIds: string[]): Promise<ItemResult[]> {
    await this.net(() => undefined)
    const s = this.store.read()
    this.teacher(s)
    const ordered = [...txIds].sort((a, b) => (s.transactions[a]?.createdAt ?? 0) - (s.transactions[b]?.createdAt ?? 0))
    const results: ItemResult[] = []
    for (const id of ordered) {
      try {
        this.approveSync(id)
        results.push({ id, ok: true })
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return results
  }

  // ------------------------------------------------------------------ 教師：加扣點、小組獎勵
  async adjust(input: AdjustInput): Promise<Transaction[]> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const teacher = this.teacher(s)
      const uids = [...new Set(input.uids ?? [])]
      if (uids.length === 0) throw new BankError('INVALID_ARGUMENT', '請選擇學生')
      if (input.kind !== 'add' && input.kind !== 'deduct') throw new BankError('INVALID_ARGUMENT', '請選擇加點或扣點')
      assertAmount(input.amount)
      const title = assertText(input.title, '項目名稱', 20)
      const note = assertText(input.note ?? '', '事由', NOTE_MAX, false)
      const students = uids.map((uid) => this.studentByUid(s, uid))
      if (input.kind === 'deduct') {
        const short = students.filter((u) => u.balance < input.amount)
        if (short.length) {
          throw new BankError('INSUFFICIENT_BALANCE',
            `點數不足：${short.map((u) => `${u.name}（${formatPoints(u.balance)}）`).join('、')}`,
            short.map((u) => u.uid))
        }
      }
      const t = this.now()
      const batchId = students.length > 1 ? newId('b_') : null
      return students.map((u) => {
        const tx = baseTx({
          id: newId('t_'), type: input.kind === 'add' ? 'reward' : 'penalty', amount: input.amount,
          fromUid: input.kind === 'deduct' ? u.uid : null, fromName: input.kind === 'deduct' ? u.name : null,
          fromSeatNo: input.kind === 'deduct' ? u.seatNo : null,
          toUid: input.kind === 'add' ? u.uid : null, toName: input.kind === 'add' ? u.name : null,
          toSeatNo: input.kind === 'add' ? u.seatNo : null,
          participants: [u.uid], title, note, presetId: input.presetId ?? null, batchId,
          createdBy: teacher.uid, createdAt: t, decidedBy: teacher.uid, decidedAt: t,
        })
        u.balance += input.kind === 'add' ? input.amount : -input.amount
        u.updatedAt = t
        s.transactions[tx.id] = tx
        return { ...tx }
      })
    })
  }

  async groupAward(input: GroupAwardInput): Promise<GroupAward> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const teacher = this.teacher(s)
      if (!isValidDateKey(input.awardDate)) throw new BankError('INVALID_ARGUMENT', '日期格式錯誤')
      const champ = [...new Set(input.championIds ?? [])]
      const runner = [...new Set(input.runnerUpIds ?? [])]
      if (champ.length === 0 && runner.length === 0) throw new BankError('INVALID_ARGUMENT', '請至少選擇一個冠軍或亞軍組別')
      if (champ.some((id) => runner.includes(id))) throw new BankError('INVALID_ARGUMENT', '同一組不能同時是冠軍和亞軍')
      for (const id of [...champ, ...runner]) {
        if (!s.groups[id]) throw new BankError('NOT_FOUND', '找不到組別')
      }
      if (champ.length) assertAmount(input.championAmount)
      if (runner.length) assertAmount(input.runnerUpAmount)
      const dup = Object.values(s.groupAwards).some((a) => a.awardDate === input.awardDate && !a.reversed)
      if (dup && !input.confirmDuplicate) throw new BankError('DUPLICATE_AWARD', `${input.awardDate} 已發放過小組獎勵`)

      const excluded = new Set(input.excludedUids ?? [])
      const t = this.now()
      const batchId = newId('b_')
      const recipients: string[] = []
      let total = 0
      const award = (ids: string[], rank: 1 | 2, amount: number) => {
        for (const gid of ids) {
          const g = s.groups[gid]
          const members = Object.values(s.users)
            .filter((u) => u.role === 'student' && u.active && u.groupId === gid && !excluded.has(u.uid))
            .sort((a, b) => a.seatNo - b.seatNo)
          for (const u of members) {
            const tx = baseTx({
              id: newId('t_'), type: 'groupReward', amount,
              toUid: u.uid, toName: u.name, toSeatNo: u.seatNo, participants: [u.uid],
              title: `小組${rank === 1 ? '冠軍' : '亞軍'}（${g.name}）`,
              note: ids.length > 1 ? `並列${rank === 1 ? '冠軍' : '亞軍'}` : '',
              batchId, group: { id: g.id, name: g.name, rank, tied: ids.length > 1, awardDate: input.awardDate },
              createdBy: teacher.uid, createdAt: t, decidedBy: teacher.uid, decidedAt: t,
            })
            u.balance += amount
            u.updatedAt = t
            s.transactions[tx.id] = tx
            recipients.push(u.uid)
            total += amount
          }
        }
      }
      award(champ, 1, input.championAmount)
      award(runner, 2, input.runnerUpAmount)
      if (recipients.length === 0) throw new BankError('INVALID_ARGUMENT', '選擇的組別沒有可發放的學生')

      const rec: GroupAward = {
        id: batchId, awardDate: input.awardDate,
        champions: champ.map((id) => ({ id, name: s.groups[id].name })),
        runnersUp: runner.map((id) => ({ id, name: s.groups[id].name })),
        championAmount: champ.length ? input.championAmount : 0,
        runnerUpAmount: runner.length ? input.runnerUpAmount : 0,
        recipients, excluded: [...excluded], total, reversed: false,
        createdBy: teacher.uid, createdAt: t,
      }
      s.groupAwards[batchId] = rec
      return { ...rec }
    })
  }

  async listGroupAwards(): Promise<GroupAward[]> {
    return this.net(() => {
      const s = this.store.read()
      this.teacher(s)
      return Object.values(s.groupAwards).sort((a, b) => b.createdAt - a.createdAt)
    })
  }

  // ------------------------------------------------------------------ 教師：沖正
  private reverseInDraft(s: DbState, teacher: User, orig: Transaction, reason: string, t: number): Transaction {
    if (orig.type === 'reversal') throw new BankError('CANNOT_REVERSE_REVERSAL', '沖正交易不能再沖正')
    if (orig.status !== 'approved') throw new BankError('NOT_APPROVED', '只有已完成的交易可以沖正；審核中的申請請直接駁回')
    if (orig.reversedBy) throw new BankError('ALREADY_REVERSED', '這筆交易已經沖正過了')
    const newFrom = orig.toUid ? this.studentByUid(s, orig.toUid) : null
    const newTo = orig.fromUid ? this.studentByUid(s, orig.fromUid) : null
    if (newFrom && newFrom.balance < orig.amount) {
      throw new BankError('NEGATIVE_AFTER_REVERSAL', `${newFrom.name} 的點數不足（目前 ${formatPoints(newFrom.balance)} 點），無法沖正`)
    }
    const rev = baseTx({
      id: newId('t_'), type: 'reversal', amount: orig.amount,
      fromUid: newFrom?.uid ?? null, fromName: newFrom?.name ?? null, fromSeatNo: newFrom?.seatNo ?? null,
      toUid: newTo?.uid ?? null, toName: newTo?.name ?? null, toSeatNo: newTo?.seatNo ?? null,
      participants: [...orig.participants], title: `沖正：${orig.title}`, note: reason,
      category: orig.category, batchId: null, reversalOf: orig.id,
      createdBy: teacher.uid, createdAt: t, decidedBy: teacher.uid, decidedAt: t,
    })
    if (newFrom) { newFrom.balance -= orig.amount; newFrom.updatedAt = t }
    if (newTo) { newTo.balance += orig.amount; newTo.updatedAt = t }
    orig.reversedBy = rev.id
    s.transactions[rev.id] = rev
    return rev
  }

  async reverse(txId: string, reason: string): Promise<Transaction> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const teacher = this.teacher(s)
      const r = assertText(reason, '沖正原因', NOTE_MAX)
      const orig = s.transactions[txId]
      if (!orig) throw new BankError('NOT_FOUND', '找不到這筆交易')
      return { ...this.reverseInDraft(s, teacher, orig, r, this.now()) }
    })
  }

  async reverseBatch(batchId: string, reason: string): Promise<Transaction[]> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const teacher = this.teacher(s)
      const r = assertText(reason, '沖正原因', NOTE_MAX)
      const items = Object.values(s.transactions).filter(
        (x) => x.batchId === batchId && x.type !== 'reversal' && x.status === 'approved' && !x.reversedBy,
      )
      if (items.length === 0) throw new BankError('NOT_FOUND', '這個批次沒有可沖正的交易')
      const t = this.now()
      const out = items.map((orig) => ({ ...this.reverseInDraft(s, teacher, orig, r, t) }))
      if (s.groupAwards[batchId]) s.groupAwards[batchId].reversed = true
      return out
    })
  }

  // ------------------------------------------------------------------ 教師：加點項目與小確幸
  async listPresets(): Promise<Preset[]> {
    return this.net(() => {
      const s = this.store.read()
      this.teacher(s)
      return Object.values(s.presets).sort((a, b) => a.sortOrder - b.sortOrder)
    })
  }

  async savePreset(p: Omit<Preset, 'id'> & { id?: string }): Promise<Preset> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      this.teacher(s)
      if (p.kind !== 'add' && p.kind !== 'deduct') throw new BankError('INVALID_ARGUMENT', '請選擇類型')
      assertAmount(p.amount)
      const preset: Preset = {
        id: p.id && s.presets[p.id] ? p.id : newId('p_'),
        kind: p.kind,
        name: assertText(p.name, '名稱', 20),
        description: assertText(p.description ?? '', '說明', DESCRIPTION_MAX, false),
        amount: p.amount,
        icon: typeof p.icon === 'string' && p.icon ? p.icon.slice(0, 20) : 'star',
        sortOrder: isInt(p.sortOrder) ? p.sortOrder : Object.keys(s.presets).length + 1,
        active: !!p.active,
        showToStudents: !!p.showToStudents,
      }
      s.presets[preset.id] = preset
      return { ...preset }
    })
  }

  // ------------------------------------------------------------------ 教師：分組
  async saveGroup(g: Omit<Group, 'id'> & { id?: string }): Promise<Group> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      this.teacher(s)
      const name = assertText(g.name, '組名', 12)
      const dupName = Object.values(s.groups).some((x) => x.name === name && x.id !== g.id)
      if (dupName) throw new BankError('INVALID_ARGUMENT', `已有名為「${name}」的組別`)
      const group: Group = {
        id: g.id && s.groups[g.id] ? g.id : newId('g_'),
        name,
        color: /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : '#06C755',
        sortOrder: isInt(g.sortOrder) ? g.sortOrder : Object.keys(s.groups).length + 1,
        active: g.active !== false,
      }
      s.groups[group.id] = group
      if (!group.active) {
        for (const u of Object.values(s.users)) if (u.groupId === group.id) u.groupId = null
      }
      return { ...group }
    })
  }

  async assignGroup(uid: string, groupId: string | null): Promise<void> {
    await this.net(() => undefined)
    this.store.transact((s) => {
      this.teacher(s)
      const u = this.studentByUid(s, uid)
      if (groupId !== null && (!s.groups[groupId] || !s.groups[groupId].active)) throw new BankError('NOT_FOUND', '找不到組別')
      u.groupId = groupId
      u.updatedAt = this.now()
    })
  }

  // ------------------------------------------------------------------ 教師：帳號
  async importStudents(rows: RosterRow[]): Promise<ImportResult> {
    await this.net(() => undefined)
    this.teacher(this.store.read())
    const skipped: ImportResult['skipped'] = []
    const valid = rows.filter((r) => {
      if (!ACCOUNT_PATTERN.test(r.account)) { skipped.push({ account: r.account, reason: '帳號格式錯誤' }); return false }
      if (r.password.length < PASSWORD_MIN) { skipped.push({ account: r.account, reason: '密碼太短' }); return false }
      return true
    })
    // 先雜湊密碼（非同步），再在單一交易中寫入
    const hashed = await Promise.all(valid.map(async (r) => ({ r, h: await hashPassword(r.password, this.iter) })))
    const created = this.store.transact((s) => {
      this.teacher(s)
      let n = 0
      const t = this.now()
      for (const { r, h } of hashed) {
        const key = r.account.toLowerCase()
        if (s.creds[key]) { skipped.push({ account: r.account, reason: '帳號已存在' }); continue }
        let groupId: string | null = null
        if (r.group) {
          const found = Object.values(s.groups).find((g) => g.name === r.group)
          if (found) groupId = found.id
          else {
            const g: Group = { id: newId('g_'), name: r.group.slice(0, 12), color: '#06C755', sortOrder: Object.keys(s.groups).length + 1, active: true }
            s.groups[g.id] = g
            groupId = g.id
          }
        }
        const uid = newId('u_')
        s.users[uid] = {
          uid, role: 'student', account: r.account, name: r.name.slice(0, 20), seatNo: r.seatNo,
          groupId, balance: 0, active: true, createdAt: t, updatedAt: t,
        }
        s.creds[key] = { uid, ...h }
        n++
      }
      return n
    })
    return { created, skipped }
  }

  async updateStudent(uid: string, patch: { name?: string; seatNo?: number; active?: boolean }): Promise<User> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      this.teacher(s)
      const u = this.studentByUid(s, uid)
      if (patch.name !== undefined) u.name = assertText(patch.name, '姓名', 20)
      if (patch.seatNo !== undefined) {
        if (!isInt(patch.seatNo) || patch.seatNo <= 0) throw new BankError('INVALID_ARGUMENT', '座號須為正整數')
        u.seatNo = patch.seatNo
      }
      if (patch.active !== undefined) u.active = !!patch.active
      u.updatedAt = this.now()
      return { ...u }
    })
  }

  async setStudentsActive(uids: string[], active: boolean): Promise<number> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      this.teacher(s)
      const list = [...new Set(uids ?? [])].map((uid) => this.studentByUid(s, uid))
      if (!list.length) throw new BankError('INVALID_ARGUMENT', '請選擇學生')
      const t = this.now()
      for (const u of list) { u.active = !!active; u.updatedAt = t }
      return list.length
    })
  }

  async deleteStudents(uids: string[]): Promise<DeleteResult> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      const teacher = this.teacher(s)
      const list = [...new Set(uids ?? [])].map((uid) => this.studentByUid(s, uid))
      if (!list.length) throw new BankError('INVALID_ARGUMENT', '請選擇學生')
      const ids = new Set(list.map((u) => u.uid))
      const t = this.now()
      let rejectedPending = 0
      // 涉及這些學生的審核中轉帳：自動駁回（點數本來就還沒移動）
      for (const tx of Object.values(s.transactions)) {
        if (tx.status === 'pending' && tx.participants.some((p) => ids.has(p))) {
          tx.status = 'rejected'
          tx.rejectReason = '帳號已刪除'
          tx.decidedBy = teacher.uid
          tx.decidedAt = t
          rejectedPending++
        }
      }
      for (const c of Object.values(s.paymentCodes)) if (ids.has(c.toUid)) delete s.paymentCodes[c.id]
      let forfeitedPoints = 0
      for (const u of list) {
        forfeitedPoints += u.balance
        const key = u.account.toLowerCase()
        delete s.creds[key]
        delete s.loginAttempts[key]
        delete s.users[u.uid]
      }
      // 交易紀錄保留（帳本只增不刪），其中已存有雙方姓名與座號快照
      return { deleted: list.length, rejectedPending, forfeitedPoints }
    })
  }

  async resetPassword(uid: string, newPassword: string): Promise<void> {
    await this.net(() => undefined)
    const s0 = this.store.read()
    this.teacher(s0)
    const u = this.studentByUid(s0, uid)
    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN) throw new BankError('INVALID_ARGUMENT', `密碼至少 ${PASSWORD_MIN} 碼`)
    const h = await hashPassword(newPassword, this.iter)
    this.store.transact((s) => {
      this.teacher(s)
      s.creds[u.account.toLowerCase()] = { uid: u.uid, ...h }
      delete s.loginAttempts[u.account.toLowerCase()]
    })
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    await this.net(() => undefined)
    return this.store.transact((s) => {
      this.teacher(s)
      const next = { ...s.settings, ...patch }
      if (!isInt(next.codeTtlMinutes) || next.codeTtlMinutes < 1 || next.codeTtlMinutes > 10) throw new BankError('INVALID_ARGUMENT', '收款碼有效時間須為 1～10 分鐘')
      assertAmount(next.championAmount)
      assertAmount(next.runnerUpAmount)
      next.className = assertText(next.className, '班級名稱', 20)
      s.settings = next
      return { ...next }
    })
  }

  async exportAll(): Promise<Record<string, unknown>> {
    return this.net(() => {
      const s = this.store.read()
      this.teacher(s)
      const { creds: _c, loginAttempts: _l, ...rest } = s
      return JSON.parse(JSON.stringify(rest))
    })
  }
}

// ------------------------------------------------------------------ 初始資料
export function seedPresets(s: DbState) {
  for (const p of seed.presets as Omit<Preset, 'id'>[]) {
    const id = newId('p_')
    s.presets[id] = { id, ...p }
  }
}

export function seedGroups(s: DbState) {
  for (let i = 1; i <= seed.groupCount; i++) {
    const id = newId('g_')
    s.groups[id] = { id, name: `第 ${i} 組`, color: seed.groupColors[i - 1], sortOrder: i, active: true }
  }
}
