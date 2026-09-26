import { reactive } from 'vue'
import { BankError } from '../api/types'

// ---------- 錯誤訊息 ----------
export function errorMessage(e: unknown): string {
  if (e instanceof BankError) return e.message
  if (e instanceof Error) return e.message || '發生錯誤，請再試一次'
  return '發生錯誤，請再試一次'
}

// ---------- Toast ----------
export interface ToastItem {
  id: number
  kind: 'ok' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

export const toasts = reactive<ToastItem[]>([])
let seq = 0

function push(kind: ToastItem['kind'], text: string, action?: ToastItem['action'], ms = 4000) {
  const id = ++seq
  toasts.push({ id, kind, text, action })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, action ? 8000 : ms)
}

export const toast = {
  ok: (text: string, action?: ToastItem['action']) => push('ok', text, action),
  error: (e: unknown) => push('error', errorMessage(e), undefined, 6000),
  dismiss: (id: number) => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  },
}

// ---------- 確認對話框（Promise 形式） ----------
export interface DialogState {
  open: boolean
  title: string
  message: string
  okText: string
  cancelText: string
  danger: boolean
  input: null | { label: string; placeholder: string; value: string; required: boolean; maxLength: number }
  resolve: ((v: string | boolean | null) => void) | null
}

export const dialog = reactive<DialogState>({
  open: false, title: '', message: '', okText: '確定', cancelText: '取消', danger: false, input: null, resolve: null,
})

export function confirmDialog(opts: { title: string; message?: string; okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    Object.assign(dialog, {
      open: true, title: opts.title, message: opts.message ?? '', okText: opts.okText ?? '確定', cancelText: '取消',
      danger: !!opts.danger, input: null,
      resolve: (v: string | boolean | null) => resolve(v === true),
    })
  })
}

export function promptDialog(opts: { title: string; message?: string; label: string; placeholder?: string; okText?: string; required?: boolean; danger?: boolean; maxLength?: number }): Promise<string | null> {
  return new Promise((resolve) => {
    Object.assign(dialog, {
      open: true, title: opts.title, message: opts.message ?? '', okText: opts.okText ?? '確定', cancelText: '取消',
      danger: !!opts.danger,
      input: { label: opts.label, placeholder: opts.placeholder ?? '', value: '', required: opts.required ?? true, maxLength: opts.maxLength ?? 50 },
      resolve: (v: string | boolean | null) => resolve(typeof v === 'string' ? v : null),
    })
  })
}

export function closeDialog(result: string | boolean | null) {
  const r = dialog.resolve
  dialog.open = false
  dialog.resolve = null
  r?.(result)
}
