/**
 * Calls every public Camera method once on every attached camera, in parallel, through the library only.
 * Usage: bun run --cwd packages/slate camera:api-check [-- --only sony|canon|nikon]
 * Method: packages/slate/docs/camera-api-check.md
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Camera } from '@camera/index'
import { typedSettingIds } from '@camera/settings/typed-settings'
import { killMacCameraDaemons } from '@transport/usb/macos-camera-daemons'

type Outcome = 'pass' | 'unsupported' | 'read-only' | 'fail'
interface Step { step: string; outcome: Outcome; milliseconds: number; detail: string }

const VENDORS: Record<number, string> = { 0x054c: 'sony', 0x04a9: 'canon', 0x04b0: 'nikon' }
const STEP_TIMEOUT_MILLISECONDS = 30_000
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined

const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
const capitalized = (id: string) => id[0].toUpperCase() + id.slice(1)
const describe = (value: unknown) => {
    if (value instanceof Uint8Array) return `${value.byteLength} bytes`
    const text = JSON.stringify(value, (_key, item) => (item instanceof Uint8Array ? `${item.byteLength} bytes` : item))
    return text === undefined ? '' : text.length > 160 ? `${text.slice(0, 157)}...` : text
}

async function checkCamera(device: Awaited<ReturnType<typeof Camera.discover>>[number]) {
    const vendor = VENDORS[device.vendorId]
    const steps: Step[] = []
    const camera = new Camera({
        device: { usb: { filters: [{ vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber }] } },
    })
    const operations = () => latestCapabilities?.operations ?? {}
    let latestCapabilities: Awaited<ReturnType<Camera['getCapabilities']>> | undefined

    async function step<Result>(name: string, run: () => Promise<Result>, operation?: string): Promise<Result | undefined> {
        const started = performance.now()
        try {
            const result = await Promise.race([
                run(),
                pause(STEP_TIMEOUT_MILLISECONDS).then(() => { throw new Error(`timed out after ${STEP_TIMEOUT_MILLISECONDS / 1000} s`) }),
            ])
            steps.push({ step: name, outcome: 'pass', milliseconds: Math.round(performance.now() - started), detail: describe(result) })
            return result as Result
        } catch (error) {
            const unsupported = error instanceof Error && error.name === 'CameraUnsupportedError'
            // "getLiveViewFrame.overlay" is an option of an operation: getCapabilities reports it under options.
            const [operationName, option] = operation?.split('.') ?? []
            const availability = operationName ? operations()[operationName as keyof ReturnType<typeof operations>] : undefined
            const advertised = (option ? availability?.options?.[option] : availability)?.supported === true
            steps.push({
                step: name,
                outcome: unsupported && !advertised ? 'unsupported' : 'fail',
                milliseconds: Math.round(performance.now() - started),
                detail: `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}${unsupported && advertised ? ' (getCapabilities said supported)' : ''}`,
            })
            return undefined
        }
    }

    const started = performance.now()
    const settingsChanged: unknown[] = []
    const mediaAdded: unknown[] = []
    const onSettingsChanged = (event: unknown) => settingsChanged.push(event)
    const onMediaAdded = (event: unknown) => mediaAdded.push(event)

    await step('connect', () => camera.connect())
    await step('getInfo', () => camera.getInfo())
    latestCapabilities = await step('getCapabilities', () => camera.getCapabilities())
    await step('on settingsChanged + mediaAdded', async () => {
        camera.on('settingsChanged', onSettingsChanged)
        camera.on('mediaAdded', onMediaAdded)
    })

    const methods = camera as unknown as Record<string, (value?: unknown) => Promise<unknown>>
    const ordered = [...typedSettingIds].sort((left, right) => Number(left === 'photoVideoMode') - Number(right === 'photoVideoMode'))
    for (const id of ordered) {
        const control = latestCapabilities?.controls[id as keyof typeof latestCapabilities.controls]
        const original = await step(`get${capitalized(id)}`, () => methods[`get${capitalized(id)}`]())
        if (!control) continue
        const choice = control.allowedValues?.find(value => value !== control.value)
        if (!control.writable || choice === undefined) {
            steps.push({ step: `set${capitalized(id)}`, outcome: 'read-only', milliseconds: 0, detail: control.writable ? 'only one choice' : 'not writable now' })
            continue
        }
        const written = await step(`set${capitalized(id)} ${choice}`, () => methods[`set${capitalized(id)}`](choice))
        if (written !== undefined) await step(`setControl ${id} back to ${control.value}`, () => camera.setControl(id as never, control.value as never))
        else if (original !== undefined) await methods[`set${capitalized(id)}`](control.value).catch(() => undefined)
    }

    await step('autofocus', () => camera.autofocus(), 'autofocus')
    await step('setFocusPoint 0.5 0.5', () => camera.setFocusPoint(0.5, 0.5), 'setFocusPoint')
    await step('resetFocusPoint', () => camera.resetFocusPoint(), 'resetFocusPoint')
    await step('nudgeFocus near small', () => camera.nudgeFocus('near', 'small'), 'nudgeFocus')
    const focalLength = latestCapabilities?.lens?.focalLengthMillimetres
    await step(`zoomTo ${focalLength ?? 35}`, () => camera.zoomTo(focalLength ?? 35), 'zoomTo')
    await step('startZoom in slow', () => camera.startZoom('in', { speed: 'slow' }), 'startZoom')
    await step('stopZoom', () => camera.stopZoom(), 'stopZoom')
    await step('getLiveViewFrame', () => camera.getLiveViewFrame(), 'getLiveViewFrame')
    await step('getLiveViewFrame overlay', () => camera.getLiveViewFrame({ overlay: true }), 'getLiveViewFrame.overlay')

    const photo = await step('takePhoto card', () => camera.takePhoto({ destination: 'card', autofocus: false }), 'takePhoto')
    const media = await step('listMedia', () => camera.listMedia(), 'listMedia')
    const photoId = photo && 'mediaId' in photo ? photo.mediaId : undefined
    steps.push({
        step: 'photo id is in listMedia',
        outcome: photoId && media?.some(item => item.id === photoId) ? 'pass' : 'fail',
        milliseconds: 0,
        detail: String(photoId),
    })
    const previewId = photoId ?? media?.[0]?.id
    if (previewId) {
        await step('getMediaPreview thumbnail', () => camera.getMediaPreview(previewId, 'thumbnail'), 'getMediaPreview')
        await step('downloadMedia', () => camera.downloadMedia(previewId), 'downloadMedia')
    }
    await step('getCardStatus', () => camera.getCardStatus(), 'getCardStatus')

    await step('getRecordingState before', () => camera.getRecordingState(), 'getRecordingState')
    const recording = await step('startRecording', () => camera.startRecording(), 'startRecording')
    if (recording !== undefined || steps.at(-1)?.outcome === 'pass') {
        await pause(2_000)
        await step('stopRecording', () => camera.stopRecording(), 'stopRecording')
    }
    await step('getRecordingState after', () => camera.getRecordingState(), 'getRecordingState')

    await step('getBattery', () => camera.getBattery(), 'getBattery')
    await step('setClock', () => camera.setClock(), 'setClock')
    steps.push({
        step: 'events delivered',
        outcome: mediaAdded.length > 0 ? 'pass' : 'fail',
        milliseconds: 0,
        detail: `settingsChanged ${settingsChanged.length}, mediaAdded ${mediaAdded.length}`,
    })
    await step('off settingsChanged + mediaAdded', async () => {
        camera.off('settingsChanged', onSettingsChanged)
        camera.off('mediaAdded', onMediaAdded)
    })
    await step('recover', () => camera.recover())
    await step('connect after recover', () => camera.connect())
    await step('disconnect', () => camera.disconnect())

    return { vendor, model: device.model, serialNumber: device.serialNumber, seconds: Math.round((performance.now() - started) / 100) / 10, steps }
}

const daemons = setInterval(() => void killMacCameraDaemons(), 1_000)
await killMacCameraDaemons()
const discovered = (await Camera.discover()).filter(device => VENDORS[device.vendorId] && (!only || VENDORS[device.vendorId] === only))
console.log(`Checking ${discovered.map(device => `${VENDORS[device.vendorId]} ${device.model ?? ''}`.trim()).join(', ') || 'no cameras'}`)
const results = await Promise.all(discovered.map(checkCamera))
clearInterval(daemons)

for (const result of results) {
    const count = (outcome: Outcome) => result.steps.filter(step => step.outcome === outcome).length
    console.log(`\n== ${result.vendor} ${result.model ?? ''}: ${result.seconds} s · pass ${count('pass')} · unsupported ${count('unsupported')} · read-only ${count('read-only')} · fail ${count('fail')}`)
    for (const step of result.steps) {
        if (step.outcome === 'pass') continue
        console.log(`  ${step.outcome.padEnd(11)} ${step.step}: ${step.detail}`)
    }
}
// Keep the last result of every camera not checked this time, so --only or an asleep body loses nothing.
const resultsPath = '/tmp/camera-api-check.json'
const earlier = existsSync(resultsPath) ? (JSON.parse(readFileSync(resultsPath, 'utf8')) as { serialNumber?: string; vendor?: string }[]) : []
const checkedAt = new Date().toISOString()
const kept = earlier.filter(result => !results.some(checked => checked.vendor === result.vendor && checked.serialNumber === result.serialNumber))
writeFileSync(resultsPath, JSON.stringify([...kept, ...results.map(result => ({ ...result, checkedAt }))], null, 2))
console.log('\nFull results: /tmp/camera-api-check.json')
process.exit(results.some(result => result.steps.some(step => step.outcome === 'fail')) ? 1 : 0)
