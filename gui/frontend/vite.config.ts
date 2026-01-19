import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },

  build: {
    // Enable/configure caching - empty dist on every build
    emptyOutDir: true,

    // Optimize chunk splitting for faster rebuilds
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['framer-motion', 'lucide-react']
        }
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
