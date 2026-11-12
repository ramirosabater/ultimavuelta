import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En pruebas locales sin Supabase, /rest/v1 se redirige a un PostgREST propio (ver README)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: process.env.POSTGREST_URL
      ? {
          '/rest/v1': { target: process.env.POSTGREST_URL, rewrite: (p) => p.replace(/^\/rest\/v1/, '') },
          // Funciones corriendo con Deno en la PC (opcional)
          ...(process.env.FUNCIONES_URL ? { '/functions/v1': { target: process.env.FUNCIONES_URL, rewrite: (p: string) => p.replace(/^\/functions\/v1\/[^/?]+/, '') } } : {}),
        }
      : undefined,
  },
})
