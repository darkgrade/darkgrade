import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.ts'],
        // DO NOT CHANGE THIS
        testTimeout: 5000,
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
        coverage: {
            reporter: ['text', 'json', 'html'],
            exclude: ['node_modules/', 'tests/', 'dist/', '*.config.ts'],
        },
    },
    resolve: {
        alias: {
            '@application': resolve(__dirname, 'src/application'),
            '@camera': resolve(__dirname, 'src/camera'),
            '@core': resolve(__dirname, 'src/core'),
            '@transport': resolve(__dirname, 'src/transport'),
            '@factories': resolve(__dirname, 'src/factories'),
            '@types': resolve(__dirname, 'src/types'),
            '@constants': resolve(__dirname, 'src/constants'),
        },
    },
})
