<script setup lang="ts">
import { computed } from 'vue'
import { api } from '../../api'
import { session } from '../../session'
import { useLive } from '../../ui/live'
import { formatPoints, formatSigned } from '../../domain/money'
import { dateKey, formatDate, startOfDay } from '../../domain/dates'
import PendingCard from '../../components/PendingCard.vue'
import TxRow from '../../components/TxRow.vue'
import Icon from '../../components/Icon.vue'

const students = useLive(() => api.listStudents())
const pending = useLive(() => api.listPending())
const today = useLive(() => api.listTransactions({ from: startOfDay(Date.now()) }))
const recent = useLive(() => api.listTransactions({ limit: 8 }))
const awards = useLive(() => api.listGroupAwards())

const bal = computed(() => new Map((students.data.value ?? []).map((s) => [s.uid, s.balance])))
const total = computed(() => (students.data.value ?? []).reduce((a, s) => a + s.balance, 0))
const issued = computed(() => (today.data.value ?? []).filter((t) => t.status === 'approved' && !t.fromUid && t.toUid).reduce((a, t) => a + t.amount, 0))
const deducted = computed(() => (today.data.value ?? []).filter((t) => t.status === 'approved' && t.fromUid && !t.toUid).reduce((a, t) => a + t.amount, 0))
const todayAward = computed(() => (awards.data.value ?? []).find((a) => a.awardDate === dateKey(Date.now()) && !a.reversed))
const hour = new Date().getHours()
const greet = hour < 11 ? '早安' : hour < 14 ? '午安' : '您好'
</script>

<template>
  <div class="page">
    <div class="row between wrap">
      <div class="col" style="gap: 2px">
        <span class="small muted">{{ formatDate(Date.now()) }} · 全班 {{ students.data.value?.length ?? 0 }} 人</span>
        <h1>{{ greet }}，{{ session.user?.name }}</h1>
      </div>
      <div class="row wrap">
        <RouterLink to="/t/adjust" class="btn outline"><Icon name="plusminus" :size="18" />加扣點 / 批次</RouterLink>
        <RouterLink to="/t/group-award" class="btn primary"><Icon name="trophy" :size="18" />小組獎勵</RouterLink>
      </div>
    </div>

    <div class="stats">
      <RouterLink to="/t/approvals" class="stat hi" style="text-decoration: none">
        <span class="label">待審核轉帳</span><span class="value num" data-testid="stat-pending">{{ pending.data.value?.length ?? 0 }} 筆</span>
      </RouterLink>
      <div class="stat"><span class="label">今日發出</span><span class="value num in">{{ formatSigned(issued) }}</span></div>
      <div class="stat"><span class="label">今日扣除</span><span class="value num out">{{ formatSigned(-deducted) }}</span></div>
      <div class="stat"><span class="label">全班總點數</span><span class="value num">{{ formatPoints(total) }}</span></div>
    </div>

    <div class="grid-2" style="grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr)">
      <section class="card">
        <div class="card-head">
          <h2>待審核轉帳</h2>
          <RouterLink to="/t/approvals" class="small bold" style="text-decoration: none">全部 →</RouterLink>
        </div>
        <div class="col" style="gap: 10px">
          <PendingCard v-for="t in (pending.data.value ?? []).slice(0, 5)" :key="t.id" :tx="t" :payer-balance="bal.get(t.fromUid!)" />
          <p v-if="pending.data.value && !pending.data.value.length" class="empty">目前沒有待審核的轉帳</p>
        </div>
      </section>

      <div class="col" style="gap: 20px">
        <section class="card dark">
          <div class="card-head"><h2>今日小組獎勵</h2></div>
          <template v-if="todayAward">
            <p>已發放：冠軍 {{ todayAward.champions.map((c) => c.name).join('、') || '—' }}；亞軍 {{ todayAward.runnersUp.map((c) => c.name).join('、') || '—' }}</p>
            <p class="num" style="font-size: 26px; font-weight: 800; margin-top: 6px">{{ todayAward.recipients.length }} 人 · {{ formatPoints(todayAward.total) }} 點</p>
          </template>
          <p v-else style="color: var(--soft-2)">今天還沒有發放</p>
          <RouterLink to="/t/group-award" class="btn brand" style="margin-top: 14px">前往小組獎勵</RouterLink>
        </section>
        <section class="card">
          <div class="card-head">
            <h2>最新交易</h2>
            <RouterLink to="/t/ledger" class="small bold" style="text-decoration: none">交易紀錄 →</RouterLink>
          </div>
          <div class="list">
            <TxRow v-for="t in recent.data.value ?? []" :key="t.id" :tx="t" :viewer-uid="null" :to="`/t/tx/${t.id}`" />
            <p v-if="recent.data.value && !recent.data.value.length" class="empty">還沒有交易</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
