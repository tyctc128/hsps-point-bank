<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api'
import { session } from '../../session'
import { useLive } from '../../ui/live'
import TxDetail from '../../components/TxDetail.vue'
import Icon from '../../components/Icon.vue'

const route = useRoute()
const router = useRouter()
const tx = useLive(() => api.getTransaction(String(route.params.id)))
watch(() => route.params.id, () => tx.reload())
</script>

<template>
  <div class="page" style="max-width: 720px">
    <button class="btn ghost sm" type="button" style="align-self: flex-start" @click="router.back()"><Icon name="arrow-left" :size="18" />返回</button>
    <p v-if="tx.error.value" class="notice err">{{ tx.error.value }}</p>
    <TxDetail v-if="tx.data.value" :key="tx.data.value.id" :tx="tx.data.value" :viewer-uid="session.user?.uid ?? null" link-base="/tx/" />
  </div>
</template>
