import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { defineConfig } from 'vite'
import devtoolsJson from 'vite-plugin-devtools-json'

export default defineConfig({
    plugins: [sveltekit(), tailwindcss(), devtoolsJson()],
    resolve: {
        alias: {
            '@camera': path.resolve('../../src/camera'),
            '@core': path.resolve('../../src/core'),
            '@transport': path.resolve('../../src/transport'),
            '@factories': path.resolve('../../src/factories'),
            '@api': path.resolve('../../src/api'),
            '@constants': path.resolve('../../src/constants'),
            '@ptp': path.resolve('../../src/ptp'),
        },
    },
    build: {
        rollupOptions: {
            external: ['usb'],
        },
    },
})
