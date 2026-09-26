<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import { CATEGORY_LABEL, type TransferCategory } from '../../domain/types'
import { confirmDialog, toast } from '../../ui/feedback'
import PendingCard from '../../components/PendingCard.vue'
import TxRow from '../../components/TxRow.vue'

const pending = useLive(() => api.listPending())
const students = useLive(() => api.listStudents())
const decided = useLive(() => api.listTransactions({ type: 'transfer', limit: 60 }))
const cat = ref<TransferCategory | ''>('')
const selected = ref<Set<string>>(new Set())

const bal = computed(() => new Map((students.data.value ?? []).map((s) => [s.uid, s.balance])))
const list = computed(() => (pending.data.value ?? []).filter((t) => !cat.value || t.category === cat.value))
const history = computed(() => (decided.data.value ?? []).filter((t) => t.status !== 'pending').slice(0, 20))
const selectable = computed(() => list.value.filter((t) => (bal.value.get(t.fromUid!) ?? 0) >= t.amount))

watch(pending.data, () => {
  const ids = new Set((pending.data.value ?? []).map((t) => t.id))
  selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
})

function toggle(id: string) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
function selectAll() {
  selected.value = new Set(selectable.value.map((t) => t.id))
}

async function approveSelected() {
  const ids = [...selected.value]
  if (!ids.length) return
  if (!(await confirmDialog({ title: `核准 ${ids.length} 筆轉帳？`, message: '將依送出時間先後逐筆核准；餘額不足的會被略過。', okText: '核准' }))) return
  const res = await api.approveMany(ids)
  const ok = res.filter((r) => r.ok).length
  const fail = res.filter((r) => !r.ok)
  if (fail.length) toast.error(new Error(`已核准 ${ok} 筆，${fail.length} 筆未核准：${fail[0].error}`))
  else toast.ok(`已核准 ${ok} 筆`)
  selected.value = new Set()
}
</script>

<template>
  <div class="page">
    <div class="row between wrap">
      <h1>轉帳審核</h1>
      <div class="row wrap">
        <select v-model="cat" class="select" style="width: auto" aria-label="分類篩選">
          <option value="">全部分類</option>
          <option v-for="(l, k) in CATEGORY_LABEL" :key="k" :value="k">{{ l }}</option>
        </select>
        <button class="btn" type="button" :disabled="!selectable.length" @click="selectAll">全選可核准的</button>
        <button class="btn primary" type="button" :disabled="!selected.size" data-testid="approve-selected" @click="approveSelected">核准所選（{{ selected.size }}）</button>
      </div>
    </div>
    <p class="notice info">核准時系統會重新檢查付款人點數；付款人扣點、收款人加點與狀態更新會同時完成（全有全無）。</p>
    <section class="col" style="gap: 10px">
      <PendingCard v-for="t in list" :key="t.id" :tx="t" :payer-balance="bal.get(t.fromUid!)" selectable
                   :selected="selected.has(t.id)" @toggle="toggle(t.id)" />
      <p v-if="pending.data.value && !list.length" class="card empty">目前沒有待審核的轉帳</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>最近處理的轉帳</h2></div>
      <div class="list">
        <TxRow v-for="t in history" :key="t.id" :tx="t" :viewer-uid="null" :to="`/t/tx/${t.id}`" />
        <p v-if="decided.data.value && !history.length" class="empty">尚無紀錄</p>
      </div>
    </section>
  </div>
</template>
