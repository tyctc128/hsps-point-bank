<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { refreshSession } from '../session'
import { errorMessage } from '../ui/feedback'
import { BankError } from '../api/types'
import logo from '../assets/logo.png'

const router = useRouter()
const route = useRoute()
const account = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const diag = computed(() => api.mockDiagnostics?.() ?? null)
const host = location.host

async function submit() {
  error.value = ''
  if (!account.value.trim() || !password.value) {
    error.value = '請輸入帳號與密碼'
    return
  }
  busy.value = true
  try {
    const s = await api.login(account.value, password.value)
    await refreshSession()
    const next = typeof route.query.next === 'string' ? route.query.next : ''
    if (s.role === 'teacher') router.replace('/t')
    else router.replace(next.startsWith('/') && !next.startsWith('/t') ? next : '/')
  } catch (e) {
    error.value = errorMessage(e)
    // 模擬資料庫：帳號不在「這個網址」的資料庫時，直接說明原因
    const d = api.mockDiagnostics?.(account.value)
    if (e instanceof BankError && e.code === 'INVALID_CREDENTIALS' && d && d.accountExists === false) {
      error.value = `這個網址（${location.host}）的資料庫裡沒有帳號「${account.value.trim()}」。模擬資料庫的資料依網址、瀏覽器分開存放，請在「這個網址」用教師帳號匯入名冊。`
    }
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <form class="card box" @submit.prevent="submit" novalidate>
      <img :src="logo" alt="HSPS logo" width="104" height="104" class="logo">
      <h1>HSPS 點數銀行</h1>
      <p class="muted">登入查看你的點數</p>
      <div class="field">
        <label for="acc">帳號</label>
        <input id="acc" v-model="account" class="input" autocomplete="username" autocapitalize="off" autocorrect="off"
               spellcheck="false" placeholder="例如 hs000001">
      </div>
      <div class="field">
        <label for="pw">密碼</label>
        <input id="pw" v-model="password" class="input" type="password" autocomplete="current-password">
      </div>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="btn primary lg block" type="submit" :disabled="busy">{{ busy ? '登入中…' : '登入' }}</button>
      <p class="hint center">忘記密碼請洽老師重設</p>
      <p v-if="diag" class="xs faint center" data-testid="mock-diag">
        目前使用模擬資料庫：這個網址（{{ host }}）有 {{ diag.studentCount }} 位學生帳號。<br>資料只存在這個網址與瀏覽器，換網址或裝置就看不到。
      </p>
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.box { width: min(420px, 100%); display: flex; flex-direction: column; gap: 16px; padding: 32px 28px; align-items: stretch; text-align: left; }
.logo { align-self: center; }
h1 { text-align: center; }
.box > p.muted { text-align: center; margin-top: -8px; }
.center { text-align: center; }
</style>
