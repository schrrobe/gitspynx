export type Theme = 'system' | 'light' | 'dark'
export type PullMode = 'ff-only' | 'rebase' | 'merge'

export interface Settings {
  version: 1
  theme: Theme
  zoom: number // 0.8 – 2
  pullMode: PullMode // what the Pull button does
  keymap: Record<string, string> // command id -> combo, overrides the defaults
  graphWidth: number | null // graph column in px; null = automatic
}

export const DEFAULT_SETTINGS: Settings = { version: 1, theme: 'system', zoom: 1, pullMode: 'ff-only', keymap: {}, graphWidth: null }

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback

// Tolerant reader for settings.json: unknown or invalid values fall back to defaults. Unversioned
// files (none exist yet) are treated as version 1; future versions migrate here.
export function parseSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const zoom = typeof r.zoom === 'number' && Number.isFinite(r.zoom) ? Math.min(2, Math.max(0.8, r.zoom)) : DEFAULT_SETTINGS.zoom
  const keymap = Object.fromEntries(
    Object.entries(r.keymap && typeof r.keymap === 'object' ? r.keymap : {}).filter(([, v]) => typeof v === 'string')
  ) as Record<string, string>
  return {
    version: 1,
    theme: oneOf(r.theme, ['system', 'light', 'dark'] as const, DEFAULT_SETTINGS.theme),
    zoom,
    pullMode: oneOf(r.pullMode, ['ff-only', 'rebase', 'merge'] as const, DEFAULT_SETTINGS.pullMode),
    keymap,
    graphWidth: typeof r.graphWidth === 'number' && Number.isFinite(r.graphWidth) ? Math.min(4000, Math.max(28, Math.round(r.graphWidth))) : null
  }
}
