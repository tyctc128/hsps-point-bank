// HSPS 點數銀行 管理工具（老師電腦執行）
//   npm run admin -- init-teacher [--name 王老師] [--password xxxxxxxx]
//   npm run admin -- import account.xlsx
//   npm run admin -- reset-password <帳號> <新密碼>
//   npm run admin -- delete-orphans [--yes]
//   npm run admin -- backup [資料夾]
//   npm run admin -- status
//   npm run admin -- deploy-rules
import * as fs from 'node:fs'
import * as XLSX from 'xlsx'
import { parseRoster } from '../src/domain/roster'
import { backup, close, connect, deleteOrphans, deployRules, importRoster, initTeacher, randomPassword, readEnvFile, resetPassword } from './admin-core'

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
  npm run admin -- status                                           顯示帳號與交易數量
  npm run admin -- deploy-rules                                     發布 firestore.rules 權限規則`)
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
        const file = await backup(ctx, args[1] ?? 'backups')
        console.log(`✔ 已備份到 ${file}`)
        break
      }
      case 'deploy-rules': {
        const name = await deployRules(ctx)
        console.log(`✔ 已發布權限規則：${name}`)
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
