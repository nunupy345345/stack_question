import DOMPurify from 'dompurify'
import renderMathInElement from 'katex/contrib/auto-render'

// feedback / questiontext で想定するタグだけを許可（script・イベント属性・style等はすべて除去）
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'sub', 'sup', 'span', 'div',
    'ul', 'ol', 'li', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
  ],
  ALLOWED_ATTR: ['class'],
  ALLOW_DATA_ATTR: false,
}

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** STACKの [[input:ans1]] 等のプレースホルダを表示用に置換 */
function replaceStackTags(html) {
  return html
    .replace(/\[\[input:([\w]+)\]\]/g, (_, n) => `<span class="stack-input">解答欄 ${escapeHtml(n)}</span>`)
    .replace(/\[\[(validation|feedback):[\w]+\]\]/g, '')
}

export function sanitize(html) {
  return DOMPurify.sanitize(replaceStackTags(String(html ?? '')), PURIFY_CONFIG)
}

/** サニタイズ済みHTMLをDOMに入れた後で数式をレンダリング（KaTeXはテキストノードのみ処理） */
export function renderMath(el) {
  renderMathInElement(el, {
    delimiters: [
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true },
      { left: '$$', right: '$$', display: true },
    ],
    throwOnError: false,
    trust: false,
  })
}

/** HTMLを除いたプレーンテキスト（空判定用） */
export function plainText(html) {
  const d = document.createElement('div')
  d.innerHTML = sanitize(html)
  return d.textContent.trim()
}
