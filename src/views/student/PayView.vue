<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type QrScannerType from 'qr-scanner'
import { api } from '../../api'
import { session } from '../../session'
import type { PaymentCode, Transaction, TransferCategory } from '../../domain/types'
import { CATEGORY_LABEL } from '../../domain/types'
import { extractCode, isValidCode, normalizeCode } from '../../domain/codes'
import { formatPoints, NOTE_MAX, parseAmount, validateAmount, validateNote } from '../../domain/money'
import { confirmDialog, errorMessage } from '../../ui/feedback'
import { BankError } from '../../api/types'
import Icon from '../../components/Icon.vue'

type Step = 'scan' | 'form' | 'done'
const route = useRoute()
const router = useRouter()
const step = ref<Step>('scan')
// 偵測鏡頭完成前不顯示輸入框，避免學生打字到一半畫面切換成相機
const mode = ref<'detecting' | 'camera' | 'manual'>('detecting')
const hasCamera = ref(false)
const manual = ref('')
const scanError = ref('')
const looking = ref(false)
const code = ref<PaymentCode | null>(null)
const amount = ref('')
const category = ref<TransferCategory | ''>('')
const note = ref('')
const formError = ref('')
const busy = ref(false)
const result = ref<Transaction | null>(null)
const video = ref<HTMLVideoElement | null>(null)
let scanner: QrScannerType | null = null

const balance = computed(() => session.user?.balance ?? 0)
const cats = Object.entries(CATEGORY_LABEL) as [TransferCategory, string][]

async function lookup(raw: string) {
  scanError.value = ''
  const c = normalizeCode(raw)
  if (!isValidCode(c)) {
    scanError.value = '代碼格式不正確（8 碼英文與數字）'
    return
  }
  looking.value = true
  try {
    const pc = await api.getPaymentCode(c)
    if (pc.used || Date.now() >= pc.expiresAt) throw new BankError('CODE_INVALID', '此收款碼已使用或已失效，請對方重新產生')
    if (pc.toUid === session.user?.uid) throw new BankError('SELF_TRANSFER', '這是你自己的收款碼，不能付款給自己')
    await stopCamera()
    code.value = pc
    step.value = 'form'
  } catch (e) {
    scanError.value = errorMessage(e)
  } finally {
    looking.value = false
  }
}

async function startCamera() {
  mode.value = 'camera'
  scanError.value = ''
  await nextTick()
  if (!video.value) return
  try {
    const { default: QrScanner } = await import('qr-scanner')
    scanner = new QrScanner(video.value, (res) => {
      const c = extractCode(res.data, location.origin)
      if (c && !looking.value) lookup(c)
      else if (!c) scanError.value = '這不是點數銀行的收款碼'
    }, { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 5 })
    await scanner.start()
  } catch {
    scanError.value = '無法開啟相機，請允許使用相機，或改用輸入代碼'
    mode.value = 'manual'
  }
}

async function stopCamera() {
  if (scanner) {
    scanner.stop()
    scanner.destroy()
    scanner = null
  }
}

async function useManual() {
  await stopCamera()
  mode.value = 'manual'
}

async function submit() {
  formError.value = ''
  const aErr = validateAmount(amount.value, { max: balance.value })
  if (aErr) return (formError.value = aErr)
  if (!category.value) return (formError.value = '請選擇分類')
  const nErr = validateNote(note.value)
  if (nErr) return (formError.value = nErr)
  const c = code.value!
  const n = parseAmount(amount.value)
  const ok = await confirmDialog({
    title: '確認付款',
    message: `付給 ${c.toName}（${c.toSeatNo} 號）${formatPoints(n)} 點\n分類：${CATEGORY_LABEL[category.value]}\n事由：${note.value.trim()}\n\n老師核准後才會生效。`,
    okText: '確定送出',
  })
  if (!ok) return
  busy.value = true
  try {
    result.value = await api.submitTransfer({ codeId: c.id, amount: n, category: category.value, note: note.value })
    step.value = 'done'
  } catch (e) {
    formError.value = errorMessage(e)
    if (e instanceof BankError && e.code === 'CODE_INVALID') {
      code.value = null
      step.value = 'scan'
      scanError.value = e.message
    }
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  const c = typeof route.query.c === 'string' ? route.query.c : ''
  if (c) {
    router.replace('/pay')
    await lookup(c)
    if (step.value === 'form') return
    // 連結中的代碼無效：改顯示輸入框，讓學生重新輸入
  }
  try {
    const { default: QrScanner } = await import('qr-scanner')
    hasCamera.value = await QrScanner.hasCamera()
  } catch {
    hasCamera.value = false
  }
  if (hasCamera.value && step.value === 'scan') startCamera()
  else mode.value = 'manual'
})

onUnmounted(stopCamera)
</script>

<template>
  <div class="page" style="max-width: 640px">
    <div class="row between">
      <h1>付款</h1>
      <RouterLink to="/" class="btn ghost sm"><Icon name="x" :size="18" />關閉</RouterLink>
    </div>

    <!-- 步驟 1：掃描或輸入代碼 -->
    <section v-if="step === 'scan'" class="card col" style="gap: 16px">
      <div v-if="hasCamera" class="row" role="group" aria-label="方式">
        <button class="chip" :class="{ on: mode === 'camera' }" type="button" @click="startCamera"><Icon name="camera" :size="16" />掃描 QR 碼</button>
        <button class="chip" :class="{ on: mode === 'manual' }" type="button" @click="useManual"><Icon name="keyboard" :size="16" />輸入代碼</button>
      </div>
      <p v-if="mode === 'detecting'" class="muted">正在準備相機…</p>
      <div v-show="mode === 'camera'" class="cam">
        <video ref="video" muted playsinline />
      </div>
      <form v-if="mode === 'manual'" class="col" style="gap: 12px" @submit.prevent="lookup(manual)">
        <div class="field">
          <label for="code">收款代碼（收款同學畫面上的 8 碼）</label>
          <input id="code" v-model="manual" class="input big num" autocomplete="off" autocapitalize="characters" spellcheck="false"
                 maxlength="12" placeholder="ABCD 2345" data-testid="pay-code">
        </div>
        <button class="btn primary lg" type="submit" :disabled="looking">{{ looking ? '查詢中…' : '下一步' }}</button>
      </form>
      <p v-if="scanError" class="notice err" role="alert">{{ scanError }}</p>
    </section>

    <!-- 步驟 2：填寫金額、分類、事由 -->
    <form v-else-if="step === 'form' && code" class="card col" style="gap: 18px" novalidate @submit.prevent="submit">
      <div class="to">
        <span class="muted small">付款給</span>
        <b class="to-name" data-testid="pay-recipient">{{ code.toName }}（{{ code.toSeatNo }} 號）</b>
      </div>
      <div class="field">
        <label for="amt">點數</label>
        <input id="amt" v-model="amount" class="input big num" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0" data-testid="pay-amount">
        <span class="hint num">我的點數：{{ formatPoints(balance) }}</span>
      </div>
      <fieldset class="field" style="border: 0; padding: 0; margin: 0">
        <legend class="label" style="margin-bottom: 6px">分類</legend>
        <div class="cats">
          <button v-for="[k, l] in cats" :key="k" class="chip" :class="{ on: category === k }" type="button"
                  :aria-pressed="category === k" @click="category = k">{{ l }}</button>
        </div>
      </fieldset>
      <div class="field">
        <label for="note">事由</label>
        <input id="note" v-model="note" class="input" :maxlength="NOTE_MAX" placeholder="例如：買手作書籤" data-testid="pay-note">
        <span class="hint">{{ note.trim().length }} / {{ NOTE_MAX }}</span>
      </div>
      <p v-if="formError" class="error-text" role="alert">{{ formError }}</p>
      <div class="row">
        <button class="btn" type="button" @click="step = 'scan'; code = null">重新掃描</button>
        <button class="btn primary lg grow" type="submit" :disabled="busy">{{ busy ? '送出中…' : '送出付款申請' }}</button>
      </div>
    </form>

    <!-- 步驟 3：完成 -->
    <section v-else-if="step === 'done' && result" class="card col" style="align-items: center; text-align: center; gap: 14px">
      <div class="done-icon"><Icon name="check" :size="40" :stroke="2.6" /></div>
      <h2 data-testid="pay-done">已送出，等待老師審核</h2>
      <p>付給 <b>{{ result.toName }}（{{ result.toSeatNo }} 號）</b> <b class="num">{{ formatPoints(result.amount) }} 點</b></p>
      <p class="muted">老師核准後才會扣點；在這之前你的點數不會變動。</p>
      <div class="row wrap" style="justify-content: center">
        <RouterLink :to="`/tx/${result.id}`" class="btn">查看交易</RouterLink>
        <RouterLink to="/" class="btn primary">回首頁</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cam { border-radius: 18px; overflow: hidden; background: #000; aspect-ratio: 1 / 1; max-height: 60vh; }
.cam video { width: 100%; height: 100%; object-fit: cover; display: block; }
.to { background: var(--soft); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; }
.to-name { font-size: 24px; color: var(--ink); }
.cats { display: flex; gap: 8px; flex-wrap: wrap; }
.cats .chip { min-height: 44px; padding: 0 20px; font-size: 16px; }
.done-icon { width: 76px; height: 76px; border-radius: 50%; background: var(--soft); color: var(--brand-dark); display: flex; align-items: center; justify-content: center; }
</style>
