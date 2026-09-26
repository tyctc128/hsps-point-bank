import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { api } from './api'
import { refreshSession, session } from './session'

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/setup', component: () => import('./views/SetupView.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('./components/StudentShell.vue'),
    meta: { role: 'student' },
    children: [
      { path: '', component: () => import('./views/student/HomeView.vue') },
      { path: 'history', component: () => import('./views/student/HistoryView.vue') },
      { path: 'tx/:id', component: () => import('./views/student/TxDetailView.vue') },
      { path: 'perks', component: () => import('./views/student/PerksView.vue') },
      { path: 'receive', component: () => import('./views/student/ReceiveView.vue') },
      { path: 'pay', component: () => import('./views/student/PayView.vue') },
      { path: 'me', component: () => import('./views/ProfileView.vue') },
    ],
  },
  {
    path: '/t',
    component: () => import('./components/TeacherShell.vue'),
    meta: { role: 'teacher' },
    children: [
      { path: '', component: () => import('./views/teacher/DashboardView.vue') },
      { path: 'approvals', component: () => import('./views/teacher/ApprovalsView.vue') },
      { path: 'students', component: () => import('./views/teacher/StudentsView.vue') },
      { path: 'students/:uid', component: () => import('./views/teacher/StudentDetailView.vue') },
      { path: 'adjust', component: () => import('./views/teacher/AdjustView.vue') },
      { path: 'group-award', component: () => import('./views/teacher/GroupAwardView.vue') },
      { path: 'ledger', component: () => import('./views/teacher/LedgerView.vue') },
      { path: 'tx/:id', component: () => import('./views/teacher/TeacherTxView.vue') },
      { path: 'presets', component: () => import('./views/teacher/PresetsView.vue') },
      { path: 'groups', component: () => import('./views/teacher/GroupsView.vue') },
      { path: 'accounts', component: () => import('./views/teacher/AccountsView.vue') },
      { path: 'settings', component: () => import('./views/teacher/SettingsView.vue') },
      { path: 'me', component: () => import('./views/ProfileView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

// 路由守衛：只負責使用體驗；真正的權限檢查在資料層（MockApi / Security Rules）
router.beforeEach(async (to) => {
  if (to.path === '/setup') return (await api.needsSetup()) ? true : '/login'
  if (to.meta.public) {
    if (await api.needsSetup()) return '/setup'
    const u = session.user ?? (await refreshSession())
    if (u) return u.role === 'teacher' ? '/t' : '/'
    return true
  }
  const u = session.user ?? (await refreshSession())
  if (!u) {
    // 保留付款連結（用 iPad 相機掃 QR 時，登入後直接回到付款頁）
    return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} }
  }
  const need = to.matched.find((r) => r.meta.role)?.meta.role
  if (need && need !== u.role) return u.role === 'teacher' ? '/t' : '/'
  return true
})
