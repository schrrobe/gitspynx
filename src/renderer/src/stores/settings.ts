import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'

export const useSettings = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })

  // data-theme on <html> overrides the system preference in style.css
  function apply(s: Settings) {
    if (s.theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = s.theme
  }

  async function load() {
    settings.value = await window.gitspynx.getSettings()
    apply(settings.value)
  }

  // Applied at once so an overlapping save builds on it; only the newest reply is taken over.
  let seq = 0
  async function save(patch: Partial<Settings>) {
    settings.value = { ...settings.value, ...patch }
    apply(settings.value)
    const my = ++seq
    // plain object: IPC cannot clone reactive proxies
    const saved = await window.gitspynx.saveSettings(JSON.parse(JSON.stringify(settings.value)))
    if (my !== seq) return
    settings.value = saved
    apply(saved)
  }

  return { settings, load, save }
})
