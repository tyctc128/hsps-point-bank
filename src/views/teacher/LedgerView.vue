<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import { CATEGORY_LABEL, TYPE_LABEL, type TransferCategory, type TxType } from '../../domain/types'
import { formatPoints } from '../../domain/money'
import { dateKey, dateKeyToMs, formatDateTime } from '../../domain/dates'
import { describeTx } from '../../ui/txView'
import { exportTransactions } from '../../ui/excel'
import { reverseBatchById, reverseTx } from '../../ui/actions'

const route = useRoute()
const router = useRouter()
const all = useLive(() => api.listTransactions())
const students = useLive(() => api.listStudents())
const groups = useLive(() => api.listGroups())

const DAY = 86_400_000
const from = ref(dateKey(Date.now() - 30 * DAY))
const to = ref(dateKey(Date.now()))
const type = ref<TxType | ''>('')
const uid = ref('')
const gid = ref('')
const status = ref<'' | 'pending' | 'approved' | 'rejected' | 'reversed'>('')
const cat = ref<TransferCategory | ''>('')
const batch = ref(typeof route.query.batch === 'string' ? route.query.batch : '')
const shown = ref(100)

const groupOf = computed(() => new Map((students.data.value ?? []).map((s) => [s.uid, s.groupId])))
const rows = computed(() => {
  let list = all.data.value ?? []
  if (batch.value) return list.filter((t) => t.batchId === batch.value)
  const f = from.value ? dateKeyToMs(from.value) : -Infinity
  const t2 = to.value ? dateKeyToMs(to.value) + DAY : Infinity
  list = list.filter((t) => t.createdAt >= f && t.createdAt < t2)
  if (type.value) list = list.filter((t) => t.type === type.value)
  if (uid.value) list = list.filter((t) => t.participants.includes(uid.value))
  if (gid.value) list = list.filter((t) => t.participants.some((p) => groupOf.value.get(p) === gid.value))
  if (status.value === 'reversed') list = list.filter((t) => !!t.reversedBy)
  else if (status.value) list = list.filter((t) => t.status === status.value && !t.reversedBy)
  if (cat.value) list = list.filter((t) => t.category === cat.value)
  return list
})
const batchCount = computed(() => (all.data.value ?? []).filter((t) => t.batchId === batch.value && t.type !== 'reversal' && t.status === 'approved' && !t.reversedBy).length)

function reset() {
  type.value = ''; uid.value = ''; gid.value = ''; status.value = ''; cat.value = ''; batch.value = ''
  router.replace('/t/ledger')
}
</script>

<template>
  <div class="page" style="max-width: 1320px">
    <div class="row between wrap">
      <h1>交易紀錄</h1>
      <div class="row">
        <button class="btn" type="button" @click="exportTransactions(rows, 'csv')">匯出 CSV</button>
        <button class="btn primary" type="button" data-testid="export-xlsx" @click="exportTransactions(rows, 'xlsx')">匯出 Excel</button>
      </div>
    </div>

    <div v-if="batch" class="notice info row between wrap">
      <span>正在檢視批次 <b class="num">{{ batch }}</b>（{{ rows.length }} 筆）</span>
      <div class="row">
        <button v-if="batchCount" class="btn sm danger" type="button" @click="reverseBatchById(batch, batchCount)">整批沖正（{{ batchCount }} 筆）</button>
        <button class="btn sm" type="button" @click="reset">清除篩選</button>
      </div>
    </div>
    <div v-else class="card tight filters">
      <label class="field"><span class="label">起</span><input v-model="from" class="input" type="date"></label>
      <label class="field"><span class="label">迄</span><input v-model="to" class="input" type="date"></label>
      <label class="field"><span class="label">類型</span>
        <select v-model="type" class="select"><option value="">全部</option><option v-for="(l, k) in TYPE_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
      <label class="field"><span class="label">學生</span>
        <select v-model="uid" class="select"><option value="">全部</option><option v-for="s in students.data.value ?? []" :key="s.uid" :value="s.uid">{{ s.seatNo }} {{ s.name }}</option></select></label>
      <label class="field"><span class="label">組別</span>
        <select v-model="gid" class="select"><option value="">全部</option><option v-for="g in groups.data.value ?? []" :key="g.id" :value="g.id">{{ g.name }}</option></select></label>
      <label class="field"><span class="label">狀態</span>
        <select v-model="status" class="select"><option value="">全部</option><option value="pending">審核中</option><option value="approved">已完成</option><option value="rejected">已駁回</option><option value="reversed">已沖正</option></select></label>
      <label class="field"><span class="label">轉帳分類</span>
        <select v-model="cat" class="select"><option value="">全部</option><option v-for="(l, k) in CATEGORY_LABEL" :key="k" :value="k">{{ l }}</option></select></label>
      <button class="btn" type="button" style="align-self: flex-end" @click="reset">清除</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>時間</th><th>類型</th><th>內容</th><th>分類 / 事由</th><th class="r">點數</th><th>狀態</th><th /></tr></thead>
        <tbody>
          <tr v-for="t in rows.slice(0, shown)" :key="t.id" data-testid="ledger-row">
            <td class="num small" style="white-space: nowrap">{{ formatDateTime(t.createdAt) }}</td>
            <td><span class="pill" :class="t.type === 'reversal' ? 'gray' : t.type === 'transfer' ? 'ink' : 'green'">{{ TYPE_LABEL[t.type] }}</span></td>
            <td>
              <RouterLink :to="`/t/tx/${t.id}`" :class="{ strike: !!t.reversedBy }" style="text-decoration: none; color: var(--ink); font-weight: 700">{{ describeTx(t, null).title }}</RouterLink>
              <div v-if="t.batchId" class="xs"><RouterLink :to="`/t/ledger?batch=${t.batchId}`" @click="batch = t.batchId!">批次</RouterLink></div>
            </td>
            <td class="small">{{ t.category ? CATEGORY_LABEL[t.category] + ' · ' : '' }}{{ t.note }}<span v-if="t.rejectReason" class="out">（駁回：{{ t.rejectReason }}）</span></td>
            <td class="r num bold">{{ formatPoints(t.amount) }}</td>
            <td><span class="pill" :class="t.reversedBy ? 'gray' : t.status === 'pending' ? 'amber' : t.status === 'rejected' ? 'gray' : 'green'">{{ t.reversedBy ? '已沖正' : t.status === 'pending' ? '審核中' : t.status === 'rejected' ? '已駁回' : '已完成' }}</span></td>
            <td class="r">
              <button v-if="t.status === 'approved' && !t.reversedBy && t.type !== 'reversal'" class="btn sm danger" type="button" data-testid="reverse" @click="reverseTx(t)">沖正</button>
            </td>
          </tr>
          <tr v-if="all.data.value && !rows.length"><td colspan="7" class="empty">沒有符合條件的交易</td></tr>
        </tbody>
      </table>
    </div>
    <button v-if="rows.length > shown" class="btn" type="button" @click="shown += 100">顯示更多（還有 {{ rows.length - shown }} 筆）</button>
  </div>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.filters .input, .filters .select { min-height: 40px; padding: 6px 10px; font-size: 15px; }
</style>
