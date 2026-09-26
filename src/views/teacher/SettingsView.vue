<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import { reconcile, type ReconcileRow } from '../../domain/ledger'
import { formatPoints, parseAmount } from '../../domain/money'
import { dateKey } from '../../domain/dates'
import { confirmDialog, errorMessage, promptDialog, toast } from '../../ui/feedback'
import { downloadJson, exportStudents } from '../../ui/excel'
import { signOut } from '../../session'
import { MockStore } from '../../api/mock/store'

const router = useRouter()
const settings = useLive(() => api.getSettings())
const form = ref({ className: '', codeTtlMinutes: '3', championAmount: '500', runnerUpAmount: '300' })
const error = ref('')
const recon = ref<ReconcileRow[] | null>(null)

watch(settings.data, (s) => {
  if (s) form.value = { className: s.className, codeTtlMinutes: String(s.codeTtlMinutes), championAmount: String(s.championAmount), runnerUpAmount: String(s.runnerUpAmount) }
}, { immediate: true })

async function save() {
  error.value = ''
  try {
    await api.saveSettings({
      className: form.value.className,
      codeTtlMinutes: parseAmount(form.value.codeTtlMinutes),
      championAmount: parseAmount(form.value.championAmount),
      runnerUpAmount: parseAmount(form.value.runnerUpAmount),
    })
    toast.ok('設定已儲存')
  } catch (e) { error.value = errorMessage(e) }
}

async function runReconcile() {
  try {
    recon.value = reconcile(await api.listStudents(), await api.listTransactions())
    const bad = recon.value.filter((r) => !r.ok).length
    bad ? toast.error(new Error(`有 ${bad} 位學生帳目不一致`)) : toast.ok('對帳完成：全部一致')
  } catch (e) { toast.error(e) }
}

async function backup() {
  try { downloadJson(await api.exportAll(), `點數銀行備份_${dateKey(Date.now())}.json`) } catch (e) { toast.error(e) }
}
async function exportXlsx() {
  try { exportStudents(await api.listStudents(), await api.listGroups()) } catch (e) { toast.error(e) }
}

async function resetMock() {
  const ok = await confirmDialog({ title: '清除模擬資料庫？', message: '這台瀏覽器中的所有帳號、點數與交易都會被刪除，無法復原。建議先下載備份。', danger: true, okText: '繼續' })
  if (!ok) return
  const word = await promptDialog({ title: '最後確認', label: '請輸入「清除」兩個字', danger: true, okText: '清除全部資料' })
  if (word !== '清除') return
  new MockStore(window.localStorage).reset()
  await signOut()
  router.replace('/setup')
}
</script>

<template>
  <div class="page" style="max-width: 900px">
    <h1>設定與備份</h1>

    <form class="card col" novalidate @submit.prevent="save">
      <h2>系統設定</h2>
      <div class="field"><label for="cn">班級名稱</label><input id="cn" v-model="form.className" class="input" maxlength="20"></div>
      <div class="field"><label for="ttl">收款 QR 碼有效時間（分鐘，1～10）</label><input id="ttl" v-model="form.codeTtlMinutes" class="input num" inputmode="numeric" style="max-width: 160px"></div>
      <div class="row wrap">
        <div class="field"><label for="ca">小組冠軍預設每人點數</label><input id="ca" v-model="form.championAmount" class="input num" inputmode="numeric"></div>
        <div class="field"><label for="ra">小組亞軍預設每人點數</label><input id="ra" v-model="form.runnerUpAmount" class="input num" inputmode="numeric"></div>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn primary" type="submit" style="align-self: flex-start">儲存設定</button>
    </form>

    <section class="card col">
      <h2>對帳檢查</h2>
      <p class="small muted">逐一比對每位學生「已完成交易的加總」與「帳戶點數」。</p>
      <button class="btn" type="button" style="align-self: flex-start" data-testid="reconcile" @click="runReconcile">執行對帳</button>
      <div v-if="recon" class="table-wrap">
        <table class="table">
          <thead><tr><th>座號</th><th>姓名</th><th class="r">帳戶點數</th><th class="r">交易加總</th><th>結果</th></tr></thead>
          <tbody>
            <tr v-for="r in recon" :key="r.uid"><td>{{ r.seatNo }}</td><td>{{ r.name }}</td><td class="r num">{{ formatPoints(r.balance) }}</td><td class="r num">{{ formatPoints(r.ledgerSum) }}</td>
              <td><span class="pill" :class="r.ok ? 'green' : 'red'" data-testid="reconcile-result">{{ r.ok ? '一致' : '不一致' }}</span></td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card col">
      <h2>備份與匯出</h2>
      <p class="small muted">建議每月備份一次。模擬資料庫的資料只存在這台電腦的瀏覽器，清除瀏覽器資料就會消失。</p>
      <div class="row wrap">
        <button class="btn" type="button" @click="backup">下載全部資料（JSON）</button>
        <button class="btn" type="button" @click="exportXlsx">匯出學生帳戶（Excel）</button>
        <RouterLink to="/t/ledger" class="btn">匯出交易紀錄</RouterLink>
      </div>
    </section>

    <section class="card col">
      <h2>教師帳號</h2>
      <RouterLink to="/t/me" class="btn" style="align-self: flex-start">修改教師密碼</RouterLink>
    </section>

    <section v-if="api.backend === 'mock'" class="card col" style="border-color: #F4C7C3">
      <h2 class="out">危險區域</h2>
      <p class="small muted">清除這台瀏覽器中的模擬資料庫，回到首次設定畫面。</p>
      <button class="btn danger" type="button" style="align-self: flex-start" @click="resetMock">清除模擬資料庫</button>
    </section>
  </div>
</template>
