<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { splitForIpc } from '../paste'
import { useRepo } from '../stores/repo'
import { useTabs } from '../stores/tabs'

// One shell per repository, kept while its tab is open — also while the panel is hidden. Shells
// start on first show; only the active repository's terminal is displayed.
const props = defineProps<{ visible: boolean; passKey: (e: KeyboardEvent) => boolean }>()
const repo = useRepo()
const tabs = useTabs()
const host = ref<HTMLElement>()
interface Session {
  id: number | null // null before start and after the shell exited
  term: Terminal
  fit: FitAddon
  el: HTMLElement
}
const sessions = new Map<string, Session>()
const byId = new Map<number, Session>()

async function start(path: string, s: Session) {
  try {
    const id = await window.gitspynx.terminalStart(path, s.term.cols, s.term.rows)
    if (sessions.get(path) !== s) return void window.gitspynx.terminalKill(id).catch(() => {}) // tab closed meanwhile
    s.id = id
    byId.set(id, s)
  } catch (e) {
    s.term.write(`\r\n[Terminal konnte nicht gestartet werden: ${e instanceof Error ? e.message : e}]\r\n`)
  }
}

async function show() {
  await nextTick()
  const path = repo.info?.path
  if (!props.visible || !path || !host.value) return
  for (const [p, s] of sessions) s.el.style.display = p === path ? '' : 'none'
  let s = sessions.get(path)
  if (!s) {
    const el = document.createElement('div')
    el.className = 'session'
    host.value.appendChild(el)
    const term = new Terminal({ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.attachCustomKeyEventHandler((e) => !(e.type === 'keydown' && props.passKey(e))) // false: xterm ignores it, the app gets it
    term.open(el)
    fit.fit()
    s = { id: null, term, fit, el }
    sessions.set(path, s)
    const session = s
    term.onData((d) => {
      if (session.id === null) return
      for (const part of splitForIpc(d)) window.gitspynx.terminalWrite(session.id, part).catch(() => {}) // large pastes in pieces
    })
    // the single place that tells the shell its size (window resize, zoom, tab switch)
    term.onResize(({ cols, rows }) => session.id !== null && window.gitspynx.terminalResize(session.id, cols, rows))
    await start(path, s)
  }
  s.fit.fit()
  if (repo.info?.path === path && props.visible) s.term.focus() // never focus a terminal that is hidden by now
}

const stopData = window.gitspynx.onTerminalData((id, data) => byId.get(id)?.term.write(data))
const stopExit = window.gitspynx.onTerminalExit((id, code) => {
  const s = byId.get(id)
  if (!s) return
  byId.delete(id)
  s.id = null
  s.term.write(`\r\n[Shell beendet (${code}) – Enter startet eine neue]\r\n`)
  const restart = s.term.onData((d) => {
    if (d !== '\r') return
    restart.dispose()
    const path = [...sessions].find(([, x]) => x === s)?.[0]
    if (path) start(path, s)
  })
})

const observer = new ResizeObserver(() => {
  const s = repo.info && sessions.get(repo.info.path)
  if (s && props.visible && s.el.style.display !== 'none') s.fit.fit()
})
watch(host, (el) => el && observer.observe(el), { immediate: true })
watch([() => repo.info?.path, () => props.visible], show, { immediate: true })

// A closed tab ends its shell.
watch(
  () => [...tabs.tabs],
  (open) => {
    for (const [path, s] of sessions) {
      if (open.includes(path)) continue
      if (s.id !== null) {
        byId.delete(s.id)
        window.gitspynx.terminalKill(s.id).catch(() => {})
      }
      s.term.dispose()
      s.el.remove()
      sessions.delete(path)
    }
  }
)

onUnmounted(() => {
  stopData()
  stopExit()
  observer.disconnect()
  for (const s of sessions.values()) {
    if (s.id !== null) window.gitspynx.terminalKill(s.id).catch(() => {})
    s.term.dispose()
  }
})
</script>

<template>
  <section class="terminal" aria-label="Terminal">
    <div ref="host" class="host" />
  </section>
</template>

<style scoped>
.terminal { grid-area: term; height: 260px; border-top: 1px solid var(--border); background: #111317; padding: 4px 0 0 8px; min-width: 0; }
.host { height: 100%; }
.host :deep(.session) { height: 100%; }
</style>
