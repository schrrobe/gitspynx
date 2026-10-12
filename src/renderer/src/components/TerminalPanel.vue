<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { useRepo } from '../stores/repo'
import { useTabs } from '../stores/tabs'

// One shell per repository, kept while its tab is open; only the active repo's terminal is shown.
const repo = useRepo()
const tabs = useTabs()
const host = ref<HTMLElement>()
interface Session {
  id: number | null // null after the shell exited
  term: Terminal
  fit: FitAddon
  el: HTMLElement
}
const sessions = new Map<string, Session>()
const byId = new Map<number, Session>()

async function start(path: string, s: Session) {
  s.id = await window.gitspynx.terminalStart(path)
  byId.set(s.id, s)
  s.fit.fit()
  await window.gitspynx.terminalResize(s.id, s.term.cols, s.term.rows)
}

async function show(path: string | undefined) {
  await nextTick()
  if (!path || !host.value) return
  for (const [p, s] of sessions) s.el.style.display = p === path ? '' : 'none'
  let s = sessions.get(path)
  if (!s) {
    const el = document.createElement('div')
    el.className = 'session'
    host.value.appendChild(el)
    const term = new Terminal({ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, cursorBlink: true, allowProposedApi: false })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    s = { id: null, term, fit, el }
    sessions.set(path, s)
    const session = s
    term.onData((d) => session.id !== null && window.gitspynx.terminalWrite(session.id, d))
    await start(path, s)
  }
  s.fit.fit()
  s.term.focus()
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

// Fit to the panel; tell the shell its new size.
const observer = new ResizeObserver(() => {
  const s = repo.info && sessions.get(repo.info.path)
  if (!s || s.el.style.display === 'none') return
  s.fit.fit()
  if (s.id !== null) window.gitspynx.terminalResize(s.id, s.term.cols, s.term.rows)
})
watch(host, (el) => el && observer.observe(el), { immediate: true })
watch(() => repo.info?.path, show, { immediate: true })

// A closed tab ends its shell.
watch(
  () => [...tabs.tabs],
  (open) => {
    for (const [path, s] of sessions) {
      if (open.includes(path)) continue
      if (s.id !== null) window.gitspynx.terminalKill(s.id).catch(() => {})
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
