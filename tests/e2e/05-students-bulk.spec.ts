import { test, expect } from '@playwright/test'
import { setupTeacher, importRoster, dialogOk, giveAll, openAs, shot, STUDENT_PW } from './helpers'

test('學生總覽：批次停用、批次刪除（需輸入「刪除」確認）；交易紀錄保留', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  await giveAll(page, 100)

  // 被刪除前，陳二先轉帳給林一並經核准 → 刪除後林一的明細仍看得到
  const payee = await openAs(context, 'e01')
  await payee.goto('/#/receive')
  const code = (await payee.getByTestId('receive-code').getAttribute('data-code'))!
  const payer = await openAs(context, 'e02')
  await payer.goto(`/#/pay?c=${code}`)
  await payer.getByTestId('pay-amount').fill('50')
  await payer.getByRole('button', { name: '還錢' }).click()
  await payer.getByTestId('pay-note').fill('還錢')
  await payer.getByRole('button', { name: '送出付款申請' }).click()
  await dialogOk(payer, '確定送出')
  await page.goto('/#/t/approvals')
  await page.getByTestId('approve').click()
  await expect(page.getByText(/已核准/)).toBeVisible()

  await page.goto('/#/t/students')
  await expect(page.getByTestId('student-row')).toHaveCount(8)

  // 批次停用：張四、李五
  for (const n of ['張四', '李五']) await page.getByTestId('student-row').filter({ hasText: n }).getByTestId('student-check').check()
  await expect(page.getByText('已選 2 人')).toBeVisible()
  await page.getByTestId('bulk-disable').click()
  await dialogOk(page, '停用')
  await expect(page.getByText('已停用 2 個帳號')).toBeVisible()
  await expect(page.getByTestId('student-row').filter({ hasText: '張四' })).toContainText('已停用')

  // 批次刪除：陳二、黃六
  for (const n of ['陳二', '黃六']) await page.getByTestId('student-row').filter({ hasText: n }).getByTestId('student-check').check()
  await shot(page, '16-students-bulk')
  await page.getByTestId('bulk-delete').click()
  await expect(page.getByRole('dialog')).toContainText('2 號 陳二')
  await expect(page.getByRole('dialog')).toContainText('共有 150 點')
  await dialogOk(page, '繼續刪除')
  // 輸入錯誤 → 取消
  await page.getByRole('dialog').getByLabel('請輸入「刪除」兩個字').fill('刪')
  await dialogOk(page, '刪除 2 個帳號')
  await expect(page.getByText('輸入不正確，已取消')).toBeVisible()
  await expect(page.getByTestId('student-row')).toHaveCount(8)
  // 重來一次，正確輸入
  await page.getByTestId('bulk-delete').click()
  await dialogOk(page, '繼續刪除')
  await page.getByRole('dialog').getByLabel('請輸入「刪除」兩個字').fill('刪除')
  await dialogOk(page, '刪除 2 個帳號')
  await expect(page.getByText('已刪除 2 個帳號')).toBeVisible()
  await expect(page.getByTestId('student-row')).toHaveCount(6)
  await expect(page.getByTestId('student-row').filter({ hasText: '陳二' })).toHaveCount(0)

  // 被刪除的學生無法再登入；已登入的分頁被登出
  await expect(payer).toHaveURL(/#\/login/)
  await payer.getByLabel('帳號').fill('e02')
  await payer.getByLabel('密碼').fill(STUDENT_PW)
  await payer.getByRole('button', { name: '登入' }).click()
  await expect(payer.getByRole('alert')).toHaveText(/帳號或密碼錯誤|資料庫裡沒有帳號「e02」/)

  // 林一的明細仍保留這筆轉入
  await payee.goto('/#/history')
  await expect(payee.getByText('收到 陳二（2 號）')).toBeVisible()
})
