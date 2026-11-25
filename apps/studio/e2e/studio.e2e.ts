import { fakeProbe, pageProbe } from './studio-probe'
import { walkStudio } from './studio-walk'
import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const studioDirectory = resolve(import.meta.dirname, '..')
const camera = process.env.DARKGRADE_CAMERA ?? 'attached-camera'
const screenshotDirectory = join(import.meta.dirname, 'results', camera.replace(/[^a-z0-9]+/gi, '-'))
const fake = process.env.DARKGRADE_E2E_FAKE === '1'

test(`Studio feature walk (${fake ? 'dry run against a fake' : camera})`, async () => {
    if (fake) {
        const walk = walkStudio({
            probe: fakeProbe(),
            page: undefined,
            screenshotDirectory,
            connectTimeoutMilliseconds: 1000,
            includeVisionOverlays: false,
        })
        await expect(walk).rejects.toThrow(/fake Studio .* did not report a connected camera/)
        await walk.catch(error => console.log(`Dry run failed as designed: ${error instanceof Error ? error.message : error}`))
        return
    }
    if (!process.env.DARKGRADE_CAMERA_LEASE)
        throw new Error('Run the walk through the camera lease: bun run --cwd apps/studio e2e (see e2e/README.md)')
    const main = join(studioDirectory, 'out/main/index.js')
    if (!existsSync(main)) throw new Error(`${main} is missing; build Studio first with bun run --cwd apps/studio build`)
    const executablePath = createRequire(join(studioDirectory, 'package.json'))('electron')
    if (typeof executablePath !== 'string') throw new Error('The electron package did not resolve to an executable path')

    const application = await electron.launch({ executablePath, args: [main], cwd: studioDirectory, env: definedEnvironment() })
    try {
        const page = await application.firstWindow()
        await walkStudio({
            probe: await pageProbe(page),
            page,
            screenshotDirectory,
            connectTimeoutMilliseconds: 90000,
            includeVisionOverlays: process.env.DARKGRADE_E2E_VISION === '1',
        })
    } finally {
        await application.close()
    }
})

function definedEnvironment(): Record<string, string> {
    return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
}
