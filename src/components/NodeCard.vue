<script setup>
// 1ノードの詳細表示＋（誤答診断ノードなら）設問C1・C2
import { computed } from 'vue'
import RichHtml from './RichHtml.vue'
import ChoiceGroup from './ChoiceGroup.vue'
import NodeJudge from './NodeJudge.vue'
import { nodeTitle } from '../lib/maxima.js'
import { plainText } from '../lib/html.js'
import { nodeMissing } from '../lib/store.js'

const props = defineProps({
  node: { type: Object, required: true },
  answer: { type: Object, default: null }, // null = 正答判定ノード（設問なし）
  idPrefix: { type: String, required: true },
  highlighted: { type: Boolean, default: false },
  ctx: { type: Object, required: true }, // 変数コンテキスト（varContext）
})
const emit = defineEmits(['change'])

const fmtScore = (b) => `${b.scoremode}${b.score}`
const nextLabel = (b) => (b.nextnode === '-1' ? '終了' : `ノード${b.nextnode}へ`)
// フィードバックがどちらの分岐にあるか（traditional/norag型は true 側、chain型は false 側にあることが多い）
const fbSide = computed(() => {
  const t = !!plainText(props.node.true.feedback)
  const f = !!plainText(props.node.false.feedback)
  return t && f ? 'true側・false側' : t ? 'true側' : f ? 'false側' : ''
})
const title = computed(() => nodeTitle(props.node))
const missing = computed(() => (props.answer ? nodeMissing(props.answer) : []))

const C2_OPTIONS = [
  { value: 1, label: '全く特定できていない' },
  { value: 2, label: 'あまり特定できていない' },
  { value: 3, label: 'おおむね特定できている' },
  { value: 4, label: '的確に特定できている' },
]
</script>

<template>
  <section :id="`${idPrefix}-node-${node.name}`" :data-node="node.name" class="node-card" :class="{ root: !answer, highlighted }">
    <header class="node-card-head">
      <span class="node-badge">{{ node.name }}</span>
      <span class="node-title">{{ answer ? '誤答診断ノード' : '正答判定ノード（参考・設問なし）' }}<template v-if="title">：{{ title }}</template></span>
      <span v-if="answer" class="node-state" :class="missing.length ? 'todo' : 'ok'">
        {{ missing.length ? `未回答: ${missing.join(', ')}` : '回答済み' }}
      </span>
    </header>

    <NodeJudge :node="node" :ctx="ctx" />

    <div class="branches">
      <div class="branch true">
        <div class="branch-head">
          <b>true</b> スコア <code>{{ fmtScore(node.true) }}</code> ・ {{ nextLabel(node.true) }} ・ <code class="note">{{ node.true.answernote }}</code>
        </div>
        <RichHtml v-if="plainText(node.true.feedback)" :html="node.true.feedback" class="feedback" />
        <div v-else class="feedback empty">（フィードバックなし）</div>
      </div>
      <div class="branch false">
        <div class="branch-head">
          <b>false</b> スコア <code>{{ fmtScore(node.false) }}</code> ・ {{ nextLabel(node.false) }} ・ <code class="note">{{ node.false.answernote }}</code>
        </div>
        <RichHtml v-if="plainText(node.false.feedback)" :html="node.false.feedback" class="feedback" />
        <div v-else class="feedback empty">（フィードバックなし）</div>
      </div>
    </div>

    <div v-if="answer" class="questions" @change="emit('change')" @input="emit('change')">
      <div class="q">
        <div class="q-text"><b>C1.</b> このノードのフィードバック文{{ fbSide ? `（${fbSide}）` : '' }}は数学的に正しいですか？</div>
        <ChoiceGroup
          v-model="answer.c1"
          :name="`${idPrefix}-${node.name}-c1`"
          :options="[{ value: 'yes', label: 'はい' }, { value: 'no', label: 'いいえ' }, { value: 'none', label: 'フィードバックなし' }]"
        />
        <div v-if="!fbSide" class="q-hint">このノードには、true側・false側ともフィードバックがありません。</div>
      </div>

      <div class="q" :class="{ muted: answer.c1 === 'none' }">
        <div class="q-text"><b>C2.</b> フィードバックは、この誤りの理由を的確に特定できていますか？</div>
        <ChoiceGroup v-model="answer.c2" :name="`${idPrefix}-${node.name}-c2`" :options="C2_OPTIONS" scale :disabled="answer.c1 === 'none'" />
      </div>
    </div>
  </section>
</template>
