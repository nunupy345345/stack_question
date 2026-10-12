<script setup>
// 1つのPRTについて：各ノードのカード（C1〜C4）＋ PRT全体の設問 D1〜D4
import { computed } from 'vue'
import NodeCard from './NodeCard.vue'
import ChoiceGroup from './ChoiceGroup.vue'
import { prtMissing } from '../lib/store.js'
import { varContext } from '../lib/maxima.js'

const props = defineProps({
  label: { type: String, required: true },
  data: { type: Object, required: true }, // { questionvariables, inputs, prt }
  answer: { type: Object, required: true }, // record.prts[label]
  idPrefix: { type: String, required: true },
  highlightNode: { type: String, default: '' },
})
const emit = defineEmits(['change'])

const ctx = computed(() => varContext(props.data))
const rootNode = computed(() => props.data.prt.nodes[0])
const diag = computed(() => props.data.prt.nodes.slice(1))
const missing = computed(() => prtMissing(props.answer))
const summaryMissing = computed(() => missing.value.filter((m) => m.startsWith('D')))

const LIKERT5_VALID = [
  { value: 1, label: '全くそう思わない' },
  { value: 2, label: 'あまりそう思わない' },
  { value: 3, label: 'どちらともいえない' },
  { value: 4, label: 'ややそう思う' },
  { value: 5, label: 'とてもそう思う' },
]
</script>

<template>
  <div class="prt-form">
    <NodeCard
      :node="rootNode"
      :ctx="ctx"
      :answer="null"
      :id-prefix="idPrefix"
      :highlighted="highlightNode === rootNode.name"
    />

    <p v-if="!diag.length" class="empty-note">このPRTには誤答診断ノードがありません。</p>
    <NodeCard
      v-for="n in diag"
      :key="n.name"
      :node="n"
      :ctx="ctx"
      :answer="answer.nodes[n.name]"
      :id-prefix="idPrefix"
      :highlighted="highlightNode === n.name"
      @change="emit('change')"
    />

    <section :id="`${idPrefix}-summary`" data-node="" class="summary-card" @change="emit('change')" @input="emit('change')">
      <header class="node-card-head">
        <span class="node-title">{{ label }} 全体の評価</span>
        <span class="node-state" :class="summaryMissing.length ? 'todo' : 'ok'">
          {{ summaryMissing.length ? `未回答: ${summaryMissing.join(', ')}` : '回答済み' }}
        </span>
      </header>

      <div class="q">
        <div class="q-text"><b>D1.</b> このPRT全体の採点ロジックは数学的に妥当だと思いますか？</div>
        <ChoiceGroup v-model="answer.d1" :name="`${idPrefix}-d1`" :options="LIKERT5_VALID" scale />
      </div>
      <div class="q">
        <div class="q-text"><b>D2.</b> 学生がつまずきやすい典型的な誤りを十分カバーできていると思いますか？</div>
        <ChoiceGroup v-model="answer.d2" :name="`${idPrefix}-d2`" :options="LIKERT5_VALID" scale />
      </div>
      <div class="q">
        <div class="q-text"><b>D3.</b> このPRTが人間によって作られたか、AIによって作られたか推測できますか？</div>
        <ChoiceGroup
          v-model="answer.d3"
          :name="`${idPrefix}-d3`"
          :options="[{ value: 'yes', label: '推測できる' }, { value: 'no', label: '推測できない' }]"
        />
        <div v-if="answer.d3 === 'yes'" class="q-sub">
          推測結果：
          <ChoiceGroup
            v-model="answer.d3_guess"
            :name="`${idPrefix}-d3g`"
            :options="[{ value: 'human', label: '人間が作成' }, { value: 'ai', label: 'AIが作成' }]"
          />
        </div>
        <label class="q-sub block">
          理由（任意）
          <textarea v-model="answer.d3_reason" rows="2" maxlength="2000" />
        </label>
      </div>
      <div class="q">
        <label class="q-text block">
          <b>D4.</b> 自由記述コメント（任意）
          <textarea v-model="answer.d4" rows="3" maxlength="5000" />
        </label>
      </div>
    </section>
  </div>
</template>
