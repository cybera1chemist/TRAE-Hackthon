/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { aiBffPlugin } from './bff/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 第三参 ''：连无 VITE_ 前缀的 AI_VENDOR_API_KEY 一并读入（仅服务端使用，不下发浏览器）
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), aiBffPlugin({ apiKey: env.AI_VENDOR_API_KEY })],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            vendor: ['@tanstack/react-query', 'zustand', 'dexie', 'zod'],
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['tests/setup.ts'],
      include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/component/**/*.test.{ts,tsx}'],
      css: false,
    },
  }
})
