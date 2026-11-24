import { sveltekit } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-auto'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import devtoolsJson from 'vite-plugin-devtools-json'

export default defineConfig({
    plugins: [sveltekit({ adapter: adapter(), preprocess: vitePreprocess() }), tailwindcss(), devtoolsJson()],
    resolve: {
        alias: {
            '@darkgrade/slate': resolve(import.meta.dirname, '../../packages/slate'),
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
