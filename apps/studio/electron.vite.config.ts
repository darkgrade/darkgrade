import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        resolve: {
            alias: {
                '@shared': resolve(__dirname, 'src/shared'),
                '@main': resolve(__dirname, 'src/main'),
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        resolve: {
            alias: {
                '@shared': resolve(__dirname, 'src/shared'),
            },
        },
    },
    renderer: {
        plugins: [react()],
        resolve: {
            alias: {
                '@shared': resolve(__dirname, 'src/shared'),
                '@renderer': resolve(__dirname, 'src/renderer/src'),
                '@voice': resolve(__dirname, 'src/renderer/src/voice'),
            },
        },
        worker: {
            format: 'es',
        },
        build: {
            // transformers.js is large; raise the warning ceiling rather than splitting it
            chunkSizeWarningLimit: 4096,
        },
    },
})
