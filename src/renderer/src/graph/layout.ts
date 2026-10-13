export const LANE_COLORS = 10

// A line inside one row: 'top' runs from the row's top edge to the node's center line,
// 'bottom' from the center line to the bottom edge. x values are lane indexes.
export interface Segment {
  x1: number
  x2: number
  half: 'top' | 'bottom'
  color: number
}

// Lanes that pass a row straight through (top and bottom half) are by far the most common
// line in big histories (git/git: ~130 per row), so they are packed as (lane, color) pairs
// instead of segment objects; segments hold only bends, starts and ends.
export interface GraphRow {
  sha: string
  col: number
  color: number
  segments: Segment[]
  through: Uint16Array
}

// Every line of a row, straight lanes expanded (tests, simple consumers).
export function allSegments(row: GraphRow): Segment[] {
  const straight: Segment[] = []
  for (let i = 0; i < row.through.length; i += 2) {
    const [x, color] = [row.through[i], row.through[i + 1]]
    straight.push({ x1: x, x2: x, half: 'top', color }, { x1: x, x2: x, half: 'bottom', color })
  }
  return [...straight, ...row.segments]
}

interface Node {
  sha: string
  parents: string[]
}

export interface Layout {
  rows: GraphRow[]
  width: number
  // where the walk stopped, so appended pages continue from here
  input: Node[]
  lanes: (string | null)[] // sha each lane is waiting for
  colors: number[]
  nextColor: number
}

// Assigns each commit (in topological order, children first) a lane and the line
// segments needed to draw it. Freed lanes are reused; lanes are never compacted.
// A row depends only on the commits above it: when `commits` starts with the commits of `prev`
// (a page was appended), only the new rows are laid out.
export function layoutGraph(commits: Node[], prev?: Layout): Layout {
  const appended = !!prev && prev.input.length <= commits.length && prev.input.every((n, i) => n === commits[i])
  const lanes = appended ? [...prev.lanes] : []
  const colors = appended ? [...prev.colors] : []
  let nextColor = appended ? prev.nextColor : 0
  let width = appended ? prev.width : 0
  const alloc = (sha: string) => {
    let i = lanes.indexOf(null)
    if (i === -1) i = lanes.length
    lanes[i] = sha
    colors[i] = nextColor++ % LANE_COLORS
    return i
  }

  const fresh = (appended ? commits.slice(prev.input.length) : commits).map(({ sha, parents }) => {
    let col = lanes.indexOf(sha)
    const segments: Segment[] = []
    const through: number[] = [] // lane, color, lane, color …

    lanes.forEach((waiting, i) => {
      if (waiting === sha) {
        segments.push({ x1: i, x2: col, half: 'top', color: colors[i] })
        lanes[i] = null
      } else if (waiting !== null) through.push(i, colors[i])
    })

    if (col === -1) col = alloc(sha) // branch tip: nothing above it
    const color = colors[col]
    lanes[col] = null
    const freeAfter: number[] = [] // freed only after all parents are placed, so no parent reuses them
    parents.forEach((p, n) => {
      let target = lanes.indexOf(p)
      if (n === 0 && target > col) {
        // keep the first-parent chain leftmost: the lane to the right bends into this one
        const k = through.findIndex((v, j) => j % 2 === 0 && v === target)
        through.splice(k, 2)
        segments.push({ x1: target, x2: target, half: 'top', color: colors[target] }, { x1: target, x2: col, half: 'bottom', color: colors[target] })
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
    return { sha, col, color, segments, through: Uint16Array.from(through) }
  })

  return { rows: appended ? prev.rows.concat(fresh) : fresh, width, input: commits, lanes, colors, nextColor }
}
