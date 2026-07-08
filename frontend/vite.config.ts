import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// O app novo é servido pelo servidor Node existente sob /novo/
// (em desenvolvimento, o proxy encaminha as chamadas de API para ele)
export default defineConfig({
  base: '/novo/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:3345' },
  },
})
