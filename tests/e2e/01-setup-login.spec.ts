import { test, expect } from '@playwright/test'
import { setupTeacher, importRoster, login, rosterXlsx, dialogOk, shot, STUDENT_PW, TEACHER_PW } from './helpers'

test('首次使用：建立教師帳號 → 匯入名冊（含錯誤列預覽）→ 學生登入', async ({ page, context }) => {
  await setupTeacher(page)
  await expect(page.getByRole('heading', { name: '帳號管理' })).toBeVisible()

  // 名冊含 2 列錯誤資料：重複帳號、密碼太短
  await page.getByTestId('roster-file').setInputFiles({
    name: 'account.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: rosterXlsx([
      { no: 9, account: 'e01', passwd: 'abcdef', name: '重複帳號' },
      { no: 10, account: 'e10', passwd: '123', name: '密碼太短' },
    ]),
  })
  await expect(page.getByText('可匯入 8 位')).toBeVisible()
  await expect(page.getByText('有誤 2 列')).toBeVisible()
  await expect(page.getByText(/第 10 列：.*重複/)).toBeVisible()
  await expect(page.getByText(/第 11 列：.*密碼至少 6 碼/)).toBeVisible()
  await shot(page, '01-import-preview')
  await page.getByTestId('roster-import').click()
  await dialogOk(page, '匯入')
  await expect(page.getByText('已建立 8 個帳號')).toBeVisible()

  await page.goto('/#/t/students')
  await expect(page.getByTestId('student-row')).toHaveCount(8)
  await shot(page, '02-teacher-students')

  // 學生在另一個分頁登入
  const s = await context.newPage()
  await s.goto('/#/login')
  await s.getByLabel('帳號').fill('e01')
  await s.getByLabel('密碼').fill('wrong-password')
  await s.getByRole('button', { name: '登入' }).click()
  await expect(s.getByRole('alert')).toHaveText('帳號或密碼錯誤')
  await login(s, 'E01', STUDENT_PW) // 帳號不分大小寫
  await expect(s.getByTestId('balance')).toHaveText('0')
  await expect(s.getByText('林一')).toBeVisible()
  await shot(s, '03-student-home-empty')
})

test('權限：學生無法進入教師後台；未登入會被導向登入頁', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  const s = await context.newPage()
  await s.goto('/#/t/students')
  await expect(s).toHaveURL(/#\/login/)
  await login(s, 'e02', STUDENT_PW)
  await s.goto('/#/t/students')
  await expect(s).toHaveURL(/#\/$/)
  await s.goto('/#/t/adjust')
  await expect(s).toHaveURL(/#\/$/)
  await expect(s.getByText('教師後台')).toHaveCount(0)
})

test('教師登出後重新登入；停用的學生無法登入', async ({ page, context }) => {
  await setupTeacher(page)
  await importRoster(page)
  await page.goto('/#/t/students')
  await page.getByTestId('student-row').filter({ hasText: '陳二' }).click()
  await page.getByRole('button', { name: '停用帳號' }).click()
  await dialogOk(page, '停用')
  await expect(page.getByText('已停用').first()).toBeVisible()

  const s = await context.newPage()
  await s.goto('/#/login')
  await s.getByLabel('帳號').fill('e02')
  await s.getByLabel('密碼').fill(STUDENT_PW)
  await s.getByRole('button', { name: '登入' }).click()
  await expect(s.getByRole('alert')).toHaveText('帳號已停用，請洽老師')

  await page.getByRole('button', { name: '登出' }).click()
  await expect(page).toHaveURL(/#\/login/)
  await login(page, 'teacher', TEACHER_PW)
  await expect(page).toHaveURL(/#\/t$/)
})
