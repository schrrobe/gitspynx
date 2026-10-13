import { describe, expect, it } from 'vitest'
import { AUTO_GRAPH_PX, graphColumnPx, LANE_PX, nodeLane } from './column'

describe('graph column', () => {
  it('shows narrow graphs in full and caps wide ones unless the user set a width', () => {
    expect(graphColumnPx(5, null)).toBe(5 * LANE_PX)
    expect(graphColumnPx(158, null)).toBe(AUTO_GRAPH_PX)
    expect(graphColumnPx(158, 700)).toBe(700)
    expect(graphColumnPx(5, 700)).toBe(5 * LANE_PX) // never wider than the graph itself
  })

  it('keeps a node in a cut-off lane visible at the right edge', () => {
    expect(nodeLane(3, 10 * LANE_PX)).toEqual({ lane: 3, clipped: false })
    expect(nodeLane(40, 10 * LANE_PX)).toEqual({ lane: 9, clipped: true })
  })
})
