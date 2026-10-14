// Width of the graph column. Very wide graphs (git/git: 158 lanes, ~2200 px) would push subject,
// author and date out of view, so the automatic width is capped; the user can drag it wider.
export const LANE_PX = 22 // room for an avatar node
export const AUTO_GRAPH_PX = 330

export const graphColumnPx = (lanes: number, setting: number | null) => Math.min(lanes * LANE_PX, setting ?? AUTO_GRAPH_PX)

// A node in a lane beyond the visible width is drawn at the last visible lane, marked as clipped.
export function nodeLane(col: number, columnPx: number): { lane: number; clipped: boolean } {
  const last = Math.max(0, Math.floor(columnPx / LANE_PX) - 1)
  return col > last ? { lane: last, clipped: true } : { lane: col, clipped: false }
}
