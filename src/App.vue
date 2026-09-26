<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppOverlays from './components/AppOverlays.vue'
import { session } from './session'

const router = useRouter()
const route = useRoute()

// 被登出（例如帳號停用）時回到登入頁
watch(() => session.user, (u, old) => {
  if (old && !u && !route.meta.public) router.replace('/login')
})
</script>

<template>
  <RouterView />
  <AppOverlays />
</template>
