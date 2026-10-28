/**
 * Maxima 式 → LaTeX 変換（表示専用。CAS は実行しない）
 *
 *   maximaToTex('(2/7)*x^(7/2) + c')  →  '\\frac{2}{7} x^{\\frac{7}{2}} + c'
 *   defToTex({ name:'wa1_pred', params:'ex', expr:'is(ex = -inf)', fn:true })
 *                                      →  '\\mathrm{wa1\\_pred}(ex) \\iff ex = -\\infty'
 *
 * 構文解析できない式（if / block / for など）は null を返す。呼び出し側は原文表示にフォールバックする。
 */

// ---------- 字句解析 ----------
const TOKEN_RE = /\s+|(\d+\.?\d*(?:[eE][+-]?\d+)?)|("(?:[^"\\]|\\.)*")|(:=|<=|>=|\*\*|[A-Za-z_%][A-Za-z0-9_%]*|[-+*/^=#<>(),[\]!])/gy

function tokenize(src) {
  const out = []
  TOKEN_RE.lastIndex = 0
  while (TOKEN_RE.lastIndex < src.length) {
    const at = TOKEN_RE.lastIndex
    const m = TOKEN_RE.exec(src)
    if (!m) throw new Error(`字句エラー: ${src.slice(at, at + 10)}`)
    if (m[1] !== undefined) out.push({ t: 'num', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].slice(1, -1) })
    else if (m[3] !== undefined) out.push({ t: /^[A-Za-z_%]/.test(m[3]) ? 'id' : 'op', v: m[3] })
  }
  return out
}

// ---------- 構文解析（Pratt） ----------
// 結合力は Maxima に合わせる: or 30 < and 65 < not 70 < 関係 80 < +- 100 < */ 120 < ^ 140
const INFIX = {
  or: [30, 'or'], and: [65, 'and'],
  '=': [80, 'rel'], '#': [80, 'rel'], '<': [80, 'rel'], '>': [80, 'rel'], '<=': [80, 'rel'], '>=': [80, 'rel'],
  '+': [100, 'bin'], '-': [100, 'bin'], '*': [120, 'bin'], '/': [120, 'bin'], '^': [140, 'pow'], '**': [140, 'pow'],
}
const KEYWORDS = new Set(['if', 'then', 'else', 'elseif', 'for', 'while', 'do', 'block', 'lambda', 'return', 'unless', 'thru', 'step', 'in'])

function parse(src) {
  const toks = tokenize(src)
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const isOp = (v) => peek()?.t === 'op' && peek().v === v
  const expectOp = (v) => { if (!isOp(v)) throw new Error(`'${v}' が必要です`); i++ }

  function infixOf(tok) {
    if (!tok) return null
    if (tok.t === 'op' || (tok.t === 'id' && (tok.v === 'and' || tok.v === 'or'))) return INFIX[tok.v] ? { ...tok, lbp: INFIX[tok.v][0], kind: INFIX[tok.v][1] } : null
    return null
  }

  function parseExpr(rbp) {
    let left = parsePrefix()
    for (;;) {
      const op = infixOf(peek())
      if (!op || op.lbp <= rbp) break
      next()
      if (op.kind === 'pow') {
        const right = parseExpr(op.lbp - 1) // 右結合
        left = { type: 'pow', base: left, exp: right }
      } else if (op.kind === 'rel') {
        left = { type: 'rel', op: op.v, l: left, r: parseExpr(op.lbp) }
      } else if (op.kind === 'and' || op.kind === 'or') {
        left = { type: op.kind, l: left, r: parseExpr(op.lbp) }
      } else {
        left = { type: 'bin', op: op.v, l: left, r: parseExpr(op.lbp) }
      }
    }
    return left
  }

  function parsePrefix() {
    const tok = next()
    if (!tok) throw new Error('式が途中で終わっています')
    if (tok.t === 'num') return { type: 'num', v: tok.v }
    if (tok.t === 'str') return { type: 'str', v: tok.v }
    if (tok.t === 'op') {
      if (tok.v === '-') return { type: 'neg', x: parseExpr(100) }
      if (tok.v === '+') return parseExpr(100)
      if (tok.v === '(') { const e = parseExpr(0); expectOp(')'); return { type: 'paren', x: e } }
      if (tok.v === '[') {
        const items = []
        if (!isOp(']')) { do { items.push(parseExpr(0)) } while (isOp(',') && next()) }
        expectOp(']')
        return { type: 'list', items }
      }
      throw new Error(`予期しない記号 '${tok.v}'`)
    }
    // 識別子
    if (tok.v === 'not') return { type: 'not', x: parseExpr(70) }
    if (KEYWORDS.has(tok.v)) throw new Error(`未対応の構文 '${tok.v}'`)
    if (isOp('(')) {
      next()
      const args = []
      if (!isOp(')')) { do { args.push(parseExpr(0)) } while (isOp(',') && next()) }
      expectOp(')')
      return { type: 'call', name: tok.v, args }
    }
    return { type: 'sym', v: tok.v }
  }

  const first = parseExpr(0)
  let e = first
  if (isOp(',')) {
    // STACK では "a, b" のように括弧なしで複数の式を並べた解答も使われる
    const items = [first]
    while (isOp(',')) { next(); items.push(parseExpr(0)) }
    e = { type: 'seq', items }
  }
  if (i < toks.length) throw new Error(`解釈できない部分: ${toks[i].v}`)
  return e
}

// ---------- LaTeX 生成 ----------
// 括弧の要否判定に使う優先度（大きいほど強く結合）
const P = { or: 1, and: 2, rel: 3, add: 4, mul: 5, frac: 6, pow: 7, call: 8, atom: 9 }

const FUNCS = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', coth: '\\coth',
  sech: '\\operatorname{sech}', csch: '\\operatorname{csch}',
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', acot: '\\operatorname{arccot}',
  arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan', arccot: '\\operatorname{arccot}',
  asinh: '\\operatorname{arsinh}', acosh: '\\operatorname{arcosh}', atanh: '\\operatorname{artanh}',
  arcsinh: '\\operatorname{arsinh}', arccosh: '\\operatorname{arcosh}', arctanh: '\\operatorname{artanh}',
  log: '\\ln', ln: '\\ln',
}
const POWERABLE = new Set(Object.keys(FUNCS)) // sin^2 x のように肩に冪を載せる関数

const esc = (s) => String(s).replace(/([_%$&#{}])/g, '\\$1')
const text = (s) => `\\text{${esc(s)}}`

function symTex(v) {
  switch (v) {
    case '%pi': return '\\pi'
    case '%e': return 'e'
    case '%i': return 'i'
    case 'inf': case 'infinity': return '\\infty'
    case 'minf': return '-\\infty'
    case 'und': case 'ind': return text(v)
    case 'true': case 'false': return text(v)
    default:
  }
  if (/^[A-Za-z]$/.test(v)) return v
  return `\\mathrm{${esc(v)}}`
}

// 「〜を含む／含まない」だけでできた条件は、記号（∧ ∨ ¬）ではなく言葉（かつ・または）で表す
const isWords = (n) => {
  n = strip(n)
  if (n.type === 'call') return n.name === 'freeof' && n.args.length === 2
  if (n.type === 'not') { const x = strip(n.x); const i = x.type === 'call' && x.name === 'is' ? strip(x.args[0]) : x; return isWords(i) }
  if (n.type === 'and' || n.type === 'or') return isWords(n.l) && isWords(n.r)
  return false
}
const strip = (n) => (n.type === 'paren' ? strip(n.x) : n)
const isAtomLike = (n) => ['num', 'str'].includes(n.type) || (n.type === 'sym' && n.v !== 'minf') || (n.type === 'call' && n.name === 'abs')

function prec(n) {
  n = strip(n)
  switch (n.type) {
    case 'num': case 'str': case 'list': return P.atom
    case 'sym': return n.v === 'minf' ? P.add : P.atom
    case 'neg': return P.add
    case 'bin': return n.op === '+' || n.op === '-' ? P.add : n.op === '*' ? P.mul : P.frac
    case 'pow': return P.pow
    case 'rel': return P.rel
    case 'and': return P.and
    case 'or': return P.or
    case 'not': return P.rel
    case 'call': {
      if (n.name === 'is' && n.args.length === 1) return prec(n.args[0])
      if (n.name === 'sqrt' || n.name === 'abs') return P.atom
      if (n.name === 'exp') return P.pow
      if (n.name === 'freeof' || (n.name === 'equal' && n.args.length === 2)) return P.rel
      if (['limit', 'integrate', 'int'].includes(n.name) && n.args.length >= 2) return P.add
      return P.call
    }
    default: return P.atom
  }
}

/** 優先度が need 未満なら括弧で包む */
function wrap(n, need) {
  const s = tex(n)
  return prec(n) < need ? `\\left(${s}\\right)` : s
}

function callTex(n) {
  const { name, args } = n
  const a = args.map(strip)
  switch (name) {
    case 'is': if (a.length === 1) return tex(a[0]); break
    case 'sqrt': if (a.length === 1) return `\\sqrt{${tex(a[0])}}`; break
    case 'abs': if (a.length === 1) return `\\left|${tex(a[0])}\\right|`; break
    case 'exp': if (a.length === 1) return `e^{${tex(a[0])}}`; break
    case 'diff':
      if (a.length === 2) return `\\frac{d}{d${tex(a[1])}}${wrap(a[0], P.call)}`
      if (a.length === 3) return `\\frac{d^{${tex(a[2])}}}{d${tex(a[1])}^{${tex(a[2])}}}${wrap(a[0], P.call)}`
      break
    // 簡約・展開・分子・分母・次数・係数は、英語名のままでは読みにくいので日本語の演算名で表示する
    case 'ratsimp': case 'radcan': case 'fullratsimp': case 'trigsimp': case 'factor': case 'expand': case 'num': case 'denom': {
      const jp = { ratsimp: '簡約', fullratsimp: '簡約', radcan: '根号の簡約', trigsimp: '三角関数の簡約', factor: '因数分解', expand: '展開', num: '分子', denom: '分母' }[name]
      if (a.length === 1) return `${text(jp)}\\left(${tex(a[0])}\\right)`
      break
    }
    case 'hipow':
      if (a.length === 2) return `\\deg_{${tex(a[1])}}\\left(${tex(a[0])}\\right)`
      break
    case 'ratcoef': case 'coeff':
      if (a.length === 2 || a.length === 3) {
        const pw = a.length === 3 ? `${tex(a[1])}^{${tex(a[2])}}` : tex(a[1])
        return `${text('係数')}_{${pw}}\\left(${tex(a[0])}\\right)`
      }
      break
    case 'int': // STACK の名詞形の積分（integrate と同じ）
    case 'integrate':
      if (a.length === 2) return `\\int ${wrap(a[0], P.mul)}\\,d${tex(a[1])}`
      if (a.length === 4) return `\\int_{${tex(a[2])}}^{${tex(a[3])}} ${wrap(a[0], P.mul)}\\,d${tex(a[1])}`
      break
    case 'limit':
      if (a.length >= 3) {
        const dir = a[3]?.type === 'sym' ? ({ plus: '^{+}', minus: '^{-}' })[a[3].v] ?? '' : ''
        return `\\lim_{${tex(a[1])} \\to ${tex(a[2])}${dir}} ${wrap(a[0], P.mul)}`
      }
      break
    case 'equal':
      if (a.length === 2) return `${tex(a[0])} = ${tex(a[1])}`
      break
    case 'subst':
      // subst([C=0, c=0], e): 複数の置き換えを同時に行う
      if (a.length === 2 && a[0].type === 'list' && a[0].items.length && a[0].items.every((i) => strip(i).type === 'rel' && strip(i).op === '='))
        return `\\left.${tex(a[1])}\\right|_{${a[0].items.map((i) => tex(strip(i))).join(',\\ ')}}`
      if (a.length === 2 && a[0].type === 'rel' && a[0].op === '=') return `\\left.${tex(a[1])}\\right|_{${tex(a[0])}}`
      if (a.length === 3) return `\\left.${tex(a[2])}\\right|_{${tex(a[1])}=${tex(a[0])}}`
      break
    case 'freeof':
      if (a.length === 2) return `${tex(a[1])} ${text(' は ')}${tex(a[0])}${text(' を含まない')}`
      break
    default:
  }
  if (FUNCS[name] && a.length === 1) {
    const arg = a[0]
    const simple = arg.type === 'num' || arg.type === 'sym' || (arg.type === 'call' && arg.name === 'abs')
    return simple ? `${FUNCS[name]} ${tex(arg)}` : `${FUNCS[name]}\\left(${tex(arg)}\\right)`
  }
  return `\\operatorname{${esc(name)}}\\left(${a.map(tex).join(', ')}\\right)`
}

function mulTex(n) {
  // a*b*c を平らにして、数字が続く所だけ \cdot で区切る
  const factors = []
  const walk = (x) => {
    x = strip(x)
    if (x.type === 'bin' && x.op === '*') { walk(x.l); walk(x.r) } else factors.push(x)
  }
  walk(n)
  return factors.reduce((acc, f, idx) => {
    const s = wrap(f, P.mul)
    if (idx === 0) return s
    const needDot = /^\d/.test(s) || (/^\d/.test(acc) && /^\\frac/.test(s)) || /^\\left\(/.test(s) && /\d$/.test(acc)
    return `${acc}${needDot ? ' \\cdot ' : ' '}${s}`
  }, '')
}

function tex(n) {
  n = strip(n)
  switch (n.type) {
    case 'num': return n.v
    case 'str': return text(n.v)
    case 'sym': return symTex(n.v)
    case 'list': return `\\left[${n.items.map(tex).join(', ')}\\right]`
    case 'seq': return n.items.map(tex).join(',\\ ')
    case 'neg': return `-${wrap(n.x, P.mul)}`
    case 'bin': {
      if (n.op === '/') return `\\frac{${tex(n.l)}}{${tex(n.r)}}`
      if (n.op === '*') return mulTex(n)
      const l = wrap(n.l, P.add)
      const r = strip(n.r)
      if (n.op === '+' && r.type === 'neg') return `${l} - ${wrap(r.x, P.mul)}`
      return `${l} ${n.op} ${wrap(r, n.op === '-' ? P.mul : P.add)}`
    }
    case 'pow': {
      const base = strip(n.base)
      const e = tex(n.exp)
      if (base.type === 'call' && POWERABLE.has(base.name) && base.args.length === 1 && strip(n.exp).type !== 'neg') {
        const arg = strip(base.args[0])
        const simple = arg.type === 'num' || arg.type === 'sym'
        return `${FUNCS[base.name]}^{${e}}${simple ? ` ${tex(arg)}` : `\\left(${tex(arg)}\\right)`}`
      }
      const needParen = !(isAtomLike(base) || (base.type === 'call' && base.name === 'sqrt')) || base.type === 'neg'
      return `${needParen ? `\\left(${tex(base)}\\right)` : tex(base)}^{${e}}`
    }
    case 'rel': {
      const sym = { '=': '=', '#': '\\ne', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge' }[n.op]
      return `${wrap(n.l, P.add)} ${sym} ${wrap(n.r, P.add)}`
    }
    case 'and': return `${wrap(n.l, P.and)} ${isWords(n) ? text('　かつ　') : '\\land'} ${wrap(n.r, P.and)}`
    case 'or': return `${wrap(n.l, P.or)} ${isWords(n) ? text('　または　') : '\\lor'} ${wrap(n.r, P.and)}`
    case 'not': {
      const x = strip(n.x)
      const inner = x.type === 'call' && x.name === 'is' ? strip(x.args[0]) : x
      // 「〜を含まない」の否定は「〜を含む」と読む
      if (inner.type === 'call' && inner.name === 'freeof' && inner.args.length === 2)
        return `${tex(strip(inner.args[1]))} ${text(' は ')}${tex(strip(inner.args[0]))}${text(' を含む')}`
      return `\\lnot ${isAtomLike(inner) ? tex(inner) : `\\left(${tex(inner)}\\right)`}`
    }
    case 'call': return callTex(n)
    default: throw new Error(`未対応のノード ${n.type}`)
  }
}

const isPredicate = (n) => {
  n = strip(n)
  return ['rel', 'and', 'or', 'not'].includes(n.type) || (n.type === 'call' && ['is', 'freeof'].includes(n.name))
}

// ---------- 公開API ----------
/** 式1つを LaTeX に。失敗したら null */
/** 式の木の中の変数（sym）を、defs（名前 → {expr, fn}）にある定義の値に置き換える。関数定義は対象外 */
function inlineVars(node, defs, seen = new Set()) {
  if (Array.isArray(node)) return node.map((x) => inlineVars(x, defs, seen))
  if (!node || typeof node !== 'object') return node
  if (node.type === 'sym' && defs.has(node.v) && !defs.get(node.v).fn && !seen.has(node.v)) {
    try { return { type: 'paren', x: inlineVars(parse(defs.get(node.v).expr), defs, new Set(seen).add(node.v)) } } catch { return node }
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, inlineVars(v, defs, seen)]))
}

/** 式の木の中の、解答欄の変数（ans1 など）を、表示用の文字列（「学生の解答」など）に置き換える */
function relabelStudent(node, label) {
  if (Array.isArray(node)) return node.map((x) => relabelStudent(x, label))
  if (!node || typeof node !== 'object') return node
  if (node.type === 'sym') { const t = label(node.v); return t ? { type: 'str', v: t } : node }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, relabelStudent(v, label)]))
}

/**
 * defs を渡すと、式に出てくる変数（ta, ans2 など）を定義の値に置き換えて表示する。
 * opts.student(name) が文字列を返す名前（解答欄 ans1 など）は、その文字列（「学生の解答」）で表示する。
 */
export function maximaToTex(expr, defs = null, opts = {}) {
  const src = String(expr ?? '').trim()
  if (!src) return null
  try {
    let ast = parse(src)
    if (defs && defs.size) ast = inlineVars(ast, defs)
    if (opts.student) ast = relabelStudent(ast, opts.student)
    return tex(ast)
  } catch { return null }
}

// ---- 加工の手順 -------------------------------------------------------------
// ratcoef(expand(ratsimp(subst([C=0,c=0], ans1)/exp(-x))), x, 2) のような入れ子を、
// 「内側から外側へ」順に並べた手順（日本語＋必要なら数式）にする。対応できない形は null。
const hasStudent = (n, isStudent) => {
  if (Array.isArray(n)) return n.some((x) => hasStudent(x, isStudent))
  if (!n || typeof n !== 'object') return false
  if (n.type === 'sym') return !!isStudent(n.v)
  return Object.values(n).some((v) => hasStudent(v, isStudent))
}
const WRAP_STEP = {
  ratsimp: '簡約する', fullratsimp: '簡約する',
  radcan: '根号・べき乗をまとめる', trigsimp: '三角関数の式を簡単にする',
  expand: '展開する', factor: '因数分解する', num: '分子を取り出す', denom: '分母を取り出す',
}
function stepsOf(node, isStudent) {
  const n = strip(node)
  if (n.type === 'sym') return isStudent(n.v) ? [] : null
  if (n.type === 'call') {
    const a = n.args.map(strip)
    const inner = (x) => stepsOf(x, isStudent)
    const then = (x, step) => { const r = inner(x); return r && [...r, step] }
    if (WRAP_STEP[n.name] && a.length === 1) return then(a[0], { text: WRAP_STEP[n.name] })
    if (n.name === 'diff' && a.length === 2) return then(a[0], { tex: tex(a[1]), text: ' で微分する' })
    if (n.name === 'hipow' && a.length === 2) return then(a[0], { tex: tex(a[1]), text: ' についての最高次数を求める' })
    if ((n.name === 'ratcoef' || n.name === 'coeff') && (a.length === 2 || a.length === 3))
      return then(a[0], { tex: a.length === 3 ? `${tex(a[1])}^{${tex(a[2])}}` : tex(a[1]), text: ' の係数を取り出す' })
    if (n.name === 'subst' && a.length === 2 && a[0].type === 'list' && a[0].items.every((i) => strip(i).type === 'rel' && strip(i).op === '=')) {
      const rels = a[0].items.map(strip)
      const consts = rels.every((r) => ['C', 'c'].includes(strip(r.l).v) && strip(r.r).v === '0')
      return then(a[1], consts ? { text: `積分定数 ${rels.map((r) => strip(r.l).v).join(', ')} を 0 とおく` } : { tex: rels.map((r) => tex(r)).join(',\\ '), text: ' を代入する' })
    }
    return null
  }
  if (n.type === 'bin' && ['/', '*', '+', '-'].includes(n.op)) {
    const ls = hasStudent(n.l, isStudent)
    const rs = hasStudent(n.r, isStudent)
    const VERB = { '/': ' で割る', '*': ' を掛ける', '+': ' を足す', '-': ' を引く' }
    if (ls && !rs) { const r = stepsOf(n.l, isStudent); return r && [...r, { tex: tex(strip(n.r)), text: VERB[n.op] }] }
    if (!ls && rs && (n.op === '*' || n.op === '+')) { const r = stepsOf(n.r, isStudent); return r && [...r, { tex: tex(strip(n.l)), text: VERB[n.op] }] }
  }
  return null
}

/** 加工の手順（[{ tex?, text }, …]）。手順にできない式は null。opts は maximaToTex と同じ */
export function explainSteps(expr, defs = null, opts = {}) {
  const src = String(expr ?? '').trim()
  if (!src || !opts.student) return null
  try {
    let ast = parse(src)
    if (defs && defs.size) ast = inlineVars(ast, defs)
    const r = stepsOf(ast, (v) => opts.student(v))
    return r && r.length ? r : null
  } catch { return null }
}

// ---- 「〜を含む／含まない」の条件 ---------------------------------------------
// freeof(a, e) / not freeof(a, e) とその and / or を、日本語の文にするための構造にする
const WHAT_NAMES = {
  log: 'log（対数）', ln: 'ln（対数）', abs: '絶対値 | |', exp: 'exp（指数関数）',
  sin: 'sin', cos: 'cos', tan: 'tan', sqrt: '√（根号）', atan: 'arctan', arctan: 'arctan',
}
function containsClause(n, opts) {
  n = strip(n)
  let has = false
  if (n.type === 'not') {
    const x = strip(n.x)
    n = x.type === 'call' && x.name === 'is' ? strip(x.args[0]) : x
    has = true
  }
  if (n.type !== 'call' || n.name !== 'freeof' || n.args.length !== 2) return null
  const [a, e] = n.args.map(strip)
  let subject
  const asStudent = (x) => x.type === 'sym' && opts.student(x.v)
  if (asStudent(e)) subject = { kind: 'student' }
  else if (e.type === 'call' && e.name === 'subst' && e.args.length === 2 && asStudent(strip(e.args[1])) && strip(e.args[0]).type === 'list') {
    const rels = strip(e.args[0]).items.map(strip)
    const consts = rels.every((r) => r.type === 'rel' && r.op === '=' && ['C', 'c'].includes(strip(r.l).v) && strip(r.r).v === '0')
    subject = { kind: 'student', note: consts ? `積分定数 ${rels.map((r) => strip(r.l).v).join(', ')} を 0 とおいたもの` : `${rels.map((r) => tex(r)).join(', ')} を代入したもの`, noteIsTex: !consts }
  } else subject = { kind: 'expr', tex: tex(relabelStudent(e, opts.student)) }
  const what = a.type === 'sym' && WHAT_NAMES[a.v] ? { text: WHAT_NAMES[a.v] } : { tex: tex(a) }
  return { subject, what, has } // has: 含まれている（true）／含まれていない（false）
}

/** 条件を { join: 'and'|'or'|null, clauses: [...] } にする。対応できない形は null */
export function explainContains(expr, defs = null, opts = {}) {
  const src = String(expr ?? '').trim()
  if (!src || !opts.student) return null
  try {
    let ast = parse(src)
    if (defs && defs.size) ast = inlineVars(ast, defs)
    ast = strip(ast)
    if (ast.type === 'call' && ast.name === 'is' && ast.args.length === 1) ast = strip(ast.args[0])
    const flat = (n, op) => { n = strip(n); return n.type === op ? [...flat(n.l, op), ...flat(n.r, op)] : [n] }
    const op = ast.type === 'and' || ast.type === 'or' ? ast.type : null
    const parts = op ? flat(ast, op) : [ast]
    const clauses = parts.map((p) => containsClause(p, opts))
    return clauses.every(Boolean) ? { join: op, clauses } : null
  } catch { return null }
}

/**
 * 定義1つ（parseVariables の要素）を LaTeX に。失敗したら null
 *   変数:    ta: x^2        → \mathrm{ta} = x^{2}
 *   述語関数: f(ex) := is(..) → \mathrm{f}(ex) \iff ...
 *   その他関数: f(x) := ...    → \mathrm{f}(x) := ...
 */
export function defToTex(def) {
  try {
    const body = parse(def.expr)
    const params = def.params === null || def.params === undefined ? '' : `(${def.params.split(',').map((p) => symTex(p.trim())).join(', ')})`
    const op = def.fn ? (isPredicate(body) ? '\\iff' : ':=') : '='
    return `${symTex(def.name)}${params} ${op} ${tex(body)}`
  } catch {
    return null
  }
}
