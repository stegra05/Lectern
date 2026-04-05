import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**'],
  },

  build: {
    // Enable/configure caching - empty dist on every build
    emptyOutDir: true,

    // Optimize chunk splitting for faster rebuilds
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/lucide-react')) {
            return 'ui-vendor'
          }
          return undefined
        },
      }
    },

    // Disable source maps for production builds (faster)
    sourcemap: false,

    // Use esbuild for minification (faster than terser)
    minify: 'esbuild',
  },

  // Enable caching
  cacheDir: 'node_modules/.vite'
})
