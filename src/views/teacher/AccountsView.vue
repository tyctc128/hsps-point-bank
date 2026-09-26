<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import { parseRoster, type RosterResult } from '../../domain/roster'
import { readSheet } from '../../ui/excel'
import { confirmDialog, errorMessage, toast } from '../../ui/feedback'
import { loadDemoData } from '../../api/mock/demo'
import Icon from '../../components/Icon.vue'

const students = useLive(() => api.listStudents())
const fileName = ref('')
const parsed = ref<RosterResult | null>(null)
const error = ref('')
const busy = ref(false)
const printing = ref(false)
const single = ref({ seatNo: '', account: '', password: '', name: '' })
const singleErr = ref('')

const existing = computed(() => (students.data.value ?? []).map((s) => s.account))

async function onFile(ev: Event) {
  error.value = ''
  parsed.value = null
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (!f) return
  fileName.value = f.name
  try {
    const records = await readSheet(f)
    parsed.value = parseRoster(records, existing.value)
    if (!parsed.value.rows.length && !parsed.value.errors.length) error.value = '檔案中沒有資料'
  } catch (e) {
    error.value = `無法讀取檔案：${errorMessage(e)}`
  } finally {
    (ev.target as HTMLInputElement).value = ''
  }
}

async function doImport() {
  const p = parsed.value
  if (!p?.rows.length) return
  if (!(await confirmDialog({ title: `匯入 ${p.rows.length} 位學生？`, message: p.errors.length ? `有 ${p.errors.length} 列資料有誤，將略過。` : '', okText: '匯入' }))) return
  busy.value = true
  try {
    const r = await api.importStudents(p.rows)
    toast.ok(`已建立 ${r.created} 個帳號${r.skipped.length ? `，略過 ${r.skipped.length} 個` : ''}`)
    if (r.skipped.length) error.value = `略過：${r.skipped.map((s) => `${s.account}（${s.reason}）`).join('、')}`
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

function printCards() {
  printing.value = true
  setTimeout(() => { window.print(); printing.value = false }, 50)
}

async function addSingle() {
  singleErr.value = ''
  const r = parseRoster([{ no: single.value.seatNo, account: single.value.account, passwd: single.value.password, name: single.value.name }], existing.value)
  if (r.errors.length) return (singleErr.value = r.errors[0].message)
  try {
    await api.importStudents(r.rows)
    toast.ok(`已新增 ${r.rows[0].name}`)
    single.value = { seatNo: '', account: '', password: '', name: '' }
  } catch (e) { singleErr.value = errorMessage(e) }
}

async function demo() {
  if (!(await confirmDialog({ title: '載入示範資料？', message: '會新增 31 位虛構學生（帳號 demo01～demo31，密碼 demo1234）並各加 5,000 點。僅供試用。', okText: '載入' }))) return
  try { await loadDemoData(api); toast.ok('已載入示範資料') } catch (e) { toast.error(e) }
}
</script>

<template>
  <div class="page">
    <div class="no-print col" style="gap: 20px">
      <h1>帳號管理</h1>
      <div class="notice info">
        <Icon name="shield" :size="20" />
        <span>名冊檔案只在這台電腦的瀏覽器內讀取，不會上傳；密碼以雜湊方式保存。請勿把 account.xlsx 放進 GitHub。</span>
      </div>

      <section class="card col">
        <h2>匯入班級名冊</h2>
        <p class="small muted">支援 .xlsx / .csv。欄位：<b>no</b>（座號）、<b>account</b>（帳號）、<b>passwd</b>（密碼）、<b>name</b>（姓名），可加 <b>組別</b>。也接受中文欄名「座號、帳號、密碼、姓名、組別」。</p>
        <label class="btn outline" style="align-self: flex-start">
          <Icon name="upload" :size="18" />選擇檔案
          <input type="file" accept=".xlsx,.xls,.csv" class="sr-only" data-testid="roster-file" @change="onFile">
        </label>
        <p v-if="error" class="notice err">{{ error }}</p>

        <template v-if="parsed">
          <div class="row wrap">
            <span class="pill green">可匯入 {{ parsed.rows.length }} 位</span>
            <span v-if="parsed.errors.length" class="pill red">有誤 {{ parsed.errors.length }} 列</span>
            <span class="small muted">{{ fileName }}</span>
          </div>
          <div v-if="parsed.errors.length" class="notice warn col" style="gap: 2px">
            <span v-for="e in parsed.errors" :key="e.row">第 {{ e.row }} 列：{{ e.message }}</span>
          </div>
          <div class="table-wrap" style="max-height: 340px; overflow: auto">
            <table class="table">
              <thead><tr><th>座號</th><th>姓名</th><th>帳號</th><th>組別</th><th>密碼</th></tr></thead>
              <tbody>
                <tr v-for="r in parsed.rows" :key="r.account"><td class="num">{{ r.seatNo }}</td><td>{{ r.name }}</td><td class="num">{{ r.account }}</td><td>{{ r.group ?? '' }}</td><td class="muted">••••••</td></tr>
              </tbody>
            </table>
          </div>
          <div class="row wrap">
            <button class="btn primary" type="button" :disabled="busy || !parsed.rows.length" data-testid="roster-import" @click="doImport">匯入 {{ parsed.rows.length }} 位學生</button>
            <button class="btn" type="button" :disabled="!parsed.rows.length" @click="printCards"><Icon name="printer" :size="18" />列印帳號小卡</button>
          </div>
        </template>
      </section>

      <div class="grid-2" style="align-items: start">
        <form class="card col" novalidate @submit.prevent="addSingle">
          <h2>新增單一學生</h2>
          <div class="row"><input v-model="single.seatNo" class="input num" style="width: 90px" placeholder="座號" aria-label="座號"><input v-model="single.name" class="input" placeholder="姓名" aria-label="姓名"></div>
          <input v-model="single.account" class="input" placeholder="帳號" aria-label="帳號" autocapitalize="off">
          <input v-model="single.password" class="input" placeholder="初始密碼（至少 6 碼）" aria-label="初始密碼">
          <p v-if="singleErr" class="error-text">{{ singleErr }}</p>
          <button class="btn primary" type="submit">新增</button>
        </form>
        <section class="card col">
          <h2>目前帳號</h2>
          <p><b class="num" style="font-size: 28px">{{ students.data.value?.length ?? 0 }}</b> 位學生（{{ (students.data.value ?? []).filter((s) => !s.active).length }} 位停用）</p>
          <p class="small muted">重設密碼、停用帳號請到「學生總覽」點選學生。</p>
          <RouterLink to="/t/students" class="btn">前往學生總覽</RouterLink>
          <button v-if="api.backend === 'mock'" class="btn ghost small" type="button" @click="demo">載入示範資料（虛構學生）</button>
        </section>
      </div>
    </div>

    <!-- 列印用：帳號小卡 -->
    <div v-if="printing && parsed" class="print-cards">
      <div v-for="r in parsed.rows" :key="r.account" class="pcard">
        <b>HSPS 點數銀行</b>
        <span>{{ r.seatNo }} 號 {{ r.name }}</span>
        <span>帳號：{{ r.account }}</span>
        <span>密碼：{{ r.password }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.print-cards { display: none; }
@media print {
  .print-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .pcard { border: 1px dashed #999; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 2px; font-size: 13px; break-inside: avoid; }
}
</style>
