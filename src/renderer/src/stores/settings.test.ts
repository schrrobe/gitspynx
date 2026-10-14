import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'
import { useSettings } from './settings'

let sent: Settings[]
let replies: ((s: Settings) => void)[]

beforeEach(() => {
  setActivePinia(createPinia())
  sent = []
  replies = []
  ;(globalThis as unknown as { window: unknown }).window = {
    gitspynx: { saveSettings: (s: Settings) => (sent.push(s), new Promise<Settings>((r) => replies.push(() => r(s)))) }
  }
  ;(globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } }
})

it('keeps both patches when two saves overlap', async () => {
  const store = useSettings()
  const a = store.save({ zoom: 1.5 })
  const b = store.save({ theme: 'light' })
  replies.forEach((r) => r(DEFAULT_SETTINGS))
  await Promise.all([a, b])
  expect(sent.at(-1)).toMatchObject({ zoom: 1.5, theme: 'light' })
  expect(store.settings).toMatchObject({ zoom: 1.5, theme: 'light' })
})
