#!/usr/bin/env node
/**
 * survey_dataset.json → 公開用 public/survey.json（匿名化済み）を生成する前処理。
 *
 * - {job_id, problem_index} ごとに 実トラック名 → PRT-A/B/C のランダム対応を生成
 *   （crypto乱数。6通りの順列を均等回数ずつシャッフルして割り当てる＝ブロック化ランダム化）
 * - 公開ファイルには実トラック名・question_id・preview_url を一切含めない
 * - 対応表は private/track_mapping_<mapping_id>.json にだけ保存（gitignore対象・非公開）
 * - トラックはデータから自動検出（traditional / norag / kc / human など任意のキー名）。
 *   問題ごとに存在するトラック数だけラベルを振る（3つなら PRT-A〜C、4つなら PRT-A〜D）
 * - --raters を指定すると評価者への問題割り当て public/assignments.json も生成
 *
 * 使い方:
 *   node scripts/prepare-survey.mjs [--input json/xxx.json] [--raters 6 | --raters R01,R02]
 *                                   [--overlap 2] [--block 8]
 *                                   [--tracks traditional,norag,kc,human]  使うトラックを限定（省略時は全検出）
 *                                   [--require human]  このトラックが無い問題は除外（省略時は2トラック以上あれば採用）
 *                                   [--reuse-mapping <mapping_id>]  private/ の既存の対応表をそのまま使って作り直す
 *                                       （コード修正後に同じ mapping_id・同じラベル割り当てで再生成したいとき。入力JSONが同一であることを確認する）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const labelAt = (i) => `PRT-${String.fromCharCode(65 + i)}` // PRT-A, PRT-B, ...
const MIN_TRACKS = 2

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[key] = true
      else { args[key] = next; i++ }
    }
  }
  return args
}

function newestDataset() {
  const dir = path.join(ROOT, 'json')
  const files = fs.readdirSync(dir).filter((f) => /^survey_dataset.*\.json$/.test(f)).sort()
  if (!files.length) throw new Error('json/ に survey_dataset*.json が見つかりません')
  return path.join(dir, files[files.length - 1])
}

// 全順列（トラック数 n に対して n! 通り）
function permutations(n) {
  if (n === 0) return [[]]
  return permutations(n - 1).flatMap((p) =>
    Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]))
}

// Fisher–Yates（crypto乱数）
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 公開用にPRTから必要なフィールドだけを抜き出す（未知のフィールドは落とす）
function cleanPrt(prt) {
  const branch = (b) => ({
    scoremode: String(b.scoremode ?? ''),
    score: String(b.score ?? ''),
    nextnode: String(b.nextnode ?? '-1'),
    answernote: String(b.answernote ?? ''),
    feedback: String(b.feedback ?? ''),
  })
  return {
    firstnodename: String(prt.firstnodename ?? prt.nodes?.[0]?.name ?? '1'),
    // PRT内で定義される変数（STACK の feedbackvariables）。無ければ空文字
    feedbackvariables: String(prt.feedbackvariables ?? prt.feedback_variables ?? ''),
    nodes: prt.nodes.map((n) => ({
      name: String(n.name),
      description: String(n.description ?? ''),
      answertest: String(n.answertest ?? ''),
      sans: String(n.sans ?? ''),
      tans: String(n.tans ?? ''),
      testoptions: String(n.testoptions ?? ''),
      true: branch(n.true),
      false: branch(n.false),
    })),
  }
}

// 解答欄の定義（STACK の inputs）。配列 [{name,type,tans}] でも {ans1:{type,tans}} でも受け付ける
function cleanInputs(inputs) {
  if (!inputs) return []
  const list = Array.isArray(inputs) ? inputs : Object.entries(inputs).map(([name, v]) => ({ name, ...v }))
  return list
    .filter((i) => i && i.name)
    .map((i) => ({ name: String(i.name), type: String(i.type ?? ''), tans: String(i.tans ?? '') }))
}

function makeRaterIds(spec) {
  if (/^\d+$/.test(spec)) {
    // 推測されにくいランダムコード（URLに入れて配布する）
    return Array.from({ length: Number(spec) }, (_, i) =>
      `r${String(i + 1).padStart(2, '0')}-${crypto.randomBytes(3).toString('hex')}`)
  }
  return spec.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * 問題を連続ブロックに分け、各ブロックを overlap 人に割り当てる（ラウンドロビンで負荷均等）。
 * 同じジョブ（問題セット）の小問はなるべく同じブロックに入る。
 */
function buildAssignments(keys, raters, overlap, blockSize) {
  if (overlap > raters.length) throw new Error('--overlap は評価者数以下にしてください')
  const blocks = []
  for (let i = 0; i < keys.length; i += blockSize) blocks.push(keys.slice(i, i + blockSize))
  const out = Object.fromEntries(raters.map((r) => [r, []]))
  blocks.forEach((block, bi) => {
    for (let k = 0; k < overlap; k++) out[raters[(bi * overlap + k) % raters.length]].push(...block)
  })
  return { blocks: blocks.length, raters: out }
}

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  console.log('usage: node scripts/prepare-survey.mjs [--input f] [--raters ..] [--overlap n] [--block n] [--tracks a,b] [--require t] [--reuse-mapping <mapping_id>]')
  process.exit(0)
}
const inputPath = args.input ? path.resolve(args.input) : newestDataset()
const raw = fs.readFileSync(inputPath)
const src = JSON.parse(raw.toString('utf8'))
const sourceSha = crypto.createHash('sha256').update(raw).digest('hex')
// 既存の対応表を再利用する場合は、入力JSONが対応表の作成時と同一であることを確かめる
let reuse = null
if (args['reuse-mapping']) {
  const f = path.join(ROOT, 'private', `track_mapping_${args['reuse-mapping']}.json`)
  if (!fs.existsSync(f)) throw new Error(`対応表が見つかりません: ${path.relative(ROOT, f)}`)
  reuse = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (reuse.source_sha256 !== sourceSha) throw new Error('入力JSONが、対応表を作ったときのJSONと異なります（--reuse-mapping は使えません）')
}
const mappingId = reuse?.mapping_id ?? `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex')}`

const hasPrt = (tr) => Array.isArray(tr?.prt?.nodes) && tr.prt.nodes.length > 0
const listArg = (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : null)

// トラック検出（出現順を保つ）
const detected = []
for (const item of src.items) for (const [t, tr] of Object.entries(item.tracks ?? {})) if (hasPrt(tr) && !detected.includes(t)) detected.push(t)
const TRACKS = listArg(args.tracks) ?? detected
const REQUIRED = listArg(args.require) ?? []
if (TRACKS.length > 26) throw new Error('トラック数が多すぎます')

// 各問題で使うトラックを決める
const candidates = []
for (const item of src.items) {
  const key = `${item.job_id}-${item.problem_index}`
  const present = TRACKS.filter((t) => hasPrt(item.tracks?.[t]))
  const lackReq = REQUIRED.filter((t) => !present.includes(t))
  if (lackReq.length) { console.warn(`skip ${key}: 必須トラック欠損 (${lackReq.join(', ')})`); continue }
  if (present.length < MIN_TRACKS) { console.warn(`skip ${key}: トラックが${present.length}つしかありません`); continue }
  candidates.push({ item, key, present })
}

// トラックの組み合わせごとに、全順列を均等回数ずつ用意してシャッフル
// （各トラックが各ラベル位置に偏りなく現れる＝ブロック化ランダム化）
const pools = {}
for (const c of candidates) (pools[c.present.join(',')] ??= { n: c.present.length, count: 0 }).count++
for (const pool of Object.values(pools)) {
  const perms = permutations(pool.n)
  pool.perms = shuffle(Array.from({ length: Math.ceil(pool.count / perms.length) }, () => perms).flat())
}

// 評価者に見せる問題文: 3トラック共通の stack_question_text。無ければ元の問題文に退避して警告する
const noStackText = []
function questionText(item) {
  const t = String(item.stack_question_text ?? '').trim()
  if (t) return t
  noStackText.push(`${item.job_id}-${item.problem_index}`)
  return String(item.source_question_text ?? '')
}

const mapping = {}
const problems = []
for (const { item, key, present } of candidates) {
  const order = reuse
    ? Object.keys(reuse.mapping[key] ?? {}).sort().map((l) => reuse.mapping[key][l])
    : pools[present.join(',')].perms.pop().map((i) => present[i])
  if (reuse && order.length !== present.length) throw new Error(`対応表と入力JSONのトラック構成が一致しません: ${key}`)
  const labels = order.map((_, i) => labelAt(i))
  const labelToTrack = Object.fromEntries(labels.map((l, i) => [l, order[i]]))
  mapping[key] = labelToTrack

  const prts = {}
  for (const label of labels) {
    const tr = item.tracks[labelToTrack[label]]
    // tr.questiontext は公開しない（トラックごとに書き方が違い、作成方法を推測する手がかりになるため）
    prts[label] = {
      // 問題変数（STACK の questionvariables, Maxima コード）。無ければ空文字
      questionvariables: String(tr.questionvariables ?? tr.question_variables ?? ''),
      inputs: cleanInputs(tr.inputs),
      prt: cleanPrt(tr.prt),
    }
  }
  problems.push({
    key,
    job_id: item.job_id,
    problem_index: item.problem_index,
    question_text: questionText(item),
    labels,
    prts,
  })
}
const ALL_LABELS = Array.from({ length: Math.max(0, ...problems.map((p) => p.labels.length)) }, (_, i) => labelAt(i))

const publicDir = path.join(ROOT, 'public')
const privateDir = path.join(ROOT, 'private')
fs.mkdirSync(publicDir, { recursive: true })
fs.mkdirSync(privateDir, { recursive: true })

fs.writeFileSync(
  path.join(publicDir, 'survey.json'),
  JSON.stringify({ mapping_id: mappingId, labels: ALL_LABELS, problems }),
)
if (!reuse) fs.writeFileSync(
  path.join(privateDir, `track_mapping_${mappingId}.json`),
  JSON.stringify({
    mapping_id: mappingId,
    created_at: new Date().toISOString(),
    source_file: path.relative(ROOT, inputPath),
    source_sha256: sourceSha,
    tracks: TRACKS,
    mapping, // { "<job_id>-<problem_index>": { "PRT-A": "<track>", ... } }
  }, null, 2),
)

// 検証: 公開ファイルに実トラック名が混入していないこと
const published = fs.readFileSync(path.join(publicDir, 'survey.json'), 'utf8')
const leaked = [...new Set([...detected, ...TRACKS])].filter((t) => published.includes(`"${t}"`))
if (leaked.length) throw new Error(`公開ファイルにトラック名が含まれています: ${leaked.join(', ')}`)

console.log(`input      : ${path.relative(ROOT, inputPath)}`)
console.log(`problems   : ${problems.length}`)
console.log(`mapping_id : ${mappingId}`)
console.log(`tracks     : ${TRACKS.join(', ')}${REQUIRED.length ? `（必須: ${REQUIRED.join(', ')}）` : ''}`)
for (const [combo, pool] of Object.entries(pools)) console.log(`  [${combo}] ${pool.count}問 → PRT-A〜${labelAt(pool.n - 1)}`)
const dist = Object.fromEntries(TRACKS.map((t) => [t, Object.fromEntries(ALL_LABELS.map((l) => [l, 0]))]))
for (const m of Object.values(mapping)) for (const [l, t] of Object.entries(m)) dist[t][l]++
console.log(`label dist : ${TRACKS.map((t) => `${t}=${ALL_LABELS.map((l) => dist[t][l]).join('/')}`).join('  ')} (${ALL_LABELS.map((l) => l.slice(4)).join('/')})`)
if (Object.keys(pools).length > 1) {
  console.warn('注意: 問題によってPRTの個数が異なります。個数の違いから特定トラック（例: 人間版）の有無が推測される可能性があります。揃えたい場合は --require を使ってください。')
}
if (noStackText.length) {
  console.warn(`警告: stack_question_text が無い問題が ${noStackText.length} 問あります（source_question_text で代用）: ${noStackText.slice(0, 8).join(', ')}`)
} else {
  console.log(`question   : stack_question_text を ${problems.length} 問すべてで使用`)
}
const withVars = problems.filter((p) => Object.values(p.prts).some((x) => x.questionvariables)).length
console.log(`variables  : 問題変数あり ${withVars}/${problems.length}問${withVars ? '' : '（questionvariables が無いため ta / wa1 等の定義は表示されません）'}`)
console.log(`public     : public/survey.json`)
console.log(`PRIVATE    : private/track_mapping_${mappingId}.json  ← 集計時の復号に必須。必ずバックアップ・非公開で保管`)

if (args.raters) {
  const raters = makeRaterIds(String(args.raters))
  const overlap = Number(args.overlap ?? 2)
  const blockSize = Number(args.block ?? 8)
  const { blocks, raters: assign } = buildAssignments(problems.map((p) => p.key), raters, overlap, blockSize)
  fs.writeFileSync(
    path.join(publicDir, 'assignments.json'),
    JSON.stringify({ mapping_id: mappingId, overlap, block_size: blockSize, raters: assign }, null, 2),
  )
  console.log(`assignments: public/assignments.json (${raters.length}名, ${blocks}ブロック, 各ブロック${overlap}名)`)
  for (const r of raters) console.log(`  ${r}: ${assign[r].length}問   URL: <site>/?e=${r}`)
} else if (fs.existsSync(path.join(publicDir, 'assignments.json'))) {
  fs.rmSync(path.join(publicDir, 'assignments.json'))
  console.log('assignments: なし（全評価者が全問を担当。古い assignments.json は削除しました）')
}
