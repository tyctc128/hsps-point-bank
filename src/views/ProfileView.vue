<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { session, signOut } from '../session'
import { errorMessage, toast } from '../ui/feedback'

const router = useRouter()
const oldPw = ref('')
const newPw = ref('')
const newPw2 = ref('')
const error = ref('')
const busy = ref(false)
const min = session.user?.role === 'teacher' ? 8 : 6

async function change() {
  error.value = ''
  if (newPw.value.length < min) return (error.value = `新密碼至少 ${min} 碼`)
  if (newPw.value !== newPw2.value) return (error.value = '兩次輸入的新密碼不同')
  busy.value = true
  try {
    await api.changePassword(oldPw.value, newPw.value)
    oldPw.value = newPw.value = newPw2.value = ''
    toast.ok('密碼已更新')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

async function logout() {
  await signOut()
  router.replace('/login')
}
</script>

<template>
  <div class="page" style="max-width: 560px">
    <h1>個人資料</h1>
    <section class="card col">
      <div class="row between"><span class="muted">姓名</span><b>{{ session.user?.name }}</b></div>
      <div class="row between"><span class="muted">帳號</span><b class="num">{{ session.user?.account }}</b></div>
      <div v-if="session.user?.role === 'student'" class="row between"><span class="muted">座號</span><b>{{ session.user?.seatNo }}</b></div>
    </section>
    <form class="card col" @submit.prevent="change" novalidate>
      <h2>修改密碼</h2>
      <div class="field"><label for="o">目前密碼</label><input id="o" v-model="oldPw" class="input" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="n1">新密碼（至少 {{ min }} 碼）</label><input id="n1" v-model="newPw" class="input" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="n2">再輸入一次新密碼</label><input id="n2" v-model="newPw2" class="input" type="password" autocomplete="new-password"></div>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="btn primary" type="submit" :disabled="busy">更新密碼</button>
    </form>
    <button class="btn danger" type="button" @click="logout">登出</button>
  </div>
</template>
