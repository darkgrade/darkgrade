// bun run --cwd packages/slate camera:verify -- [--camera VID:PID[:SERIAL] ...] [--area NAME ...] [--output FILE] [--wait-minutes 30]
//
// Finds every attached camera (or the ones named) and, in parallel across cameras, leases each one
// through camera:lease's per-camera lease and runs every camera-smoke area against it through the
// public Camera API, plus one card file per photo, one clip per take decoded with ffmpeg,
// disconnect/connect on the same Camera, and a check that every writable setting reads as before.
// Never formats, deletes or overwrites; photos and short clips are added to the card. Prints one
// table (camera × area: pass / skip / fail with the reason) and writes the results as JSON.
import type { DiscoveredCamera } from '@camera/driver'
import { Camera } from '@camera/index'
import { cameraDevice, cameraLabel, parseCameraSelector, withCameraLeases, type LeasedCamera } from '@scripts/camera-lease'
import { smokeAreas } from '@scripts/camera-smoke/index'
import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'
import { clipDecodeCheck, photoFileCheck, reconnectCheck, restoreCheck, snapshotControls } from '@scripts/camera-verify/checks'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const verifyAreas: readonly SmokeArea[] = [...smokeAreas, photoFileCheck, clipDecodeCheck, reconnectCheck]
const usage = `Usage: bun run camera:verify -- [--camera VID:PID[:SERIAL] ...] [--area <${[...verifyAreas.map(area => area.name), 'restore'].join('|')}> ...] [--output FILE] [--wait-minutes 30]`

type Outcome = 'pass' | 'skip' | 'fail'

interface Step {
    outcome: 'confirmed' | 'skipped'
    step: string
    detail: unknown
}

interface AreaResult {
    area: string
    outcome: Outcome
    reason?: string
    durationMilliseconds: number
    steps: Step[]
}

interface CameraResult {
    camera: string
    model?: string
    firmware?: string
    error?: string
    areas: AreaResult[]
}

function parseArguments(argumentList: string[]) {
    const remaining = argumentList[0] === '--' ? argumentList.slice(1) : [...argumentList]
    const cameras: LeasedCamera[] = []
    const areaNames: string[] = []
    let output = join(tmpdir(), `camera-verify-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    let waitMinutes = 30
    while (remaining.length) {
        const flag = remaining.shift()
        const value = remaining.shift() ?? ''
        if (flag === '--camera') cameras.push(parseCameraSelector(value))
        else if (flag === '--area') areaNames.push(value)
        else if (flag === '--output') output = resolve(value)
        else if (flag === '--wait-minutes') waitMinutes = Number(value)
        else throw new Error(`Unknown option ${flag}\n${usage}`)
    }
    if (!Number.isFinite(waitMinutes) || waitMinutes <= 0) throw new Error(usage)
    for (const name of areaNames)
        if (name !== 'restore' && !verifyAreas.some(area => area.name === name)) throw new Error(`Unknown area ${name}\n${usage}`)
    const areas = areaNames.length ? verifyAreas.filter(area => areaNames.includes(area.name)) : verifyAreas
    return { cameras, areas, output, waitMinutes }
}

function errorText(error: unknown) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** Runs one area and classifies it: a throw fails, only skips skip, any confirmed result passes. */
async function runArea(camera: Camera, area: SmokeArea, log: (line: string) => void): Promise<AreaResult> {
    const steps: Step[] = []
    const started = Date.now()
    const report = {
        confirmed: (step: string, detail: unknown) => steps.push({ outcome: 'confirmed', step, detail }),
        skipped: (step: string, reason: string) => steps.push({ outcome: 'skipped', step, detail: reason }),
    }
    const finish = (outcome: Outcome, reason?: string): AreaResult => {
        log(`${area.name}: ${outcome}${reason ? ` (${reason})` : ''}`)
        return { area: area.name, outcome, ...(reason ? { reason } : {}), durationMilliseconds: Date.now() - started, steps }
    }
    try {
        await area.run(camera, report)
    } catch (error) {
        return finish('fail', errorText(error))
    }
    const skipped = steps.filter(step => step.outcome === 'skipped')
    if (skipped.length === steps.length) return finish('skip', skipped.map(step => String(step.detail)).join('; ') || 'no steps ran')
    return finish('pass', skipped.length ? `${skipped.length} step(s) skipped: ${skipped.map(step => step.step).join(', ')}` : undefined)
}

/** Leases one camera, connects to exactly that body and runs every area on the same Camera. */
async function verifyCamera(device: LeasedCamera, areas: readonly SmokeArea[], waitMinutes: number): Promise<CameraResult> {
    const label = cameraLabel(device)
    const log = (line: string) => process.stderr.write(`[${label}] ${line}\n`)
    const result: CameraResult = { camera: label, areas: [] }
    try {
        await withCameraLeases([device], `camera:verify ${label}`, waitMinutes, async () => {
            const camera = new Camera({ firstContact: false, device: cameraDevice(device) })
            await camera.connect()
            try {
                const information = await camera.getInfo()
                Object.assign(result, { model: information.model, firmware: information.firmware })
                log(`connected: ${information.manufacturer} ${information.model} ${information.firmware}`)
                const original = await snapshotControls(camera)
                for (const area of [...areas, restoreCheck(original)]) result.areas.push(await runArea(camera, area, log))
            } finally {
                await camera.disconnect().catch(error => log(`disconnect failed: ${errorText(error)}`))
            }
        })
    } catch (error) {
        result.error = errorText(error)
        log(`could not verify: ${result.error}`)
    }
    return result
}

function printTable(results: readonly CameraResult[]) {
    const rows = results.flatMap(result =>
        result.error && !result.areas.length
            ? [[result.camera, result.model ?? '', '(camera)', 'fail', result.error]]
            : result.areas.map(area => [result.camera, result.model ?? '', area.area, area.outcome, area.reason ?? ''])
    )
    const header = ['camera', 'model', 'area', 'result', 'reason']
    const widths = header.map((title, column) => Math.max(title.length, ...rows.map(row => (column === 4 ? 0 : row[column]!.length))))
    const format = (row: string[]) => row.map((cell, column) => (column === 4 ? cell : cell.padEnd(widths[column]!))).join('  ')
    console.log(format(header))
    console.log(widths.map(width => '-'.repeat(width)).join('  '))
    for (const row of rows) console.log(format(row))
}

async function main() {
    const { cameras, areas, output, waitMinutes } = parseArguments(process.argv.slice(2))
    const devices: LeasedCamera[] = cameras.length ? cameras : await Camera.discover().then(found => found.map(identity))
    if (!devices.length) throw new Error('No USB camera is attached')
    process.stderr.write(`camera:verify: ${devices.map(cameraLabel).join(', ')}; areas ${areas.map(area => area.name).join(', ')}, restore\n`)
    const results = await Promise.all(devices.map(device => verifyCamera(device, areas, waitMinutes)))
    printTable(results)
    writeFileSync(output, JSON.stringify({ finishedAt: new Date().toISOString(), cameras: results }, null, 2))
    console.log(`\nResults: ${output}`)
    const failed = results.some(result => result.error || result.areas.some(area => area.outcome === 'fail'))
    process.exit(failed ? 1 : 0)
}

const identity = ({ vendorId, productId, serialNumber }: DiscoveredCamera): LeasedCamera => ({ vendorId, productId, ...(serialNumber ? { serialNumber } : {}) })

main().catch(error => {
    console.error(`camera:verify: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
})
