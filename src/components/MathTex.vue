<script setup>
// LaTeX を KaTeX で描画する。変換できない場合は原文（fallback）を等幅で表示する
import { computed } from 'vue'
import katex from 'katex'

const props = defineProps({
  tex: { type: String, default: null },
  fallback: { type: String, default: '' },
  display: { type: Boolean, default: false },
})

const html = computed(() => {
  if (!props.tex) return null
  try {
    return katex.renderToString(props.tex, { throwOnError: true, displayMode: props.display, strict: 'ignore', trust: false })
  } catch {
    return null
  }
})
</script>

<template>
  <span v-if="html" class="mathtex" v-html="html" />
  <code v-else class="mathtex-raw">{{ fallback }}</code>
</template>
