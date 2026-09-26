<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api'
import { useLive } from '../../ui/live'
import { approveTx, rejectTx, reverseTx } from '../../ui/actions'
import TxDetail from '../../components/TxDetail.vue'
import Icon from '../../components/Icon.vue'

const route = useRoute()
const router = useRouter()
const tx = useLive(() => api.getTransaction(String(route.params.id)))
watch(() => route.params.id, () => tx.reload())
</script>

<template>
  <div class="page" style="max-width: 760px">
    <button class="btn ghost sm" type="button" style="align-self: flex-start" @click="router.back()"><Icon name="arrow-left" :size="18" />返回</button>
    <p v-if="tx.error.value" class="notice err">{{ tx.error.value }}</p>
    <TxDetail v-if="tx.data.value" :key="tx.data.value.id" :tx="tx.data.value" :viewer-uid="null" link-base="/t/tx/">
      <template v-if="tx.data.value.status === 'pending'">
        <button class="btn sm danger" type="button" @click="rejectTx(tx.data.value)">駁回</button>
        <button class="btn sm primary" type="button" @click="approveTx(tx.data.value)">核准</button>
      </template>
      <button v-if="tx.data.value.status === 'approved' && !tx.data.value.reversedBy && tx.data.value.type !== 'reversal'"
              class="btn sm danger" type="button" @click="reverseTx(tx.data.value)">沖正</button>
      <RouterLink v-if="tx.data.value.batchId" :to="`/t/ledger?batch=${tx.data.value.batchId}`" class="btn sm">查看同批次</RouterLink>
    </TxDetail>
  </div>
</template>
