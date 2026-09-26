import { afterEach } from 'vitest'
import { disposeDevices } from './api/helpers'

afterEach(async () => {
  await disposeDevices()
})
