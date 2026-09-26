<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { closeDialog, dialog, toast, toasts } from '../ui/feedback'

const inputEl = ref<HTMLInputElement | null>(null)
const okEl = ref<HTMLButtonElement | null>(null)

watch(() => dialog.open, async (open) => {
  if (!open) return
  await nextTick()
  if (dialog.input) inputEl.value?.focus()
  else okEl.value?.focus()
})

function ok() {
  if (dialog.input) {
    const v = dialog.input.value.trim()
    if (dialog.input.required && !v) return
    closeDialog(v)
  } else closeDialog(true)
}
</script>

<template>
  <div v-if="dialog.open" class="overlay" @click.self="closeDialog(null)" @keydown.esc="closeDialog(null)">
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="dialog.title">
      <h2>{{ dialog.title }}</h2>
      <p v-if="dialog.message" class="muted" style="white-space: pre-line">{{ dialog.message }}</p>
      <div v-if="dialog.input" class="field">
        <label for="dlg-input">{{ dialog.input.label }}</label>
        <input id="dlg-input" ref="inputEl" v-model="dialog.input.value" class="input" :placeholder="dialog.input.placeholder"
               :maxlength="dialog.input.maxLength" @keydown.enter="ok">
      </div>
      <div class="dialog-actions">
        <button class="btn" type="button" @click="closeDialog(null)">{{ dialog.cancelText }}</button>
        <button ref="okEl" class="btn" :class="dialog.danger ? 'danger-fill' : 'primary'" type="button"
                :disabled="!!dialog.input && dialog.input.required && !dialog.input.value.trim()" @click="ok">{{ dialog.okText }}</button>
      </div>
    </div>
  </div>

  <div class="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="{ error: t.kind === 'error' }" role="status">
      <span class="grow">{{ t.text }}</span>
      <button v-if="t.action" class="btn sm" type="button" @click="t.action.run(); toast.dismiss(t.id)">{{ t.action.label }}</button>
    </div>
  </div>
</template>
