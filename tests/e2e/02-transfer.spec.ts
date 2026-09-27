import { test, expect } from '@playwright/test'
import { setupTeacher, importRoster, openAs, giveAll, dialogOk, shot, fillPayCode } from './helpers'

test('QR 轉帳完整流程：收款 → 輸入代碼付款 → 雙方即時看到 → 教師核准 → 雙方明細一致', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  await giveAll(page, 1000)

  // 收款方 e01（林一）
  const payee = await openAs(context, 'e01')
  await payee.getByTestId('go-receive').click()
  const codeEl = payee.getByTestId('receive-code')
  await expect(codeEl).toBeVisible()
  await expect(payee.getByTestId('qr-image')).toBeVisible()
  const code = (await codeEl.getAttribute('data-code'))!
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  await shot(payee, '04-receive-qr')

  // 付款方 e02（陳二）：沒有鏡頭時預設顯示輸入代碼
  const payer = await openAs(context, 'e02')
  await payer.getByTestId('go-pay').click()
  await fillPayCode(payer, `${code.slice(0, 4).toLowerCase()} ${code.slice(4)}`)
  await payer.getByRole('button', { name: '下一步' }).click()
  await expect(payer.getByTestId('pay-recipient')).toHaveText('林一（1 號）')
  await payer.getByTestId('pay-amount').fill('200')
  await payer.getByRole('button', { name: '買東西' }).click()
  await payer.getByTestId('pay-note').fill('買手作書籤')
  await shot(payer, '05-pay-form')
  await payer.getByRole('button', { name: '送出付款申請' }).click()
  await expect(payer.getByRole('dialog')).toContainText('付給 林一（1 號）200 點')
  await dialogOk(payer, '確定送出')
  await expect(payer.getByTestId('pay-done')).toBeVisible()

  // 收款方畫面即時更新
  await expect(payee.getByTestId('receive-used')).toBeVisible()
  await expect(payee.getByText('陳二（2 號）')).toBeVisible()
  await shot(payee, '06-receive-used')

  // 審核前雙方餘額不變，明細顯示審核中
  await payer.goto('/#/')
  await expect(payer.getByTestId('balance')).toHaveText('1,000')
  await expect(payer.getByText('1 筆轉出等待老師審核')).toBeVisible()
  await payee.goto('/#/')
  await expect(payee.getByText('1 筆轉入等待老師審核')).toBeVisible()

  // 教師核准
  await page.goto('/#/t')
  await expect(page.getByTestId('stat-pending')).toHaveText('1 筆')
  await page.goto('/#/t/approvals')
  const card = page.getByTestId('pending-card').first()
  await expect(card).toContainText('陳二 2號')
  await expect(card).toContainText('林一 1號')
  await expect(card).toContainText('買手作書籤')
  await shot(page, '07-teacher-approvals')
  await card.getByTestId('approve').click()
  await expect(page.getByText(/已核准：陳二 → 林一 200 點/)).toBeVisible()

  // 雙方餘額即時更新
  await expect(payer.getByTestId('balance')).toHaveText('800')
  await expect(payee.getByTestId('balance')).toHaveText('1,200')
  await shot(payer, '08-student-home')

  // 雙方開啟同一筆交易詳情：對象、事由、金額一致
  await payer.getByTestId('tx-row').filter({ hasText: '轉帳給' }).first().click()
  await expect(payer.getByTestId('detail-counterpart')).toHaveText('林一（1 號）')
  await expect(payer.getByTestId('detail-note')).toHaveText('買手作書籤')
  await expect(payer.getByTestId('detail-amount')).toContainText('−200')
  await shot(payer, '09-tx-detail-payer')
  await payee.getByTestId('tx-row').filter({ hasText: '收到' }).first().click()
  await expect(payee.getByTestId('detail-counterpart')).toHaveText('陳二（2 號）')
  await expect(payee.getByTestId('detail-note')).toHaveText('買手作書籤')
  await expect(payee.getByTestId('detail-amount')).toContainText('+200')
})

test('同一個收款碼不能用兩次；不能付款給自己', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  await giveAll(page, 500)

  const payee = await openAs(context, 'e03')
  await payee.goto('/#/receive')
  const code = (await payee.getByTestId('receive-code').getAttribute('data-code'))!

  // 自己的收款碼
  const self = await openAs(context, 'e03') // 等登入完成（回到首頁）後才前往付款頁
  await self.goto('/#/pay')
  await fillPayCode(self, code)
  await self.getByRole('button', { name: '下一步' }).click()
  await expect(self.getByRole('alert')).toContainText('不能付款給自己')

  const a = await openAs(context, 'e04')
  await a.goto(`/#/pay?c=${code}`) // 用 iPad 相機掃 QR 時會直接開啟這個網址
  await expect(a.getByTestId('pay-recipient')).toHaveText('王三（3 號）')
  await a.getByTestId('pay-amount').fill('100')
  await a.getByRole('button', { name: '贈送' }).click()
  await a.getByTestId('pay-note').fill('生日禮物')
  await a.getByRole('button', { name: '送出付款申請' }).click()
  await dialogOk(a, '確定送出')
  await expect(a.getByTestId('pay-done')).toBeVisible()

  const b = await openAs(context, 'e05')
  await b.goto('/#/pay')
  await fillPayCode(b, code)
  await b.getByRole('button', { name: '下一步' }).click()
  await expect(b.getByRole('alert')).toContainText('已使用或已失效')
})

test('付款金額超過餘額時無法送出；教師駁回後學生看得到原因', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  await giveAll(page, 300)
  const payee = await openAs(context, 'e01')
  await payee.goto('/#/receive')
  const code = (await payee.getByTestId('receive-code').getAttribute('data-code'))!
  const payer = await openAs(context, 'e02')
  await payer.goto(`/#/pay?c=${code}`)
  await payer.getByTestId('pay-amount').fill('999')
  await payer.getByRole('button', { name: '還錢' }).click()
  await payer.getByTestId('pay-note').fill('還錢')
  await payer.getByRole('button', { name: '送出付款申請' }).click()
  await expect(payer.getByRole('alert')).toContainText('點數不足')
  await payer.getByTestId('pay-amount').fill('100')
  await payer.getByRole('button', { name: '送出付款申請' }).click()
  await dialogOk(payer, '確定送出')
  await expect(payer.getByTestId('pay-done')).toBeVisible()

  await page.goto('/#/t/approvals')
  await page.getByTestId('pending-card').getByRole('button', { name: '駁回' }).click()
  await page.getByRole('dialog').getByLabel('駁回原因（選填）').fill('請當面確認')
  await dialogOk(page, '駁回')
  await expect(page.getByText('已駁回').first()).toBeVisible()

  await payer.goto('/#/history')
  await payer.getByTestId('tx-row').filter({ hasText: '轉帳給' }).click()
  await expect(payer.getByText('請當面確認')).toBeVisible()
  await payer.goto('/#/')
  await expect(payer.getByTestId('balance')).toHaveText('300')
})
