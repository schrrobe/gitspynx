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

  async function save(patch: Partial<Settings>) {
    // plain object: IPC cannot clone reactive proxies
    const next = JSON.parse(JSON.stringify({ ...settings.value, ...patch }))
    settings.value = await window.gitspynx.saveSettings(next)
    apply(settings.value)
  }

  return { settings, load, save }
})
