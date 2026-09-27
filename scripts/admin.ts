// HSPS 點數銀行 管理工具（老師電腦執行）
//   npm run admin -- init-teacher [--name 王老師] [--password xxxxxxxx]
//   npm run admin -- import account.xlsx
//   npm run admin -- reset-password <帳號> <新密碼>
//   npm run admin -- delete-orphans [--yes]
//   npm run admin -- backup [資料夾]
//   npm run admin -- restore <備份檔> --yes
//   npm run admin -- status
//   npm run admin -- deploy-rules
//   npm run admin -- set-settings [--champion 3000] [--runner 300] [--ttl 3] [--class 班級名稱]
import * as fs from 'node:fs'
import * as XLSX from 'xlsx'
import { parseRoster } from '../src/domain/roster'
import { backup, close, connect, deleteOrphans, deployRules, importRoster, initTeacher, randomPassword, readEnvFile, resetPassword, restore } from './admin-core'

const env = { ...readEnvFile('.env.production'), ...process.env }
const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

function usage() {
  console.log(`用法：
  npm run admin -- init-teacher [--name 王老師] [--password 至少8碼]   建立教師帳號與初始資料（未指定密碼會自動產生）
  npm run admin -- import account.xlsx                              由名冊建立學生登入帳號（已存在者略過）
  npm run admin -- reset-password <帳號> <新密碼>                    重設學生密碼
  npm run admin -- delete-orphans [--yes]                           刪除已從名冊刪除的學生登入帳號（不加 --yes 只列出）
  npm run admin -- backup [資料夾]                                   備份全部資料為 JSON（預設 backups/）
  npm run admin -- restore <備份檔> [--yes]                          將資料完全還原成備份時的狀態（不加 --yes 只顯示差異）
  npm run admin -- status                                           顯示帳號與交易數量
  npm run admin -- deploy-rules                                     發布 firestore.rules 權限規則
  npm run admin -- set-settings [--champion N] [--runner N] [--ttl 分鐘] [--class 名稱]   修改系統設定（小組冠軍/亞軍預設點數等）`)
}

async function main() {
  if (!cmd || cmd === 'help') return usage()
  const ctx = connect({
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    studentDomain: env.VITE_STUDENT_EMAIL_DOMAIN ?? '',
    teacherEmail: env.VITE_TEACHER_EMAIL ?? '',
  })
  try {
    switch (cmd) {
      case 'init-teacher': {
        const pw = flag('password') ?? randomPassword()
        if (pw.length < 8) throw new Error('教師密碼至少 8 碼')
        const r = await initTeacher(ctx, { name: flag('name') ?? '導師', password: pw })
        console.log(`✔ 教師帳號${r.created ? '已建立' : '已更新'}：${ctx.teacherEmail}`)
        if (!flag('password')) {
          // 密碼寫入 teacher-account.txt（已列入 .gitignore），不顯示在畫面上
          fs.writeFileSync('teacher-account.txt', `HSPS 點數銀行 教師帳號\n登入帳號：teacher（或 ${ctx.teacherEmail}）\n初始密碼：${pw}\n建立時間：${new Date().toLocaleString('zh-TW')}\n\n請登入後到「設定與備份 → 修改教師密碼」更改，並刪除此檔案。\n`)
          console.log('  初始密碼已寫入 teacher-account.txt（請妥善保存，登入改密碼後刪除此檔）')
        }
        break
      }
      case 'import': {
        const file = args[1]
        if (!file || !fs.existsSync(file)) throw new Error('請指定名冊檔案，例如：npm run admin -- import account.xlsx')
        const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' })
        const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
        const parsed = parseRoster(recs)
        for (const e of parsed.errors) console.log(`  ✖ 第 ${e.row} 列：${e.message}`)
        const r = await importRoster(ctx, parsed.rows)
        console.log(`✔ 建立 ${r.created.length} 個學生帳號；略過 ${r.skipped.length} 個`)
        for (const s of r.skipped) console.log(`  - ${s.account}：${s.reason}`)
        break
      }
      case 'reset-password': {
        const [account, pw] = [args[1], args[2]]
        if (!account || !pw) throw new Error('用法：npm run admin -- reset-password <帳號> <新密碼>')
        await resetPassword(ctx, account, pw)
        console.log(`✔ 已重設 ${account} 的密碼`)
        break
      }
      case 'delete-orphans': {
        const yes = args.includes('--yes')
        const list = await deleteOrphans(ctx, !yes)
        console.log(list.length ? `${yes ? '✔ 已刪除' : '將刪除（加上 --yes 才會執行）'}：\n  ${list.join('\n  ')}` : '沒有需要刪除的登入帳號')
        break
      }
      case 'backup': {
        const label = args.includes('--label') ? flag('label')! : 'backup'
        const dir = args[1] && !args[1].startsWith('--') ? args[1] : 'backups'
        const file = await backup(ctx, dir, label)
        console.log(`✔ 已備份到 ${file}`)
        break
      }
      case 'set-settings': {
        const ref = ctx.db.doc('settings/app')
        const cur = (await ref.get()).data() ?? {}
        const next: Record<string, unknown> = { ...cur }
        const num = (name: string, key: string, min: number, max: number) => {
          const v = flag(name)
          if (v === undefined) return
          const n = Number(v)
          if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} 必須是 ${min}～${max} 的整數`)
          next[key] = n
        }
        num('champion', 'championAmount', 1, 1_000_000)
        num('runner', 'runnerUpAmount', 1, 1_000_000)
        num('ttl', 'codeTtlMinutes', 1, 10)
        if (flag('class')) next.className = flag('class')!.slice(0, 20)
        await ref.set(next)
        console.log(`✔ 系統設定：冠軍每人 ${next.championAmount}、亞軍每人 ${next.runnerUpAmount}、收款碼 ${next.codeTtlMinutes} 分鐘、班級「${next.className}」`)
        break
      }
      case 'deploy-rules': {
        const name = await deployRules(ctx)
        console.log(`✔ 已發布權限規則：${name}`)
        break
      }
      case 'restore': {
        const file = args[1]
        if (!file || !fs.existsSync(file)) throw new Error('請指定備份檔，例如：npm run admin -- restore backups/baseline-2026-09-27-10-00-00.json --yes')
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        const proj = data._meta?.project
        if (proj && proj !== ctx.app.options.projectId) throw new Error(`備份檔屬於專案 ${proj}，與目前專案 ${ctx.app.options.projectId} 不同`)
        const cur = await ctx.db.collection('transactions').count().get()
        const want = Object.keys(data.transactions ?? {}).length
        console.log(`目前交易 ${cur.data().count} 筆 → 還原後 ${want} 筆；學生 ${Object.values(data.users ?? {}).filter((u: any) => u.role === 'student').length} 位`)
        if (!args.includes('--yes')) {
          console.log('（預覽）加上 --yes 才會執行還原。還原前會自動另存目前狀態到 backups/before-restore-*.json')
          break
        }
        const safety = await backup(ctx, 'backups', 'before-restore')
        console.log(`已先保存目前狀態：${safety}`)
        const r = await restore(ctx, data)
        for (const [col, v] of Object.entries(r.collections)) console.log(`  ${col.padEnd(14)} 還原 ${v.restored} 筆，移除 ${v.removed} 筆`)
        if (r.missingLogins.length) console.log(`  ⚠ 以下帳號的登入資料已不存在，請重新匯入名冊：${r.missingLogins.join('、')}`)
        console.log('✔ 已還原完成。學生與老師的 iPad 重新整理即可看到還原後的狀態。')
        break
      }
      case 'status': {
        const users = await ctx.db.collection('users').get()
        const txs = await ctx.db.collection('transactions').count().get()
        const students = users.docs.filter((d) => d.data().role === 'student')
        const teachers = users.docs.filter((d) => d.data().role === 'teacher')
        console.log(`教師 ${teachers.length} 位、學生 ${students.length} 位（停用 ${students.filter((d) => !d.data().active).length}）、交易 ${txs.data().count} 筆`)
        break
      }
      default:
        usage()
    }
  } finally {
    await close(ctx)
  }
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e)
  process.exit(1)
})
