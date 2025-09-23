import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  build: {
    lib: {
      entry: {
        web: resolve(__dirname, 'src/web.ts'),
        node: resolve(__dirname, 'src/node.ts'),
      },
      name: 'Fuse',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const extension = format === 'es' ? 'mjs' : 'js'
        return `${entryName}.${extension}`
      },
    },
    rollupOptions: {
      external: ['fs', 'path', 'usb', 'node:fs', 'node:path'],
      output: {
        globals: {
          fs: 'fs',
          path: 'path',
          usb: 'usb',
        },
      },
    },
    target: 'esnext',
    sourcemap: true,
    minify: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@camera': resolve(__dirname, './src/camera'),
      '@core': resolve(__dirname, './src/core'),
      '@transport': resolve(__dirname, './src/transport'),
      '@factories': resolve(__dirname, './src/factories'),
      '@client': resolve(__dirname, './src/client'),
      '@constants': resolve(__dirname, './src/constants'),
    },
  },
})