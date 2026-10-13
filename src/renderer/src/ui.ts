import { ref } from 'vue'

// Cross-component UI requests triggered by commands (shortcuts, palette).
export const focusSearchRequest = ref(0)
export const paletteOpen = ref(false)
export const settingsOpen = ref(false)
export const terminalOpen = ref(false)
// Scroll position of the commit list per repository; the list is re-created on every tab switch.
export const listScroll = new Map<string, number>()
