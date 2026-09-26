<script setup lang="ts">
import { useRouter } from 'vue-router'
import { session, signOut } from '../session'
import Icon from './Icon.vue'
import logo from '../assets/logo.png'

const router = useRouter()
async function logout() {
  await signOut()
  router.replace('/login')
}
</script>

<template>
  <div class="shell">
    <header class="top no-print">
      <RouterLink to="/" class="brand">
        <img :src="logo" alt="HSPS" width="42" height="42">
        <span>HSPS 點數銀行</span>
      </RouterLink>
      <nav class="tabs" aria-label="主要頁面">
        <RouterLink to="/" class="tab" exact-active-class="on"><Icon name="home" :size="18" />首頁</RouterLink>
        <RouterLink to="/history" class="tab" active-class="on"><Icon name="list" :size="18" />明細</RouterLink>
        <RouterLink to="/perks" class="tab" active-class="on"><Icon name="gift" :size="18" />小確幸</RouterLink>
      </nav>
      <div class="me">
        <RouterLink to="/me" class="who">
          <span class="name">{{ session.user?.name }}</span>
          <span class="seat">{{ session.user?.seatNo }} 號</span>
        </RouterLink>
        <button class="btn sm ghost" type="button" @click="logout"><Icon name="logout" :size="18" /><span class="hide-sm">登出</span></button>
      </div>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.top {
  max-width: 1200px; margin: 0 auto; padding: 16px 28px 0;
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); font-weight: 900; font-size: 20px; }
.tabs { display: flex; gap: 4px; background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 4px; }
.tab { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 18px; border-radius: 999px; text-decoration: none; color: var(--ink); font-size: 15px; }
.tab.on { background: var(--ink); color: #fff; font-weight: 700; }
.me { display: flex; align-items: center; gap: 6px; }
.who { display: flex; flex-direction: column; align-items: flex-end; text-decoration: none; line-height: 1.25; padding: 4px 8px; border-radius: 10px; }
.who:hover { background: var(--soft); }
.who .name { color: var(--ink); font-weight: 700; }
.who .seat { color: var(--muted); font-size: 13px; }
@media (max-width: 767px) {
  .top { padding: 12px 16px 0; }
  .tabs { order: 3; width: 100%; justify-content: space-between; }
  .tab { flex: 1; justify-content: center; padding: 0 8px; }
  .hide-sm { display: none; }
}
</style>
