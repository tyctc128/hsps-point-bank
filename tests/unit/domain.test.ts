import { describe, expect, it } from 'vitest'
import { formatPoints, formatSigned, validateAmount, validateNote } from '../../src/domain/money'
import { dateKey, formatRelative, isValidDateKey, startOfDay, startOfWeek, formatDateTime } from '../../src/domain/dates'
import { extractCode, isValidCode, newCodeId, normalizeCode } from '../../src/domain/codes'
import { parseRoster, toHalfWidth } from '../../src/domain/roster'
import { deltaFor, periodTotals, reconcile, runningBalances } from '../../src/domain/ledger'
import type { Transaction, User } from '../../src/domain/types'

describe('金額', () => {
  it('千分位與正負號', () => {
    expect(formatPoints(12800)).toBe('12,800')
    expect(formatSigned(3000)).toBe('+3,000')
    expect(formatSigned(-800)).toBe('−800')
    expect(formatSigned(0)).toBe('0')
  })
  it('驗證：正整數、上限、餘額', () => {
    expect(validateAmount('')).toBe('請輸入點數')
    expect(validateAmount('abc')).toBe('點數必須是數字')
    expect(validateAmount('1.5')).toBe('點數必須是整數')
    expect(validateAmount('0')).toBe('點數必須大於 0')
    expect(validateAmount('-3')).toBe('點數必須大於 0')
    expect(validateAmount(1_000_001)).toMatch('不可超過')
    expect(validateAmount('500', { max: 300 })).toMatch('點數不足')
    expect(validateAmount(' 200 ', { max: 300 })).toBeNull()
  })
  it('事由：必填、最多 50 字', () => {
    expect(validateNote('  ')).toBe('請填寫事由')
    expect(validateNote('a'.repeat(51))).toMatch('50')
    expect(validateNote('買書籤')).toBeNull()
  })
})

describe('日期（台北時間）', () => {
  const t = Date.UTC(2026, 8, 25, 17, 30) // 台北 9/26 01:30
  it('跨日以台北時間計算', () => {
    expect(dateKey(t)).toBe('2026-09-26')
    expect(formatDateTime(t)).toBe('2026/09/26 01:30')
    expect(dateKey(startOfDay(t))).toBe('2026-09-26')
  })
  it('本週一 00:00', () => {
    const mon = startOfWeek(t) // 2026-09-26 是週六 → 週一為 09-21
    expect(dateKey(mon)).toBe('2026-09-21')
    expect(formatDateTime(mon)).toBe('2026/09/21 00:00')
  })
  it('相對日期', () => {
    expect(formatRelative(t, t + 3600_000)).toBe('今天 01:30')
    expect(formatRelative(t, t + 24 * 3600_000)).toBe('昨天 01:30')
  })
  it('日期字串驗證', () => {
    expect(isValidDateKey('2026-09-26')).toBe(true)
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('26-9-2026')).toBe(false)
  })
})

describe('收款碼', () => {
  it('8 碼且不含易混淆字元', () => {
    for (let i = 0; i < 200; i++) {
      const c = newCodeId()
      expect(isValidCode(c)).toBe(true)
      expect(c).not.toMatch(/[IO01]/)
    }
  })
  it('正規化手動輸入', () => {
    expect(normalizeCode(' abcd-efgh ')).toBe('ABCDEFGH')
  })
  it('只接受本站付款網址或純代碼', () => {
    const origin = 'https://example.github.io'
    expect(extractCode('ABCD2345')).toBe('ABCD2345')
    expect(extractCode(`${origin}/bank/#/pay?c=abcd2345`, origin)).toBe('ABCD2345')
    expect(extractCode('https://evil.example.com/#/pay?c=ABCD2345', origin)).toBeNull()
    expect(extractCode(`${origin}/#/login`, origin)).toBeNull()
    expect(extractCode('javascript:alert(1)', origin)).toBeNull()
    expect(extractCode('hello world')).toBeNull()
  })
})

describe('名冊解析', () => {
  it('支援 account.xlsx 的英文欄名（no/account/passwd/name）', () => {
    const r = parseRoster([
      { no: 1, account: 'hs000001', passwd: 'Abc12345', name: '甲' },
      { no: 2, account: 'kza0415', passwd: 'Xyz98765', name: '乙' },
    ])
    expect(r.errors).toEqual([])
    expect(r.rows).toEqual([
      { seatNo: 1, account: 'hs000001', password: 'Abc12345', name: '甲', group: null },
      { seatNo: 2, account: 'kza0415', password: 'Xyz98765', name: '乙', group: null },
    ])
  })
  it('支援中文欄名、BOM 與全形字元', () => {
    const r = parseRoster([{ '﻿座號': '３', 帳號: 'ｓ０１', 密碼: 'ａｂｃ１２３', 姓名: '丙', 組別: '第 2 組' }])
    expect(r.rows[0]).toEqual({ seatNo: 3, account: 's01', password: 'abc123', name: '丙', group: '第 2 組' })
  })
  it('標示錯誤列：重複帳號、重複座號、缺欄、密碼太短；空白列略過', () => {
    const r = parseRoster([
      { no: 1, account: 'a001', passwd: '123456', name: '甲' },
      { no: 2, account: 'A001', passwd: '123456', name: '乙' },
      { no: 1, account: 'a003', passwd: '123456', name: '丙' },
      { no: 4, account: 'a004', passwd: '123', name: '' },
      { no: '', account: '', passwd: '', name: '' },
      { no: 5, account: 'a005', passwd: '123456', name: '戊' },
    ], ['a005'])
    expect(r.rows.map((x) => x.account)).toEqual(['a001'])
    expect(r.errors.map((e) => e.row)).toEqual([3, 4, 5, 7])
    expect(r.errors[0].message).toMatch('重複')
    expect(r.errors[2].message).toMatch('密碼')
    expect(r.errors[2].message).toMatch('姓名')
  })
  it('全形轉半形', () => {
    expect(toHalfWidth('ＡＢＣ１２３')).toBe('ABC123')
  })
})

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: 'x', type: 'reward', amount: 0, fromUid: null, toUid: null, fromName: null, toName: null,
    fromSeatNo: null, toSeatNo: null, participants: [], status: 'approved', title: '', note: '',
    category: null, presetId: null, batchId: null, group: null, codeId: null, reversalOf: null,
    reversedBy: null, rejectReason: null, createdBy: 't', createdAt: 0, decidedBy: null, decidedAt: null,
    ...p,
  }
}

describe('帳本計算', () => {
  const txs = [
    tx({ id: 'p', type: 'transfer', status: 'pending', fromUid: 'a', toUid: 'b', amount: 200, participants: ['a', 'b'], createdAt: 50 }),
    tx({ id: 't3', type: 'transfer', fromUid: 'a', toUid: 'b', amount: 100, participants: ['a', 'b'], createdAt: 40 }),
    tx({ id: 't2', type: 'penalty', fromUid: 'a', amount: 300, participants: ['a'], createdAt: 30 }),
    tx({ id: 't1', type: 'reward', toUid: 'a', amount: 1000, participants: ['a'], createdAt: 10 }),
  ]
  it('只有已完成交易影響餘額', () => {
    expect(deltaFor(txs[0], 'a')).toBe(0)
    expect(deltaFor(txs[1], 'a')).toBe(-100)
    expect(deltaFor(txs[1], 'b')).toBe(100)
  })
  it('由目前餘額往回推算結餘', () => {
    const m = runningBalances(txs, 600, 'a')
    expect(m.get('t3')).toBe(600)
    expect(m.get('t2')).toBe(700)
    expect(m.get('t1')).toBe(1000)
    expect(m.has('p')).toBe(false)
  })
  it('期間收支', () => {
    expect(periodTotals(txs, 'a', 20)).toEqual({ income: 0, expense: 400 })
    expect(periodTotals(txs, 'a', 0)).toEqual({ income: 1000, expense: 400 })
  })
  it('對帳找出不一致', () => {
    const users = [
      { uid: 'a', role: 'student', name: 'A', seatNo: 1, balance: 600 },
      { uid: 'b', role: 'student', name: 'B', seatNo: 2, balance: 999 },
    ] as User[]
    const rows = reconcile(users, txs)
    expect(rows.find((r) => r.uid === 'a')!.ok).toBe(true)
    expect(rows.find((r) => r.uid === 'b')).toMatchObject({ ok: false, ledgerSum: 100 })
  })
})
