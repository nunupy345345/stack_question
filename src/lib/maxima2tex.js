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
    // 整理・展開・分子・分母・次数・係数は、英語名のままでは読みにくいので日本語の演算名で表示する
    case 'ratsimp': case 'radcan': case 'fullratsimp': case 'trigsimp': case 'factor': case 'expand': case 'num': case 'denom': {
      const jp = { ratsimp: '整理', fullratsimp: '整理', radcan: '整理', trigsimp: '整理', factor: '因数分解', expand: '展開', num: '分子', denom: '分母' }[name]
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
    case 'and': return `${wrap(n.l, P.and)} \\land ${wrap(n.r, P.and)}`
    case 'or': return `${wrap(n.l, P.or)} \\lor ${wrap(n.r, P.and)}`
    case 'not': {
      const x = strip(n.x)
      const inner = x.type === 'call' && x.name === 'is' ? strip(x.args[0]) : x
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
export function maximaToTex(expr) {
  const src = String(expr ?? '').trim()
  if (!src) return null
  try { return tex(parse(src)) } catch { return null }
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
