export const LANE_COLORS = 10

// A line inside one row: 'top' runs from the row's top edge to the node's center line,
// 'bottom' from the center line to the bottom edge. x values are lane indexes.
export interface Segment {
  x1: number
  x2: number
  half: 'top' | 'bottom'
  color: number
}

export interface GraphRow {
  sha: string
  col: number
  color: number
  segments: Segment[]
}

interface Node {
  sha: string
  parents: string[]
}

// Assigns each commit (in topological order, children first) a lane and the line
// segments needed to draw it. Freed lanes are reused; lanes are never compacted.
// ponytail: recomputed over the whole list on every page load, move into a worker/incremental if profiling demands it
export function layoutGraph(commits: Node[]): { rows: GraphRow[]; width: number } {
  const lanes: (string | null)[] = [] // sha each lane is waiting for
  const colors: number[] = []
  let nextColor = 0
  let width = 0
  const alloc = (sha: string) => {
    let i = lanes.indexOf(null)
    if (i === -1) i = lanes.length
    lanes[i] = sha
    colors[i] = nextColor++ % LANE_COLORS
    return i
  }

  const rows = commits.map(({ sha, parents }) => {
    let col = lanes.indexOf(sha)
    const segments: Segment[] = []

    lanes.forEach((waiting, i) => {
      if (waiting === sha) {
        segments.push({ x1: i, x2: col, half: 'top', color: colors[i] })
        lanes[i] = null
      } else if (waiting !== null) {
        segments.push({ x1: i, x2: i, half: 'top', color: colors[i] })
        segments.push({ x1: i, x2: i, half: 'bottom', color: colors[i] })
      }
    })

    if (col === -1) col = alloc(sha) // branch tip: nothing above it
    const color = colors[col]
    lanes[col] = null
    const freeAfter: number[] = [] // freed only after all parents are placed, so no parent reuses them
    parents.forEach((p, n) => {
      let target = lanes.indexOf(p)
      if (n === 0 && target > col) {
        // keep the first-parent chain leftmost: the lane to the right bends into this one
        segments.find((s) => s.half === 'bottom' && s.x1 === target && s.x2 === target)!.x2 = col
        freeAfter.push(target)
        lanes[col] = p
        target = col
      } else if (target === -1) {
        if (n === 0) {
          lanes[col] = p // first parent continues straight down
          target = col
        } else {
          target = alloc(p)
        }
      }
      segments.push({ x1: col, x2: target, half: 'bottom', color: colors[target] })
    })
    for (const lane of freeAfter) lanes[lane] = null

    width = Math.max(width, lanes.length)
    return { sha, col, color, segments }
  })

  return { rows, width }
}
