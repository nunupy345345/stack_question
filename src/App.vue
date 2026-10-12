<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import ProblemView from './components/ProblemView.vue'
import {
  state, loadSurvey, login, logout, getProblem, problemStatus,
  exportJson, submitPending, hasEndpoint,
} from './lib/store.js'

const loading = ref(true)
const idInput = ref('')
const loginError = ref('')
const current = ref(0)
const finished = ref(false)
const toolMsg = ref('')
const showIntro = ref(false)
const drawerOpen = ref(false)

const STATUS_LABEL = { todo: '未着手', partial: '回答中', unsynced: '未送信', done: '完了' }

function readParam(name) {
  return new URLSearchParams(location.search).get(name) || ''
}
function setUrl() {
  const u = new URL(location.href)
  if (state.evaluatorId) {
    u.searchParams.set('e', state.evaluatorId)
    u.searchParams.set('q', String(current.value + 1))
  } else {
    u.searchParams.delete('e')
    u.searchParams.delete('q')
  }
  history.replaceState(null, '', u)
}

onMounted(async () => {
  try {
    await loadSurvey()
    const fromUrl = readParam('e')
    idInput.value = fromUrl || (() => { try { return localStorage.getItem('prt-survey:last-evaluator') || '' } catch { return '' } })()
    if (fromUrl) doLogin(Number(readParam('q')) - 1)
  } catch (e) {
    state.loadError = String(e.message || e)
  } finally {
    loading.value = false
  }
})

function doLogin(startAt = -1) {
  loginError.value = login(idInput.value) || ''
  if (loginError.value) return
  // 指定がなければ最初の未完了問題から再開
  const firstTodo = state.problemKeys.findIndex((k) => problemStatus(k) !== 'done')
  current.value = startAt >= 0 && startAt < state.problemKeys.length ? startAt : Math.max(firstTodo, 0)
  showIntro.value = !Object.keys(state.responses).length
  finished.value = false
  setUrl()
}

function doLogout() {
  drawerOpen.value = false
  logout()
  setUrl()
}

const problem = computed(() => (state.evaluatorId ? getProblem(state.problemKeys[current.value]) : null))
const counts = computed(() => {
  const c = { todo: 0, partial: 0, unsynced: 0, done: 0 }
  for (const k of state.problemKeys) c[problemStatus(k)]++
  return c
})

function go(i) {
  drawerOpen.value = false
  if (i < 0) return
  if (i >= state.problemKeys.length) { finished.value = true; return }
  finished.value = false
  current.value = i
  window.scrollTo({ top: 0 })
}
watch(current, setUrl)

function onKey(e) {
  if (e.key === 'Escape') { drawerOpen.value = false; showIntro.value = false }
}
onMounted(() => window.addEventListener('keydown', onKey))

async function resend() {
  toolMsg.value = '送信中…'
  const r = await submitPending()
  toolMsg.value = r.failed ? `${r.sent}件送信、${r.failed}件失敗しました。通信環境を確認して再試行してください。` : `${r.sent}件送信しました。`
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <button
        v-if="state.evaluatorId"
        type="button"
        class="icon-btn"
        aria-label="メニュー"
        :aria-expanded="drawerOpen"
        @click="drawerOpen = !drawerOpen"
      >
        <span class="burger" />
      </button>
      <h1>STACK PRT 比較アンケート</h1>
      <div v-if="state.evaluatorId" class="topbar-nav">
        <button type="button" class="icon-btn small" :disabled="current === 0 || finished" aria-label="前の問題" @click="go(current - 1)">‹</button>
        <span class="topbar-pos">問題 <b>{{ finished ? '—' : current + 1 }}</b> / {{ state.problemKeys.length }}</span>
        <button type="button" class="icon-btn small" :disabled="finished || current >= state.problemKeys.length - 1" aria-label="次の問題" @click="go(current + 1)">›</button>
      </div>
      <button v-if="state.evaluatorId" type="button" class="topbar-progress" @click="drawerOpen = true">
        <span class="mini-bar"><span :style="{ width: (100 * counts.done / state.problemKeys.length) + '%' }" /></span>
        完了 {{ counts.done }}/{{ state.problemKeys.length }}
        <span v-if="counts.unsynced" class="unsynced-dot" title="未送信の回答があります">未送信{{ counts.unsynced }}</span>
      </button>
    </header>
    <div v-if="toolMsg" class="toolmsg" @click="toolMsg = ''">{{ toolMsg }}</div>

    <!-- ===== ドロワー（問題一覧・各種操作） ===== -->
    <template v-if="state.evaluatorId">
      <div class="drawer-backdrop" :class="{ open: drawerOpen }" @click="drawerOpen = false" />
      <aside class="drawer" :class="{ open: drawerOpen }" :aria-hidden="!drawerOpen">
        <div class="drawer-head">
          <div>
            <div class="muted small">評価者</div>
            <b>{{ state.evaluatorId }}</b>
          </div>
          <button type="button" class="icon-btn" aria-label="閉じる" @click="drawerOpen = false">✕</button>
        </div>
        <div class="progress">
          <div class="progress-bar"><span :style="{ width: (100 * counts.done / state.problemKeys.length) + '%' }" /></div>
          <div class="progress-text">完了 {{ counts.done }} / {{ state.problemKeys.length }}
            <span v-if="counts.partial">・回答中 {{ counts.partial }}</span>
            <span v-if="counts.unsynced">・未送信 {{ counts.unsynced }}</span>
          </div>
        </div>
        <ol class="pgrid">
          <li v-for="(k, i) in state.problemKeys" :key="k">
            <button
              type="button"
              :class="['pcell', problemStatus(k), { current: i === current && !finished }]"
              :title="`問題${i + 1}：${STATUS_LABEL[problemStatus(k)]}`"
              @click="go(i)"
            >{{ i + 1 }}</button>
          </li>
        </ol>
        <div class="pgrid-legend">
          <span><i class="pcell-dot todo" />未着手</span>
          <span><i class="pcell-dot partial" />回答中</span>
          <span v-if="hasEndpoint"><i class="pcell-dot unsynced" />未送信</span>
          <span><i class="pcell-dot done" />完了</span>
        </div>
        <div class="drawer-actions">
          <button type="button" class="btn" @click="showIntro = true; drawerOpen = false">評価の手順を見る</button>
          <button v-if="hasEndpoint" type="button" class="btn" :disabled="!counts.unsynced" @click="resend">未送信を再送（{{ counts.unsynced }}）</button>
          <button v-else type="button" class="btn" @click="exportJson">回答をJSONで保存</button>
          <button type="button" class="btn ghost" @click="doLogout">評価者を切り替える</button>
        </div>
      </aside>
    </template>

    <main v-if="loading" class="center">読み込み中…</main>
    <main v-else-if="state.loadError" class="center error">{{ state.loadError }}</main>

    <main v-else-if="!state.evaluatorId" class="login">
      <section class="intro card">
        <h2>このアンケートについて</h2>
        <p>
          数学の問題に対して、学生の解答を自動採点する<strong>採点ロジック（PRT: Potential Response Tree）</strong>を
          複数の方法で作成しました。各問題について <b>PRT-A / PRT-B / …</b> を順に表示しますので、
          ロジックとフィードバックの妥当性を評価してください。ラベルと作成方法の対応は問題ごとにランダムです。
        </p>
        <ul>
          <li><b>ノード1</b>は「正答判定」です（正解なら満点で終了）。</li>
          <li><b>ノード2以降</b>は「誤答診断」です。典型的な誤りに一致すると、部分点とその誤りを指摘するフィードバックを返します。</li>
          <li>各誤答診断ノードについて C1〜C4、各PRT全体について D1〜D4 に回答してください。</li>
          <li>回答はこのブラウザに自動保存されます。途中で中断しても同じURLから再開できます。</li>
        </ul>
      </section>
      <form class="card login-form" @submit.prevent="doLogin()">
        <label>評価者コード
          <input v-model="idInput" type="text" autocomplete="off" placeholder="配布されたコード" />
        </label>
        <button type="submit" class="btn primary">開始</button>
        <p v-if="loginError" class="error">{{ loginError }}</p>
      </form>
    </main>

    <template v-else>
      <section v-if="finished" class="card center-card finish">
        <h2>お疲れさまでした</h2>
        <p v-if="counts.done === state.problemKeys.length">担当分すべての回答が完了しました。ご協力ありがとうございました。</p>
        <p v-else>未完了の問題が {{ state.problemKeys.length - counts.done }} 件あります。メニュー（☰）の一覧から確認してください。</p>
        <template v-if="!hasEndpoint">
          <p>「回答をJSONで保存」でファイルを保存し、研究担当者に送付してください。</p>
          <button type="button" class="btn primary" @click="exportJson">回答をJSONで保存</button>
        </template>
        <button v-else-if="counts.unsynced" type="button" class="btn primary" @click="resend">未送信の回答を再送（{{ counts.unsynced }}）</button>
      </section>

      <ProblemView
        v-else-if="problem"
        :key="problem.key"
        :problem="problem"
        :position="current"
        :total="state.problemKeys.length"
        @prev="go(current - 1)"
        @next="go(current + 1)"
      />
    </template>

    <!-- ===== 評価の手順（モーダル） ===== -->
    <div v-if="showIntro && state.evaluatorId" class="overlay" @click.self="showIntro = false">
      <section class="overlay-panel intro-modal" role="dialog" aria-modal="true" aria-label="評価の手順">
        <h2>評価の手順</h2>
        <ol>
          <li>左側に「問題」と、いま評価している PRT の採点木が表示されます。</li>
          <li>右側で、誤答診断ノードごとに設問 C1〜C4、最後に PRT 全体の設問 D1〜D4 に回答します。右をスクロールすると、いま見ているノードが左の木で強調されます。</li>
          <li>木のノードにマウスを乗せると判定内容とフィードバック、クリックするとそのノードの設問へ移動します。</li>
          <li>1つの PRT が終わったら「次は PRT-B を評価 →」で次へ。すべて終わったら「{{ hasEndpoint ? '送信して' : '保存して' }}次の問題へ」を押します。</li>
          <li>「全PRTを比較」で、全PRTの木を並べて見比べられます。</li>
        </ol>
        <p class="muted">
          <code>SAns</code> は学生の解答（またはそれを加工した式）、<code>TAns</code> は比較対象の式です。
          <code>ta</code>・<code>wa1</code>・<code>wa1_pred</code> などは、問題側で定義された正答・典型的誤答・誤答判定用の式です。
        </p>
        <p class="muted">問題一覧・進捗は左上のメニュー（☰）から確認できます。</p>
        <button type="button" class="btn primary" @click="showIntro = false">はじめる</button>
      </section>
    </div>
  </div>
</template>
