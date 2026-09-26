<script setup lang="ts">
import { useRouter } from 'vue-router'
import { api } from '../api'
import { session, signOut } from '../session'
import { useLive } from '../ui/live'
import Icon from './Icon.vue'
import logo from '../assets/logo.png'

const router = useRouter()
const pending = useLive(() => api.listPending())

const items = [
  { to: '/t', label: '儀表板', icon: 'home', exact: true },
  { to: '/t/approvals', label: '轉帳審核', icon: 'inbox', badge: true },
  { to: '/t/students', label: '學生總覽', icon: 'users' },
  { to: '/t/adjust', label: '加扣點 / 批次', icon: 'plusminus' },
  { to: '/t/group-award', label: '小組獎勵', icon: 'trophy' },
  { to: '/t/ledger', label: '交易紀錄', icon: 'list' },
  { to: '/t/presets', label: '加點項目與小確幸', icon: 'gift' },
  { to: '/t/groups', label: '分組管理', icon: 'grid' },
  { to: '/t/accounts', label: '帳號管理', icon: 'user' },
  { to: '/t/settings', label: '設定與備份', icon: 'settings' },
]

async function logout() {
  await signOut()
  router.replace('/login')
}
</script>

<template>
  <div class="t-shell">
    <aside class="side no-print">
      <RouterLink to="/t" class="brand">
        <img :src="logo" alt="HSPS" width="38" height="38">
        <span class="col" style="gap: 0">
          <b>HSPS 點數銀行</b>
          <span class="xs muted">教師後台</span>
        </span>
      </RouterLink>
      <nav class="nav" aria-label="後台選單">
        <RouterLink v-for="it in items" :key="it.to" :to="it.to" class="nav-item"
                    :active-class="it.exact ? '' : 'on'" :exact-active-class="'on'">
          <Icon :name="it.icon" :size="19" />
          <span class="grow">{{ it.label }}</span>
          <span v-if="it.badge && pending.data.value?.length" class="badge" data-testid="pending-badge">{{ pending.data.value.length }}</span>
        </RouterLink>
      </nav>
      <div class="foot">
        <span class="small muted">{{ session.user?.name }}</span>
        <button class="btn sm ghost" type="button" @click="logout"><Icon name="logout" :size="18" />登出</button>
      </div>
    </aside>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.t-shell { display: flex; min-height: 100vh; background: linear-gradient(to right, #fff 250px, var(--bg) 250px); }
.side {
  width: 250px; flex-shrink: 0; background: #fff; border-right: 1px solid var(--line);
  padding: 20px 14px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: 0; height: 100vh;
}
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); padding: 0 8px 8px; }
.nav { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow: auto; }
.nav-item { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border-radius: 12px; text-decoration: none; color: var(--ink); font-size: 15px; }
.nav-item:hover { background: #F4F8F5; }
.nav-item.on { background: var(--soft); font-weight: 700; color: var(--ink); }
.nav-item.on :deep(svg) { color: var(--brand-dark); }
.foot { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding: 10px 6px 0; }
.main { flex: 1; min-width: 0; }
@media (max-width: 1023px) {
  .t-shell { flex-direction: column; background: var(--bg); }
  .side { width: 100%; height: auto; position: static; border-right: none; border-bottom: 1px solid var(--line); }
  .nav { flex-direction: row; flex-wrap: wrap; }
  .nav-item { min-height: 38px; }
}
</style>
