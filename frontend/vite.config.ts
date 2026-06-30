import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  if (mode === 'production' && !env.VITE_API_URL?.trim()) {
    throw new Error('VITE_API_URL must be set when building for production.')
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        // 🚀 This forwards all /api requests straight to your NestJS backend
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, 'api'), // Keeps the 'api/' prefix for your controllers
        },
      },
    },
  }
})