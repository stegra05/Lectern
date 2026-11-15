import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    // The engine is TypeScript source in the workspace, so it is bundled into the main process.
    // Its PDF reader and canvas stay external: they load native code and data files at run time.
    build: { externalizeDeps: { exclude: ['@lectern/engine'] } },
  },
  preload: {
    // CommonJS keeps the preload script inside Electron's sandbox.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: {
    plugins: [react()],
  },
})
