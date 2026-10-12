import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base: './' にしておくと GitHub Pages のサブパス (/<repo>/) でもそのまま動く
export default defineConfig({
  base: './',
  plugins: [vue()],
})
