// bun run --cwd packages/slate camera:lease -- bun run camera:smoke -- --area settings [--area photo ...]
//
// Connects to the attached camera through the public Camera API and runs one or more areas'
// smoke steps, printing each confirmed result. One file per area in this directory; the slice
// that owns an area extends only its own file. Refuses to run outside `camera:lease`.
import { Camera } from '@camera/index'
import { cameraDevice, isEntryPoint, parseCameraSelector } from '@scripts/camera-lease'
import { bodySmoke } from '@scripts/camera-smoke/body'
import { connectionSmoke } from '@scripts/camera-smoke/connection'
import { eventsSmoke } from '@scripts/camera-smoke/events'
import { focusSmoke } from '@scripts/camera-smoke/focus'
import { liveViewSmoke } from '@scripts/camera-smoke/live-view'
import { mediaSmoke } from '@scripts/camera-smoke/media'
import { photoSmoke } from '@scripts/camera-smoke/photo'
import { settingsSmoke } from '@scripts/camera-smoke/settings'
import type { SmokeArea, SmokeReport } from '@scripts/camera-smoke/smoke-area'
import { videoSmoke } from '@scripts/camera-smoke/video'
import { zoomSmoke } from '@scripts/camera-smoke/zoom'
import { hardwareTestEnvironmentVariable, hardwareTestsEnabled } from '@tests/setup/hardware'

export const smokeAreas: readonly SmokeArea[] = [
    connectionSmoke,
    settingsSmoke,
    focusSmoke,
    zoomSmoke,
    photoSmoke,
    liveViewSmoke,
    videoSmoke,
    mediaSmoke,
    bodySmoke,
    eventsSmoke,
]

const usage = `Usage: bun run camera:lease -- bun run camera:smoke -- --area <${smokeAreas.map(area => area.name).join('|')}|all> [--area ...]`

function requestedAreas(argumentList: string[]): SmokeArea[] {
    const names = argumentList.flatMap((argument, index) => (argument === '--area' ? [argumentList[index + 1] ?? ''] : []))
    if (!names.length) throw new Error(usage)
    if (names.includes('all')) return [...smokeAreas]
    return names.map(name => {
        const area = smokeAreas.find(candidate => candidate.name === name)
        if (!area) throw new Error(`Unknown area ${name || '(empty)'}\n${usage}`)
        return area
    })
}

function printer(area: string): SmokeReport & { skips: number; results: number } {
    const report = {
        skips: 0,
        results: 0,
        confirmed(step: string, detail: unknown) {
            report.results++
            console.log(`  ✓ ${area}: ${step} → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
        },
        skipped(step: string, reason: string) {
            report.skips++
            console.log(`  – ${area}: ${step} skipped: ${reason}`)
        },
    }
    return report
}

async function main() {
    const selected = requestedAreas(process.argv.slice(2))
    if (!hardwareTestsEnabled)
        throw new Error(`camera:smoke opens the attached camera; run it under camera:lease (${hardwareTestEnvironmentVariable}=1)`)
    // Under `camera:lease --camera`, open exactly the leased body.
    const leased = process.env.DARKGRADE_LEASED_CAMERAS?.split(',').filter(Boolean) ?? []
    const camera = new Camera({ firstContact: false, ...(leased.length === 1 ? { device: cameraDevice(parseCameraSelector(leased[0]!)) } : {}) })
    await camera.connect()
    let failed = false
    try {
        for (const area of selected) {
            console.log(`${area.name}: ${area.description}`)
            const report = printer(area.name)
            try {
                await area.run(camera, report)
            } catch (error) {
                failed = true
                console.log(`  ✗ ${area.name}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
            }
        }
    } finally {
        await camera.disconnect()
    }
    process.exit(failed ? 1 : 0)
}

if (isEntryPoint(import.meta.url))
    main().catch(error => {
        console.error(`camera:smoke: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
    })
