import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
    define: {
        global: 'globalThis',
    },
    server: {
        open: '/examples/web/index.html',
        host: true,
    },
    resolve: {
        alias: {
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
            entry: {
                web: resolve(__dirname, 'src/index.ts'),
            },
            name: 'Fuse',
        },
        rollupOptions: {
            external: ['fs', 'path', 'usb', 'node:fs', 'node:path'],
        },
    },
})
