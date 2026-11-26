import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: '.',
    testMatch: '*.e2e.ts',
    // One camera, one Studio: never run walks side by side.
    workers: 1,
    fullyParallel: false,
    retries: 0,
    timeout: 15 * 60 * 1000,
    outputDir: 'results/playwright',
    reporter: [['list']],
})
