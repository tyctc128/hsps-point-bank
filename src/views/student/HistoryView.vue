<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api'
import { session } from '../../session'
import { useLive } from '../../ui/live'
import { runningBalances } from '../../domain/ledger'
import TxRow from '../../components/TxRow.vue'

type F = 'all' | 'in' | 'out' | 'pending'
const route = useRoute()
const filter = ref<F>((['all', 'in', 'out', 'pending'] as F[]).includes(route.query.f as F) ? (route.query.f as F) : 'all')
const shown = ref(30)
const txs = useLive(() => api.listMyTransactions())
const uid = computed(() => session.user?.uid ?? '')

const balances = computed(() => runningBalances(txs.data.value ?? [], session.user?.balance ?? 0, uid.value))
const filtered = computed(() => {
  const list = txs.data.value ?? []
  switch (filter.value) {
    case 'in': return list.filter((t) => t.toUid === uid.value && t.status === 'approved')
    case 'out': return list.filter((t) => t.fromUid === uid.value && t.status === 'approved')
    case 'pending': return list.filter((t) => t.status === 'pending')
    default: return list
  }
})
const labels: [F, string][] = [['all', '全部'], ['in', '收入'], ['out', '支出'], ['pending', '審核中']]
</script>

<template>
  <div class="page" style="max-width: 860px">
    <div class="row between wrap">
      <h1>交易明細</h1>
      <div class="row wrap" style="gap: 6px" role="group" aria-label="篩選">
        <button v-for="[k, l] in labels" :key="k" class="chip" :class="{ on: filter === k }" type="button"
                :aria-pressed="filter === k" @click="filter = k; shown = 30">{{ l }}</button>
      </div>
    </div>
    <section class="card">
      <div class="list">
        <TxRow v-for="t in filtered.slice(0, shown)" :key="t.id" :tx="t" :viewer-uid="uid" :balance-after="balances.get(t.id)" />
        <p v-if="txs.data.value && !filtered.length" class="empty">沒有符合的交易</p>
      </div>
      <button v-if="filtered.length > shown" class="btn block" type="button" style="margin-top: 12px" @click="shown += 30">
        顯示更多（還有 {{ filtered.length - shown }} 筆）
      </button>
    </section>
    <p class="hint">「結餘」是該筆交易完成後你的點數。審核中與已駁回的轉帳不影響點數。</p>
  </div>
</template>
