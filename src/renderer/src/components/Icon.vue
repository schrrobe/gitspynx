<script setup lang="ts">
// Small stroke icons (24×24 grid, currentColor) for toolbar and sidebar.
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
const PATHS: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  pull: 'M12 3v13M7 11l5 5 5-5M5 21h14',
  push: 'M12 21V8M7 13l5-5 5 5M5 3h14',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  stash: 'M3 13h5l1.5 3h5L16 13h5M5 13l2-8h10l2 8v6H5z',
  pop: 'M3 13h5l1.5 3h5L16 13h5M5 13l1-3M19 13l-1-3M5 13v6h14v-6M12 3v8M9 6l3-3 3 3',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  actions: 'M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35',
  chevron: 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  laptop: 'M5 5h14v10H5zM2 19h20',
  cloud: 'M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  worktree: 'M12 3v18M12 8l-5-3M12 13l6-4M12 18l-4-2',
  submodule: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
  check: 'M5 12l5 5 9-10',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z',
  plus: 'M12 5v14M5 12h14',
  file: 'M14 3H6v18h12V7zM14 3v4h4',
  pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  tree: 'M4 4h6v6H4zM14 14h6v6h-6zM7 10v7h7'
}
</script>

<template>
  <svg :width="props.size" :height="props.size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="PATHS[props.name] ?? ''" />
  </svg>
</template>
