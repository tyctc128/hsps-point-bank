// 學生名冊匯入：支援老師現有 account.xlsx 的欄位（no / account / passwd / name），
// 也接受中文欄名（座號 / 帳號 / 密碼 / 姓名 / 組別）。

export interface RosterRow {
  seatNo: number
  account: string
  password: string
  name: string
  group: string | null
}

export interface RosterError {
  row: number        // 試算表列號（含標題列，第一筆資料為第 2 列）
  message: string
}

export interface RosterResult {
  rows: RosterRow[]
  errors: RosterError[]
}

export const ACCOUNT_PATTERN = /^[A-Za-z0-9._-]{3,32}$/
export const PASSWORD_MIN = 6

const ALIASES: Record<keyof RosterRow, string[]> = {
  seatNo: ['no', 'seat', 'seatno', '座號', '號碼'],
  account: ['account', 'username', 'id', '帳號', '學號'],
  password: ['passwd', 'password', 'pwd', '密碼', '初始密碼'],
  name: ['name', '姓名', '名字'],
  group: ['group', '組別', '分組', '小組'],
}

function normKey(k: string): string {
  return k.replace(/﻿/g, '').trim().toLowerCase().replace(/\s+/g, '')
}

/** 全形英數轉半形 */
export function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ')
}

function pick(record: Record<string, unknown>, field: keyof RosterRow): string {
  const keys = Object.keys(record)
  for (const k of keys) {
    if (ALIASES[field].includes(normKey(k))) {
      const v = record[k]
      return v === null || v === undefined ? '' : toHalfWidth(String(v)).trim()
    }
  }
  return ''
}

export function parseRoster(records: Record<string, unknown>[], existingAccounts: string[] = []): RosterResult {
  const rows: RosterRow[] = []
  const errors: RosterError[] = []
  const seenAcc = new Set(existingAccounts.map((a) => a.toLowerCase()))
  const seenSeat = new Set<number>()

  records.forEach((rec, i) => {
    const rowNo = i + 2
    const account = pick(rec, 'account')
    const password = pick(rec, 'password')
    const name = pick(rec, 'name')
    const seatRaw = pick(rec, 'seatNo')
    const group = pick(rec, 'group') || null

    if (!account && !password && !name && !seatRaw) return // 空白列略過

    const problems: string[] = []
    if (!ACCOUNT_PATTERN.test(account)) problems.push('帳號須為 3～32 個英數字')
    if (password.length < PASSWORD_MIN) problems.push(`密碼至少 ${PASSWORD_MIN} 碼`)
    if (!name) problems.push('缺少姓名')
    const seatNo = Number(seatRaw)
    if (!Number.isInteger(seatNo) || seatNo <= 0) problems.push('座號須為正整數')

    if (account && seenAcc.has(account.toLowerCase())) problems.push(`帳號 ${account} 重複`)
    if (Number.isInteger(seatNo) && seatNo > 0 && seenSeat.has(seatNo)) problems.push(`座號 ${seatNo} 重複`)

    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join('；') })
      return
    }
    seenAcc.add(account.toLowerCase())
    seenSeat.add(seatNo)
    rows.push({ seatNo, account, password, name, group })
  })

  return { rows, errors }
}
