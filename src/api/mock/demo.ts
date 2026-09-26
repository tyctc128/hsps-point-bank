// 示範資料（全部為虛構姓名），供試用與自動化測試使用。真實名冊請由「帳號管理 → 匯入名冊」匯入。
import type { BankApi } from '../types'
import type { RosterRow } from '../../domain/roster'

const SURNAMES = ['林', '陳', '王', '張', '李', '黃', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '郭', '洪', '邱']
const GIVEN = ['小明', '小華', '小美', '小強', '小芳', '小安', '小宇', '小晴', '小傑', '小雯', '小豪', '小婷', '小凱', '小涵', '小恩', '小瑜',
  '小翔', '小薇', '小哲', '小彤', '小睿', '小妍', '小軒', '小寧', '小澄', '小萱', '小承', '小語', '小亦', '小潔', '小謙']

export const DEMO_PASSWORD = 'demo1234'

export function demoRoster(count = 31): RosterRow[] {
  return Array.from({ length: count }, (_, i) => ({
    seatNo: i + 1,
    account: `demo${String(i + 1).padStart(2, '0')}`,
    password: DEMO_PASSWORD,
    name: `${SURNAMES[i % SURNAMES.length]}${GIVEN[i % GIVEN.length]}`,
    group: `第 ${(i % 8) + 1} 組`,
  }))
}

/** 需以教師身分登入後執行 */
export async function loadDemoData(api: BankApi): Promise<void> {
  await api.importStudents(demoRoster())
  const students = await api.listStudents()
  const demo = students.filter((s) => s.account.startsWith('demo'))
  if (demo.length === 0) return
  await api.adjust({ uids: demo.map((s) => s.uid), kind: 'add', amount: 5000, title: '開學禮', note: '示範資料：每人 5,000 點' })
  const presets = await api.listPresets()
  const good = presets.find((p) => p.name === '表現優良')
  if (good) await api.adjust({ uids: demo.slice(0, 5).map((s) => s.uid), kind: 'add', amount: good.amount, title: good.name, note: '', presetId: good.id })
}
