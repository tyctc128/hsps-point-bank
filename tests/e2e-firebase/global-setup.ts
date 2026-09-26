// 清空 Firebase 模擬器並建立教師帳號（對應正式上線時的 npm run admin -- init-teacher）
import { connect, initTeacher, close, readEnvFile } from '../../scripts/admin-core'

export const E2E_TEACHER_PW = 'teacher-e2e-pass'

export default async function globalSetup() {
  const env = readEnvFile('.env.emulator')
  const project = env.VITE_FIREBASE_PROJECT_ID
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`, { method: 'DELETE' })
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  const ctx = connect({ projectId: project, studentDomain: env.VITE_STUDENT_EMAIL_DOMAIN, teacherEmail: env.VITE_TEACHER_EMAIL, appName: 'e2e-setup' })
  await initTeacher(ctx, { name: '王老師', password: E2E_TEACHER_PW })
  await close(ctx)
}
