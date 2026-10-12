import { reactive, watch } from 'vue'

const ENDPOINT = import.meta.env.VITE_SUBMIT_ENDPOINT || ''
const TOKEN = import.meta.env.VITE_SUBMIT_TOKEN || ''
export const CLIENT_VERSION = '1.0.0'
export const hasEndpoint = !!ENDPOINT

export const state = reactive({
  survey: null, // public/survey.json
  assignments: null, // public/assignments.json（無ければ null）
  evaluatorId: '',
  problemKeys: [], // 担当問題のキー一覧
  responses: {}, // problemKey -> record
  loadError: '',
})

const storageKey = () => `prt-survey:v1:${state.survey.mapping_id}:${state.evaluatorId}`

function safeGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value) } catch { /* 容量超過・プライベートモード */ }
}

export async function loadSurvey() {
  const base = import.meta.env.BASE_URL
  const res = await fetch(`${base}survey.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`survey.json を読み込めません (${res.status})`)
  state.survey = await res.json()
  const ar = await fetch(`${base}assignments.json`, { cache: 'no-cache' }).catch(() => null)
  if (ar?.ok) state.assignments = await ar.json().catch(() => null)
}

/** 評価者IDを確定し、担当問題と保存済み回答を読み込む。成功なら null、失敗ならエラーメッセージ */
export function login(id) {
  id = String(id || '').trim()
  if (!/^[\w-]{2,64}$/.test(id)) return '評価者コードは英数字・ハイフン・アンダースコアで入力してください'
  const all = state.survey.problems.map((p) => p.key)
  if (state.assignments?.raters) {
    const keys = state.assignments.raters[id]
    if (!keys) return 'この評価者コードは登録されていません。配布されたURLから開いてください'
    state.problemKeys = keys.filter((k) => all.includes(k))
  } else {
    state.problemKeys = all
  }
  state.evaluatorId = id
  const saved = safeGet(storageKey())
  let restored = {}
  try { restored = saved ? JSON.parse(saved) : {} } catch { /* 破損データは無視 */ }
  state.responses = restored
  try { localStorage.setItem('prt-survey:last-evaluator', id) } catch { /* noop */ }
  return null
}

export function logout() {
  state.evaluatorId = ''
  state.problemKeys = []
  state.responses = {}
}

watch(
  () => state.responses,
  (v) => { if (state.evaluatorId && state.survey) safeSet(storageKey(), JSON.stringify(v)) },
  { deep: true },
)

export function getProblem(key) {
  return state.survey.problems.find((p) => p.key === key)
}

export const diagNodes = (prt) => prt.nodes.slice(1)

/** 問題ごとのラベル（古い survey.json には problem.labels が無いので prts のキーから求める） */
export const problemLabels = (problem) => problem.labels ?? Object.keys(problem.prts).sort()

/** 回答レコードを取得（無ければ作成） */
export function ensureRecord(problem) {
  if (!state.responses[problem.key]) {
    const prts = {}
    for (const label of problemLabels(problem)) {
      const nodes = {}
      for (const n of diagNodes(problem.prts[label].prt)) {
        nodes[n.name] = { c1_agree: '', c1_score: null, c2: '', c3: null, c4: null }
      }
      prts[label] = { nodes, d1: null, d2: null, d3: '', d3_guess: '', d3_reason: '', d4: '' }
    }
    state.responses[problem.key] = {
      evaluator_id: state.evaluatorId,
      mapping_id: state.survey.mapping_id,
      problem_key: problem.key,
      job_id: problem.job_id,
      problem_index: problem.problem_index,
      prts,
      started_at: new Date().toISOString(),
      updated_at: null,
      completed: false,
      synced_at: null,
      client_version: CLIENT_VERSION,
    }
  }
  return state.responses[problem.key]
}

export function touch(record) {
  record.updated_at = new Date().toISOString()
  record.completed = isRecordComplete(record)
}

// ---- 入力チェック ----
export function nodeMissing(a) {
  const m = []
  if (!a.c1_agree) m.push('C1')
  else if (a.c1_agree === 'disagree' && !validScore(a.c1_score)) m.push('C1（妥当な点数）')
  if (!a.c2) m.push('C2')
  if (a.c2 && a.c2 !== 'none') {
    if (!a.c3) m.push('C3')
    if (!a.c4) m.push('C4')
  }
  return m
}
export const validScore = (v) => v !== null && v !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 1

export function prtMissing(p) {
  const m = []
  for (const [name, a] of Object.entries(p.nodes)) {
    const nm = nodeMissing(a)
    if (nm.length) m.push(`ノード${name}: ${nm.join(', ')}`)
  }
  if (!p.d1) m.push('D1')
  if (!p.d2) m.push('D2')
  if (!p.d3) m.push('D3')
  else if (p.d3 === 'yes' && !p.d3_guess) m.push('D3（推測結果）')
  return m
}

export const isRecordComplete = (r) => Object.values(r.prts).every((p) => prtMissing(p).length === 0)

export function problemStatus(key) {
  const r = state.responses[key]
  if (!r || !r.updated_at) return 'todo'
  if (!r.completed) return 'partial'
  if (hasEndpoint && (!r.synced_at || r.synced_at < r.updated_at)) return 'unsynced'
  return 'done'
}

// ---- 送信 ----
/**
 * Apps Script へ送信。Content-Type を text/plain にして CORS プリフライトを避ける。
 * 送信失敗しても回答は localStorage に残り、後から再送できる。
 */
export async function submitRecord(record) {
  if (!ENDPOINT) return { ok: false, reason: 'no-endpoint' }
  const payload = { ...record }
  delete payload.synced_at
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: TOKEN, record: payload }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.ok === false) return { ok: false, reason: body.error || `HTTP ${res.status}` }
    record.synced_at = new Date().toISOString()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
}

export async function submitPending() {
  const results = []
  for (const key of state.problemKeys) {
    if (problemStatus(key) === 'unsynced') results.push(await submitRecord(state.responses[key]))
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }
}

/** 全回答をJSONファイルとしてダウンロード（バックアップ／メール提出用） */
export function exportJson() {
  const data = {
    exported_at: new Date().toISOString(),
    evaluator_id: state.evaluatorId,
    mapping_id: state.survey.mapping_id,
    client_version: CLIENT_VERSION,
    records: Object.values(state.responses),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `prt-survey_${state.evaluatorId}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
