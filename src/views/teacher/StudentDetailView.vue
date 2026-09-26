<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import type { Preset } from '../../domain/types'
import { formatPoints, parseAmount, validateAmount } from '../../domain/money'
import { runningBalances } from '../../domain/ledger'
import { confirmDialog, errorMessage, promptDialog, toast } from '../../ui/feedback'
import { undoAction } from '../../ui/actions'
import TxRow from '../../components/TxRow.vue'
import Icon from '../../components/Icon.vue'

const route = useRoute()
const router = useRouter()
const uid = String(route.params.uid)
const student = useLive(() => api.getStudent(uid))
const txs = useLive(() => api.listTransactions({ uid }))
const presets = useLive(() => api.listPresets())
const groups = useLive(() => api.listGroups())
const shown = ref(30)
const custom = ref({ kind: 'add' as 'add' | 'deduct', amount: '', title: '', note: '' })
const customErr = ref('')

const balances = computed(() => runningBalances(txs.data.value ?? [], student.data.value?.balance ?? 0, uid))
const active = computed(() => (presets.data.value ?? []).filter((p) => p.active))

async function applyPreset(p: Preset) {
  const s = student.data.value!
  try {
    const r = await api.adjust({ uids: [uid], kind: p.kind, amount: p.amount, title: p.name, note: '', presetId: p.id })
    toast.ok(`${s.name} ${p.kind === 'add' ? '+' : '−'}${formatPoints(p.amount)}（${p.name}）`, undoAction(r))
  } catch (e) { toast.error(e) }
}

async function applyCustom() {
  customErr.value = ''
  const aErr = validateAmount(custom.value.amount)
  if (aErr) return (customErr.value = aErr)
  if (!custom.value.title.trim()) return (customErr.value = '請填寫項目名稱')
  try {
    const r = await api.adjust({ uids: [uid], kind: custom.value.kind, amount: parseAmount(custom.value.amount), title: custom.value.title, note: custom.value.note })
    toast.ok('已完成', undoAction(r))
    custom.value = { kind: custom.value.kind, amount: '', title: '', note: '' }
  } catch (e) { customErr.value = errorMessage(e) }
}

async function setGroup(ev: Event) {
  const v = (ev.target as HTMLSelectElement).value
  try { await api.assignGroup(uid, v || null); toast.ok('已更新組別') } catch (e) { toast.error(e) }
}

async function edit() {
  const s = student.data.value!
  const name = await promptDialog({ title: '修改姓名', label: '姓名', placeholder: s.name, okText: '儲存', maxLength: 20 })
  if (!name) return
  try { await api.updateStudent(uid, { name }); toast.ok('已更新') } catch (e) { toast.error(e) }
}

async function toggleActive() {
  const s = student.data.value!
  const ok = await confirmDialog({
    title: s.active ? `停用 ${s.name} 的帳號？` : `啟用 ${s.name} 的帳號？`,
    message: s.active ? '停用後無法登入，也不能收付款；點數與紀錄都會保留。' : '啟用後可以再次登入。',
    danger: s.active, okText: s.active ? '停用' : '啟用',
  })
  if (!ok) return
  try { await api.updateStudent(uid, { active: !s.active }); toast.ok('已更新') } catch (e) { toast.error(e) }
}

async function removeStudent() {
  const s = student.data.value!
  const ok = await confirmDialog({
    title: `刪除 ${s.name} 的帳號？`,
    message: `帳號與登入資料會被刪除，無法復原；交易紀錄會保留，審核中的轉帳會自動駁回。${s.balance > 0 ? `
目前 ${formatPoints(s.balance)} 點會一併消失。` : ''}

只是暫時不用的話，建議改用「停用帳號」。`,
    danger: true, okText: '繼續刪除',
  })
  if (!ok) return
  const word = await promptDialog({ title: '最後確認', label: '請輸入「刪除」兩個字', okText: '刪除帳號', danger: true })
  if (word !== '刪除') return
  try {
    await api.deleteStudents([uid])
    toast.ok(`已刪除 ${s.name} 的帳號`)
    router.replace('/t/students')
  } catch (e) { toast.error(e) }
}

async function resetPw() {
  const s = student.data.value!
  const pw = await promptDialog({ title: `重設 ${s.name} 的密碼`, message: '請把新密碼告訴學生，並提醒登入後自行修改。', label: '新密碼（至少 6 碼）', okText: '重設', maxLength: 64 })
  if (!pw) return
  try { await api.resetPassword(uid, pw); toast.ok('密碼已重設') } catch (e) { toast.error(e) }
}
</script>

<template>
  <div class="page">
    <RouterLink to="/t/students" class="btn ghost sm" style="align-self: flex-start"><Icon name="arrow-left" :size="18" />學生總覽</RouterLink>
    <p v-if="student.error.value" class="notice err">{{ student.error.value }}</p>
    <template v-if="student.data.value">
      <div class="row between wrap">
        <div class="col" style="gap: 2px">
          <span class="muted">{{ student.data.value.seatNo }} 號 · {{ student.data.value.account }}</span>
          <h1>{{ student.data.value.name }} <span v-if="!student.data.value.active" class="pill gray">已停用</span></h1>
        </div>
        <div class="balance-box">
          <span class="small bold">目前點數</span>
          <span class="num" data-testid="student-balance">{{ formatPoints(student.data.value.balance) }}</span>
        </div>
      </div>

      <div class="grid-side">
        <div class="col" style="gap: 18px">
          <section class="card col">
            <h2>一鍵加扣點</h2>
            <div class="presets">
              <button v-for="p in active" :key="p.id" class="btn preset" :class="p.kind" type="button" @click="applyPreset(p)">
                <span>{{ p.name }}</span><span class="num">{{ p.kind === 'add' ? '+' : '−' }}{{ formatPoints(p.amount) }}</span>
              </button>
            </div>
            <details>
              <summary class="bold" style="cursor: pointer">自訂加扣點</summary>
              <form class="col" style="margin-top: 12px" @submit.prevent="applyCustom">
                <div class="row">
                  <button class="chip" :class="{ on: custom.kind === 'add' }" type="button" @click="custom.kind = 'add'">加點</button>
                  <button class="chip" :class="{ on: custom.kind === 'deduct' }" type="button" @click="custom.kind = 'deduct'">扣點</button>
                </div>
                <input v-model="custom.amount" class="input num" inputmode="numeric" placeholder="點數" aria-label="點數">
                <input v-model="custom.title" class="input" maxlength="20" placeholder="項目名稱（例如：幫忙搬書）" aria-label="項目名稱">
                <input v-model="custom.note" class="input" maxlength="50" placeholder="事由（選填）" aria-label="事由">
                <p v-if="customErr" class="error-text">{{ customErr }}</p>
                <button class="btn primary" type="submit">送出</button>
              </form>
            </details>
          </section>
          <section class="card col">
            <h2>帳號</h2>
            <div class="field">
              <label for="grp">組別</label>
              <select id="grp" class="select" :value="student.data.value.groupId ?? ''" @change="setGroup">
                <option value="">未分組</option>
                <option v-for="g in groups.data.value ?? []" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </div>
            <div class="row wrap">
              <button class="btn sm" type="button" @click="edit"><Icon name="edit" :size="16" />修改姓名</button>
              <button class="btn sm" type="button" @click="resetPw">重設密碼</button>
              <button class="btn sm danger" type="button" @click="toggleActive">{{ student.data.value.active ? '停用帳號' : '啟用帳號' }}</button>
              <button class="btn sm danger-fill" type="button" @click="removeStudent">刪除帳號</button>
            </div>
          </section>
        </div>

        <section class="card">
          <div class="card-head"><h2>交易明細</h2><span class="small muted">{{ txs.data.value?.length ?? 0 }} 筆</span></div>
          <div class="list">
            <TxRow v-for="t in (txs.data.value ?? []).slice(0, shown)" :key="t.id" :tx="t" :viewer-uid="uid" :balance-after="balances.get(t.id)" :to="`/t/tx/${t.id}`" />
            <p v-if="txs.data.value && !txs.data.value.length" class="empty">還沒有交易</p>
          </div>
          <button v-if="(txs.data.value?.length ?? 0) > shown" class="btn block" type="button" style="margin-top: 10px" @click="shown += 30">顯示更多</button>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.balance-box { background: var(--brand); color: var(--ink); border-radius: 20px; padding: 12px 22px; display: flex; flex-direction: column; align-items: flex-end; }
.balance-box .num { font-size: 40px; font-weight: 800; line-height: 1.1; }
.presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.preset { justify-content: space-between; min-height: 48px; }
.preset.add { background: var(--soft); border-color: var(--soft-2); }
.preset.add .num { color: var(--brand-dark); }
.preset.deduct { background: var(--red-soft); border-color: #F4C7C3; }
.preset.deduct .num { color: var(--red); }
</style>
