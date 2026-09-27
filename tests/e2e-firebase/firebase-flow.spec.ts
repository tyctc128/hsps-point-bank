// Firebase 版完整流程：老師與學生各用獨立的瀏覽器（= 不同裝置），驗證跨裝置即時同步
import { test, expect, type Browser, type Page } from '@playwright/test'
import { dialogOk, fillPayCode, giveAll, login, rosterXlsx, shot, STUDENT_PW } from '../e2e/helpers'
import { E2E_TEACHER_PW } from './global-setup'

async function newDevice(browser: Browser, account: string, password = STUDENT_PW): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' })
  const page = await ctx.newPage()
  await login(page, account, password)
  return page
}

test.describe.configure({ mode: 'serial' })

test('Firebase：教師登入 → 匯入名冊 → 批次加點 → 兩台裝置 QR 轉帳 → 核准 → 雙方即時更新 → 小組獎勵 → 刪除帳號', async ({ page, browser }) => {
  // 教師（電腦）
  await login(page, 'teacher', E2E_TEACHER_PW)
  await expect(page).toHaveURL(/#\/t$/)
  await page.goto('/#/t/accounts')
  await page.getByTestId('roster-file').setInputFiles({
    name: 'account.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: rosterXlsx(),
  })
  await page.getByTestId('roster-import').click()
  await dialogOk(page, '匯入')
  await expect(page.getByText('已建立 8 個帳號')).toBeVisible({ timeout: 60_000 })
  await page.goto('/#/t/students')
  await expect(page.getByTestId('student-row')).toHaveCount(8)
  await giveAll(page, 1000)

  // 兩位學生各用一台裝置
  const payee = await newDevice(browser, 'e01')
  const payer = await newDevice(browser, 'e02')
  await expect(payee.getByTestId('balance')).toHaveText('1,000')

  await payee.getByTestId('go-receive').click()
  const code = (await payee.getByTestId('receive-code').getAttribute('data-code'))!
  await payer.goto(`/#/pay?c=${code}`)
  await expect(payer.getByTestId('pay-recipient')).toHaveText('林一（1 號）')
  await payer.getByTestId('pay-amount').fill('200')
  await payer.getByRole('button', { name: '買東西' }).click()
  await payer.getByTestId('pay-note').fill('買手作書籤')
  await payer.getByRole('button', { name: '送出付款申請' }).click()
  await dialogOk(payer, '確定送出')
  await expect(payer.getByTestId('pay-done')).toBeVisible()
  await expect(payee.getByTestId('receive-used')).toBeVisible() // 另一台裝置即時收到

  // 教師審核（另一台電腦即時出現）
  await page.goto('/#/t/approvals')
  const card = page.getByTestId('pending-card').first()
  await expect(card).toContainText('買手作書籤')
  await shot(page, 'firebase-approvals')
  await card.getByTestId('approve').click()
  await expect(page.getByText(/已核准：陳二 → 林一 200 點/)).toBeVisible()

  await payer.goto('/#/')
  await expect(payer.getByTestId('balance')).toHaveText('800')
  await payee.goto('/#/')
  await expect(payee.getByTestId('balance')).toHaveText('1,200')
  await payee.getByTestId('tx-row').filter({ hasText: '收到' }).first().click()
  await expect(payee.getByTestId('detail-counterpart')).toHaveText('陳二（2 號）')
  await shot(payee, 'firebase-student-detail')

  // 同一個收款碼不能再用
  const other = await newDevice(browser, 'e03')
  await other.goto('/#/pay')
  await fillPayCode(other, code)
  await other.getByRole('button', { name: '下一步' }).click()
  await expect(other.getByRole('alert')).toContainText('已使用或已失效')

  // 小組獎勵
  await page.goto('/#/t/group-award')
  await page.getByTestId('champ-group').filter({ hasText: '第 1 組' }).click()
  await page.getByTestId('runner-group').filter({ hasText: '第 2 組' }).click()
  await page.getByTestId('award-submit').click()
  await dialogOk(page, '發放')
  await expect(page.getByText(/已發放：4 人/)).toBeVisible()
  await payee.goto('/#/')
  await expect(payee.getByTestId('balance')).toHaveText('4,200') // 林一在第 1 組，冠軍 +3,000（預設）

  // 停用與刪除帳號：被刪除的學生立即被登出，無法再登入
  await page.goto('/#/t/students')
  await page.getByTestId('student-row').filter({ hasText: '王三' }).getByTestId('student-check').check()
  await page.getByTestId('bulk-delete').click()
  await dialogOk(page, '繼續刪除')
  await page.getByRole('dialog').getByLabel('請輸入「刪除」兩個字').fill('刪除')
  await dialogOk(page, '刪除 1 個帳號')
  await expect(page.getByText('已刪除 1 個帳號')).toBeVisible()
  await expect(other).toHaveURL(/#\/login/, { timeout: 20_000 })
  await other.getByLabel('帳號').fill('e03')
  await other.getByLabel('密碼').fill(STUDENT_PW)
  await other.getByRole('button', { name: '登入' }).click()
  await expect(other.getByRole('alert')).toHaveText('帳號或密碼錯誤')

  // 對帳
  await page.goto('/#/t/settings')
  await page.getByTestId('reconcile').click()
  await expect(page.getByTestId('reconcile-result').filter({ hasText: '不一致' })).toHaveCount(0)
})

test('Firebase：權限——學生無法進入教師後台；重新整理後保持登入', async ({ browser }) => {
  const s = await newDevice(browser, 'e04')
  await s.goto('/#/t/students')
  await expect(s).toHaveURL(/#\/$/)
  await s.reload()
  await expect(s.getByTestId('balance')).toBeVisible()
  await expect(s).not.toHaveURL(/#\/login/)
})
