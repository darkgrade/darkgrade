import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './tests/browser',
    fullyParallel: false,
    timeout: 30_000,
    use: {
        baseURL: 'http://localhost:5230',
        viewport: { width: 1440, height: 1000 },
        channel: process.env.TESTBENCH_BROWSER_CHANNEL === 'chrome' ? 'chrome' : undefined,
    },
    webServer: {
        command: 'bun run build && bun run preview',
        url: 'http://localhost:5230',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
})
