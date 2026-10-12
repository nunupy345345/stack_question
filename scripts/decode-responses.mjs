#!/usr/bin/env node
/**
 * 回答データを実トラック名に復号して集計用CSVを出力する（研究者用・ローカル実行）。
 *
 * 入力（複数可・混在可）:
 *   - サイトの「回答をJSONで保存」で得たファイル (*.json)
 *   - Apps Script のスプレッドシートを CSV でダウンロードしたもの (*.csv, payload 列を使用)
 * 対応表は private/track_mapping_<mapping_id>.json を mapping_id で自動選択する。
 *
 * 使い方:
 *   node scripts/decode-responses.mjs responses/*.json sheet.csv [--out out/]
 *
 * 出力:
 *   out/nodes.csv … 誤答診断ノード単位（C1〜C4）
 *   out/prts.csv  … PRT単位（D1〜D4）
 *   同じ (評価者, 問題) の回答が複数あれば updated_at が最新のものを採用する。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

const argv = process.argv.slice(2)
let outDir = path.join(ROOT, 'out')
const inputs = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outDir = path.resolve(argv[++i])
  else inputs.push(argv[i])
}
if (!inputs.length) {
  console.error('usage: node scripts/decode-responses.mjs <responses.json|sheet.csv>... [--out dir]')
  process.exit(1)
}

// RFC4180 程度の最小CSVパーサ
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (header, rows) => '﻿' + [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'

// ---- 読み込み ----
const records = []
for (const file of inputs) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
  if (file.endsWith('.csv')) {
    const [header, ...rows] = parseCsv(text)
    const pi = header.indexOf('payload')
    if (pi < 0) throw new Error(`${file}: payload 列がありません`)
    for (const r of rows) if (r[pi]) records.push(JSON.parse(r[pi]))
  } else {
    const data = JSON.parse(text)
    records.push(...(Array.isArray(data) ? data : data.records ?? [data]))
  }
}

// 最新の回答だけ残す
const latest = new Map()
for (const r of records) {
  if (!r?.problem_key || !r.updated_at) continue
  const k = `${r.evaluator_id}\t${r.problem_key}`
  const prev = latest.get(k)
  if (!prev || prev.updated_at < r.updated_at) latest.set(k, r)
}

// ---- 対応表 ----
const mappings = {}
function getMapping(id) {
  if (!(id in mappings)) {
    const f = path.join(ROOT, 'private', `track_mapping_${id}.json`)
    mappings[id] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).mapping : null
    if (!mappings[id]) console.warn(`対応表が見つかりません: ${f}`)
  }
  return mappings[id]
}

// 問題文・ノード説明を付けるため公開データも参照（mapping_idが一致する場合のみ）
const survey = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'survey.json'), 'utf8'))
const problemOf = (r) => (r.mapping_id === survey.mapping_id ? survey.problems.find((p) => p.key === r.problem_key) : null)

const nodeRows = []
const prtRows = []
for (const r of latest.values()) {
  const map = getMapping(r.mapping_id)
  const prob = problemOf(r)
  for (const [label, p] of Object.entries(r.prts)) {
    const track = map?.[r.problem_key]?.[label] ?? ''
    const base = {
      evaluator_id: r.evaluator_id, mapping_id: r.mapping_id, problem_key: r.problem_key,
      job_id: r.job_id, problem_index: r.problem_index, label, track, completed: r.completed,
    }
    const nodes = prob?.prts[label]?.prt.nodes ?? []
    for (const [name, a] of Object.entries(p.nodes)) {
      const n = nodes.find((x) => x.name === name)
      nodeRows.push({
        ...base, node: name, description: n?.description ?? '',
        answertest: n?.answertest ?? '', true_scoremode: n?.true.scoremode ?? '', true_score: n?.true.score ?? '',
        c1_agree: a.c1_agree, c1_score: a.c1_agree === 'disagree' ? a.c1_score : '',
        c2: a.c2, c3: a.c2 === 'none' ? '' : a.c3, c4: a.c2 === 'none' ? '' : a.c4,
      })
    }
    prtRows.push({
      ...base, n_nodes: nodes.length || '',
      d1: p.d1, d2: p.d2, d3: p.d3, d3_guess: p.d3 === 'yes' ? p.d3_guess : '',
      d3_reason: p.d3_reason, d4: p.d4, updated_at: r.updated_at,
    })
  }
}

fs.mkdirSync(outDir, { recursive: true })
const NODE_H = ['evaluator_id', 'mapping_id', 'problem_key', 'job_id', 'problem_index', 'label', 'track', 'completed', 'node', 'description', 'answertest', 'true_scoremode', 'true_score', 'c1_agree', 'c1_score', 'c2', 'c3', 'c4']
const PRT_H = ['evaluator_id', 'mapping_id', 'problem_key', 'job_id', 'problem_index', 'label', 'track', 'completed', 'n_nodes', 'd1', 'd2', 'd3', 'd3_guess', 'd3_reason', 'd4', 'updated_at']
fs.writeFileSync(path.join(outDir, 'nodes.csv'), toCsv(NODE_H, nodeRows))
fs.writeFileSync(path.join(outDir, 'prts.csv'), toCsv(PRT_H, prtRows))
console.log(`records: ${records.length} → latest ${latest.size}`)
console.log(`wrote ${path.relative(process.cwd(), path.join(outDir, 'nodes.csv'))} (${nodeRows.length} rows), prts.csv (${prtRows.length} rows)`)
