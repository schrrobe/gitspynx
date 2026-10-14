import { ref, shallowRef } from 'vue'

// Cross-component UI requests triggered by commands (shortcuts, palette).
export const focusSearchRequest = ref(0)
export const paletteOpen = ref(false)
export const settingsOpen = ref(false)
export const terminalOpen = ref(false)
// Scroll position of the commit list per repository; the list is re-created on every tab switch.
export const listScroll = new Map<string, number>()
// Collapsed sidebar sections ("local") and folders ("local:feature"), kept across tab switches.
export const sidebarCollapsed = shallowRef(new Set<string>(['tags'])) // tags start collapsed, as in GitKraken
// Files of a commit as plain paths or as a folder tree (the Path / Tree switch).
export const fileView = ref<'path' | 'tree'>('path')
