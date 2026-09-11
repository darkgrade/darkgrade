import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import devtoolsJson from 'vite-plugin-devtools-json'

export default defineConfig({
    plugins: [sveltekit(), tailwindcss(), devtoolsJson()],
    resolve: {
        alias: {
            '@darkgrade/link': resolve(__dirname, '../../packages/link'),
        },
    },
    build: {
        rollupOptions: {
            external: [
                'fs',
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
