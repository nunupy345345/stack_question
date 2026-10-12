<script setup>
// サニタイズ済みHTMLを描画し、その後KaTeXで数式をレンダリングする
import { ref, watch, onMounted, nextTick } from 'vue'
import { sanitize, renderMath } from '../lib/html.js'

const props = defineProps({ html: { type: String, default: '' }, tag: { type: String, default: 'div' } })
const el = ref(null)

async function render() {
  if (!el.value) return
  el.value.innerHTML = sanitize(props.html)
  await nextTick()
  renderMath(el.value)
}
onMounted(render)
watch(() => props.html, render)
</script>

<template>
  <component :is="tag" ref="el" class="rich" />
</template>
