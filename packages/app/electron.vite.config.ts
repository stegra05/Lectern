import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  // The engine is a development dependency, so it is bundled into the main process. Only the
  // app's own dependencies stay external: the PDF reader and canvas load native code and data
  // files at run time, and the installer ships them.
  main: {},
  preload: {
    // CommonJS keeps the preload script inside Electron's sandbox.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: {
    plugins: [react()],
  },
})
