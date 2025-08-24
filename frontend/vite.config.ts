import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  },
  define: {
    'process.env': {},
    // Require WebSocket URL from environment variable - no defaults
    __WS_URL__: JSON.stringify(process.env.VITE_WS_URL || (() => {
      console.error('ERROR: VITE_WS_URL environment variable is required');
      process.exit(1);
    })())
  }
})