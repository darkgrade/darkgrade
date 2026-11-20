import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: {
            '@contribute': resolve(__dirname, './src/contribute'),
            '@workflows': resolve(__dirname, './src/workflows'),
            '@vendors': resolve(__dirname, './src/vendors'),
            '@camera': resolve(__dirname, './src/camera'),
            '@core': resolve(__dirname, './src/core'),
            '@transport': resolve(__dirname, './src/transport'),
            '@ptp': resolve(__dirname, './src/ptp'),
            '@runtime': resolve(__dirname, './src/runtime'),
        },
    },
    test: {
        // The runtime's tests check package resolution with Bun's bundler: `bun run test:runtime`.
        exclude: [...configDefaults.exclude, 'tests/runtime/**', 'tests/contribute/**', 'tests/cli/**'],
        globals: true,
        environment: 'node',
        pool: 'forks',
        maxWorkers: 1,
        fileParallelism: false,
        sequence: {
            shuffle: false,
            concurrent: false,
        },
    },
})
