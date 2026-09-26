<script setup lang="ts">
import { computed } from 'vue'
import type { Transaction } from '../domain/types'
import { CATEGORY_LABEL } from '../domain/types'
import { formatPoints } from '../domain/money'
import { formatRelative } from '../domain/dates'
import { approveTx, rejectTx } from '../ui/actions'
import Icon from './Icon.vue'

const props = defineProps<{ tx: Transaction; payerBalance: number | undefined; selectable?: boolean; selected?: boolean }>()
const emit = defineEmits<{ (e: 'toggle'): void }>()
const short = computed(() => props.payerBalance !== undefined && props.payerBalance < props.tx.amount)
</script>

<template>
  <div class="pc" :class="{ warn: short }" data-testid="pending-card">
    <input v-if="selectable" type="checkbox" :checked="selected" :disabled="short" aria-label="選取" @change="emit('toggle')">
    <div class="col grow" style="gap: 4px">
      <div class="row wrap" style="gap: 8px">
        <b>{{ tx.fromName }} {{ tx.fromSeatNo }}號</b>
        <Icon name="arrow-right" :size="18" />
        <b>{{ tx.toName }} {{ tx.toSeatNo }}號</b>
        <span v-if="tx.category" class="pill" :class="short ? 'amber' : 'green'">{{ CATEGORY_LABEL[tx.category] }}</span>
      </div>
      <span class="small" :class="short ? 'bold' : 'muted'" :style="short ? 'color: var(--amber)' : ''">
        <template v-if="short">點數不足：付款人目前 {{ formatPoints(payerBalance ?? 0) }}，需要 {{ formatPoints(tx.amount) }}</template>
        <template v-else>事由：{{ tx.note }} · 付款人餘額 {{ payerBalance === undefined ? '—' : formatPoints(payerBalance) }} · {{ formatRelative(tx.createdAt) }}</template>
      </span>
      <span v-if="short" class="small muted">事由：{{ tx.note }}</span>
    </div>
    <span class="num amt">{{ formatPoints(tx.amount) }}</span>
    <button class="btn sm danger" type="button" @click="rejectTx(tx)">駁回</button>
    <button class="btn sm primary" type="button" :disabled="short" data-testid="approve" @click="approveTx(tx)">核准</button>
  </div>
</template>

<style scoped>
.pc { border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #fff; }
.pc.warn { background: var(--amber-soft); border-color: var(--amber-line); }
.pc input { width: 20px; height: 20px; accent-color: var(--brand-dark); }
.amt { font-size: 24px; font-weight: 800; color: var(--ink); min-width: 70px; text-align: right; }
</style>
