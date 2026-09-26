<script setup lang="ts">
import { computed } from 'vue'
import { api } from '../../api'
import { session } from '../../session'
import { useLive } from '../../ui/live'
import { formatPoints } from '../../domain/money'
import Icon from '../../components/Icon.vue'

const presets = useLive(() => api.listVisiblePresets())
const bal = computed(() => session.user?.balance ?? 0)
const perks = computed(() => (presets.data.value ?? []).filter((p) => p.kind === 'deduct'))
const earns = computed(() => (presets.data.value ?? []).filter((p) => p.kind === 'add'))
</script>

<template>
  <div class="page">
    <div class="row between wrap">
      <h1>小確幸</h1>
      <span class="pill green num" style="font-size: 15px">我的點數 {{ formatPoints(bal) }}</span>
    </div>
    <p class="muted">想使用小確幸時，請告訴老師，老師會幫你扣點。</p>

    <section class="grid-cards" aria-label="小確幸清單">
      <article v-for="p in perks" :key="p.id" class="perk card" :class="{ can: bal >= p.amount }" data-testid="perk">
        <div class="ic"><Icon :name="p.icon" :size="26" /></div>
        <h3>{{ p.name }}</h3>
        <p class="small muted desc">{{ p.description || '　' }}</p>
        <div class="row between">
          <span class="num price">{{ formatPoints(p.amount) }} <small>點</small></span>
          <span class="pill" :class="bal >= p.amount ? 'green' : 'gray'">{{ bal >= p.amount ? '點數足夠' : `還差 ${formatPoints(p.amount - bal)}` }}</span>
        </div>
      </article>
      <p v-if="presets.data.value && !perks.length" class="empty">老師還沒有設定小確幸</p>
    </section>

    <h2 style="margin-top: 12px">怎麼賺點數</h2>
    <section class="grid-cards" aria-label="賺點方式">
      <article v-for="p in earns" :key="p.id" class="card tight earn">
        <div class="ic in"><Icon :name="p.icon" :size="22" /></div>
        <div class="col grow" style="gap: 2px">
          <span class="bold">{{ p.name }}</span>
          <span class="small muted">{{ p.description }}</span>
        </div>
        <span class="num bold in" style="font-size: 20px">+{{ formatPoints(p.amount) }}</span>
      </article>
    </section>
  </div>
</template>

<style scoped>
.grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.perk { display: flex; flex-direction: column; gap: 8px; }
.perk.can { border-color: var(--soft-2); }
.ic { width: 48px; height: 48px; border-radius: 14px; background: var(--soft); color: var(--brand-dark); display: flex; align-items: center; justify-content: center; }
.desc { min-height: 42px; }
.price { font-size: 26px; font-weight: 800; color: var(--ink); }
.price small { font-size: 14px; }
.earn { display: flex; align-items: center; gap: 12px; }
.earn .ic { width: 40px; height: 40px; border-radius: 12px; }
</style>
