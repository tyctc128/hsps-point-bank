import { expect, type BrowserContext, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const TEACHER_PW = 'teacher-e2e-pass'
export const STUDENT_PW = 'pass1234'

/** 虛構名冊：8 位學生、4 個組別（第 1～4 組各 2 人）。欄位與老師的 account.xlsx 相同。 */
export const ROSTER = Array.from({ length: 8 }, (_, i) => ({
  no: i + 1,
  account: `e${String(i + 1).padStart(2, '0')}`,
  passwd: STUDENT_PW,
  name: ['林一', '陳二', '王三', '張四', '李五', '黃六', '吳七', '劉八'][i],
  組別: `第 ${(i % 4) + 1} 組`,
}))

export function rosterXlsx(extraRows: Record<string, unknown>[] = []): Buffer {
  const ws = XLSX.utils.json_to_sheet([...ROSTER, ...extraRows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '工作表1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export async function shot(page: Page, name: string) {
  const dir = path.join('test-results', 'screenshots')
  fs.mkdirSync(dir, { recursive: true })
  const project = test_project(page)
  await page.screenshot({ path: path.join(dir, `${project}-${name}.png`), fullPage: true })
}

function test_project(page: Page): string {
  const w = page.viewportSize()?.width ?? 0
  return w <= 1200 ? 'ipad' : 'desktop'
}

export async function dialogOk(page: Page, name: string) {
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click()
}

/** 首次使用：建立教師帳號（不載入示範資料） */
export async function setupTeacher(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/#\/setup/)
  await page.getByLabel('老師姓名（顯示用）').fill('王老師')
  await page.getByLabel('密碼（至少 8 碼）').fill(TEACHER_PW)
  await page.getByLabel('再輸入一次密碼').fill(TEACHER_PW)
  await page.getByRole('button', { name: '建立並登入' }).click()
  await expect(page).toHaveURL(/#\/t\/accounts/)
}

export async function importRoster(page: Page) {
  await page.goto('/#/t/accounts')
  await page.getByTestId('roster-file').setInputFiles({
    name: 'account.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: rosterXlsx(),
  })
  await page.getByTestId('roster-import').click()
  await dialogOk(page, '匯入')
  await expect(page.getByText('已建立 8 個帳號')).toBeVisible()
}

/** 新開一個分頁（同一台裝置的另一個分頁 = 共用模擬資料庫，但登入身分各自獨立） */
export async function openAs(context: BrowserContext, account: string, password = STUDENT_PW): Promise<Page> {
  const page = await context.newPage()
  await login(page, account, password)
  return page
}

export async function login(page: Page, account: string, password: string) {
  await page.goto('/#/login')
  await page.getByLabel('帳號').fill(account)
  await page.getByLabel('密碼').fill(password)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(page).not.toHaveURL(/#\/login/)
}

/** 教師在「加扣點 / 批次」頁幫全班加點 */
export async function giveAll(page: Page, amount: number, title = '開學禮') {
  await page.goto('/#/t/adjust')
  await expect(page.getByTestId('pick-student').first()).toBeVisible()
  await page.getByTestId('select-all').click()
  await expect(page.getByText(/已選 [1-9]/)).toBeVisible()
  await page.getByRole('button', { name: '自訂', exact: true }).click()
  await page.getByTestId('adjust-amount').fill(String(amount))
  await page.getByTestId('adjust-title').fill(title)
  await page.getByTestId('adjust-submit').click()
  await dialogOk(page, '確認')
  await expect(page.getByText(/已完成：\d+ 位學生加/)).toBeVisible()
}

export async function balanceOn(page: Page): Promise<string> {
  await page.goto('/#/')
  return (await page.getByTestId('balance').textContent())?.trim() ?? ''
}

/** 在付款頁輸入收款代碼：有鏡頭的裝置會先開相機，需要先切換到「輸入代碼」（與真人操作相同） */
export async function fillPayCode(page: Page, code: string) {
  const input = page.getByTestId('pay-code')
  const chip = page.getByRole('button', { name: '輸入代碼' })
  // 偵測鏡頭期間畫面可能隨時切換：重試直到輸入框出現
  await expect(async () => {
    if (await input.isVisible()) return
    if (await chip.isVisible()) await chip.click({ timeout: 1000 }).catch(() => {})
    await expect(input).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 30_000 })
  await input.fill(code)
}
