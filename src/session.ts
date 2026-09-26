import { reactive } from 'vue'
import { api } from './api'
import type { User } from './domain/types'

export const session = reactive<{ user: User | null }>({ user: null })

/** 依目前登入狀態重新載入使用者；帳號被停用或不存在時自動登出 */
export async function refreshSession(): Promise<User | null> {
  await api.ready()
  if (!api.currentSession()) {
    session.user = null
    return null
  }
  try {
    session.user = await api.getMe()
  } catch {
    await api.logout()
    session.user = null
  }
  return session.user
}

export async function signOut() {
  await api.logout()
  session.user = null
}

// 其他分頁或老師改動資料時同步更新自己的帳戶（例如餘額、停用）
api.onChange(() => {
  if (session.user) refreshSession()
})
