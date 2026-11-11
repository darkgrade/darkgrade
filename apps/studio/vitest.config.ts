import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@shared': resolve(__dirname, 'src/shared'),
            '@main': resolve(__dirname, 'src/main'),
            '@renderer': resolve(__dirname, 'src/renderer/src'),
            '@voice': resolve(__dirname, 'src/renderer/src/voice'),
        },
    },
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
    },
})
