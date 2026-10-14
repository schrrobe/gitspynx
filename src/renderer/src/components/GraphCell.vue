<script setup lang="ts">
import { computed } from 'vue'
import { LANE_PX as LANE, nodeLane } from '../graph/column'
import type { GraphRow } from '../graph/layout'

// columnPx: visible width; lanes beyond it are cut off, a node there is drawn at the edge.
// Commits are drawn as avatar circles (author initials), merges as small dots.
const props = defineProps<{ row: GraphRow; columnPx: number; initials: string; merge: boolean }>()
const H = 28
const MID = H / 2
const x = (lane: number) => lane * LANE + LANE / 2

function path(s: GraphRow['segments'][number]) {
  const [y1, y2] = s.half === 'top' ? [0, MID] : [MID, H]
  const [x1, x2] = [x(s.x1), x(s.x2)]
  if (x1 === x2) return `M${x1} ${y1}V${y2}`
  const ym = (y1 + y2) / 2
  return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`
}

// All straight lanes of one color as a single path: one element per color instead of per lane.
const straight = computed(() => {
  const byColor = new Map<number, string>()
  const t = props.row.through
  for (let i = 0; i < t.length; i += 2) byColor.set(t[i + 1], `${byColor.get(t[i + 1]) ?? ''}M${x(t[i])} 0V${H}`)
  return [...byColor]
})
const node = computed(() => nodeLane(props.row.col, props.columnPx))
</script>

<template>
  <svg :width="props.columnPx" :height="H" aria-hidden="true">
    <path v-for="[color, d] in straight" :key="`s${color}`" :d="d" :stroke="`var(--lane-${color})`" stroke-width="2" fill="none" />
    <path
      v-for="(s, i) in props.row.segments"
      :key="i"
      :d="path(s)"
      :stroke="`var(--lane-${s.color})`"
      stroke-width="2"
      fill="none"
    />
    <template v-if="!node.clipped">
      <circle v-if="props.merge" :cx="x(node.lane)" :cy="MID" r="5" :fill="`var(--lane-${props.row.color})`" stroke="var(--bg-graph)" stroke-width="2" />
      <template v-else>
        <circle :cx="x(node.lane)" :cy="MID" r="10.5" :fill="`var(--lane-${props.row.color})`" stroke="var(--bg-graph)" stroke-width="1.5" />
        <text :x="x(node.lane)" :y="MID" text-anchor="middle" dominant-baseline="central" class="initials">{{ props.initials }}</text>
      </template>
    </template>
    <circle v-else :cx="x(node.lane)" :cy="MID" r="4" fill="var(--bg)" :stroke="`var(--lane-${props.row.color})`" stroke-width="2.5"><title>Commit in einer ausgeblendeten Spur – Graph-Spalte breiter ziehen</title></circle>
  </svg>
</template>

<style scoped>
.initials { font: 600 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #0d1015; pointer-events: none; }
</style>
