<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import { formatPoints } from '../../domain/money'
import { periodTotals } from '../../domain/ledger'
import { startOfWeek } from '../../domain/dates'
import { confirmDialog, promptDialog, toast } from '../../ui/feedback'
import Icon from '../../components/Icon.vue'

const router = useRouter()
const students = useLive(() => api.listStudents())
const groups = useLive(() => api.listGroups())
const week = useLive(() => api.listTransactions({ from: startOfWeek(Date.now()) }))
const q = ref('')
const g = ref('')
const sortKey = ref<'seat' | 'balance'>('seat')
const selected = ref<Set<string>>(new Set())
const busy = ref(false)

const gName = computed(() => new Map((groups.data.value ?? []).map((x) => [x.id, x.name])))
const rows = computed(() => {
  let list = [...(students.data.value ?? [])]
  const s = q.value.trim().toLowerCase()
  if (s) list = list.filter((u) => u.name.includes(s) || u.account.toLowerCase().includes(s) || String(u.seatNo) === s)
  if (g.value === '__none') list = list.filter((u) => !u.groupId)
  else if (g.value) list = list.filter((u) => u.groupId === g.value)
  if (sortKey.value === 'balance') list.sort((a, b) => b.balance - a.balance)
  return list.map((u) => ({ u, w: periodTotals(week.data.value ?? [], u.uid, 0) }))
})
const total = computed(() => rows.value.reduce((a, r) => a + r.u.balance, 0))
const chosen = computed(() => (students.data.value ?? []).filter((u) => selected.value.has(u.uid)))
const allShownSelected = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.u.uid)))

// 學生被刪除後，從勾選中移除
watch(students.data, (list) => {
  const ids = new Set((list ?? []).map((u) => u.uid))
  selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
})

function toggle(uid: string) {
  const s = new Set(selected.value)
  if (s.has(uid)) s.delete(uid)
  else s.add(uid)
  selected.value = s
}
function toggleAllShown() {
  const s = new Set(selected.value)
  if (allShownSelected.value) for (const r of rows.value) s.delete(r.u.uid)
  else for (const r of rows.value) s.add(r.u.uid)
  selected.value = s
}

async function setActive(active: boolean) {
  const list = chosen.value
  const ok = await confirmDialog({
    title: `${active ? '啟用' : '停用'} ${list.length} 位學生的帳號？`,
    message: active ? '啟用後可以再次登入。' : '停用後無法登入、無法收付款；點數與紀錄都會保留，之後可以再啟用。',
    okText: active ? '啟用' : '停用', danger: !active,
  })
  if (!ok) return
  busy.value = true
  try {
    const n = await api.setStudentsActive(list.map((u) => u.uid), active)
    toast.ok(`已${active ? '啟用' : '停用'} ${n} 個帳號`)
    selected.value = new Set()
  } catch (e) { toast.error(e) } finally { busy.value = false }
}

async function remove() {
  const list = chosen.value
  const points = list.reduce((a, u) => a + u.balance, 0)
  const names = list.slice(0, 8).map((u) => `${u.seatNo} 號 ${u.name}`).join('、') + (list.length > 8 ? ` 等 ${list.length} 人` : '')
  const ok = await confirmDialog({
    title: `刪除 ${list.length} 位學生的帳號？`,
    message: `${names}\n\n・帳號與登入資料會被刪除，無法復原。\n・交易紀錄會保留（其他同學的明細仍看得到）。\n・審核中的轉帳會自動駁回。`
      + (points > 0 ? `\n・這些學生目前共有 ${formatPoints(points)} 點，刪除後點數一併消失。` : '')
      + '\n\n只是暫時不用的話，建議改用「停用」。',
    okText: '繼續刪除', danger: true,
  })
  if (!ok) return
  const word = await promptDialog({ title: '最後確認', label: '請輸入「刪除」兩個字', okText: `刪除 ${list.length} 個帳號`, danger: true })
  if (word !== '刪除') {
    if (word !== null) toast.error(new Error('輸入不正確，已取消'))
    return
  }
  busy.value = true
  try {
    const r = await api.deleteStudents(list.map((u) => u.uid))
    toast.ok(`已刪除 ${r.deleted} 個帳號${r.rejectedPending ? `，自動駁回 ${r.rejectedPending} 筆審核中的轉帳` : ''}`)
    selected.value = new Set()
  } catch (e) { toast.error(e) } finally { busy.value = false }
}
</script>

<template>
  <div class="page">
    <div class="row between wrap">
      <h1>學生總覽</h1>
      <span class="muted">共 {{ rows.length }} 人 · 合計 <b class="num">{{ formatPoints(total) }}</b> 點</span>
    </div>
    <div class="row wrap">
      <input v-model="q" class="input grow" style="min-width: 220px; width: auto" placeholder="搜尋姓名、帳號或座號" aria-label="搜尋">
      <select v-model="g" class="select" style="width: auto" aria-label="組別篩選">
        <option value="">全部組別</option>
        <option v-for="x in groups.data.value ?? []" :key="x.id" :value="x.id">{{ x.name }}</option>
        <option value="__none">未分組</option>
      </select>
      <select v-model="sortKey" class="select" style="width: auto" aria-label="排序">
        <option value="seat">依座號</option>
        <option value="balance">依點數（多到少）</option>
      </select>
    </div>

    <div v-if="selected.size" class="bulk" role="toolbar" aria-label="批次操作">
      <b>已選 {{ selected.size }} 人</b>
      <button class="btn sm" type="button" @click="selected = new Set()">取消選取</button>
      <span class="grow" />
      <button class="btn sm" type="button" :disabled="busy" @click="setActive(true)">批次啟用</button>
      <button class="btn sm" type="button" :disabled="busy" data-testid="bulk-disable" @click="setActive(false)">批次停用</button>
      <button class="btn sm danger-fill" type="button" :disabled="busy" data-testid="bulk-delete" @click="remove"><Icon name="x" :size="16" />批次刪除</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 44px"><input type="checkbox" class="cb" :checked="allShownSelected" aria-label="全選目前列出的學生" data-testid="select-all-students" @change="toggleAllShown"></th>
            <th>座號</th><th>姓名</th><th>帳號</th><th>組別</th><th class="r">本週收入</th><th class="r">本週支出</th><th class="r">點數</th><th>狀態</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ u, w } in rows" :key="u.uid" class="click" :class="{ sel: selected.has(u.uid) }" data-testid="student-row" @click="router.push(`/t/students/${u.uid}`)">
            <td @click.stop><input type="checkbox" class="cb" :checked="selected.has(u.uid)" :aria-label="`選取 ${u.name}`" data-testid="student-check" @change="toggle(u.uid)"></td>
            <td class="num">{{ u.seatNo }}</td>
            <td class="bold">{{ u.name }}</td>
            <td class="num muted">{{ u.account }}</td>
            <td>{{ gName.get(u.groupId ?? '') ?? '—' }}</td>
            <td class="r num in">{{ w.income ? '+' + formatPoints(w.income) : '' }}</td>
            <td class="r num out">{{ w.expense ? '−' + formatPoints(w.expense) : '' }}</td>
            <td class="r num bold" style="font-size: 17px">{{ formatPoints(u.balance) }}</td>
            <td><span class="pill" :class="u.active ? 'green' : 'gray'">{{ u.active ? '使用中' : '已停用' }}</span></td>
            <td class="r"><Icon name="chevron" :size="18" /></td>
          </tr>
          <tr v-if="students.data.value && !rows.length"><td colspan="10" class="empty">沒有學生。請到「帳號管理」匯入名冊。</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.cb { width: 20px; height: 20px; accent-color: var(--brand-dark); cursor: pointer; }
.bulk { position: sticky; top: 8px; z-index: 5; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--ink); color: #fff; border-radius: 14px; padding: 10px 14px; box-shadow: var(--shadow); }
.bulk .btn:not(.danger-fill) { background: rgba(255,255,255,.12); color: #fff; border-color: transparent; }
tr.sel td { background: var(--soft); }
</style>
