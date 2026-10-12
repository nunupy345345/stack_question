<script setup>
/**
 * 1問分の評価画面（2ペイン）
 *  左: 元の問題 + PRT切替タブ + 評価中PRTの木（sticky・常に表示）
 *  右: 評価中PRTのノード詳細と設問
 * 右をスクロールすると、いま見ているノードが左の木でハイライトされる。
 * 木のノードをクリックすると右がそのノードへスクロールする。
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import PrtTree from './PrtTree.vue'
import PrtForm from './PrtForm.vue'
import RichHtml from './RichHtml.vue'
import MaxDef from './MaxDef.vue'
import { varContext } from '../lib/maxima.js'
import { state, problemLabels, ensureRecord, touch, prtMissing, nodeMissing, submitRecord, hasEndpoint } from '../lib/store.js'

const props = defineProps({
  problem: { type: Object, required: true },
  position: { type: Number, required: true },
  total: { type: Number, required: true },
})
const emit = defineEmits(['prev', 'next'])

const labels = computed(() => problemLabels(props.problem))
// 表示前に回答レコードを用意しておく（computed内で状態を変更しないため）
watch(() => props.problem, (p) => ensureRecord(p), { immediate: true })
const record = computed(() => state.responses[props.problem.key])
const activeLabel = ref(labels.value[0])
const focusNode = ref('') // 右ペインで現在見ているノード
const saveMsg = ref('')
const showCompare = ref(false)
const rightPane = ref(null)
const treeBox = ref(null)

// 問題文は HTML ではなくテキスト（数式は \( \) 形式）。< や & を含んでも壊れないようエスケープして渡す
const questionHtml = computed(() =>
  String(props.problem.question_text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>'))
const activeIndex = computed(() => labels.value.indexOf(activeLabel.value))
const nextLabel = computed(() => labels.value[activeIndex.value + 1])
const activePrt = computed(() => props.problem.prts[activeLabel.value].prt)
const ctxOf = (label) => varContext(props.problem.prts[label])
const activeCtx = computed(() => ctxOf(activeLabel.value))
const activeVarDefs = computed(() => [...activeCtx.value.defs.values()])
const activeVarsCode = computed(() => {
  const d = props.problem.prts[activeLabel.value]
  return [d.questionvariables, d.prt.feedbackvariables].filter((x) => x && x.trim()).join('\n\n/* PRT内の変数 */\n')
})

const idPrefix = (label) => `p${props.problem.key}-${label}`
const doneNodes = (label) =>
  Object.entries(record.value.prts[label].nodes).filter(([, a]) => !nodeMissing(a).length).map(([n]) => n)
const remaining = (label) => prtMissing(record.value.prts[label]).length

// ---- 右ペインのスクロール位置 → 左の木のハイライト ----
const FOCUS_LINE = 180 // 画面上端からこの位置を越えたノードを「いま見ている」とみなす
let raf = 0
function syncFocus() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    const form = rightPane.value?.querySelector(`[data-label="${activeLabel.value}"]`)
    if (!form) return
    let current = ''
    for (const el of form.querySelectorAll('[data-node]')) {
      if (el.getBoundingClientRect().top <= FOCUS_LINE) current = el.dataset.node
    }
    focusNode.value = current
  })
}
function onKey(e) {
  if (e.key === 'Escape') showCompare.value = false
}
onMounted(() => {
  window.addEventListener('scroll', syncFocus, { passive: true })
  window.addEventListener('keydown', onKey)
  syncFocus()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', syncFocus)
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
})

// ハイライトされたノードが左ペインの外に出たら、左の木の枠だけをスクロールして見える位置へ
watch(focusNode, async () => {
  await nextTick()
  const box = treeBox.value
  const el = box?.querySelector('g.node.selected')
  if (!box || !el) return
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.top < b.top + 20 || r.bottom > b.bottom - 20) {
    box.scrollBy({ top: r.top - b.top - b.height / 3, behavior: 'smooth' })
  }
})

async function selectNode(label, nodeName) {
  showCompare.value = false
  if (label !== activeLabel.value) await switchTab(label, false)
  await nextTick()
  document.getElementById(`${idPrefix(label)}-node-${nodeName}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  focusNode.value = nodeName
}

async function switchTab(label, scroll = true) {
  activeLabel.value = label
  focusNode.value = ''
  if (treeBox.value) treeBox.value.scrollTop = 0
  if (scroll) {
    await nextTick()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function onChange() {
  touch(record.value)
}

const allMissing = computed(() =>
  labels.value.flatMap((l) => prtMissing(record.value.prts[l]).map((m) => `${l} ${m}`)))

async function saveAndNext() {
  touch(record.value)
  if (allMissing.value.length) {
    saveMsg.value = `未回答の項目が${allMissing.value.length}件あります（入力内容は自動保存済み）`
    // 未回答が残っているPRTへ移動
    const first = labels.value.find((l) => remaining(l))
    if (first && first !== activeLabel.value) switchTab(first)
    return
  }
  if (hasEndpoint) {
    saveMsg.value = '送信中…'
    const r = await submitRecord(record.value)
    if (!r.ok) {
      saveMsg.value = `送信に失敗しました（${r.reason}）。回答はブラウザに保存済みです。メニューの「未送信を再送」から再送できます。`
      return
    }
  }
  saveMsg.value = ''
  emit('next')
}
</script>

<template>
  <div class="workspace">
    <!-- ===== 左ペイン：問題と評価中のPRT ===== -->
    <aside class="left-pane">
      <section class="q-card">
        <div class="q-card-head">
          <span class="q-card-label">問題</span>
          <span class="muted small">ID {{ problem.key }}</span>
        </div>
        <RichHtml :html="questionHtml" class="source-q" />
      </section>

      <nav class="seg" role="tablist" aria-label="評価するPRT">
        <button
          v-for="label in labels"
          :key="label"
          type="button"
          role="tab"
          class="seg-btn"
          :class="{ active: activeLabel === label, complete: !remaining(label) }"
          :aria-selected="activeLabel === label"
          @click="switchTab(label)"
        >
          <span class="seg-name">{{ label }}</span>
          <span class="seg-state">{{ remaining(label) ? `残り${remaining(label)}` : '✓ 完了' }}</span>
        </button>
      </nav>

      <section class="tree-card">
        <div class="tree-card-head">
          <span><b>{{ activeLabel }}</b> の採点木 <span class="muted small">・ノード{{ activePrt.nodes.length }}個</span></span>
          <button type="button" class="btn small ghost" @click="showCompare = true">全PRTを比較</button>
        </div>
        <div ref="treeBox" class="tree-box">
          <PrtTree
            :key="activeLabel"
            :prt="activePrt"
            :label="activeLabel"
            :selected="focusNode"
            :ctx="activeCtx"
            :done-nodes="doneNodes(activeLabel)"
            @select="(n) => selectNode(activeLabel, n)"
          />
        </div>
        <div class="legend">
          <span><i class="lg root" />正答判定</span>
          <span><i class="lg diag" />誤答診断</span>
          <span><i class="lg t" />true</span>
          <span><i class="lg f" />false</span>
          <span><code>=x</code> 得点をxに / <code>+x</code> xを加算</span>
        </div>
        <details v-if="activeVarsCode" class="allvars">
          <summary>{{ activeLabel }} の問題変数（すべて）</summary>
          <ul class="allvars-list"><li v-for="d in activeVarDefs" :key="d.name"><MaxDef :def="d" /></li></ul>
          <details class="raw-toggle"><summary>Maxima 原文</summary><pre>{{ activeVarsCode }}</pre></details>
        </details>
      </section>
    </aside>

    <!-- ===== 右ペイン：設問 ===== -->
    <main ref="rightPane" class="right-pane">
      <div class="right-head">
        <h2>{{ activeLabel }} の評価</h2>
        <span class="muted small">左の木のノードをクリックすると、そのノードの設問へ移動します</span>
      </div>

      <template v-for="label in labels" :key="label">
        <PrtForm
          v-show="activeLabel === label"
          :data-label="label"
          :label="label"
          :data="problem.prts[label]"
          :answer="record.prts[label]"
          :id-prefix="idPrefix(label)"
          :highlight-node="activeLabel === label ? focusNode : ''"
          @change="onChange"
        />
      </template>

      <div class="pane-end">
        <button v-if="nextLabel" type="button" class="btn primary" @click="switchTab(nextLabel)">
          次は {{ nextLabel }} を評価 →
        </button>
        <p v-else class="muted small">これがこの問題の最後のPRTです。下のボタンで{{ hasEndpoint ? '送信' : '保存' }}してください。</p>
      </div>

      <footer class="problem-foot">
        <button type="button" class="btn ghost" :disabled="position === 0" @click="emit('prev')">← 前の問題</button>
        <div class="foot-msg" :class="{ warn: saveMsg }">
          <template v-if="saveMsg">
            {{ saveMsg }}
            <details v-if="allMissing.length" class="missing-list">
              <summary>一覧</summary>
              <ul><li v-for="m in allMissing" :key="m">{{ m }}</li></ul>
            </details>
          </template>
          <template v-else>
            <span v-for="l in labels" :key="l" class="foot-chip" :class="remaining(l) ? 'todo' : 'ok'">{{ l }} {{ remaining(l) ? `残り${remaining(l)}` : '✓' }}</span>
          </template>
        </div>
        <button type="button" class="btn primary" @click="saveAndNext">
          {{ hasEndpoint ? '送信して' : '保存して' }}{{ position < total - 1 ? '次の問題へ →' : '完了' }}
        </button>
      </footer>
    </main>

    <!-- ===== 全PRT比較オーバーレイ ===== -->
    <div v-if="showCompare" class="overlay" @click.self="showCompare = false">
      <div class="overlay-panel" role="dialog" aria-modal="true" aria-label="全PRTの比較">
        <div class="overlay-head">
          <h3>全PRTの比較</h3>
          <span class="muted small">ノードをクリックすると、そのPRTの設問へ移動します</span>
          <button type="button" class="btn small" @click="showCompare = false">閉じる（Esc）</button>
        </div>
        <div class="tree-grid" :style="{ '--cols': labels.length }" :class="`cols-${labels.length}`">
          <div v-for="label in labels" :key="label" class="tree-col" :class="{ active: activeLabel === label }">
            <div class="tree-col-head">
              <b class="label-name">{{ label }}</b>
              <span class="tree-stats">ノード{{ problem.prts[label].prt.nodes.length }}個</span>
            </div>
            <PrtTree
              :prt="problem.prts[label].prt"
              :label="`cmp-${label}`"
              :ctx="ctxOf(label)"
              :done-nodes="doneNodes(label)"
              @select="(n) => selectNode(label, n)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
