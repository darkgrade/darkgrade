import devtoolsJson from 'vite-plugin-devtools-json'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
    plugins: [sveltekit(), tailwindcss(), devtoolsJson()],
    define: { global: 'globalThis' },
    optimizeDeps: { include: ['buffer', 'process'] },
    resolve: {
        alias: {
            '@camera': path.resolve('../../src/camera'),
            '@core': path.resolve('../../src/core'),
            '@transport': path.resolve('../../src/transport'),
            '@factories': path.resolve('../../src/factories'),
            '@api': path.resolve('../../src/api'),
            '@constants': path.resolve('../../src/constants'),
        },
    },
})
