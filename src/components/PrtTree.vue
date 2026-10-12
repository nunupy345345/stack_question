<script setup>
/**
 * PRTの木構造をSVGで描画する。
 * - ノードは上から nodes[] の順に縦に並べる（STACKのPRTは前方にしか分岐しない）
 * - true 分岐は左（緑）、false 分岐は右（赤）
 * - nextnode = -1 は終端ボックス（スコアとanswer note）として描く
 * - ホバーで詳細ツールチップ、クリックで select イベント
 */
import { computed, ref } from 'vue'
import RichHtml from './RichHtml.vue'
import NodeJudge from './NodeJudge.vue'
import { nodeTitle } from '../lib/maxima.js'
import { plainText } from '../lib/html.js'

const props = defineProps({
  prt: { type: Object, required: true },
  label: { type: String, required: true },
  selected: { type: String, default: '' },
  doneNodes: { type: Array, default: () => [] },
  ctx: { type: Object, default: null }, // 変数コンテキスト（ツールチップで定義を表示）
})
const emit = defineEmits(['select'])

const W = 360
const CX = 180
const ROW = 116
const TOP = 34
const R = 19
const LEAF_DX = 104
const LEAF_W = 92
const LEAF_H = 40

const fmtScore = (b) => `${b.scoremode === '+' ? '+' : b.scoremode === '-' ? '−' : '='}${b.score}`
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const layout = computed(() => {
  const nodes = props.prt.nodes
  const idx = Object.fromEntries(nodes.map((n, i) => [n.name, i]))
  const y = (i) => TOP + i * ROW
  const items = nodes.map((n, i) => ({
    node: n,
    i,
    x: CX,
    y: y(i),
    isRoot: i === 0,
    hasFeedback: !!plainText(n.true.feedback),
  }))
  const edges = []
  const leaves = []
  for (const it of items) {
    for (const side of ['true', 'false']) {
      const b = it.node[side]
      const sgn = side === 'true' ? -1 : 1
      const target = idx[b.nextnode]
      const key = `${it.node.name}-${side}`
      if (target === undefined || b.nextnode === '-1') {
        // 終端
        const lx = it.x + sgn * LEAF_DX
        const ly = it.y + 64
        const sx = it.x + sgn * R * 0.8
        const sy = it.y + R * 0.6
        edges.push({
          key, side,
          d: `M${sx},${sy} Q${lx},${it.y + 6} ${lx},${ly - LEAF_H / 2}`,
          labelX: it.x + sgn * 30, labelY: it.y + 4, anchor: side === 'true' ? 'end' : 'start',
          score: null, note: null,
        })
        leaves.push({ key, side, x: lx - LEAF_W / 2, y: ly - LEAF_H / 2, cx: lx, score: fmtScore(b), note: b.answernote, unknownTarget: target === undefined && b.nextnode !== '-1', next: b.nextnode })
      } else {
        const t = items[target]
        const span = target - it.i
        const bulge = 46 + 22 * (span - 1)
        const sx = it.x + sgn * R * 0.7
        const sy = it.y + R * 0.7
        const ex = t.x + sgn * R * 0.7
        const ey = t.y - R * 0.7
        const mx = it.x + sgn * bulge
        edges.push({
          key, side,
          d: `M${sx},${sy} C${mx},${sy + 30} ${mx},${ey - 30} ${ex},${ey}`,
          labelX: mx + sgn * 6, labelY: (sy + ey) / 2 - 4, anchor: side === 'true' ? 'end' : 'start',
          score: fmtScore(b), note: b.answernote,
        })
      }
    }
  }
  const height = TOP + (nodes.length - 1) * ROW + 64 + LEAF_H / 2 + 14
  return { items, edges, leaves, height }
})

// ---- ツールチップ ----
const hover = ref(null)
const tipPos = ref({ left: 0, top: 0 })
const wrap = ref(null)
function onEnter(it, ev) {
  hover.value = it.node
  placeTip(ev)
}
function placeTip(ev) {
  const r = wrap.value.getBoundingClientRect()
  const left = Math.min(Math.max(ev.clientX - r.left + 14, 0), Math.max(r.width - 320, 0))
  tipPos.value = { left, top: ev.clientY - r.top + 16 }
}
</script>

<template>
  <div ref="wrap" class="tree-wrap">
    <svg
      :viewBox="`0 0 ${W} ${layout.height}`"
      class="tree"
      role="img"
      :aria-label="`${label} の採点木`"
    >
      <defs>
        <marker :id="`arr-t-${label}`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" class="arrow-t" />
        </marker>
        <marker :id="`arr-f-${label}`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" class="arrow-f" />
        </marker>
      </defs>

      <g v-for="e in layout.edges" :key="e.key">
        <path
          :d="e.d"
          class="edge"
          :class="e.side"
          :marker-end="`url(#arr-${e.side === 'true' ? 't' : 'f'}-${label})`"
        />
        <text :x="e.labelX" :y="e.labelY" :text-anchor="e.anchor" class="edge-tf" :class="e.side">
          {{ e.side === 'true' ? 'T' : 'F' }}<tspan v-if="e.score" class="edge-score"> {{ e.score }}</tspan>
        </text>
        <text v-if="e.note" :x="e.labelX" :y="e.labelY + 13" :text-anchor="e.anchor" class="edge-note">{{ e.note }}</text>
      </g>

      <g v-for="l in layout.leaves" :key="'leaf-' + l.key" class="leaf" :class="l.side">
        <rect :x="l.x" :y="l.y" :width="LEAF_W" :height="LEAF_H" rx="7" />
        <text :x="l.cx" :y="l.y + 17" text-anchor="middle" class="leaf-score">{{ l.score }}</text>
        <text :x="l.cx" :y="l.y + 32" text-anchor="middle" class="leaf-note">{{ l.unknownTarget ? `→${l.next}?` : l.note }}</text>
      </g>

      <g
        v-for="it in layout.items"
        :key="it.node.name"
        class="node"
        :class="{ root: it.isRoot, selected: selected === it.node.name, done: doneNodes.includes(it.node.name) }"
        tabindex="0"
        role="button"
        :aria-label="`ノード${it.node.name}: ${nodeTitle(it.node)}`"
        @mouseenter="onEnter(it, $event)"
        @mousemove="placeTip"
        @mouseleave="hover = null"
        @focus="hover = null"
        @click="emit('select', it.node.name)"
        @keydown.enter.prevent="emit('select', it.node.name)"
      >
        <circle :cx="it.x" :cy="it.y" :r="R" />
        <text :x="it.x" :y="it.y + 5" text-anchor="middle" class="node-name">{{ it.node.name }}</text>
        <text v-if="doneNodes.includes(it.node.name)" :x="it.x + R - 2" :y="it.y - R + 6" class="node-check">✓</text>
        <text :x="it.x + R + 8" :y="it.y - 8" class="node-desc">{{ truncate(nodeTitle(it.node) || '（説明なし）', 15) }}</text>
        <text v-if="!it.isRoot && !it.hasFeedback" :x="it.x - R - 8" :y="it.y - 8" text-anchor="end" class="node-nofb">FBなし</text>
      </g>
    </svg>

    <div v-if="hover" class="tooltip" :style="{ left: tipPos.left + 'px', top: tipPos.top + 'px' }">
      <div class="tip-head">ノード {{ hover.name }}<template v-if="nodeTitle(hover)">：{{ nodeTitle(hover) }}</template></div>
      <NodeJudge v-if="ctx" :node="hover" :ctx="ctx" compact />
      <div class="tip-branch true">
        <b>T</b> {{ fmtScore(hover.true) }} → {{ hover.true.nextnode === '-1' ? '終了' : 'ノード' + hover.true.nextnode }}
        <RichHtml v-if="hover.true.feedback" :html="hover.true.feedback" class="tip-fb" />
      </div>
      <div class="tip-branch false">
        <b>F</b> {{ fmtScore(hover.false) }} → {{ hover.false.nextnode === '-1' ? '終了' : 'ノード' + hover.false.nextnode }}
        <RichHtml v-if="hover.false.feedback" :html="hover.false.feedback" class="tip-fb" />
      </div>
      <div class="tip-hint">クリックで詳細と設問へ移動</div>
    </div>
  </div>
</template>
