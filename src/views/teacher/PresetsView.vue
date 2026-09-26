<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import type { Preset } from '../../domain/types'
import { DESCRIPTION_MAX, formatPoints, parseAmount, validateAmount } from '../../domain/money'
import { errorMessage, toast } from '../../ui/feedback'
import Icon from '../../components/Icon.vue'

const presets = useLive(() => api.listPresets())
const ICONS = ['star', 'heart', 'check', 'book', 'seat', 'gift', 'trophy', 'sparkle', 'alert', 'clock']

type Form = { id?: string; kind: 'add' | 'deduct'; name: string; description: string; amount: string; icon: string; sortOrder: number; active: boolean; showToStudents: boolean }
const editing = ref(false)
const form = reactive<Form>({ kind: 'deduct', name: '', description: '', amount: '', icon: 'gift', sortOrder: 0, active: true, showToStudents: true })
const error = ref('')

const perks = computed(() => (presets.data.value ?? []).filter((p) => p.kind === 'deduct'))
const earns = computed(() => (presets.data.value ?? []).filter((p) => p.kind === 'add'))

function openNew(kind: 'add' | 'deduct') {
  Object.assign(form, { id: undefined, kind, name: '', description: '', amount: '', icon: kind === 'add' ? 'star' : 'gift', sortOrder: (presets.data.value?.length ?? 0) + 1, active: true, showToStudents: true })
  error.value = ''
  editing.value = true
}
function openEdit(p: Preset) {
  Object.assign(form, { ...p, amount: String(p.amount) })
  error.value = ''
  editing.value = true
}
async function save() {
  error.value = ''
  const aErr = validateAmount(form.amount)
  if (aErr) return (error.value = aErr)
  if (!form.name.trim()) return (error.value = '請填寫名稱')
  try {
    await api.savePreset({ ...form, amount: parseAmount(form.amount) })
    editing.value = false
    toast.ok('已儲存')
  } catch (e) { error.value = errorMessage(e) }
}
async function quick(p: Preset, patch: Partial<Preset>) {
  try { await api.savePreset({ ...p, ...patch }) } catch (e) { toast.error(e) }
}
async function move(list: Preset[], i: number, dir: -1 | 1) {
  const a = list[i], b = list[i + dir]
  if (!a || !b) return
  try {
    await api.savePreset({ ...a, sortOrder: b.sortOrder })
    await api.savePreset({ ...b, sortOrder: a.sortOrder })
  } catch (e) { toast.error(e) }
}
</script>

<template>
  <div class="page">
    <h1>加點項目與小確幸</h1>
    <p class="muted">勾選「顯示於前台」的項目，學生可以在「小確幸」頁看到。未顯示的項目只出現在老師的加扣點按鈕。</p>

    <div class="grid-2" style="align-items: start">
      <section v-for="sec in [{ k: 'deduct' as const, t: '小確幸（扣點）', list: perks }, { k: 'add' as const, t: '加點項目', list: earns }]" :key="sec.k" class="card col">
        <div class="row between">
          <h2>{{ sec.t }}</h2>
          <button class="btn sm primary" type="button" :data-testid="`new-${sec.k}`" @click="openNew(sec.k)">＋ 新增</button>
        </div>
        <div v-for="(p, i) in sec.list" :key="p.id" class="item" :class="{ off: !p.active }" data-testid="preset-item">
          <div class="ic" :class="sec.k"><Icon :name="p.icon" :size="20" /></div>
          <div class="col grow" style="gap: 0">
            <span class="bold">{{ p.name }} <span class="num" :class="sec.k === 'add' ? 'in' : 'out'">{{ sec.k === 'add' ? '+' : '−' }}{{ formatPoints(p.amount) }}</span></span>
            <span class="xs muted">{{ p.description || '（無說明）' }}</span>
            <div class="row wrap" style="gap: 12px; margin-top: 4px">
              <label class="check xs"><input type="checkbox" :checked="p.showToStudents" @change="quick(p, { showToStudents: !p.showToStudents })">顯示於前台</label>
              <label class="check xs"><input type="checkbox" :checked="p.active" @change="quick(p, { active: !p.active })">啟用</label>
            </div>
          </div>
          <div class="col" style="gap: 2px">
            <button class="btn sm ghost" type="button" aria-label="上移" :disabled="i === 0" @click="move(sec.list, i, -1)">▲</button>
            <button class="btn sm ghost" type="button" aria-label="下移" :disabled="i === sec.list.length - 1" @click="move(sec.list, i, 1)">▼</button>
          </div>
          <button class="btn sm" type="button" @click="openEdit(p)"><Icon name="edit" :size="16" />編輯</button>
        </div>
        <p v-if="presets.data.value && !sec.list.length" class="empty">還沒有項目</p>
      </section>
    </div>

    <div v-if="editing" class="overlay" @click.self="editing = false">
      <form class="dialog" role="dialog" aria-modal="true" aria-label="編輯項目" novalidate @submit.prevent="save">
        <h2>{{ form.id ? '編輯' : '新增' }}{{ form.kind === 'add' ? '加點項目' : '小確幸' }}</h2>
        <div class="row">
          <button class="chip" :class="{ on: form.kind === 'deduct' }" type="button" @click="form.kind = 'deduct'">小確幸（扣點）</button>
          <button class="chip" :class="{ on: form.kind === 'add' }" type="button" @click="form.kind = 'add'">加點項目</button>
        </div>
        <div class="field"><label for="pn">名稱</label><input id="pn" v-model="form.name" class="input" maxlength="20" data-testid="preset-name"></div>
        <div class="field"><label for="pa">點數</label><input id="pa" v-model="form.amount" class="input num" inputmode="numeric" data-testid="preset-amount"></div>
        <div class="field"><label for="pd">說明（顯示給學生，最多 {{ DESCRIPTION_MAX }} 字）</label><input id="pd" v-model="form.description" class="input" :maxlength="DESCRIPTION_MAX"></div>
        <div class="field"><span class="label">圖示</span>
          <div class="row wrap" style="gap: 6px">
            <button v-for="ic in ICONS" :key="ic" class="btn sm" :class="{ ink: form.icon === ic }" type="button" :aria-label="ic" @click="form.icon = ic"><Icon :name="ic" :size="18" /></button>
          </div>
        </div>
        <label class="check"><input v-model="form.showToStudents" type="checkbox">顯示於學生前台</label>
        <label class="check"><input v-model="form.active" type="checkbox">啟用</label>
        <p v-if="error" class="error-text">{{ error }}</p>
        <div class="dialog-actions">
          <button class="btn" type="button" @click="editing = false">取消</button>
          <button class="btn primary" type="submit" data-testid="preset-save">儲存</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.item { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--line-2); }
.item.off { opacity: .55; }
.ic { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ic.add { background: var(--soft); color: var(--brand-dark); }
.ic.deduct { background: var(--red-soft); color: var(--red); }
</style>
