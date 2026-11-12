import { execFileSync } from 'node:child_process'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
    define: {
        global: 'globalThis',
        __LINK_TELEMETRY_REVISION__: JSON.stringify(process.env.LINK_REVISION || execFileSync('git', ['rev-parse', 'HEAD']).toString().trim()),
        __LINK_TELEMETRY_DIRTY__: JSON.stringify(execFileSync('git', ['status', '--porcelain', '--untracked-files=no']).toString().trim().length > 0),
    },
    plugins: [
        // Emits dist/index.d.ts (+ tree) with @camera/@core/... aliases
        // rewritten to relative paths so consumers can resolve them.
        dts({ include: ['src'], entryRoot: 'src' }),
    ],
    resolve: {
        alias: {
            '@workflows': resolve(__dirname, './src/workflows'),
            '@vendors': resolve(__dirname, './src/vendors'),
            '@camera': resolve(__dirname, './src/camera'),
            '@core': resolve(__dirname, './src/core'),
            '@transport': resolve(__dirname, './src/transport'),
            '@factories': resolve(__dirname, './src/factories'),
            '@api': resolve(__dirname, './src/api'),
            '@constants': resolve(__dirname, './src/constants'),
            '@ptp': resolve(__dirname, './src/ptp'),
        },
    },
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'Fuse',
            formats: ['es', 'cjs'],
            fileName: format => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
        },
        rollupOptions: {
            external: [
                /^@darkgrade\/contribute(?:\/|$)/,
                'fs',
                'path',
                'usb',
                'ink',
                'ink-spinner',
                'node:fs',
                'node:path',
                'node:stream',
                'node:process',
                'node:buffer',
                'node:events',
                'assert',
                'events',
                'module',
                /^node:/,
            ],
        },
    },
})
