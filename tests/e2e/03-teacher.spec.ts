import { test, expect } from '@playwright/test'
import { setupTeacher, importRoster, openAs, giveAll, dialogOk, shot } from './helpers'

test('小組獎勵：並列冠軍 + 亞軍 + 請假排除；同日重複提醒；整批沖正', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page) // 第 1 組：林一、李五；第 2 組：陳二、黃六；第 3 組：王三、吳七；第 4 組：張四、劉八
  await page.goto('/#/t/group-award')
  await page.getByTestId('champ-group').filter({ hasText: '第 1 組' }).click()
  await page.getByTestId('champ-group').filter({ hasText: '第 2 組' }).click()
  await page.getByTestId('runner-group').filter({ hasText: '第 3 組' }).click()
  await expect(page.getByTestId('runner-group').filter({ hasText: '第 1 組' })).toBeDisabled()
  await page.getByTestId('award-member').filter({ hasText: '黃六' }).click() // 請假
  await expect(page.getByText('冠軍 3 人 ＋ 亞軍 2 人')).toBeVisible()
  await expect(page.getByText('2,100 點')).toBeVisible()
  await shot(page, '10-group-award')
  await page.getByTestId('award-submit').click()
  await dialogOk(page, '發放')
  await expect(page.getByText('已發放：5 人，共 2,100 點')).toBeVisible()

  const s1 = await openAs(context, 'e01')
  await expect(s1.getByTestId('balance')).toHaveText('500')
  await expect(s1.getByText('小組冠軍（第 1 組）')).toBeVisible()
  const s6 = await openAs(context, 'e06')
  await expect(s6.getByTestId('balance')).toHaveText('0')

  // 同一天再發一次 → 提醒
  await page.getByTestId('champ-group').filter({ hasText: '第 4 組' }).click()
  await page.getByTestId('award-submit').click()
  await dialogOk(page, '發放')
  await expect(page.getByRole('dialog')).toContainText('已發放過小組獎勵')
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  // 整批沖正第一次發放
  await page.getByRole('button', { name: '整批沖正' }).first().click()
  await page.getByRole('dialog').getByLabel('沖正原因').fill('選錯組別')
  await dialogOk(page, '整批沖正')
  await expect(page.getByText('已沖正 5 筆')).toBeVisible()
  await expect(s1.getByTestId('balance')).toHaveText('0')
})

test('個別加扣點（一鍵項目）→ 交易紀錄沖正 → 學生看到已沖正；對帳一致', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  await giveAll(page, 1000)
  await page.goto('/#/t/students')
  await page.getByTestId('student-row').filter({ hasText: '林一' }).click()
  await page.getByRole('button', { name: /表現優良/ }).click()
  await expect(page.getByTestId('student-balance')).toHaveText('4,000')
  await page.getByRole('button', { name: /忘記帶作業/ }).click()
  await expect(page.getByTestId('student-balance')).toHaveText('3,700')
  await shot(page, '11-student-detail')

  await page.goto('/#/t/ledger')
  const row = page.getByTestId('ledger-row').filter({ hasText: '忘記帶作業' })
  await row.getByTestId('reverse').click()
  await page.getByRole('dialog').getByLabel('沖正原因').fill('老師誤扣')
  await dialogOk(page, '沖正')
  await expect(page.getByTestId('ledger-row').filter({ hasText: '忘記帶作業' }).filter({ hasText: '已沖正' })).toHaveCount(1)
  await shot(page, '12-ledger')

  const s = await openAs(context, 'e01')
  await expect(s.getByTestId('balance')).toHaveText('4,000')
  await s.goto('/#/history')
  await expect(s.getByText('沖正：忘記帶作業')).toBeVisible()
  await expect(s.getByTestId('tx-row').filter({ hasText: '忘記帶作業' }).filter({ hasText: '已沖正' })).toHaveCount(1)

  await page.goto('/#/t/settings')
  await page.getByTestId('reconcile').click()
  await expect(page.getByTestId('reconcile-result').filter({ hasText: '不一致' })).toHaveCount(0)
  await expect(page.getByTestId('reconcile-result')).toHaveCount(8)
})

test('批次扣點時有人點數不足：顯示名單並可排除後再送出', async ({ page }) => {
  await setupTeacher(page)
  await importRoster(page)
  await page.goto('/#/t/students')
  await page.getByTestId('student-row').filter({ hasText: '林一' }).click()
  await page.getByRole('button', { name: /表現優良/ }).click()
  await expect(page.getByTestId('student-balance')).toHaveText('3,000')

  await page.goto('/#/t/adjust')
  await expect(page.getByTestId('pick-student')).toHaveCount(8)
  await page.getByTestId('select-all').click()
  await expect(page.getByText('已選 8 人')).toBeVisible()
  await page.getByRole('button', { name: /午休看課外書/ }).click()
  await expect(page.getByText(/點數不足：陳二/)).toBeVisible()
  await page.getByRole('button', { name: '排除這些學生' }).click()
  await expect(page.getByText('已選 1 人')).toBeVisible()
  await page.getByTestId('adjust-submit').click()
  await dialogOk(page, '確認')
  await expect(page.getByText(/已完成：1 位學生扣 800 點/)).toBeVisible()
})

test('小確幸：老師新增並顯示於前台 → 學生即時看到；隱藏後消失', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  const s = await openAs(context, 'e01')
  await s.goto('/#/perks')
  await expect(s.getByTestId('perk').filter({ hasText: '午休看課外書' })).toBeVisible()

  await page.goto('/#/t/presets')
  await page.getByTestId('new-deduct').click()
  await page.getByTestId('preset-name').fill('當一天小老師')
  await page.getByTestId('preset-amount').fill('15000')
  await page.getByTestId('preset-save').click()
  await expect(page.getByText('已儲存')).toBeVisible()

  await expect(s.getByTestId('perk').filter({ hasText: '當一天小老師' })).toBeVisible()
  await expect(s.getByTestId('perk').filter({ hasText: '當一天小老師' })).toContainText('還差 15,000')
  await shot(s, '13-perks')

  await page.getByTestId('preset-item').filter({ hasText: '當一天小老師' }).getByLabel('顯示於前台').uncheck()
  await expect(s.getByTestId('perk').filter({ hasText: '當一天小老師' })).toHaveCount(0)

  // 刪除項目
  await page.getByTestId('preset-item').filter({ hasText: '當一天小老師' }).getByTestId('preset-delete').click()
  await dialogOk(page, '刪除')
  await expect(page.getByText('已刪除「當一天小老師」')).toBeVisible()
  await expect(page.getByTestId('preset-item').filter({ hasText: '當一天小老師' })).toHaveCount(0)
})

test('儀表板與分組管理畫面', async ({ page }) => {
  await setupTeacher(page)
  await importRoster(page)
  await giveAll(page, 2000)
  await page.goto('/#/t')
  await expect(page.getByText('全班總點數')).toBeVisible()
  await expect(page.getByText('16,000', { exact: true })).toBeVisible()
  await shot(page, '14-teacher-dashboard')
  await page.goto('/#/t/groups')
  await expect(page.getByRole('heading', { name: /第 1 組/ })).toBeVisible()
  await shot(page, '15-groups')
})
