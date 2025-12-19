import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
    test: {
        globals: true,
        environment: 'node',
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        fileParallelism: false,
        sequence: {
            shuffle: false,
            concurrent: false,
        },
    },
})
