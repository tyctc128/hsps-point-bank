<script setup lang="ts">
import { computed } from 'vue'
import { api } from '../../api'
import { session } from '../../session'
import { useLive } from '../../ui/live'
import { formatPoints, formatSigned } from '../../domain/money'
import { periodTotals } from '../../domain/ledger'
import { startOfWeek } from '../../domain/dates'
import TxRow from '../../components/TxRow.vue'
import Icon from '../../components/Icon.vue'

const txs = useLive(() => api.listMyTransactions())
const presets = useLive(() => api.listVisiblePresets())
const groups = useLive(() => api.listGroups())

const me = computed(() => session.user)
const groupName = computed(() => groups.data.value?.find((g) => g.id === me.value?.groupId)?.name ?? '')
const week = computed(() => periodTotals(txs.data.value ?? [], me.value?.uid ?? '', startOfWeek(Date.now())))
const pendingOut = computed(() => (txs.data.value ?? []).filter((t) => t.status === 'pending' && t.fromUid === me.value?.uid).length)
const pendingIn = computed(() => (txs.data.value ?? []).filter((t) => t.status === 'pending' && t.toUid === me.value?.uid).length)
const recent = computed(() => (txs.data.value ?? []).slice(0, 6))
const perks = computed(() => (presets.data.value ?? []).filter((p) => p.kind === 'deduct').slice(0, 3))
</script>

<template>
  <div class="page">
    <div class="grid-side">
      <div class="col" style="gap: 18px">
        <section class="balance" aria-label="我的點數">
          <div class="row between">
            <span class="bold">我的點數</span>
            <span v-if="groupName" class="grp">{{ groupName }}</span>
          </div>
          <div class="row" style="align-items: baseline; gap: 8px">
            <span class="big num" data-testid="balance">{{ formatPoints(me?.balance ?? 0) }}</span>
            <span class="unit">點</span>
          </div>
          <div class="week">
            <div><span class="xs">本週收入</span><b class="num">{{ formatSigned(week.income) }}</b></div>
            <div><span class="xs">本週支出</span><b class="num">{{ formatSigned(-week.expense) }}</b></div>
          </div>
          <RouterLink v-if="pendingOut || pendingIn" to="/history?f=pending" class="pending">
            <Icon name="clock" :size="18" />
            <span v-if="pendingOut">{{ pendingOut }} 筆轉出等待老師審核</span>
            <span v-if="pendingOut && pendingIn">、</span>
            <span v-if="pendingIn">{{ pendingIn }} 筆轉入等待老師審核</span>
          </RouterLink>
        </section>

        <div class="actions">
          <RouterLink to="/receive" class="act dark" data-testid="go-receive">
            <Icon name="qr" :size="40" />
            <span class="t">收款</span>
            <span class="s">出示我的 QR 碼</span>
          </RouterLink>
          <RouterLink to="/pay" class="act light" data-testid="go-pay">
            <Icon name="scan" :size="40" />
            <span class="t">付款</span>
            <span class="s">掃碼或輸入代碼</span>
          </RouterLink>
        </div>

        <section class="card tight">
          <div class="card-head" style="margin-bottom: 8px">
            <h2>小確幸</h2>
            <RouterLink to="/perks" class="small bold" style="text-decoration: none">看全部 →</RouterLink>
          </div>
          <div class="perks">
            <RouterLink v-for="p in perks" :key="p.id" to="/perks" class="perk" :class="{ no: (me?.balance ?? 0) < p.amount }">
              <span class="small bold">{{ p.name }}</span>
              <span class="num bold" style="font-size: 18px">{{ formatPoints(p.amount) }}</span>
              <span class="xs bold" :class="(me?.balance ?? 0) >= p.amount ? 'in' : 'muted'">
                {{ (me?.balance ?? 0) >= p.amount ? '點數足夠' : `還差 ${formatPoints(p.amount - (me?.balance ?? 0))} 點` }}
              </span>
            </RouterLink>
            <p v-if="!perks.length" class="small muted">老師還沒有設定小確幸</p>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card-head">
          <h2>最近交易</h2>
          <RouterLink to="/history" class="small bold" style="text-decoration: none">全部明細 →</RouterLink>
        </div>
        <div class="list">
          <TxRow v-for="t in recent" :key="t.id" :tx="t" :viewer-uid="me?.uid ?? null" />
          <p v-if="txs.data.value && !recent.length" class="empty">還沒有任何交易</p>
          <p v-if="txs.error.value" class="error-text">{{ txs.error.value }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.balance { background: var(--brand); color: var(--ink); border-radius: 28px; padding: 24px 26px; display: flex; flex-direction: column; gap: 14px; }
.grp { background: #fff; border-radius: 999px; padding: 3px 12px; font-size: 13px; font-weight: 700; }
.big { font-size: clamp(56px, 8vw, 80px); font-weight: 800; line-height: 1; letter-spacing: -1px; }
.unit { font-size: 22px; font-weight: 700; }
.week { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.week > div { background: rgba(255,255,255,.4); border-radius: 16px; padding: 8px 14px; display: flex; flex-direction: column; }
.week b { font-size: 22px; }
.pending { display: flex; align-items: center; gap: 8px; background: var(--ink); color: #fff; border-radius: 14px; padding: 10px 14px; font-size: 15px; text-decoration: none; }
.pending :deep(svg) { color: #FFD166; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.act { min-height: 128px; border-radius: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-decoration: none; }
.act .t { font-size: 24px; font-weight: 900; letter-spacing: 3px; }
.act .s { font-size: 13px; }
.act.dark { background: var(--ink); color: #fff; }
.act.dark :deep(svg) { color: var(--brand); }
.act.dark .s { color: var(--soft-2); }
.act.light { background: #fff; color: var(--ink); border: 2px solid var(--ink); }
.act.light .s { color: var(--muted); }
.perks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.perk { background: var(--soft); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; text-decoration: none; color: var(--ink); }
.perk.no { background: var(--bg); }
@media (max-width: 480px) { .perks { grid-template-columns: 1fr; } }
</style>
