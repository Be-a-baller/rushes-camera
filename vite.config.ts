import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// iPhone の Safari はカメラ利用に HTTPS が必須なので、開発サーバーも HTTPS で動かす。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), basicSsl()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 5173 },
})
