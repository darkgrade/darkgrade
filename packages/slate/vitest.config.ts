import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'
import tsconfig from './tsconfig.json' with { type: 'json' }

export default defineConfig({
    resolve: {
        alias: Object.fromEntries(
            Object.entries(tsconfig.compilerOptions.paths).map(([name, [source]]) => [
                name.replace(/\/\*$/, ''),
                resolve(import.meta.dirname, source.replace(/\/\*$/, '')),
            ])
        ),
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
