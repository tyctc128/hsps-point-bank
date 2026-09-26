<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import QRCode from 'qrcode'
import { api } from '../../api'
import type { PaymentCode, Transaction } from '../../domain/types'
import { CATEGORY_LABEL } from '../../domain/types'
import { formatPoints } from '../../domain/money'
import { errorMessage } from '../../ui/feedback'
import Icon from '../../components/Icon.vue'

type State = 'loading' | 'active' | 'used' | 'expired' | 'error'
const state = ref<State>('loading')
const code = ref<PaymentCode | null>(null)
const qr = ref('')
const now = ref(Date.now())
const usedTx = ref<Transaction | null>(null)
const error = ref('')
let timer: ReturnType<typeof setInterval> | null = null
let off: (() => void) | null = null

const remaining = computed(() => Math.max(0, Math.ceil(((code.value?.expiresAt ?? 0) - now.value) / 1000)))
const mmss = computed(() => `${Math.floor(remaining.value / 60)}:${String(remaining.value % 60).padStart(2, '0')}`)
const ratio = computed(() => {
  const c = code.value
  if (!c) return 0
  return Math.max(0, Math.min(1, (c.expiresAt - now.value) / (c.expiresAt - c.createdAt)))
})
const spaced = computed(() => (code.value ? `${code.value.id.slice(0, 4)} ${code.value.id.slice(4)}` : ''))

function payUrl(id: string) {
  return `${location.origin}${location.pathname}#/pay?c=${id}`
}

async function generate() {
  state.value = 'loading'
  usedTx.value = null
  error.value = ''
  try {
    const c = await api.createPaymentCode()
    code.value = c
    qr.value = await QRCode.toDataURL(payUrl(c.id), { width: 360, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B3D22', light: '#FFFFFF' } })
    now.value = Date.now()
    state.value = 'active'
  } catch (e) {
    error.value = errorMessage(e)
    state.value = 'error'
  }
}

async function check() {
  if (state.value !== 'active' || !code.value) return
  try {
    const c = await api.getPaymentCode(code.value.id)
    if (c.used && c.txId) {
      usedTx.value = await api.getTransaction(c.txId)
      state.value = 'used'
    }
  } catch {
    // 收款碼被清除（例如在其他分頁重新產生）
    state.value = 'expired'
  }
}

onMounted(() => {
  generate()
  timer = setInterval(() => {
    now.value = Date.now()
    if (state.value === 'active' && remaining.value <= 0) state.value = 'expired'
  }, 500)
  off = api.onChange(check)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  off?.()
  if (state.value === 'active' && code.value) api.cancelPaymentCode(code.value.id).catch(() => {})
})
</script>

<template>
  <div class="page" style="max-width: 640px">
    <div class="row between">
      <h1>收款</h1>
      <RouterLink to="/" class="btn ghost sm"><Icon name="x" :size="18" />關閉</RouterLink>
    </div>

    <section class="card qr-card" aria-live="polite">
      <template v-if="state === 'loading'">
        <p class="muted">產生收款碼中…</p>
      </template>

      <template v-else-if="state === 'active' && code">
        <p class="muted">請付款的同學按「付款」掃描這個 QR 碼</p>
        <img :src="qr" alt="收款 QR 碼" class="qr" width="300" height="300" data-testid="qr-image">
        <div class="code num" data-testid="receive-code" :data-code="code.id">{{ spaced }}</div>
        <p class="small muted">沒有鏡頭時，也可以輸入上面的 8 碼代碼</p>
        <div class="timer">
          <div class="bar"><span :style="{ width: `${ratio * 100}%` }" /></div>
          <span class="num bold">{{ mmss }}</span>
        </div>
        <p class="xs muted">收款人：{{ code.toName }}（{{ code.toSeatNo }} 號）｜此碼只能使用一次</p>
      </template>

      <template v-else-if="state === 'used' && usedTx">
        <div class="done-icon"><Icon name="check" :size="40" :stroke="2.6" /></div>
        <h2 data-testid="receive-used">已收到付款申請</h2>
        <p style="font-size: 18px">
          <b>{{ usedTx.fromName }}（{{ usedTx.fromSeatNo }} 號）</b> 要付給你
          <b class="num in">{{ formatPoints(usedTx.amount) }} 點</b>
        </p>
        <p class="muted">{{ usedTx.category ? CATEGORY_LABEL[usedTx.category] : '' }} · {{ usedTx.note }}</p>
        <p class="notice warn">老師核准後，點數才會進入你的帳戶。</p>
        <div class="row wrap" style="justify-content: center">
          <button class="btn primary" type="button" @click="generate"><Icon name="qr" :size="18" />再收一筆</button>
          <RouterLink :to="`/tx/${usedTx.id}`" class="btn">查看交易</RouterLink>
        </div>
      </template>

      <template v-else-if="state === 'expired'">
        <div class="done-icon gray"><Icon name="clock" :size="40" /></div>
        <h2>收款碼已失效</h2>
        <p class="muted">為了安全，收款碼只在短時間內有效。</p>
        <button class="btn primary lg" type="button" @click="generate"><Icon name="refresh" :size="18" />重新產生</button>
      </template>

      <template v-else>
        <p class="notice err">{{ error }}</p>
        <button class="btn primary" type="button" @click="generate">再試一次</button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.qr-card { display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; padding: 28px 22px; }
.qr { width: min(300px, 80vw); height: auto; border-radius: 16px; border: 1px solid var(--line); padding: 8px; background: #fff; }
.code { font-size: 34px; font-weight: 800; letter-spacing: 6px; color: var(--ink); background: var(--soft); padding: 6px 18px; border-radius: 14px; }
.timer { display: flex; align-items: center; gap: 12px; width: min(320px, 100%); }
.bar { flex: 1; height: 10px; background: var(--line-2); border-radius: 5px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--brand); transition: width .5s linear; }
.done-icon { width: 76px; height: 76px; border-radius: 50%; background: var(--soft); color: var(--brand-dark); display: flex; align-items: center; justify-content: center; }
.done-icon.gray { background: #F1F3F2; color: var(--faint); }
</style>
