<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import type { Preset, PresetKind } from '../../domain/types'
import { formatPoints, NOTE_MAX, parseAmount, validateAmount } from '../../domain/money'
import { confirmDialog, errorMessage, toast } from '../../ui/feedback'
import { undoAction } from '../../ui/actions'
import { BankError } from '../../api/types'

const students = useLive(() => api.listStudents())
const groups = useLive(() => api.listGroups())
const presets = useLive(() => api.listPresets())

const selected = ref<Set<string>>(new Set())
const presetId = ref<string>('')
const kind = ref<PresetKind>('add')
const amount = ref('')
const title = ref('')
const note = ref('')
const error = ref('')
const busy = ref(false)

const activeStudents = computed(() => (students.data.value ?? []).filter((s) => s.active))
const activePresets = computed(() => (presets.data.value ?? []).filter((p) => p.active))
const chosen = computed(() => activeStudents.value.filter((s) => selected.value.has(s.uid)))
const n = computed(() => parseAmount(amount.value))
const short = computed(() => (kind.value === 'deduct' && Number.isInteger(n.value) ? chosen.value.filter((s) => s.balance < n.value) : []))

function toggle(uid: string) {
  const s = new Set(selected.value)
  if (s.has(uid)) s.delete(uid)
  else s.add(uid)
  selected.value = s
}
function selectAll() { selected.value = new Set(activeStudents.value.map((s) => s.uid)) }
function selectNone() { selected.value = new Set() }
function selectGroup(gid: string) {
  const s = new Set(selected.value)
  const members = activeStudents.value.filter((u) => u.groupId === gid)
  const allIn = members.every((u) => s.has(u.uid))
  for (const u of members) allIn ? s.delete(u.uid) : s.add(u.uid)
  selected.value = s
}
function usePreset(p: Preset) {
  presetId.value = p.id
  kind.value = p.kind
  amount.value = String(p.amount)
  title.value = p.name
}
function useCustom() {
  presetId.value = ''
  title.value = ''
  amount.value = ''
}
function excludeShort() {
  const s = new Set(selected.value)
  for (const u of short.value) s.delete(u.uid)
  selected.value = s
}

async function submit() {
  error.value = ''
  if (!chosen.value.length) return (error.value = '請選擇學生')
  const aErr = validateAmount(amount.value)
  if (aErr) return (error.value = aErr)
  if (!title.value.trim()) return (error.value = '請填寫項目名稱')
  if (short.value.length) return (error.value = `有 ${short.value.length} 位學生點數不足，請先排除`)
  const total = n.value * chosen.value.length
  const ok = await confirmDialog({
    title: `${kind.value === 'add' ? '加點' : '扣點'}：${title.value.trim()}`,
    message: `${chosen.value.length} 位學生，每人 ${kind.value === 'add' ? '+' : '−'}${formatPoints(n.value)} 點\n合計 ${formatPoints(total)} 點`,
    okText: '確認', danger: kind.value === 'deduct',
  })
  if (!ok) return
  busy.value = true
  try {
    const r = await api.adjust({ uids: chosen.value.map((s) => s.uid), kind: kind.value, amount: n.value, title: title.value, note: note.value, presetId: presetId.value || null })
    toast.ok(`已完成：${r.length} 位學生${kind.value === 'add' ? '加' : '扣'} ${formatPoints(n.value)} 點`, undoAction(r))
    selectNone()
    note.value = ''
  } catch (e) {
    error.value = errorMessage(e)
    if (e instanceof BankError && e.code === 'INSUFFICIENT_BALANCE') students.reload()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1>加扣點 / 批次</h1>
    <div class="grid-2" style="grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); align-items: start">
      <section class="card col">
        <div class="row between wrap">
          <h2>1. 選擇學生 <span class="muted small">（已選 {{ chosen.length }} 人）</span></h2>
          <div class="row">
            <button class="btn sm" type="button" data-testid="select-all" @click="selectAll">全選</button>
            <button class="btn sm" type="button" @click="selectNone">清除</button>
          </div>
        </div>
        <div class="row wrap" style="gap: 6px">
          <span class="small muted">依組別：</span>
          <button v-for="g in (groups.data.value ?? []).filter((x) => x.active)" :key="g.id" class="chip" type="button" @click="selectGroup(g.id)">{{ g.name }}</button>
        </div>
        <div class="picker">
          <button v-for="s in activeStudents" :key="s.uid" class="stu" :class="{ on: selected.has(s.uid), short: short.some((x) => x.uid === s.uid) }"
                  type="button" :aria-pressed="selected.has(s.uid)" data-testid="pick-student" @click="toggle(s.uid)">
            <span class="seat num">{{ s.seatNo }}</span>
            <span class="nm">{{ s.name }}</span>
            <span class="xs num bal">{{ formatPoints(s.balance) }}</span>
          </button>
        </div>
      </section>

      <form class="card col" novalidate @submit.prevent="submit">
        <h2>2. 選擇項目</h2>
        <div class="presets">
          <button v-for="p in activePresets" :key="p.id" class="btn preset" :class="[p.kind, { on: presetId === p.id }]" type="button" @click="usePreset(p)">
            <span>{{ p.name }}</span><span class="num">{{ p.kind === 'add' ? '+' : '−' }}{{ formatPoints(p.amount) }}</span>
          </button>
          <button class="btn preset" :class="{ on: !presetId }" type="button" @click="useCustom">自訂</button>
        </div>
        <div class="row">
          <button class="chip" :class="{ on: kind === 'add' }" type="button" @click="kind = 'add'">加點</button>
          <button class="chip" :class="{ on: kind === 'deduct' }" type="button" @click="kind = 'deduct'">扣點</button>
        </div>
        <div class="field"><label for="amt">每人點數</label><input id="amt" v-model="amount" class="input num" inputmode="numeric" data-testid="adjust-amount"></div>
        <div class="field"><label for="tt">項目名稱</label><input id="tt" v-model="title" class="input" maxlength="20" data-testid="adjust-title"></div>
        <div class="field"><label for="nt">事由（選填，學生看得到）</label><input id="nt" v-model="note" class="input" :maxlength="NOTE_MAX"></div>
        <div v-if="short.length" class="notice warn col" style="gap: 6px">
          <span>點數不足：{{ short.map((s) => `${s.name}（${formatPoints(s.balance)}）`).join('、') }}</span>
          <button class="btn sm" type="button" @click="excludeShort">排除這些學生</button>
        </div>
        <div class="summary">
          <span>{{ chosen.length }} 人 × {{ Number.isInteger(n) && n > 0 ? formatPoints(n) : '—' }}</span>
          <b class="num" :class="kind === 'add' ? 'in' : 'out'">{{ kind === 'add' ? '+' : '−' }}{{ Number.isInteger(n) && n > 0 ? formatPoints(n * chosen.length) : 0 }}</b>
        </div>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <button class="btn lg" :class="kind === 'add' ? 'primary' : 'danger-fill'" type="submit" :disabled="busy" data-testid="adjust-submit">
          {{ kind === 'add' ? '確認加點' : '確認扣點' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.stu { display: flex; flex-direction: column; align-items: flex-start; gap: 0; padding: 8px 10px; border-radius: 12px; border: 1.5px solid var(--line); background: #fff; cursor: pointer; text-align: left; min-height: 64px; }
.stu .seat { font-size: 12px; color: var(--muted); }
.stu .nm { font-weight: 700; color: var(--ink); }
.stu .bal { color: var(--muted); }
.stu.on { background: var(--soft); border-color: var(--brand-dark); box-shadow: inset 0 0 0 1px var(--brand-dark); }
.stu.short { background: var(--amber-soft); border-color: var(--amber); }
.presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.preset { justify-content: space-between; min-height: 46px; font-weight: 700; }
.preset.add .num { color: var(--brand-dark); }
.preset.deduct .num { color: var(--red); }
.preset.on { border: 2px solid var(--ink); background: var(--soft); }
.summary { display: flex; justify-content: space-between; align-items: baseline; background: var(--bg); border-radius: 14px; padding: 12px 16px; }
.summary b { font-size: 26px; }
</style>
