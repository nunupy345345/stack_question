/**
 * STACK の questionvariables / feedbackvariables（Maxima コード）を軽量に解析する。
 * CAS は実行せず、「名前 → 定義式」の対応だけを取り出して表示に使う。
 *   ta: 3/2;            → { name: 'ta', params: null, expr: '3/2' }
 *   wa1_pred(x) := ...; → { name: 'wa1_pred', params: 'x', expr: '...' }
 */

const CONTINUES_AFTER = /(?:[-+*/^,:=<>]|\b(?:and|or|not))\s*$/
const CONTINUES_BEFORE = /^\s*(?:[*/^,=<>]|and\b|or\b)/

/** コメントを除去し、括弧・文字列の外にある ; / $ で文を分割 */
function splitStatements(code) {
  const src = String(code ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const out = []
  let depth = 0
  let inStr = false
  let buf = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      buf += c
      if (c === '\\') { buf += src[++i] ?? ''; continue }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; buf += c; continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
    if ((c === ';' || c === '$') && depth === 0) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      continue
    }
    // STACK は改行も文の区切りとして扱う（演算子で終わる行・演算子で始まる次行は継続とみなす）
    if (c === '\n' && depth === 0 && buf.trim() && !CONTINUES_AFTER.test(buf) && !CONTINUES_BEFORE.test(src.slice(i + 1))) {
      out.push(buf.trim())
      buf = ''
      continue
    }
    buf += c
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/** トップレベルの最初の ":" / ":=" の位置を探す（括弧内・文字列内は無視） */
function findAssign(stmt) {
  let depth = 0
  let inStr = false
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i]
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === ':' && depth === 0) {
      return stmt[i + 1] === '=' ? { at: i, len: 2, fn: true } : { at: i, len: 1, fn: false }
    }
  }
  return null
}

/** @returns {Map<string, {name, params, expr, fn}>} 後の定義で上書き */
export function parseVariables(code) {
  const defs = new Map()
  for (const stmt of splitStatements(code)) {
    const a = findAssign(stmt)
    if (!a) continue
    const lhs = stmt.slice(0, a.at).trim()
    const expr = stmt.slice(a.at + a.len).trim()
    const m = lhs.match(/^([A-Za-z_%][\w%]*)\s*(?:\(([^)]*)\))?$/)
    if (!m || !expr) continue
    defs.set(m[1], { name: m[1], params: m[2] ?? null, expr, fn: a.fn || m[2] !== undefined })
  }
  return defs
}

const RESERVED = new Set([
  'true', 'false', 'and', 'or', 'not', 'if', 'then', 'else', 'elseif', 'do', 'for', 'in', 'while',
  'block', 'lambda', 'is', 'pi', 'inf', 'minf',
])

/** 式に現れる識別子（関数名も含む） */
export function identifiers(expr) {
  const s = String(expr ?? '').replace(/"(?:[^"\\]|\\.)*"/g, ' ')
  return [...new Set(s.match(/[A-Za-z_%][\w%]*/g) ?? [])]
}

/**
 * 式 exprs に登場する変数の定義を、依存関係をたどって集める（定義順は登場順・深さ優先）。
 * 例: sans = "wa1_pred(ans1)" → wa1_pred の定義、その中で使われる ta の定義 …
 */
export function collectDefinitions(exprs, defs, { maxDepth = 3 } = {}) {
  const seen = new Set()
  const out = []
  const visit = (expr, depth, locals) => {
    for (const id of identifiers(expr)) {
      if (seen.has(id) || locals.has(id) || RESERVED.has(id) || !defs.has(id)) continue
      seen.add(id)
      const d = defs.get(id)
      out.push({ ...d, depth })
      // 関数本体の中の仮引数（wa1_pred(x) の x 等）は外側の変数として扱わない
      const params = new Set((d.params ?? '').split(',').map((p) => p.trim()).filter(Boolean))
      if (depth < maxDepth) visit(d.expr, depth + 1, params)
    }
  }
  for (const e of exprs) visit(e, 0, new Set())
  return out
}

/** PRTごとの変数コンテキスト（問題変数 + PRTのフィードバック変数 + 解答欄） */
export function varContext(prtData) {
  const qv = prtData?.questionvariables ?? ''
  const fv = prtData?.prt?.feedbackvariables ?? ''
  const defs = parseVariables(qv)
  for (const [k, v] of parseVariables(fv)) defs.set(k, { ...v, scope: 'feedback' })
  return { defs, inputs: prtData?.inputs ?? [], hasData: !!(qv.trim() || fv.trim()) }
}

/** sans / tans に登場する解答欄（inputs が無い場合は ans1, ans2 … を解答欄とみなす） */
export function inputsIn(exprs, ctx) {
  const ids = new Set(exprs.flatMap(identifiers))
  if (ctx.inputs.length) return ctx.inputs.filter((i) => ids.has(i.name))
  return [...ids].filter((id) => /^ans\d+$/.test(id) && !ctx.defs.has(id)).map((name) => ({ name, type: '', tans: '' }))
}

/** 変数名から役割を推定: ta → 正答, wa2 / wa2_pred → 誤答2 */
export function roleOf(name) {
  const s = String(name ?? '')
  if (/^ta(_.*)?$/.test(s)) return '正答'
  const m = s.match(/^wa(\d+)(_.*)?$/)
  return m ? `誤答${m[1]}` : ''
}

const BARE_ID = /^[A-Za-z_]\w*$/
const CALL_OF = /^([A-Za-z_]\w*)\(\s*(ans\d+)\s*\)$/
export const isBareId = (e) => BARE_ID.test(String(e ?? '').trim())
/** `wa1_pred(ans1)` のような「解答に述語関数を適用した式」なら関数名を返す */
export const predicateCall = (e) => String(e ?? '').trim().match(CALL_OF)?.[1] ?? null

/** ノードの見出し: description があればそれ、なければ判定対象（wa2 → 誤答2）から作る */
export function nodeTitle(node) {
  const d = String(node.description ?? '').trim()
  if (d) return d
  const tans = String(node.tans ?? '').trim()
  return roleOf(isBareId(tans) ? tans : predicateCall(node.sans))
}
