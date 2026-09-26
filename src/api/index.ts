// 選擇資料後端：VITE_BACKEND=firebase（正式版，.env.production）或 mock（開發 / 試用）
import type { BankApi } from './types'
import { MockApi } from './mock/mockApi'
import { MockStore } from './mock/store'
import { FirebaseApi } from './firebase/firebaseApi'

function createApi(): BankApi {
  const env = import.meta.env
  if (env.VITE_BACKEND === 'firebase') {
    return new FirebaseApi({
      config: {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      },
      teacherEmail: env.VITE_TEACHER_EMAIL ?? '',
      studentEmailDomain: env.VITE_STUDENT_EMAIL_DOMAIN ?? 'students.local',
      emulator: env.VITE_USE_EMULATOR === 'true' ? { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 } : undefined,
    })
  }
  const store = new MockStore(window.localStorage)
  return new MockApi({ store, sessionStorage: window.sessionStorage, latencyMs: 80 })
}

export const api: BankApi = createApi()
export { BankError } from './types'
export type { BankApi } from './types'
