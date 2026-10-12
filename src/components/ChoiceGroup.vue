<script setup>
// ラジオボタン群（Likert尺度・選択肢）
defineProps({
  modelValue: { type: [String, Number, null], default: null },
  options: { type: Array, required: true }, // [{ value, label }]
  name: { type: String, required: true },
  scale: { type: Boolean, default: false }, // 尺度表示（横一列・等幅）
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="choices" :class="{ scale, disabled }" role="radiogroup">
    <label v-for="o in options" :key="o.value" class="choice" :class="{ checked: modelValue === o.value }">
      <input
        type="radio"
        :name="name"
        :value="o.value"
        :checked="modelValue === o.value"
        :disabled="disabled"
        @change="emit('update:modelValue', o.value)"
      />
      <span v-if="scale" class="choice-num">{{ o.value }}</span>
      <span class="choice-label">{{ o.label }}</span>
    </label>
  </div>
</template>
