import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/merchant/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 前后端共享契约（枚举/状态值唯一事实源，纯类型零依赖）
      '@contracts': path.resolve(__dirname, '../herix-server/src/shared/contracts.ts'),
    },
  },
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:4005',
        changeOrigin: true,
      },
    },
  },
})
