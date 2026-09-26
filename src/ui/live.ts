import { onMounted, onUnmounted, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { api } from '../api'
import { errorMessage } from './feedback'

/**
 * 即時資料：掛載時載入，之後資料庫任何變動（包含其他分頁 / 裝置）就重新載入。
 * 對應 Firestore 的 onSnapshot。
 */
export function useLive<T>(loader: () => Promise<T>): {
  data: ShallowRef<T | null>
  error: Ref<string>
  loading: Ref<boolean>
  reload: () => Promise<void>
} {
  const data = shallowRef<T | null>(null)
  const error = ref('')
  const loading = ref(true)
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function reload() {
    const my = ++seq
    try {
      const v = await loader()
      if (my === seq) { data.value = v; error.value = '' }
    } catch (e) {
      if (my === seq) error.value = errorMessage(e)
    } finally {
      if (my === seq) loading.value = false
    }
  }

  let off: (() => void) | null = null
  onMounted(() => {
    reload()
    off = api.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(reload, 30)
    })
  })
  onUnmounted(() => {
    off?.()
    if (timer) clearTimeout(timer)
  })
  return { data, error, loading, reload }
}
