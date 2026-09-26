<script setup lang="ts">
import { computed } from 'vue'
import type { Transaction } from '../domain/types'
import { describeTx } from '../ui/txView'
import { formatPoints, formatSigned } from '../domain/money'
import Icon from './Icon.vue'

const props = defineProps<{ tx: Transaction; viewerUid: string | null; balanceAfter?: number; to?: string }>()
const v = computed(() => describeTx(props.tx, props.viewerUid))
</script>

<template>
  <RouterLink :to="to ?? `/tx/${tx.id}`" class="tx-row" :class="{ pending: tx.status === 'pending' }" data-testid="tx-row">
    <div class="tx-icon" :class="{ out: v.tone === 'out', wait: v.tone === 'wait', gray: v.tone === 'gray' }">
      <Icon :name="v.icon" />
    </div>
    <div class="tx-main">
      <span class="tx-title" :class="{ strike: v.struck }">{{ v.title }}</span>
      <span class="tx-sub">{{ v.sub }}</span>
    </div>
    <span v-if="v.status" class="pill" :class="v.status.cls">{{ v.status.text }}</span>
    <div class="col" style="gap: 0">
      <span class="tx-amt num" :class="{ in: v.tone === 'in', out: v.tone === 'out', strike: v.struck, faint: v.tone === 'wait' }">
        {{ viewerUid ? formatSigned(v.signed) : formatPoints(tx.amount) }}
      </span>
      <span v-if="balanceAfter !== undefined" class="tx-bal num">結餘 {{ formatPoints(balanceAfter) }}</span>
    </div>
  </RouterLink>
</template>
