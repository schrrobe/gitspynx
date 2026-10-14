import { describe, expect, it } from 'vitest'
import { allSegments, layoutGraph, type Segment } from './layout'

const c = (sha: string, ...parents: string[]) => ({ sha, parents })
// Order-independent view of a row's segments without colors.
const segs = (s: Segment[]) =>
  s.map(({ x1, x2, half }) => `${half}:${x1}->${x2}`).sort()

describe('layoutGraph', () => {
  it('keeps linear history in one lane', () => {
    const { rows, width } = layoutGraph([c('c3', 'c2'), c('c2', 'c1'), c('c1')])
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0])
    expect(segs(allSegments(rows[0]))).toEqual(['bottom:0->0'])
    expect(segs(allSegments(rows[1]))).toEqual(['bottom:0->0', 'top:0->0'])
    expect(segs(allSegments(rows[2]))).toEqual(['top:0->0'])
    expect(width).toBe(1)
  })

  it('opens a lane for the second merge parent and joins it back', () => {
    const { rows, width } = layoutGraph([c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')])
    expect(rows.map((r) => r.col)).toEqual([0, 0, 1, 0])
    expect(segs(allSegments(rows[0]))).toEqual(['bottom:0->0', 'bottom:0->1'])
    expect(segs(allSegments(rows[1]))).toEqual(['bottom:0->0', 'bottom:1->1', 'top:0->0', 'top:1->1'])
    expect(segs(allSegments(rows[2]))).toEqual(['bottom:0->0', 'bottom:1->0', 'top:0->0', 'top:1->1'])
    expect(segs(allSegments(rows[3]))).toEqual(['top:0->0'])
    expect(width).toBe(2)
  })

  it('gives a second branch tip its own lane and color', () => {
    const { rows } = layoutGraph([c('X', 'R'), c('Y', 'R'), c('R')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0])
    expect(rows[1].color).not.toBe(rows[0].color)
    expect(segs(allSegments(rows[1]))).toEqual(['bottom:0->0', 'bottom:1->0', 'top:0->0'])
  })

  it('colors a merge-in segment with the lane it comes from', () => {
    const { rows } = layoutGraph([c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')])
    const toSecondLane = rows[0].segments.find((s) => s.x2 === 1)!
    expect(toSecondLane.color).toBe(rows[2].color)
  })

  it('pulls a first parent tracked further right into the current lane', () => {
    // main: M -> H -> W ; feature: F2 -> F1 -> W ; S is a later tip on W
    const { rows } = layoutGraph([c('M', 'H', 'F2'), c('F2', 'F1'), c('F1', 'W'), c('H', 'W'), c('S', 'W'), c('W')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 1, 0, 1, 0])
    expect(segs(allSegments(rows[3]))).toEqual(['bottom:0->0', 'bottom:1->0', 'top:0->0', 'top:1->1'])
    expect(rows[5].color).toBe(rows[0].color)
  })

  it('does not cross lines when a merge pulls its first parent left', () => {
    // C waits on M (lane 0) and P (lane 1); M's first parent P bends left, Q needs a fresh lane
    const { rows } = layoutGraph([c('C', 'M', 'P'), c('M', 'P', 'Q'), c('P'), c('Q')])
    expect(segs(allSegments(rows[1]))).toEqual(['bottom:0->0', 'bottom:0->2', 'bottom:1->0', 'top:0->0', 'top:1->1'])
  })

  it('reuses a freed lane for a later tip', () => {
    const { rows, width } = layoutGraph([c('M', 'A', 'B'), c('B', 'A'), c('A'), c('T', 'U'), c('U')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0, 0])
    expect(width).toBe(2)
  })

  it('stores straight lanes compactly instead of as segment objects', () => {
    // four tips with their own parents: four lanes stay open until the roots
    const { rows } = layoutGraph(['A', 'B', 'C', 'D'].map((x) => c(`${x}1`, `${x}0`)).concat(['A', 'B', 'C', 'D'].map((x) => c(`${x}0`))))
    const d1 = rows[3] // lanes 0-2 pass straight through, D1 starts lane 3
    expect(d1.through).toBeInstanceOf(Uint16Array)
    expect([...d1.through].filter((_, i) => i % 2 === 0)).toEqual([0, 1, 2])
    expect(segs(d1.segments)).toEqual(['bottom:3->3'])
    expect(segs(allSegments(d1))).toEqual(['bottom:0->0', 'bottom:1->1', 'bottom:2->2', 'bottom:3->3', 'top:0->0', 'top:1->1', 'top:2->2'])
  })

  it('continues a previous layout when commits were only appended, and starts over otherwise', () => {
    const all = [c('M', 'A', 'B'), c('A', 'R'), c('X', 'B'), c('B', 'R'), c('R')]
    const full = layoutGraph(all)
    const firstPage = layoutGraph(all.slice(0, 2))
    const continued = layoutGraph(all, firstPage)
    expect(continued.rows[0]).toBe(firstPage.rows[0]) // earlier rows reused, not recomputed
    expect(continued.rows.map((r) => [r.col, segs(allSegments(r))])).toEqual(full.rows.map((r) => [r.col, segs(allSegments(r))]))
    expect(continued.width).toBe(full.width)
    const other = [c('Z')]
    expect(layoutGraph(other, firstPage).rows.map((r) => r.sha)).toEqual(['Z'])
  })
})
