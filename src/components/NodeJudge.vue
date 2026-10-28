<script setup>
/**
 * ノードの判定内容を、STACKを知らない人にも分かる文で説明する。
 *   学生の解答 が [誤答1  wa1 = −10] と代数的に等しいか
 * 右側に、判定で使われている式（関連する定義）を並べる。
 */
import { computed } from 'vue'
import MathTex from './MathTex.vue'
import MaxDef from './MaxDef.vue'
import { collectDefinitions, identifiers, isBareId, predicateCall, roleOf } from '../lib/maxima.js'
import { maximaToTex, explainSteps, explainContains } from '../lib/maxima2tex.js'

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

// 式の中に出てくる関数の意味（表示名 → 説明）。同じ表示名はまとめる
const TERMS = {
  ratsimp: ['簡約', '有理式を通分して約分した形に直す'],
  fullratsimp: ['簡約', '有理式を通分して約分した形に直す'],
  radcan: ['根号の簡約', '根号やべき乗を、まとめられる形に直す'],
  trigsimp: ['三角関数の簡約', '三角関数の式を、より簡単な形に直す'],
  expand: ['展開', 'かっこを外して、項の和の形にする'],
  factor: ['因数分解', '積の形に直す'],
  num: ['分子', '通分・約分した形の分子'],
  denom: ['分母', '通分・約分した形の分母'],
  hipow: ['deg', '指定した文字についての最高次数'],
  ratcoef: ['係数', '指定した項（xⁿ など）の係数'],
  coeff: ['係数', '指定した項（xⁿ など）の係数'],
  subst: ['| 記号', '縦棒の右下の値を代入する（C=0, c=0 は積分定数を 0 とおく）'],
}
const terms = computed(() => {
  if (steps.value || subject.value.kind === 'contains') return [] // 手順・文で説明しているときは、用語の説明は不要
  const seen = new Map()
  for (const id of identifiers(`${props.node.sans ?? ''} ${props.node.tans ?? ''}`)) {
    const t = TERMS[id]
    if (t && !seen.has(t[0])) seen.set(t[0], t[1])
  }
  return [...seen]
})

// is(L = R) / is(L # R) を L, R に分ける（括弧の外にある比較演算子が1つだけのときのみ）
function splitRelation(src) {
  const m = /^is\(([\s\S]*)\)$/.exec(src)
  if (!m) return null
  const body = m[1]
  let depth = 0
  let found = null
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) { depth--; if (depth < 0) return null }
    else if (depth === 0 && (c === '=' || c === '#')) {
      if (found || body[i - 1] === '<' || body[i - 1] === '>' || body[i - 1] === ':' || body[i + 1] === '=') return null
      found = { at: i, op: c }
    } else if (depth === 0 && (c === '<' || c === '>' || c === ',' || /\b(and|or|not)\b/.test(body.slice(i, i + 4)))) return null
  }
  if (depth !== 0 || !found) return null
  const L = body.slice(0, found.at).trim()
  const R = body.slice(found.at + 1).trim()
  return L && R ? { L, R, op: found.op } : null
}

const sans = computed(() => String(props.node.sans ?? '').trim())
const tans = computed(() => String(props.node.tans ?? '').trim())
const test = computed(() => TESTS[props.node.answertest] ?? null)
const defOf = (id) => props.ctx.defs.get(id)
// 式の中の解答欄（ans1 など）は「学生の解答」と表示する（解答欄が複数あるときは名前を添える）
const studentLabel = (name) => {
  if (!/^ans\d+$/.test(name) || props.ctx.defs.has(name)) return null
  return props.ctx.inputs.length > 1 ? `学生の解答（${name}）` : '学生の解答'
}
const toTex = (e, defs = props.ctx.defs) => maximaToTex(e, defs, { student: studentLabel })

// 入れ子の加工式（簡約・展開・係数 …）は、内側から順に並べた手順にして読みやすくする（2手順以上のときだけ）
const STEP_NO = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']
const stepsFor = (src) => {
  if (props.compact) return null
  const r = explainSteps(src, props.ctx.defs, { student: studentLabel })
  if (!r || r.length < 2) return null
  let first = true // 「簡約」は最初の1回だけ意味を添える
  return r.map((st) => {
    if (st.text === '簡約する' && first) { first = false; return { ...st, text: '簡約する（通分して約分した形に直す）' } }
    if (st.text === '簡約する') first = false
    return st
  })
}

const subject = computed(() => {
  if (/^ans\d+$/.test(sans.value)) return { kind: 'student' }
  const rel = ['true', 'false'].includes(tans.value) ? splitRelation(sans.value) : null
  if (rel) {
    const same = (rel.op === '=') === (tans.value === 'true') // 文が「等しいか」なら true
    const isStudent = /^ans\d+$/.test(rel.L) && !props.ctx.defs.has(rel.L)
    const steps = isStudent ? null : stepsFor(rel.L)
    return { kind: 'rel', same, steps, lhs: isStudent || steps ? null : toTex(rel.L), lhsRaw: rel.L, rhs: toTex(rel.R), rhsRaw: rel.R }
  }
  const fn = predicateCall(sans.value)
  if (fn) return { kind: 'cond', name: fn, role: roleOf(fn) }
  const contains = ['true', 'false'].includes(tans.value) ? explainContains(sans.value, props.ctx.defs, { student: studentLabel }) : null
  if (contains) return { kind: 'contains', ...contains, flipped: tans.value === 'false' }
  const steps = stepsFor(sans.value)
  return { kind: 'expr', steps, tex: steps ? null : toTex(sans.value) }
})

const target = computed(() => {
  if (subject.value.kind !== 'student' && ['true', 'false'].includes(tans.value)) return { kind: 'bool', value: tans.value === 'true' }
  if (isBareId(tans.value)) {
    const d = defOf(tans.value)
    return { kind: 'var', role: roleOf(tans.value), name: tans.value, tex: d && !d.fn ? toTex(d.expr) : null }
  }
  return { kind: 'expr', tex: toTex(tans.value) }
})

// 判定で使われている変数の定義は、文ではなく「判定」の下にまとめて示す
const extra = computed(() => collectDefinitions([sans.value, tans.value], props.ctx.defs))

const steps = computed(() => subject.value.steps ?? null)

const hint = computed(() => {
  if (['rel', 'contains'].includes(subject.value.kind)) return '「はい」なら true、「いいえ」なら false の分岐に進みます'
  if (subject.value.kind === 'expr' && target.value.kind === 'bool')
    return `この式が${target.value.value ? '成り立つ' : '成り立たない'}とき true の分岐に進みます（学生の解答を加工して、条件を満たすかを調べています）`
  if (subject.value.kind === 'cond') return '条件の中身は右の「関連する定義」のとおりです。満たしたとき、この誤りと判定します'
  return test.value?.hint ?? ''
})
const tech = computed(() => `${props.node.answertest}(${sans.value}, ${tans.value}${props.node.testoptions ? `; ${props.node.testoptions}` : ''})`)
const missingData = computed(() => !props.ctx.hasData && target.value.kind === 'var')
</script>

<template>
  <div class="judge" :class="{ compact }">
    <div class="judge-main">
      <div v-if="subject.kind === 'contains'" class="judge-sentence contains">
        <p v-if="subject.join" class="contains-head">次の条件が{{ subject.flipped ? '成り立たない' : '成り立つ' }}か</p>
        <p v-for="(c, i) in subject.clauses" :key="i" class="contains-line">
          <span v-if="i" class="contains-join">{{ subject.join === 'or' ? 'または' : 'かつ' }}</span>
          <span class="chip student">{{ c.subject.kind === 'student' ? '学生の解答' : '学生の解答を加工した式' }}</span>
          <MathTex v-if="c.subject.kind === 'expr'" :tex="c.subject.tex" :fallback="c.subject.tex" />
          <span v-if="c.subject.note" class="contains-note">（{{ c.subject.note }}）</span>
          に
          <span class="chip target">
            <template v-if="c.what.text">{{ c.what.text }}</template>
            <MathTex v-else :tex="c.what.tex" :fallback="c.what.tex" />
          </span>
          が含まれ{{ (subject.join ? c.has : subject.flipped ? !c.has : c.has) ? 'ている' : 'ていない' }}<template v-if="!subject.join">か</template>
        </p>
      </div>
      <p v-else-if="subject.kind === 'rel'" class="judge-sentence">
        <span class="chip student">{{ subject.lhs ? '学生の解答を加工した式' : subject.steps ? '学生の解答を加工した値' : '学生の解答' }}</span>
        <MathTex v-if="subject.lhs" :tex="subject.lhs" :fallback="subject.lhsRaw" />
        が
        <span class="chip target"><MathTex :tex="subject.rhs" :fallback="subject.rhsRaw" /></span>と{{ subject.same ? '等しいか' : '等しくないか' }}
      </p>
      <p v-else-if="test" class="judge-sentence">
        <span class="chip student">{{ subject.kind === 'student' ? '学生の解答' : subject.kind === 'cond' ? '学生の解答' : subject.steps ? '学生の解答を加工した値' : target.kind === 'bool' ? '条件' : '学生の解答を加工した式' }}</span>
        <template v-if="subject.kind === 'expr' && !subject.steps">
          <span v-if="target.kind === 'bool'" class="chip target"><MathTex :tex="subject.tex" :fallback="sans" /></span>
          <MathTex v-else :tex="subject.tex" :fallback="sans" />
        </template>
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
      <p v-if="steps" class="judge-steps">
        <span class="judge-steps-title">加工の手順</span>
        <template v-for="(st, i) in steps" :key="i">
          <span v-if="i" class="step-arrow">→</span>
          <span class="step"><b>{{ STEP_NO[i] ?? i + 1 }}</b><MathTex v-if="st.tex" :tex="st.tex" :fallback="st.tex" />{{ st.text }}</span>
        </template>
      </p>
      <p v-if="hint && !compact" class="judge-hint">{{ hint }}</p>
      <p v-if="terms.length && !compact" class="judge-terms">
        <span>用語:</span>
        <template v-for="([name, desc], i) in terms" :key="name"><template v-if="i"> ／ </template><b>{{ name }}</b> … {{ desc }}</template>
      </p>
      <p class="judge-tech" :title="`STACK上の設定: ${tech}`"><span>判定:</span> <code>{{ tech }}</code></p>
      <p v-if="missingData && !compact" class="var-missing">※ 問題変数のデータがないため、{{ tans }} の中身は表示できません。</p>

      <div v-if="extra.length" class="judge-defs">
        <span>変数:</span>
        <ul>
          <li v-for="d in extra" :key="d.name">
            <MaxDef :def="d" />
            <span v-if="d.scope === 'feedback'" class="var-scope">PRT内の変数</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
