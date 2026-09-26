<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { loadDemoData } from '../api/mock/demo'
import { refreshSession } from '../session'
import { errorMessage } from '../ui/feedback'
import logo from '../assets/logo.png'

const router = useRouter()
const name = ref('')
const pw = ref('')
const pw2 = ref('')
const demo = ref(false)
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (!name.value.trim()) return (error.value = '請輸入老師姓名')
  if (pw.value.length < 8) return (error.value = '密碼至少 8 碼')
  if (pw.value !== pw2.value) return (error.value = '兩次輸入的密碼不同')
  busy.value = true
  try {
    await api.setupTeacher(name.value, pw.value)
    await api.login('teacher', pw.value)
    await refreshSession()
    if (demo.value) await loadDemoData(api)
    router.replace(demo.value ? '/t' : '/t/accounts')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <form class="card box" @submit.prevent="submit" novalidate>
      <img :src="logo" alt="HSPS logo" width="80" height="80" style="align-self: center">
      <h1 style="text-align: center">建立教師帳號</h1>
      <p class="muted" style="text-align: center">第一次使用：設定老師的登入密碼。教師帳號為 <b>teacher</b>。</p>
      <div class="field">
        <label for="n">老師姓名（顯示用）</label>
        <input id="n" v-model="name" class="input" maxlength="20" placeholder="例如 王老師">
      </div>
      <div class="field">
        <label for="p1">密碼（至少 8 碼）</label>
        <input id="p1" v-model="pw" class="input" type="password" autocomplete="new-password">
      </div>
      <div class="field">
        <label for="p2">再輸入一次密碼</label>
        <input id="p2" v-model="pw2" class="input" type="password" autocomplete="new-password">
      </div>
      <label class="check"><input v-model="demo" type="checkbox">同時載入示範資料（31 位虛構學生，密碼皆為 demo1234）</label>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="btn primary lg block" type="submit" :disabled="busy">{{ busy ? '建立中…' : '建立並登入' }}</button>
      <p class="hint">建立後請到「帳號管理」匯入班級名冊（account.xlsx）。</p>
    </form>
  </div>
</template>

<style scoped>
.wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.box { width: min(460px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 30px 28px; }
</style>
