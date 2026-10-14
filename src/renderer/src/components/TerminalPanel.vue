<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { splitForIpc } from '../paste'
import { useRepo } from '../stores/repo'
import { useSettings } from '../stores/settings'
import { useTabs } from '../stores/tabs'
import { terminalOpen } from '../ui'

// Shells per repository, kept while its tab is open — also while the panel is hidden. The first
// starts on first show; more can be added. Only the active shell of the shown repository is
// displayed.
const props = defineProps<{ visible: boolean; passKey: (e: KeyboardEvent) => boolean }>()
const repo = useRepo()
const tabs = useTabs()
const settings = useSettings()
const host = ref<HTMLElement>()
interface Session {
  id: number | null // null before start and after the shell exited
  term: Terminal
  fit: FitAddon
  el: HTMLElement
  label: number
}
interface Shells {
  list: Session[]
  active: number
  next: number // label of the next shell ("Shell 2" …)
}
const shells = new Map<string, Shells>()
const byId = new Map<number, Session>()
const changed = ref(0) // shells live outside Vue's reactivity; bumped for the shell bar
const shown = () => (repo.info ? shells.get(repo.info.path) : undefined)
// a fresh snapshot per change, so the bar re-renders (the arrays themselves are not reactive)
const bar = computed(() => (changed.value, shown() ? { list: [...shown()!.list], active: shown()!.active } : null))
const pathOf = (s: Session) => [...shells].find(([, r]) => r.list.includes(s))?.[0]

async function start(path: string, s: Session) {
  try {
    const id = await window.gitspynx.terminalStart(path, s.term.cols, s.term.rows)
    if (pathOf(s) !== path) return void window.gitspynx.terminalKill(id).catch(() => {}) // closed meanwhile
    s.id = id
    byId.set(id, s)
  } catch (e) {
    s.term.write(`\r\n[Terminal konnte nicht gestartet werden: ${e instanceof Error ? e.message : e}]\r\n`)
  }
}

function create(path: string, r: Shells): Session {
  const el = document.createElement('div')
  el.className = 'session'
  host.value!.appendChild(el)
  const term = new Terminal({ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, cursorBlink: true })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.attachCustomKeyEventHandler((e) => !(e.type === 'keydown' && props.passKey(e))) // false: xterm ignores it, the app gets it
  term.open(el)
  fit.fit()
  const s: Session = { id: null, term, fit, el, label: r.next++ }
  term.onData((d) => {
    if (s.id === null) return
    for (const part of splitForIpc(d)) window.gitspynx.terminalWrite(s.id, part).catch(() => {}) // large pastes in pieces
  })
  // the single place that tells the shell its size (window resize, zoom, tab switch)
  term.onResize(({ cols, rows }) => s.id !== null && window.gitspynx.terminalResize(s.id, cols, rows))
  r.list.push(s)
  void start(path, s)
  return s
}

async function show() {
  await nextTick()
  const path = repo.info?.path
  if (!props.visible || !path || !host.value) return
  let r = shells.get(path)
  if (!r) shells.set(path, (r = { list: [], active: 0, next: 1 }))
  if (!r.list.length) create(path, r)
  const active = r.list[r.active]
  for (const other of shells.values()) for (const s of other.list) s.el.style.display = s === active ? '' : 'none'
  changed.value++
  active.fit.fit()
  if (repo.info?.path === path && props.visible) active.term.focus() // never focus a terminal that is hidden by now
}

function addShell() {
  const r = shown()
  if (!r || !repo.info) return
  create(repo.info.path, r)
  r.active = r.list.length - 1
  void show()
}

function selectShell(i: number) {
  const r = shown()
  if (!r) return
  r.active = i
  void show()
}

function dispose(s: Session) {
  if (s.id !== null) {
    byId.delete(s.id)
    window.gitspynx.terminalKill(s.id).catch(() => {})
  }
  s.term.dispose()
  s.el.remove()
}

// Closing the last shell hides the panel; showing it again starts a new one.
function closeShell(i: number) {
  const r = shown()
  if (!r) return
  dispose(r.list.splice(i, 1)[0])
  r.active = Math.max(0, Math.min(r.active, r.list.length - 1))
  changed.value++
  if (!r.list.length) terminalOpen.value = false
  else void show()
}

// Acknowledged once xterm has processed it, so main can pause a shell that floods the window.
const stopData = window.gitspynx.onTerminalData((id, data) =>
  byId.get(id)?.term.write(data, () => void window.gitspynx.terminalAck(id, data.length).catch(() => {}))
)
const stopExit = window.gitspynx.onTerminalExit((id, code) => {
  const s = byId.get(id)
  if (!s) return
  byId.delete(id)
  s.id = null
  s.term.write(`\r\n[Shell beendet (${code}) – Enter startet eine neue]\r\n`)
  const restart = s.term.onData((d) => {
    if (d !== '\r') return
    restart.dispose()
    const path = pathOf(s)
    if (path) void start(path, s)
  })
})

const observer = new ResizeObserver(() => {
  const r = shown()
  const s = r?.list[r.active]
  if (s && props.visible && s.el.style.display !== 'none') s.fit.fit()
})
watch(host, (el) => el && observer.observe(el), { immediate: true })
watch([() => repo.info?.path, () => props.visible], show, { immediate: true })

// A closed tab ends its shells.
watch(
  () => [...tabs.tabs],
  (open) => {
    for (const [path, r] of shells) {
      if (open.includes(path)) continue
      r.list.forEach(dispose)
      shells.delete(path)
    }
    changed.value++
  }
)

// Height: drag the top edge (or ↑/↓ on it); saved in the settings.
const dragHeight = ref<number | null>(null)
const height = computed(() => dragHeight.value ?? settings.settings.terminalHeight)
const clampHeight = (h: number) => Math.round(Math.min(window.innerHeight * 0.8, Math.max(120, h)))
function startResize(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const [y0, h0] = [e.clientY, height.value]
  const move = (m: PointerEvent) => (dragHeight.value = clampHeight(h0 - (m.clientY - y0)))
  const up = () => {
    el.removeEventListener('pointermove', move)
    if (dragHeight.value !== null) void settings.save({ terminalHeight: dragHeight.value })
    dragHeight.value = null
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up, { once: true })
}
function resizeKey(e: KeyboardEvent) {
  const step = { ArrowUp: 20, ArrowDown: -20 }[e.key]
  if (step === undefined) return
  e.preventDefault()
  void settings.save({ terminalHeight: clampHeight(height.value + step) })
}

onUnmounted(() => {
  stopData()
  stopExit()
  observer.disconnect()
  for (const r of shells.values()) r.list.forEach(dispose)
})
</script>

<template>
  <section class="terminal" aria-label="Terminal" :style="{ height: `${height}px` }">
    <div
      class="resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Höhe des Terminals (↑/↓)"
      :aria-valuenow="height"
      tabindex="0"
      title="Ziehen: Terminal höher/niedriger"
      @pointerdown.prevent="startResize"
      @keydown="resizeKey"
    />
    <div class="bar" role="tablist" aria-label="Shells">
      <span v-for="(s, i) in bar?.list ?? []" :key="s.label" class="shell" :class="{ active: i === bar?.active }">
        <button role="tab" :aria-selected="i === bar?.active" @click="selectShell(i)">Shell {{ s.label }}</button>
        <button class="close" :aria-label="`Shell ${s.label} schließen`" title="Shell beenden" @click="closeShell(i)">×</button>
      </span>
      <button class="add" aria-label="Neue Shell" title="Neue Shell in diesem Repository" @click="addShell">+</button>
    </div>
    <div ref="host" class="host" />
  </section>
</template>

<style scoped>
.terminal { grid-area: term; position: relative; display: flex; flex-direction: column; border-top: 1px solid var(--border); background: #111317; min-width: 0; }
.resize { position: absolute; top: -3px; left: 0; right: 0; height: 6px; cursor: row-resize; z-index: 1; }
.resize:hover, .resize:focus-visible { background: color-mix(in srgb, var(--accent) 45%, transparent); outline: none; }
.bar { display: flex; align-items: center; gap: 2px; padding: 3px 6px 0; flex: none; }
.shell { display: flex; align-items: center; border-radius: 5px 5px 0 0; color: #9aa3b2; }
.shell.active { background: #1c1f26; color: #d7dae0; }
.bar button { border: 0; background: none; color: inherit; font-size: 12px; padding: 2px 8px; }
.shell .close { padding: 2px 6px 2px 0; }
.shell .close:hover { color: var(--danger); }
.bar .add { color: #9aa3b2; }
.host { flex: 1; min-height: 0; padding: 4px 0 0 8px; }
.host :deep(.session) { height: 100%; }
</style>
