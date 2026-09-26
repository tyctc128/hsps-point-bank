<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import { formatPoints, parseAmount, validateAmount } from '../../domain/money'
import { dateKey, formatDateTime } from '../../domain/dates'
import { confirmDialog, errorMessage, toast } from '../../ui/feedback'
import { reverseBatchById } from '../../ui/actions'
import { BankError } from '../../api/types'

const students = useLive(() => api.listStudents())
const groups = useLive(() => api.listGroups())
const settings = useLive(() => api.getSettings())
const awards = useLive(() => api.listGroupAwards())

const date = ref(dateKey(Date.now()))
const champ = ref<string[]>([])
const runner = ref<string[]>([])
const champAmt = ref('')
const runnerAmt = ref('')
const excluded = ref<Set<string>>(new Set())
const error = ref('')
const busy = ref(false)

watch(settings.data, (s) => {
  if (s && !champAmt.value) champAmt.value = String(s.championAmount)
  if (s && !runnerAmt.value) runnerAmt.value = String(s.runnerUpAmount)
}, { immediate: true })

const activeGroups = computed(() => (groups.data.value ?? []).filter((g) => g.active))
const members = (gid: string) => (students.data.value ?? []).filter((s) => s.active && s.groupId === gid)
const gName = (gid: string) => activeGroups.value.find((g) => g.id === gid)?.name ?? ''

function toggleChamp(gid: string) {
  if (runner.value.includes(gid)) return
  champ.value = champ.value.includes(gid) ? champ.value.filter((x) => x !== gid) : [...champ.value, gid]
}
function toggleRunner(gid: string) {
  if (champ.value.includes(gid)) return
  runner.value = runner.value.includes(gid) ? runner.value.filter((x) => x !== gid) : [...runner.value, gid]
}
function toggleExcluded(uid: string) {
  const s = new Set(excluded.value)
  if (s.has(uid)) s.delete(uid)
  else s.add(uid)
  excluded.value = s
}

const preview = computed(() => {
  const count = (ids: string[]) => ids.reduce((a, g) => a + members(g).filter((u) => !excluded.value.has(u.uid)).length, 0)
  const c = count(champ.value)
  const r = count(runner.value)
  const ca = parseAmount(champAmt.value) || 0
  const ra = parseAmount(runnerAmt.value) || 0
  return { c, r, total: c * ca + r * ra }
})
const sameDay = computed(() => (awards.data.value ?? []).filter((a) => a.awardDate === date.value && !a.reversed))

async function submit(confirmDuplicate = false) {
  error.value = ''
  if (!champ.value.length && !runner.value.length) return (error.value = '請選擇冠軍或亞軍組別')
  if (champ.value.length) { const e = validateAmount(champAmt.value); if (e) return (error.value = `冠軍：${e}`) }
  if (runner.value.length) { const e = validateAmount(runnerAmt.value); if (e) return (error.value = `亞軍：${e}`) }
  if (!confirmDuplicate) {
    const ok = await confirmDialog({
      title: '確認發放小組獎勵',
      message: `日期：${date.value}\n冠軍：${champ.value.map(gName).join('、') || '—'}（每人 ${champAmt.value}）\n亞軍：${runner.value.map(gName).join('、') || '—'}（每人 ${runnerAmt.value}）\n共 ${preview.value.c + preview.value.r} 人，${formatPoints(preview.value.total)} 點`,
      okText: '發放',
    })
    if (!ok) return
  }
  busy.value = true
  try {
    const a = await api.groupAward({
      awardDate: date.value, championIds: champ.value, runnerUpIds: runner.value,
      championAmount: parseAmount(champAmt.value), runnerUpAmount: parseAmount(runnerAmt.value),
      excludedUids: [...excluded.value], confirmDuplicate,
    })
    toast.ok(`已發放：${a.recipients.length} 人，共 ${formatPoints(a.total)} 點`)
    champ.value = []
    runner.value = []
    excluded.value = new Set()
  } catch (e) {
    if (e instanceof BankError && e.code === 'DUPLICATE_AWARD') {
      const again = await confirmDialog({ title: '這天已經發放過了', message: `${date.value} 已發放過小組獎勵，確定要再發一次嗎？`, okText: '再發一次', danger: true })
      if (again) { busy.value = false; return submit(true) }
    } else error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="row between wrap">
      <h1>小組獎勵</h1>
      <div class="field" style="flex-direction: row; align-items: center; gap: 8px">
        <label for="d">發放日期</label>
        <input id="d" v-model="date" class="input" type="date" style="width: auto">
      </div>
    </div>
    <p v-if="sameDay.length" class="notice warn">{{ date }} 已發放過 {{ sameDay.length }} 次小組獎勵。</p>

    <div class="grid-2" style="grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); align-items: start">
      <section class="card col" style="gap: 18px">
        <div class="col">
          <div class="row between"><h2>冠軍（可並列）</h2>
            <div class="row" style="gap: 6px"><span class="small muted">每人</span><input v-model="champAmt" class="input num" style="width: 110px; min-height: 40px" inputmode="numeric" aria-label="冠軍每人點數"><span class="small muted">點</span></div>
          </div>
          <div class="groups">
            <button v-for="g in activeGroups" :key="g.id" class="gbtn" :class="{ gold: champ.includes(g.id) }" type="button"
                    :disabled="runner.includes(g.id)" :aria-pressed="champ.includes(g.id)" data-testid="champ-group" @click="toggleChamp(g.id)">
              <b>{{ g.name }}</b><span class="xs">{{ members(g.id).length }} 人</span>
            </button>
          </div>
        </div>
        <div class="col">
          <div class="row between"><h2>亞軍（可並列）</h2>
            <div class="row" style="gap: 6px"><span class="small muted">每人</span><input v-model="runnerAmt" class="input num" style="width: 110px; min-height: 40px" inputmode="numeric" aria-label="亞軍每人點數"><span class="small muted">點</span></div>
          </div>
          <div class="groups">
            <button v-for="g in activeGroups" :key="g.id" class="gbtn" :class="{ silver: runner.includes(g.id) }" type="button"
                    :disabled="champ.includes(g.id)" :aria-pressed="runner.includes(g.id)" data-testid="runner-group" @click="toggleRunner(g.id)">
              <b>{{ g.name }}</b><span class="xs">{{ members(g.id).length }} 人</span>
            </button>
          </div>
        </div>
      </section>

      <section class="card dark col">
        <h2>發放名單</h2>
        <p class="small" style="color: var(--soft-2)">點選學生可排除請假者</p>
        <div v-for="gid in [...champ, ...runner]" :key="gid" class="col" style="gap: 6px">
          <span class="bold">{{ gName(gid) }} <span class="pill" :class="champ.includes(gid) ? 'green' : 'gray'">{{ champ.includes(gid) ? '冠軍' : '亞軍' }}</span></span>
          <div class="row wrap" style="gap: 6px">
            <button v-for="u in members(gid)" :key="u.uid" class="mem" :class="{ off: excluded.has(u.uid) }" type="button"
                    :aria-pressed="!excluded.has(u.uid)" data-testid="award-member" @click="toggleExcluded(u.uid)">
              {{ u.name }}{{ excluded.has(u.uid) ? '（請假）' : '' }}
            </button>
            <span v-if="!members(gid).length" class="small" style="color: var(--soft-2)">這組還沒有組員</span>
          </div>
        </div>
        <p v-if="!champ.length && !runner.length" style="color: var(--soft-2)">請先在左邊選擇冠軍與亞軍組別</p>
        <div class="total">
          <div class="col" style="gap: 0">
            <span class="small" style="color: var(--soft-2)">冠軍 {{ preview.c }} 人 ＋ 亞軍 {{ preview.r }} 人</span>
            <span class="num" style="font-size: 30px; font-weight: 800">{{ formatPoints(preview.total) }} 點</span>
          </div>
          <button class="btn brand lg" type="button" :disabled="busy" data-testid="award-submit" @click="submit()">確認發放</button>
        </div>
        <p v-if="error" class="notice err" role="alert">{{ error }}</p>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>發放紀錄</h2></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>日期</th><th>冠軍</th><th>亞軍</th><th class="r">人數</th><th class="r">點數</th><th>狀態</th><th /></tr></thead>
          <tbody>
            <tr v-for="a in awards.data.value ?? []" :key="a.id">
              <td class="num">{{ a.awardDate }}<div class="xs muted">{{ formatDateTime(a.createdAt) }}</div></td>
              <td>{{ a.champions.map((c) => c.name).join('、') || '—' }}<span v-if="a.champions.length" class="xs muted">（每人 {{ a.championAmount }}）</span></td>
              <td>{{ a.runnersUp.map((c) => c.name).join('、') || '—' }}<span v-if="a.runnersUp.length" class="xs muted">（每人 {{ a.runnerUpAmount }}）</span></td>
              <td class="r num">{{ a.recipients.length }}</td>
              <td class="r num">{{ formatPoints(a.total) }}</td>
              <td><span class="pill" :class="a.reversed ? 'gray' : 'green'">{{ a.reversed ? '已沖正' : '已發放' }}</span></td>
              <td class="r"><button v-if="!a.reversed" class="btn sm danger" type="button" @click="reverseBatchById(a.id, a.recipients.length)">整批沖正</button></td>
            </tr>
            <tr v-if="awards.data.value && !awards.data.value.length"><td colspan="7" class="empty">尚無發放紀錄</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.groups { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.gbtn { min-height: 58px; border-radius: 14px; border: 1.5px solid var(--line); background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; color: var(--ink); }
.gbtn .xs { color: var(--muted); }
.gbtn.gold { background: var(--brand); border-color: var(--brand-dark); }
.gbtn.silver { background: var(--soft-2); border-color: var(--brand-dark); }
.gbtn:disabled { opacity: .35; cursor: not-allowed; }
.mem { min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--brand); background: var(--brand); color: var(--ink); font-weight: 700; cursor: pointer; }
.mem.off { background: transparent; color: var(--soft-2); border-color: #2E5A40; text-decoration: line-through; font-weight: 400; }
.total { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; border-top: 1px solid #2E5A40; padding-top: 14px; flex-wrap: wrap; }
@media (max-width: 640px) { .groups { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
