import { test, expect } from '@playwright/test'
import { setupTeacher, importRoster, openAs, giveAll, dialogOk } from './helpers'

test('安全：正式版含 CSP；事由中的 HTML / 腳本以純文字顯示（XSS 防護）', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)

  await setupTeacher(page)
  await importRoster(page)
  await giveAll(page, 500)
  const payee = await openAs(context, 'e01')
  await payee.goto('/#/receive')
  const code = (await payee.getByTestId('receive-code').getAttribute('data-code'))!

  const payer = await openAs(context, 'e02')
  let alerted = false
  payer.on('dialog', (d) => { alerted = true; d.dismiss() })
  payee.on('dialog', (d) => { alerted = true; d.dismiss() })
  page.on('dialog', (d) => { alerted = true; d.dismiss() })

  const evil = '<img src=x onerror=alert(1)>'
  await payer.goto(`/#/pay?c=${code}`)
  await payer.getByTestId('pay-amount').fill('10')
  await payer.getByRole('button', { name: '其他' }).click()
  await payer.getByTestId('pay-note').fill(evil)
  await payer.getByRole('button', { name: '送出付款申請' }).click()
  await dialogOk(payer, '確定送出')
  await expect(payer.getByTestId('pay-done')).toBeVisible()

  await page.goto('/#/t/approvals')
  await expect(page.getByTestId('pending-card')).toContainText(evil)
  await payee.goto('/#/history')
  await payee.getByTestId('tx-row').first().click()
  await expect(payee.getByTestId('detail-note')).toHaveText(evil)
  expect(await payee.locator('img[src="x"]').count()).toBe(0)
  expect(alerted).toBe(false)
})

test('安全：竄改瀏覽器中的登入身分無法取得教師權限', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  const s = await openAs(context, 'e01')
  // 學生把自己的 session 角色改成 teacher
  await s.evaluate(() => {
    const k = 'hsps-bank-session'
    const v = JSON.parse(sessionStorage.getItem(k)!)
    sessionStorage.setItem(k, JSON.stringify({ ...v, role: 'teacher' }))
  })
  await s.goto('/#/t/students')
  // 路由守衛以資料庫中的角色為準 → 被導回學生首頁
  await expect(s).toHaveURL(/#\/$/)
  await expect(s.getByTestId('balance')).toBeVisible()
})
