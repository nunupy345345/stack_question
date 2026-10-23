<script setup>
/**
 * ノードの判定内容を、STACKを知らない人にも分かる文で説明する。
 *   学生の解答 が [誤答1  wa1 = −10] と代数的に等しいか
 * 右側に、判定で使われている式（関連する定義）を並べる。
 */
import { computed } from 'vue'
import MathTex from './MathTex.vue'
import MaxDef from './MaxDef.vue'
import { collectDefinitions, isBareId, predicateCall, roleOf } from '../lib/maxima.js'
import { maximaToTex, defToTex } from '../lib/maxima2tex.js'

const props = defineProps({
  node: { type: Object, required: true },
  ctx: { type: Object, required: true }, // varContext()
  compact: { type: Boolean, default: false }, // ツールチップ用
})

// STACK の AnswerTest を平易な日本語で説明（未登録のテストは名前をそのまま出す）
const TESTS = {
  AlgEquiv: { tail: 'と代数的に等しいか', hint: '式変形しても同じ式になれば「等しい」と判定します' },
  Int: { tail: 'と同じ関数の不定積分になっているか', hint: '両方を微分して比べます。積分定数 +c の書き方も確認します' },
  Diff: { tail: 'と代数的に等しいか', hint: '微分の答えを比べます。微分すべきところを積分していないかも検出します' },
}

const sans = computed(() => String(props.node.sans ?? '').trim())
const tans = computed(() => String(props.node.tans ?? '').trim())
const test = computed(() => TESTS[props.node.answertest] ?? null)
const defOf = (id) => props.ctx.defs.get(id)

const subject = computed(() => {
  if (/^ans\d+$/.test(sans.value)) return { kind: 'student' }
  const fn = predicateCall(sans.value)
  if (fn) return { kind: 'cond', name: fn, role: roleOf(fn) }
  return { kind: 'expr', tex: maximaToTex(sans.value) }
})

const target = computed(() => {
  if (subject.value.kind !== 'student' && ['true', 'false'].includes(tans.value)) return { kind: 'bool', value: tans.value === 'true' }
  if (isBareId(tans.value)) {
    const d = defOf(tans.value)
    return { kind: 'var', role: roleOf(tans.value), name: tans.value, tex: d && !d.fn ? defToTex(d) : null }
  }
  return { kind: 'expr', tex: maximaToTex(tans.value) }
})

// 文の中ですでに値を見せた変数は、右の「関連する定義」から省く
const inline = computed(() => new Set([isBareId(sans.value) ? sans.value : null, target.value.kind === 'var' ? tans.value : null]))
const extra = computed(() =>
  collectDefinitions([sans.value, tans.value], props.ctx.defs)
    .filter((d) => !(d.depth === 0 && !d.fn && inline.value.has(d.name))))

const hint = computed(() => {
  if (subject.value.kind === 'expr' && target.value.kind === 'bool')
    return `この式が${target.value.value ? '成り立つ' : '成り立たない'}とき true の分岐に進みます（学生の解答を加工して、条件を満たすかを調べています）`
  if (subject.value.kind === 'cond') return '条件の中身は右の「関連する定義」のとおりです。満たしたとき、この誤りと判定します'
  return test.value?.hint ?? ''
})
const tech = computed(() => `${props.node.answertest}(${sans.value}, ${tans.value}${props.node.testoptions ? `; ${props.node.testoptions}` : ''})`)
const missingData = computed(() => !props.ctx.hasData && target.value.kind === 'var')
</script>

<template>
  <div class="judge" :class="{ compact, two: extra.length > 0 }">
    <div class="judge-main">
      <p v-if="test" class="judge-sentence">
        <span class="chip student">{{ subject.kind === 'student' ? '学生の解答' : subject.kind === 'cond' ? '学生の解答' : target.kind === 'bool' ? '条件' : '学生の解答を加工した式' }}</span>
        <template v-if="subject.kind === 'expr'"><MathTex :tex="subject.tex" :fallback="sans" /></template>
        <template v-if="subject.kind === 'expr' && target.kind === 'bool'">
          {{ target.value ? 'が成り立つか' : 'が成り立たないか' }}
        </template>
        <template v-else-if="subject.kind === 'cond' && target.kind === 'bool'">
          が <span class="chip target"><b>{{ subject.role ? `${subject.role}の判定条件` : `条件 ${subject.name}` }}</b></span>{{ target.value ? 'を満たすか' : 'を満たさないか' }}
        </template>
        <template v-else>
          が
          <span class="chip target">
            <b v-if="target.kind === 'var' && target.role">{{ target.role }}</b>
            <MathTex v-if="target.tex" :tex="target.tex" :fallback="tans" />
            <code v-else class="mathtex-raw">{{ tans }}</code>
          </span>{{ test.tail }}
        </template>
      </p>
      <p v-else class="judge-sentence">
        <span class="chip student">学生の解答</span>と <code>{{ tans }}</code> を <code>{{ node.answertest }}</code> で比較
      </p>
      <p v-if="hint && !compact" class="judge-hint">{{ hint }}</p>
      <p class="judge-tech" :title="`STACK上の設定: ${tech}`"><span>判定:</span> <code>{{ tech }}</code></p>
      <p v-if="missingData && !compact" class="var-missing">※ 問題変数のデータがないため、{{ tans }} の中身は表示できません。</p>
    </div>
    <div v-if="extra.length" class="judge-defs">
      <div class="judge-defs-title">関連する定義</div>
      <ul>
        <li v-for="d in extra" :key="d.name">
          <MaxDef :def="d" />
          <span v-if="d.scope === 'feedback'" class="var-scope">PRT内の変数</span>
        </li>
      </ul>
    </div>
  </div>
</template>
