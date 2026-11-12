import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

/** onnxruntime-web's dist folder, whose WebAssembly files its package exports don't list. */
const onnxRuntimeDistribution = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))

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
        plugins: [react(), tailwindcss()],
        resolve: {
            alias: {
                '@shared': resolve(__dirname, 'src/shared'),
                '@renderer': resolve(__dirname, 'src/renderer/src'),
                '@voice': resolve(__dirname, 'src/renderer/src/voice'),
                '@onnxruntime-web-distribution': onnxRuntimeDistribution,
            },
        },
        // onnxruntime-web loads its own WebAssembly files by URL; Vite's dev pre-bundling breaks those imports.
        optimizeDeps: {
            exclude: ['onnxruntime-web', '@onnxruntime-web-distribution'],
        },
        worker: {
            format: 'es',
        },
    },
})
