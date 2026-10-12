<script setup>
// Maxima の定義1つ（ta: ..., wa1_pred(ex) := ...）を数式で表示する
import { computed } from 'vue'
import MathTex from './MathTex.vue'
import { defToTex } from '../lib/maxima2tex.js'

const props = defineProps({ def: { type: Object, required: true } })
const tex = computed(() => defToTex(props.def))
const raw = computed(() => `${props.def.name}${props.def.params !== null ? `(${props.def.params})` : ''} ${props.def.fn ? ':=' : ':'} ${props.def.expr}`)
</script>

<template>
  <MathTex :tex="tex" :fallback="raw" />
</template>
