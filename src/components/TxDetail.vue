<script setup lang="ts">
import { computed } from 'vue'
import type { Transaction } from '../domain/types'
import { CATEGORY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../domain/types'
import { formatDateTime } from '../domain/dates'
import { formatPoints, formatSigned } from '../domain/money'
import { describeTx } from '../ui/txView'
import Icon from './Icon.vue'

const props = defineProps<{ tx: Transaction; viewerUid: string | null; linkBase: string }>()
const v = computed(() => describeTx(props.tx, props.viewerUid))

function who(name: string | null, seat: number | null) {
  if (!name) return '銀行（老師）'
  return seat ? `${name}（${seat} 號）` : name
}

const counterpart = computed(() => {
  const t = props.tx
  if (t.type !== 'transfer' && !(t.type === 'reversal' && t.fromUid && t.toUid)) return null
  if (!props.viewerUid) return null
  return t.fromUid === props.viewerUid
    ? { label: t.type === 'transfer' ? '付給' : '退還給', name: who(t.toName, t.toSeatNo) }
    : { label: t.type === 'transfer' ? '來自' : '來自', name: who(t.fromName, t.fromSeatNo) }
})

const steps = computed(() => {
  const t = props.tx
  const out: { label: string; time: number | null; tone: string }[] = [{ label: t.type === 'transfer' ? '送出申請' : '建立', time: t.createdAt, tone: 'done' }]
  if (t.type === 'transfer') {
    if (t.status === 'pending') out.push({ label: '等待老師審核', time: null, tone: 'wait' })
    if (t.status === 'approved') out.push({ label: '老師核准，點數已轉移', time: t.decidedAt, tone: 'done' })
    if (t.status === 'rejected') out.push({ label: '老師駁回', time: t.decidedAt, tone: 'bad' })
  }
  if (t.reversedBy) out.push({ label: '已沖正（老師更正）', time: null, tone: 'bad' })
  return out
})
</script>

<template>
  <div class="card detail">
    <div class="head">
      <div class="tx-icon big" :class="{ out: v.tone === 'out', wait: v.tone === 'wait', gray: v.tone === 'gray' }">
        <Icon :name="v.icon" :size="30" />
      </div>
      <div class="col" style="gap: 4px">
        <span class="muted small">{{ TYPE_LABEL[tx.type] }}</span>
        <h2 :class="{ strike: v.struck }">{{ v.title }}</h2>
      </div>
      <span v-if="v.status" class="pill" :class="v.status.cls" style="margin-left: auto">{{ v.status.text }}</span>
    </div>

    <div class="amount num" :class="{ in: v.tone === 'in', out: v.tone === 'out', strike: v.struck, faint: v.tone === 'wait' }" data-testid="detail-amount">
      {{ viewerUid ? formatSigned(v.signed) : formatPoints(tx.amount) }} <span class="unit">點</span>
    </div>

    <dl class="facts">
      <template v-if="counterpart">
        <dt>{{ counterpart.label }}</dt><dd class="bold" data-testid="detail-counterpart">{{ counterpart.name }}</dd>
      </template>
      <template v-if="!viewerUid">
        <dt>付款方</dt><dd>{{ who(tx.fromName, tx.fromSeatNo) }}</dd>
        <dt>收款方</dt><dd>{{ who(tx.toName, tx.toSeatNo) }}</dd>
      </template>
      <template v-if="tx.category"><dt>分類</dt><dd>{{ CATEGORY_LABEL[tx.category] }}</dd></template>
      <template v-if="tx.note"><dt>{{ tx.type === 'reversal' ? '沖正原因' : '事由' }}</dt><dd data-testid="detail-note">{{ tx.note }}</dd></template>
      <template v-if="tx.group"><dt>小組</dt><dd>{{ tx.group.name }}（{{ tx.group.awardDate }}{{ tx.group.tied ? '，並列' : '' }}）</dd></template>
      <template v-if="tx.rejectReason"><dt>駁回原因</dt><dd class="out bold">{{ tx.rejectReason }}</dd></template>
      <dt>狀態</dt><dd>{{ tx.reversedBy ? '已沖正' : STATUS_LABEL[tx.status] }}</dd>
      <dt>建立時間</dt><dd class="num">{{ formatDateTime(tx.createdAt) }}</dd>
      <template v-if="tx.decidedAt && tx.type === 'transfer'"><dt>審核時間</dt><dd class="num">{{ formatDateTime(tx.decidedAt) }}</dd></template>
      <dt>交易編號</dt><dd class="xs num muted">{{ tx.id }}</dd>
    </dl>

    <ol class="steps" aria-label="處理進度">
      <li v-for="(s, i) in steps" :key="i" :class="s.tone">
        <span class="dot" />
        <span class="bold">{{ s.label }}</span>
        <span v-if="s.time" class="xs muted num">{{ formatDateTime(s.time) }}</span>
      </li>
    </ol>

    <div class="row wrap">
      <RouterLink v-if="tx.reversedBy" :to="`${linkBase}${tx.reversedBy}`" class="btn sm">查看沖正紀錄</RouterLink>
      <RouterLink v-if="tx.reversalOf" :to="`${linkBase}${tx.reversalOf}`" class="btn sm">查看原交易</RouterLink>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.detail { display: flex; flex-direction: column; gap: 18px; }
.head { display: flex; align-items: center; gap: 14px; }
.tx-icon.big { width: 60px; height: 60px; }
.amount { font-size: 48px; font-weight: 800; line-height: 1; }
.amount .unit { font-size: 20px; }
.facts { display: grid; grid-template-columns: 100px 1fr; gap: 10px 16px; margin: 0; padding: 16px; background: var(--bg); border-radius: 16px; }
.facts dt { color: var(--muted); font-size: 14px; }
.facts dd { margin: 0; word-break: break-word; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.steps li { display: flex; align-items: center; gap: 10px; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--brand); flex-shrink: 0; }
.steps li.wait .dot { background: var(--amber); }
.steps li.bad .dot { background: var(--faint); }
</style>
