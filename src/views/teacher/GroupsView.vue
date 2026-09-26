<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import type { Group } from '../../domain/types'
import { promptDialog, toast, confirmDialog } from '../../ui/feedback'
import Icon from '../../components/Icon.vue'

const students = useLive(() => api.listStudents())
const groups = useLive(() => api.listGroups())
const dragging = ref<string | null>(null)
const over = ref<string | null>(null)

const active = computed(() => (groups.data.value ?? []).filter((g) => g.active))
const membersOf = (gid: string | null) => (students.data.value ?? []).filter((s) => (s.groupId ?? null) === gid)

async function move(uid: string, gid: string | null) {
  try { await api.assignGroup(uid, gid) } catch (e) { toast.error(e) }
}
function onDrop(gid: string | null) {
  if (dragging.value) move(dragging.value, gid)
  dragging.value = null
  over.value = null
}
async function addGroup() {
  const name = await promptDialog({ title: '新增組別', label: '組名', placeholder: `第 ${active.value.length + 1} 組`, okText: '新增', maxLength: 12 })
  if (!name) return
  try { await api.saveGroup({ name, color: '#06C755', sortOrder: (groups.data.value?.length ?? 0) + 1, active: true }) } catch (e) { toast.error(e) }
}
async function rename(g: Group) {
  const name = await promptDialog({ title: '修改組名', label: '組名', placeholder: g.name, okText: '儲存', maxLength: 12 })
  if (!name) return
  try { await api.saveGroup({ ...g, name }) } catch (e) { toast.error(e) }
}
async function remove(g: Group) {
  if (!(await confirmDialog({ title: `停用「${g.name}」？`, message: '組員會變成未分組；過去的小組獎勵紀錄不受影響。', danger: true, okText: '停用' }))) return
  try { await api.saveGroup({ ...g, active: false }) } catch (e) { toast.error(e) }
}
</script>

<template>
  <div class="page" style="max-width: 1320px">
    <div class="row between wrap">
      <h1>分組管理</h1>
      <button class="btn primary" type="button" @click="addGroup">＋ 新增組別</button>
    </div>
    <p class="muted">把學生卡片拖到組別中；在 iPad 上可以用卡片右邊的選單調整。每位學生只屬於一組。</p>
    <div class="board">
      <section v-for="col in [...active.map((g) => ({ g, id: g.id as string | null })), { g: null, id: null }]" :key="col.id ?? 'none'"
               class="colm" :class="{ over: over === (col.id ?? 'none') }"
               @dragover.prevent="over = col.id ?? 'none'" @dragleave="over = null" @drop.prevent="onDrop(col.id)">
        <div class="row between">
          <h3>{{ col.g ? col.g.name : '未分組' }} <span class="muted small">{{ membersOf(col.id).length }} 人</span></h3>
          <div v-if="col.g" class="row" style="gap: 2px">
            <button class="btn sm ghost" type="button" aria-label="修改組名" @click="rename(col.g)"><Icon name="edit" :size="16" /></button>
            <button class="btn sm ghost" type="button" aria-label="停用組別" @click="remove(col.g)"><Icon name="x" :size="16" /></button>
          </div>
        </div>
        <div class="col" style="gap: 6px">
          <div v-for="s in membersOf(col.id)" :key="s.uid" class="stu" draggable="true" @dragstart="dragging = s.uid" @dragend="dragging = null">
            <span class="num xs muted">{{ s.seatNo }}</span>
            <span class="grow bold">{{ s.name }}</span>
            <select class="mini" :value="s.groupId ?? ''" :aria-label="`${s.name} 的組別`" @change="move(s.uid, ($event.target as HTMLSelectElement).value || null)">
              <option value="">未分組</option>
              <option v-for="g in active" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.board { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.colm { background: #fff; border: 1.5px solid var(--line); border-radius: 18px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 140px; }
.colm.over { border-color: var(--brand-dark); background: var(--soft); }
.stu { display: flex; align-items: center; gap: 8px; background: var(--bg); border-radius: 10px; padding: 6px 8px; cursor: grab; }
.mini { border: 1px solid var(--line); border-radius: 8px; background: #fff; font-size: 13px; padding: 4px; max-width: 92px; }
</style>
