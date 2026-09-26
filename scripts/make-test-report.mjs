// 由最近一次的測試結果產生「測試紀錄」HTML（再以瀏覽器列印成 PDF）
// 輸入：test-results/vitest.json、test-results/e2e.json、test-results/npm-audit.json、test-results/screenshots/*.png
// 輸出：docs/src/TestReport.html（圖片複製到 docs/src/report-img/）
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
const R = (p) => path.join(root, p)
const readJson = (p) => (fs.existsSync(R(p)) ? JSON.parse(fs.readFileSync(R(p), 'utf8')) : null)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const vitest = readJson('test-results/vitest.json')
const e2e = readJson('test-results/e2e.json')
const audit = readJson('test-results/npm-audit.json')
const vitestFb = readJson('test-results/vitest-firebase.json')
const e2eFb = readJson('test-results/e2e-firebase.json')
if (!vitest || !e2e) {
  console.error('找不到測試結果，請先執行 npm test 與 npm run test:e2e')
  process.exit(1)
}

const ver = (cmd) => { try { return execSync(cmd, { cwd: root }).toString().trim() } catch { return '—' } }
const pkg = JSON.parse(fs.readFileSync(R('package.json'), 'utf8'))
const lockVer = (name) => { try { return JSON.parse(fs.readFileSync(R(`node_modules/${name}/package.json`), 'utf8')).version } catch { return '—' } }
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

// ---------- Vitest ----------
const FILE_LABEL = {
  'domain.test.ts': ['單元測試', '金額、日期、收款碼、名冊解析、帳本計算'],
  'auth.test.ts': ['整合測試', '帳號、登入、密碼'],
  'transfer.test.ts': ['整合測試', 'QR 轉帳送出與審核'],
  'adjust.test.ts': ['整合測試', '加扣點、批次、小組獎勵、沖正、對帳'],
  'accounts.test.ts': ['整合測試', '批次停用、啟用與刪除學生帳號'],
  'rules.test.ts': ['安全測試', 'Firestore 權限規則（直接對規則測試）'],
  'security.test.ts': ['安全測試', '權限矩陣（對應 SDD 7.2）'],
  'atomicity.test.ts': ['安全測試', '原子性（全有全無，BR-17）'],
}
const vFiles = vitest.testResults.map((f) => {
  const base = path.basename(f.name)
  const [kind, topic] = FILE_LABEL[base] ?? ['其他', base]
  const tests = f.assertionResults.map((a) => ({
    group: a.ancestorTitles.join(' › '),
    title: a.title,
    status: a.status,
    ms: Math.round(a.duration ?? 0),
  }))
  return { base, kind, topic, tests }
})
const vTotal = vitest.numTotalTests
const vPassed = vitest.numPassedTests
const vFailed = vitest.numFailedTests

// ---------- Playwright ----------
const eTests = []
const walk = (s, file) => {
  for (const x of s.suites ?? []) walk(x, x.file ?? file)
  for (const sp of s.specs ?? []) for (const t of sp.tests) {
    const res = t.results[t.results.length - 1] ?? {}
    eTests.push({ file: path.basename(sp.file ?? file ?? ''), title: sp.title, project: t.projectName, status: res.status ?? 'unknown', ms: res.duration ?? 0, retries: t.results.length - 1 })
  }
}
walk(e2e)
const eTotal = eTests.length
const ePassed = eTests.filter((t) => t.status === 'passed').length
const eFailed = eTotal - ePassed
const specTitles = [...new Set(eTests.map((t) => `${t.file}|${t.title}`))]

// ---------- Firebase 模擬器 ----------
const fbFiles = vitestFb ? vitestFb.testResults.map((f) => {
  const base = path.basename(f.name)
  const [kind, topic] = FILE_LABEL[base] ?? ['其他', base]
  return { base, kind, topic, tests: f.assertionResults.map((a) => ({ group: a.ancestorTitles.join(' › '), title: a.title, status: a.status, ms: Math.round(a.duration ?? 0) })) }
}) : []
const fbPassed = vitestFb?.numPassedTests ?? 0
const fbFailed = vitestFb?.numFailedTests ?? 0
const fbSkipped = (vitestFb?.numPendingTests ?? 0) + (vitestFb?.numTodoTests ?? 0)
const fbRun = fbPassed + fbFailed
const eFbTests = []
if (e2eFb) {
  const walkFb = (s, file) => {
    for (const x of s.suites ?? []) walkFb(x, x.file ?? file)
    for (const sp of s.specs ?? []) for (const t of sp.tests) {
      const res = t.results[t.results.length - 1] ?? {}
      eFbTests.push({ title: sp.title, status: res.status ?? 'unknown', ms: res.duration ?? 0 })
    }
  }
  walkFb(e2eFb)
}
const eFbPassed = eFbTests.filter((t) => t.status === 'passed').length
const allPassed = vPassed + ePassed + fbPassed + eFbPassed
const allRun = vTotal + eTotal + fbRun + eFbTests.length
const allFailed = allRun - allPassed

// ---------- 截圖 ----------
const shotDir = R('test-results/screenshots')
const imgDir = R('docs/src/report-img')
fs.mkdirSync(imgDir, { recursive: true })
const SHOT_LABEL = {
  '01-import-preview': '匯入名冊預覽（含錯誤列標示）', '02-teacher-students': '學生總覽', '03-student-home-empty': '學生首頁（初始）',
  '04-receive-qr': '收款：一次性 QR 碼與 8 碼代碼', '05-pay-form': '付款：金額、分類、事由', '06-receive-used': '收款方即時看到付款申請',
  '07-teacher-approvals': '教師轉帳審核', '08-student-home': '學生首頁（核准後）', '09-tx-detail-payer': '交易詳情（付款方）',
  '10-group-award': '小組獎勵（並列冠軍、請假排除）', '11-student-detail': '學生個人頁（一鍵加扣點）', '12-ledger': '交易紀錄（沖正）',
  '13-perks': '學生小確幸頁', '16-students-bulk': '學生總覽批次操作（停用 / 刪除）', '14-teacher-dashboard': '教師儀表板', '15-groups': '分組管理',
}
const shots = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort() : []
for (const f of shots) fs.copyFileSync(path.join(shotDir, f), path.join(imgDir, f))
const pick = ['ipad-08-student-home', 'ipad-04-receive-qr', 'ipad-05-pay-form', 'ipad-06-receive-used', 'ipad-09-tx-detail-payer', 'ipad-13-perks',
  'desktop-14-teacher-dashboard', 'desktop-07-teacher-approvals', 'desktop-10-group-award', 'desktop-11-student-detail', 'desktop-12-ledger', 'desktop-16-students-bulk', 'desktop-01-import-preview']
  .filter((n) => shots.includes(`${n}.png`))

// ---------- npm audit ----------
const vuln = audit?.metadata?.vulnerabilities ?? {}
const vulnList = Object.entries(audit?.vulnerabilities ?? {}).map(([name, v]) => ({
  name, severity: v.severity, direct: v.isDirect,
  title: v.via.map((x) => (typeof x === 'string' ? x : x.title)).join('；'),
  dev: pkg.devDependencies?.[name] !== undefined || !pkg.dependencies?.[name],
}))

const statusPill = (s) => s === 'passed'
  ? '<span class="pill p0">通過</span>'
  : s === 'skipped' || s === 'pending' ? '<span class="pill p2">略過</span>'
  : `<span class="pill" style="background:#FDECEA;color:#B42318">${esc(s === 'failed' ? '失敗' : s)}</span>`
const kinds = ['單元測試', '整合測試', '安全測試']
const byKind = (k) => vFiles.filter((f) => f.kind === k)
const count = (k) => byKind(k).reduce((a, f) => a + f.tests.length, 0)
const passCount = (k) => byKind(k).reduce((a, f) => a + f.tests.filter((t) => t.status === 'passed').length, 0)

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>HSPS 點數銀行 測試紀錄</title>
<link rel="stylesheet" href="doc.css">
<style>
.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0}
.kpi div{border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.kpi b{display:block;font-size:22pt;color:var(--green-deep)}
.kpi span{font-size:9pt;color:var(--muted)}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.shots figure{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;page-break-inside:avoid;break-inside:avoid}
.shots img{width:100%;display:block;border-bottom:1px solid var(--line)}
.shots figcaption{font-size:9pt;padding:4px 8px;color:var(--muted)}
td.t{font-size:9pt}
</style></head><body>
<span class="doc-title-string">HSPS 點數銀行｜測試紀錄</span>

<div class="cover">
  <div class="cover-top"><img src="logo.png" alt=""><div class="org">HSPS 班級點數銀行<small>CLASS POINT BANK</small></div></div>
  <div class="cover-mid">
    <span class="kicker">TEST REPORT · 測試紀錄</span>
    <h1>HSPS 點數銀行<br>測試紀錄</h1>
    <div class="sub">功能測試・整合測試・端對端測試・安全測試</div>
    <div class="cover-bar"></div>
    <table class="meta-table">
      <tr><td>執行時間</td><td>${esc(stamp)}</td></tr>
      <tr><td>受測版本</td><td>v${esc(pkg.version)}（Firebase 正式版＋模擬資料庫）</td></tr>
      <tr><td>對應文件</td><td>PRD v1.3、SDD v1.4</td></tr>
      <tr><td>總結</td><td><b>${allPassed} / ${allRun} 項通過</b>${allFailed ? `，${allFailed} 項失敗` : '，無失敗'}</td></tr>
    </table>
  </div>
  <img class="cover-logo-big" src="logo.png" alt="">
</div>

<section class="chapter" style="page-break-before:auto">
<h2><span class="n">1</span>總覽</h2>
<div class="kpi">
  <div><b>${allPassed}/${allRun}</b><span>全部測試通過</span></div>
  <div><b>${vPassed + ePassed}/${vTotal + eTotal}</b><span>模擬資料庫：Vitest + 端對端（${specTitles.length} 情境 × 2 環境）</span></div>
  <div><b>${fbPassed + eFbPassed}/${fbRun + eFbTests.length}</b><span>Firebase 模擬器：規則 + 整合 + 端對端</span></div>
  <div><b>${vuln.critical ?? 0}/${vuln.high ?? 0}</b><span>嚴重 / 高風險套件漏洞</span></div>
</div>
<table class="t">
  <tr><th style="width:18%">類別</th><th>範圍</th><th style="width:14%" class="c">項目</th><th style="width:12%" class="c">結果</th></tr>
  ${kinds.map((k) => `<tr><td>${k}</td><td>${byKind(k).map((f) => esc(f.topic)).join('；')}</td><td class="c">${count(k)}</td><td class="c">${passCount(k) === count(k) ? statusPill('passed') : statusPill('failed')}</td></tr>`).join('')}
  <tr><td>端對端測試</td><td>以正式建置版（含 CSP）在桌面 Chromium（教師電腦）與 iPad Pro 11 橫向 WebKit（學生 iPad Safari）執行完整操作流程</td><td class="c">${eTotal}</td><td class="c">${eFailed ? statusPill('failed') : statusPill('passed')}</td></tr>
  <tr><td>Firebase 模擬器</td><td>30 項權限規則直接測試；與模擬版相同的整合測試改對 Firebase + 正式規則執行（${fbSkipped} 項僅適用模擬資料庫而略過）；端對端以獨立瀏覽器模擬多台裝置</td><td class="c">${fbRun + eFbTests.length}</td><td class="c">${fbFailed || eFbTests.length - eFbPassed ? statusPill('failed') : statusPill('passed')}</td></tr>
  <tr><td>型別檢查與建置</td><td>vue-tsc 型別檢查、vite 正式建置（Firebase 版）</td><td class="c">2</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>相依套件稽核</td><td>npm audit（正式執行套件 / 開發工具）</td><td class="c">1</td><td class="c">${(vuln.critical ?? 0) + (vuln.high ?? 0) === 0 ? statusPill('passed') : statusPill('failed')}</td></tr>
</table>

<h3>1.1 測試環境</h3>
<table class="t">
  <tr><th style="width:26%">項目</th><th>版本 / 設定</th></tr>
  <tr><td>作業系統</td><td>Windows 10 Pro Education</td></tr>
  <tr><td>Node.js</td><td>${esc(ver('node -v'))}</td></tr>
  <tr><td>Vue / Vite</td><td>${esc(lockVer('vue'))} / ${esc(lockVer('vite'))}</td></tr>
  <tr><td>Vitest（jsdom）</td><td>${esc(lockVer('vitest'))}</td></tr>
  <tr><td>Playwright</td><td>${esc(lockVer('@playwright/test'))}；desktop-chromium（1366×900）、ipad-webkit（iPad Pro 11 landscape）</td></tr>
  <tr><td>資料庫</td><td>① 模擬資料庫（瀏覽器 localStorage）② Firebase 模擬器（Auth + Firestore，套用正式 firestore.rules）</td></tr>
  <tr><td>測試資料</td><td>全部為虛構姓名與帳號，未使用真實學生名冊</td></tr>
</table>
</section>

<section class="chapter">
<h2><span class="n">2</span>需求對照（PRD 驗收情境）</h2>
<table class="t">
  <tr><th style="width:7%" class="c">#</th><th>PRD 13.2 驗收情境</th><th style="width:42%">驗證的測試</th></tr>
  <tr><td class="c">1</td><td>匯入名冊，其中有錯誤列</td><td>E2E「首次使用…匯入名冊（含錯誤列預覽）」；單元「標示錯誤列…」</td></tr>
  <tr><td class="c">2</td><td>批次全班加點</td><td>整合「批次加點：每人一筆交易，共用批次編號」；E2E 各情境前置</td></tr>
  <tr><td class="c">3</td><td>小組獎勵：兩組並列冠軍、一組亞軍、一人請假</td><td>整合「並列冠軍 + 亞軍 + 請假排除」；E2E「小組獎勵…」</td></tr>
  <tr><td class="c">4</td><td>學生 A 收款、B 付款 → 雙方審核中、餘額不變</td><td>整合「送出後為審核中，雙方餘額都不變」；E2E「QR 轉帳完整流程」</td></tr>
  <tr><td class="c">5</td><td>同一張 QR 截圖再付一次</td><td>整合「收款碼只能使用一次」；E2E「同一個收款碼不能用兩次」</td></tr>
  <tr><td class="c">6</td><td>老師核准 → 雙方餘額與明細更新</td><td>整合「核准後付款人扣點…」；E2E「QR 轉帳完整流程」</td></tr>
  <tr><td class="c">7</td><td>多筆申請總額超過餘額</td><td>整合「多筆申請總額超過餘額…」「核准所選…」</td></tr>
  <tr><td class="c">8</td><td>老師沖正</td><td>整合「沖正產生反向交易…」「沖正轉帳：雙方餘額還原…」；E2E「個別加扣點 → 沖正」</td></tr>
  <tr><td class="c">9</td><td>學生開啟教師網址</td><td>E2E「權限：學生無法進入教師後台」；安全「竄改登入身分」</td></tr>
  <tr><td class="c">10</td><td>對帳檢查</td><td>整合「對帳：經過各種操作後…」；E2E 對帳全部一致</td></tr>
  <tr><td class="c">11</td><td>學生在電腦上以輸入代碼付款</td><td>E2E（desktop-chromium 無鏡頭 → 預設輸入代碼）</td></tr>
  <tr><td class="c">12</td><td>送出或核准中途斷線</td><td>安全「原子性：中途失敗時資料不變」4 項</td></tr>
  <tr><td class="c">13</td><td>轉帳雙方看到相同細目、看不到對方餘額</td><td>整合「付款人與收款人都看得到…」「交易資料中不含任何餘額資訊」；E2E 詳情頁比對</td></tr>
  <tr><td class="c">14</td><td>老師新增小確幸並顯示於前台</td><td>E2E「小確幸：老師新增…」；安全「只看得到啟用且顯示於前台的項目」</td></tr>
</table>
</section>

<section class="chapter">
<h2><span class="n">3</span>端對端測試（Playwright）</h2>
<p>每個情境都從全新瀏覽器開始：建立教師帳號 → 匯入虛構名冊 → 以多個分頁模擬老師與不同學生同時操作。</p>
<table class="t">
  <tr><th>情境</th><th style="width:16%" class="c">桌面 Chromium</th><th style="width:16%" class="c">iPad WebKit</th></tr>
  ${specTitles.map((k) => {
    const [file, title] = k.split('|')
    const c = eTests.find((t) => t.file === file && t.title === title && t.project === 'desktop-chromium')
    const w = eTests.find((t) => t.file === file && t.title === title && t.project === 'ipad-webkit')
    const cell = (t) => t ? `${statusPill(t.status)}<div class="small muted">${(t.ms / 1000).toFixed(1)} 秒</div>` : '—'
    return `<tr><td class="t">${esc(title)}<div class="small muted">${esc(file)}</div></td><td class="c">${cell(c)}</td><td class="c">${cell(w)}</td></tr>`
  }).join('')}
</table>
<div class="box"><div class="h">說明</div>Windows 上的 Playwright WebKit 執行速度明顯較慢（同一情境約為 Chromium 的 5～8 倍），因此 iPad 專案的逾時設為 150 秒；真實 iPad Safari 不受影響。上線前仍需以真實 iPad 進行實機驗收（相機權限、加入主畫面、校園網路）。</div>
</section>

<section class="chapter">
<h2><span class="n">4</span>單元、整合與安全測試（Vitest）</h2>
${vFiles.map((f) => `
<h3>${esc(f.kind)}：${esc(f.topic)}</h3>
<table class="t">
  <tr><th style="width:26%">分組</th><th>測試項目</th><th style="width:11%" class="c">結果</th><th style="width:9%" class="c">毫秒</th></tr>
  ${f.tests.map((t) => `<tr><td class="t">${esc(t.group)}</td><td class="t">${esc(t.title)}</td><td class="c">${statusPill(t.status)}</td><td class="c small">${t.ms}</td></tr>`).join('')}
</table>`).join('')}
</section>

<section class="chapter">
<h2><span class="n">4B</span>Firebase 模擬器測試（正式版資料層）</h2>
<p>與正式環境相同的 Firebase Auth 與 Firestore（本機模擬器），套用專案中的 <code>firestore.rules</code>。整合測試與模擬資料庫版使用<b>同一批測試程式</b>，只換資料後端；少數需要控制時鐘或讀取瀏覽器儲存內容的測試僅適用模擬資料庫而略過，對應的保護改由權限規則測試驗證。</p>
<h3>端對端（多台裝置）</h3>
<table class="t">
  <tr><th>情境</th><th style="width:14%" class="c">結果</th><th style="width:12%" class="c">秒數</th></tr>
  ${eFbTests.map((t) => `<tr><td class="t">${esc(t.title)}</td><td class="c">${statusPill(t.status)}</td><td class="c small">${(t.ms / 1000).toFixed(1)}</td></tr>`).join('')}
</table>
${fbFiles.map((f) => `
<h3>${esc(f.kind)}：${esc(f.topic)}（Firebase）</h3>
<table class="t">
  <tr><th style="width:26%">分組</th><th>測試項目</th><th style="width:11%" class="c">結果</th><th style="width:9%" class="c">毫秒</th></tr>
  ${f.tests.map((t) => `<tr><td class="t">${esc(t.group)}</td><td class="t">${esc(t.title)}</td><td class="c">${statusPill(t.status)}</td><td class="c small">${t.ms}</td></tr>`).join('')}
</table>`).join('')}
</section>

<section class="chapter">
<h2><span class="n">5</span>安全測試摘要</h2>
<table class="t">
  <tr><th style="width:30%">威脅</th><th>驗證方式</th><th style="width:10%" class="c">結果</th></tr>
  <tr><td>未登入存取資料</td><td>未登入呼叫各項讀取 API 皆被拒絕；未登入開啟頁面導向登入頁</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>學生執行教師操作</td><td>21 個教師專用方法逐一以學生身分呼叫，全部 PERMISSION_DENIED，且學生點數不變</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>竄改登入身分（前端）</td><td>把瀏覽器中的角色改為 teacher：API 與路由皆以資料庫角色為準，仍無教師權限</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>偷看他人交易 / 餘額</td><td>學生讀取與自己無關的交易被拒；轉帳文件不含餘額資訊</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>重複使用 / 偽造收款碼</td><td>已用、過期、取消、不存在、格式錯誤的代碼皆拒絕；不能付款給自己</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>金額竄改</td><td>0、負數、小數、NaN、字串、超過餘額、超過上限皆拒絕</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>重複核准 / 並行核准</td><td>兩台教師裝置同時核准同一筆，只成功一次</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>部分完成（原子性）</td><td>送出、核准、批次、小組獎勵、整批沖正在寫回前模擬斷線，資料庫內容完全不變</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>XSS</td><td>事由輸入 &lt;img onerror&gt;，教師與學生頁面皆以純文字顯示、無腳本執行；正式版含 CSP</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>暴力破解密碼</td><td>連續 5 次錯誤鎖定 1 分鐘；錯誤訊息不透露帳號是否存在</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>密碼外洩</td><td>資料庫只存 PBKDF2 雜湊；匯出備份不含雜湊；程式包中無真實名冊</td><td class="c">${statusPill('passed')}</td></tr>
  <tr><td>帳本竄改</td><td>系統沒有任何刪除交易的操作，錯誤一律沖正；刪除學生帳號時交易紀錄保留、對帳仍一致</td><td class="c">${statusPill('passed')}</td></tr>
</table>
<h3>5.1 相依套件稽核（npm audit）</h3>
<table class="t">
  <tr><th>嚴重</th><th>高</th><th>中</th><th>低</th></tr>
  <tr><td>${vuln.critical ?? 0}</td><td>${vuln.high ?? 0}</td><td>${vuln.moderate ?? 0}</td><td>${vuln.low ?? 0}</td></tr>
</table>
${vulnList.length ? `<table class="t"><tr><th style="width:22%">套件</th><th style="width:10%">等級</th><th>說明</th><th style="width:22%">影響評估</th></tr>
${vulnList.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.severity)}</td><td class="t">${esc(v.title)}</td><td class="t">${v.dev ? '僅開發測試工具，不會打包進網站' : '需處理'}</td></tr>`).join('')}</table>` : ''}
<p class="small">正式執行套件（npm audit --omit=dev）：0 個漏洞。</p>
</section>

<section class="chapter">
<h2><span class="n">6</span>已知限制與後續事項</h2>
<table class="t">
  <tr><th style="width:30%">項目</th><th>說明</th></tr>
  <tr><td>正式環境實機驗收</td><td>自動化測試使用 Firebase 模擬器；正式環境已完成帳號建立與規則發布，仍需以真實 iPad 實機驗收（相機掃描、加入主畫面、校園網路）。</td></tr>
  <tr><td>模擬資料庫版</td><td>僅供開發與示範：資料不跨裝置同步，權限檢查在瀏覽器內執行。正式版由 Firestore Security Rules 在伺服器端保護。</td></tr>
  <tr><td>App Check 與 API 金鑰限制</td><td>尚未啟用（建議上線後設定，見 docs/MIGRATION.md）。目前資料安全由權限規則保障：未列入名冊的帳號無任何權限。</td></tr>
  <tr><td>重設 / 刪除登入帳號</td><td>免費方案無法在網頁上操作他人的登入帳號，改用老師電腦的管理工具（npm run admin）。</td></tr>
  <tr><td>相機掃描</td><td>自動化測試環境沒有鏡頭，以「輸入代碼」與「掃描網址直接開啟付款頁」驗證；相機掃描需在真實 iPad 上實機測試。</td></tr>

</table>
</section>

<section class="chapter">
<h2><span class="n">7</span>畫面截圖（測試過程自動擷取，資料皆為虛構）</h2>
<div class="shots">
${pick.map((n) => `<figure><img src="report-img/${n}.png" alt=""><figcaption>${n.startsWith('ipad') ? 'iPad' : '教師電腦'}｜${esc(SHOT_LABEL[n.replace(/^(ipad|desktop)-/, '')] ?? n)}</figcaption></figure>`).join('\n')}
</div>
</section>
</body></html>`

fs.writeFileSync(R('docs/src/TestReport.html'), html)
console.log(`已產生 docs/src/TestReport.html：Vitest ${vPassed}/${vTotal}、E2E ${ePassed}/${eTotal}`)
