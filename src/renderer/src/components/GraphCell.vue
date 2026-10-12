<script setup lang="ts">
import type { GraphRow } from '../graph/layout'

const props = defineProps<{ row: GraphRow; width: number }>()
const LANE = 14
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
</script>

<template>
  <svg :width="props.width * LANE" :height="H" aria-hidden="true">
    <path
      v-for="(s, i) in props.row.segments"
      :key="i"
      :d="path(s)"
      :stroke="`var(--lane-${s.color})`"
      stroke-width="2"
      fill="none"
    />
    <circle :cx="x(props.row.col)" :cy="MID" r="4.5" :fill="`var(--lane-${props.row.color})`" stroke="var(--bg)" stroke-width="1.5" />
  </svg>
</template>
