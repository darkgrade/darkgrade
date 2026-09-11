import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { OK } from '@ptp/definitions/response-definitions'
import { IPTransport } from '@transport/ip/ip-transport'
import { writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'

type Action =
    | 'probe'
    | 'canon-status'
    | 'exposure-status'
    | 'autofocus'
    | 'keep-awake'
    | 'set-focus-mode'
    | 'set-white-balance'
    | 'set-image-format'
    | 'set-continuous-autofocus'
    | 'set-movie-servo-autofocus'
    | 'probe-movie-mode'
    | 'set-movie-format'
    | 'set-iso'
    | 'set-aperture'
    | 'set-shutter-speed'
    | 'storage-status'
    | 'recent-images'
    | 'capture'
    | 'capture-download'
    | 'download-latest'
    | 'record-clip'

interface PropertyState {
    code: number
    name: string
    description: string
    value: unknown
    allowedValues?: unknown[]
}

interface CameraObject extends ObjectInfo {
    handle: number
}

const actions: Action[] = [
    'probe',
    'canon-status',
    'exposure-status',
    'autofocus',
    'keep-awake',
    'set-focus-mode',
    'set-white-balance',
    'set-image-format',
    'set-continuous-autofocus',
    'set-movie-servo-autofocus',
    'probe-movie-mode',
    'set-movie-format',
    'set-iso',
    'set-aperture',
    'set-shutter-speed',
    'storage-status',
    'recent-images',
    'capture',
    'capture-download',
    'download-latest',
    'record-clip',
]

function argument(name: string): string | undefined {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredArgument(name: string): string {
    const value = argument(name)
    if (!value) throw new Error(`${name} is required`)
    return value
}

function requestedAction(): Action {
    const requested = argument('--action') || 'probe'
    if (!actions.includes(requested as Action)) throw new Error(`--action must be ${actions.join('|')}`)
    return requested as Action
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
    const raw = argument(name)
    const value = raw === undefined ? fallback : Number.parseInt(raw, 10)
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`)
    }
    return value
}

function property(properties: PropertyState[], name: string): PropertyState | undefined {
    return properties.find(candidate => candidate.name === name)
}

function exposure(properties: PropertyState[]) {
    return {
        iso: property(properties, 'CanonIso'),
        aperture: property(properties, 'CanonAperture'),
        shutterSpeed: property(properties, 'CanonShutterSpeed'),
    }
}

function ensureAdvertised(properties: PropertyState[], propertyName: string, value: unknown): void {
    const state = property(properties, propertyName)
    if (!state) throw new Error(`${propertyName} was not published by the attached camera`)
    if (!state.allowedValues?.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))) {
        throw new Error(`${propertyName} value ${JSON.stringify(value)} was not advertised by the attached camera`)
    }
}

function contentType(filename: string): string {
    const extension = path.extname(filename).toLowerCase()
    return (
        {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.heif': 'image/heif',
            '.heic': 'image/heic',
            '.png': 'image/png',
            '.cr2': 'image/x-canon-cr2',
            '.cr3': 'image/x-canon-cr3',
            '.dng': 'image/x-adobe-dng',
            '.mov': 'video/quicktime',
            '.mp4': 'video/mp4',
        } as Record<string, string>
    )[extension] || 'application/octet-stream'
}

function safeFilename(filename: string): string {
    return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_') || 'camera-media.bin'
}

function isMedia(info: ObjectInfo, imagesOnly = false): boolean {
    if (!info.objectCompressedSize || info.associationType !== 0) return false
    const expression = imagesOnly ? /\.(jpe?g|heif|heic|cr2|cr3|dng|png)$/i : /\.(jpe?g|heif|heic|cr2|cr3|dng|png|mov|mp4)$/i
    return expression.test(info.filename)
}

function objectOrder(object: CameraObject): string {
    const date = object.captureDate || object.modificationDate || ''
    const jpegPreference = /\.jpe?g$/i.test(object.filename) ? '1' : '0'
    return `${date.padStart(20, '0')}:${jpegPreference}:${String(object.sequenceNumber).padStart(12, '0')}:${String(object.handle).padStart(12, '0')}`
}

async function objectHandles(camera: Camera): Promise<Set<number>> {
    const operations = camera.getInstance().registry.operations
    const storageResponse = await camera.send(operations.GetStorageIDs, {})
    const handles = new Set<number>()
    for (const storageId of storageResponse.data || []) {
        const response = await camera.send(operations.GetObjectHandles, { StorageID: storageId })
        for (const handle of response.data || []) handles.add(Number(handle))
    }
    return handles
}

async function recentMedia(camera: Camera, limit: number, imagesOnly = true): Promise<CameraObject[]> {
    const operations = camera.getInstance().registry.operations
    const handles = [...(await objectHandles(camera))].sort((left, right) => right - left).slice(0, 80)
    const media: CameraObject[] = []
    for (const handle of handles) {
        const response = await camera.send(operations.GetObjectInfo, { ObjectHandle: handle })
        if (response.data && isMedia(response.data, imagesOnly)) media.push({ ...response.data, handle })
        if (media.length >= Math.max(limit * 3, limit + 4)) break
    }
    media.sort((left, right) => objectOrder(right).localeCompare(objectOrder(left)))
    return media.slice(0, limit)
}

async function waitForNewMedia(camera: Camera, baseline: Set<number>, imagesOnly: boolean): Promise<CameraObject> {
    const operations = camera.getInstance().registry.operations
    for (let attempt = 0; attempt < 24; attempt += 1) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 500))
        const current = await objectHandles(camera)
        const candidates: CameraObject[] = []
        for (const handle of current) {
            if (baseline.has(handle)) continue
            const response = await camera.send(operations.GetObjectInfo, { ObjectHandle: handle })
            if (response.data && isMedia(response.data, imagesOnly)) candidates.push({ ...response.data, handle })
        }
        candidates.sort((left, right) => objectOrder(right).localeCompare(objectOrder(left)))
        if (candidates[0]) return candidates[0]
    }
    throw new Error(`Camera command completed, but no new ${imagesOnly ? 'image' : 'media object'} appeared within 12 seconds`)
}

async function saveObject(camera: Camera, object: CameraObject, outputPath: string | undefined) {
    if (!outputPath) throw new Error('This action requires --output')
    const data = await camera.getObject(object.handle, object.objectCompressedSize)
    await writeFile(outputPath, data)
    const filename = safeFilename(object.filename)
    return {
        filename,
        contentType: contentType(filename),
        bytes: data.length,
        objectHandle: object.handle,
        filePath: outputPath,
    }
}

function compactObject(object: CameraObject) {
    return {
        handle: object.handle,
        filename: object.filename,
        bytes: object.objectCompressedSize,
        format: object.objectFormatDecoded,
        width: object.imagePixWidth,
        height: object.imagePixHeight,
        capturedAt: object.captureDate || object.modificationDate,
    }
}

async function storageStatus(camera: Camera) {
    const operations = camera.getInstance().registry.operations
    const response = await camera.send(operations.GetStorageIDs, {})
    const storages = []
    for (const storageId of response.data || []) {
        const info = await camera.send(operations.GetStorageInfo, { StorageID: storageId })
        if (!info.data) continue
        storages.push({
            storageId,
            description: info.data.storageDescription,
            volumeLabel: info.data.volumeLabel,
            accessCapability: info.data.accessCapability,
            capacityBytes: info.data.maxCapacity.toString(),
            freeBytes: info.data.freeSpaceInBytes.toString(),
            freeImages: info.data.freeSpaceInImages,
        })
    }
    return storages
}

const host = requiredArgument('--host')
const localAddress = requiredArgument('--local-address')
const action = requestedAction()
const rawValue = argument('--value')
const outputPath = argument('--output')
const recentLimit = boundedInteger('--limit', 8, 1, 20)
const clipDurationMilliseconds = boundedInteger('--duration-ms', 5_000, 1_000, 30_000)
const port = boundedInteger('--port', 15_740, 1, 65_535)
const socketTimeoutMilliseconds = boundedInteger('--timeout', 20_000, 1_000, 120_000)
const logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
const transport = new IPTransport(
    {
        address: host,
        port,
        localAddress,
        timeout: socketTimeoutMilliseconds,
        clientName: argument('--client-name') || `Darkgrade ${hostname()}`,
    },
    logger
)
const camera = new Camera({
    transport,
    vendorId: VendorIDs.CANON,
    logger: { expanded: false, captureConsole: false, renderInTerminal: false },
})
const watchdog = setTimeout(() => {
    process.stderr.write(`Darkgrade PTP/IP ${action} timed out for ${host}\n`)
    process.exit(124)
}, 180_000)

let result: Record<string, unknown>
try {
    await camera.connect({ ip: { host, port, protocol: 'ptp/ip', localAddress } })
    const instance = camera.getInstance()
    const deviceInfo = await camera.send(instance.registry.operations.GetDeviceInfo, {})
    if (deviceInfo.code !== OK.code || !deviceInfo.data) {
        throw new Error(`GetDeviceInfo returned 0x${deviceInfo.code.toString(16)} without a device dataset`)
    }

    let detail = `PTP/IP GetDeviceInfo completed for ${deviceInfo.data.manufacturer} ${deviceInfo.data.model}`
    let controls = await camera.getCanonPropertyStates()
    let extra: Record<string, unknown> = {}

    if (action === 'canon-status') {
        detail = `Read ${controls.length} Canon properties over PTP/IP`
    } else if (action === 'exposure-status') {
        detail = 'Read Canon ISO, aperture, and shutter speed over PTP/IP'
        extra = { exposure: exposure(controls) }
    } else if (action === 'autofocus') {
        await camera.autofocus()
        detail = 'Canon autofocus completed over PTP/IP and the focus command was released'
    } else if (action === 'keep-awake') {
        await camera.keepDeviceOn()
        detail = 'Canon KeepDeviceOn completed over PTP/IP'
    } else if (action === 'set-focus-mode') {
        if (!rawValue) throw new Error('set-focus-mode requires --value')
        ensureAdvertised(controls, 'CanonFocusMode', rawValue)
        await camera.setFocusMode(rawValue)
        detail = `Focus mode changed to ${rawValue} over PTP/IP`
    } else if (action === 'set-white-balance') {
        if (!rawValue) throw new Error('set-white-balance requires --value')
        ensureAdvertised(controls, 'CanonWhiteBalance', rawValue)
        await camera.setWhiteBalance(rawValue)
        detail = `White balance changed to ${rawValue} over PTP/IP`
    } else if (action === 'set-image-format') {
        const packed = Number(rawValue)
        if (!Number.isInteger(packed)) throw new Error('set-image-format requires a numeric --value')
        const format = property(controls, 'CanonImageFormatSd') || property(controls, 'CanonImageFormat')
        if (!format?.allowedValues?.some(value => (value as { packed?: number }).packed === packed)) {
            throw new Error(`Image format ${packed} was not advertised by the attached camera`)
        }
        await camera.setImageFormat(packed)
        detail = `Still-image format changed to ${packed} over PTP/IP`
    } else if (action === 'set-continuous-autofocus') {
        if (!rawValue) throw new Error('set-continuous-autofocus requires --value')
        ensureAdvertised(controls, 'CanonContinuousAutofocus', rawValue)
        await camera.setContinuousAutofocus(rawValue)
        detail = `Continuous autofocus changed to ${rawValue} over PTP/IP`
    } else if (action === 'set-movie-servo-autofocus') {
        if (!rawValue) throw new Error('set-movie-servo-autofocus requires --value')
        ensureAdvertised(controls, 'CanonMovieServoAutofocus', rawValue)
        await camera.setMovieServoAutofocus(rawValue)
        detail = `Movie Servo AF changed to ${rawValue} over PTP/IP`
    } else if (action === 'set-iso') {
        if (!rawValue) throw new Error('set-iso requires --value')
        ensureAdvertised(controls, 'CanonIso', rawValue)
        await camera.setIso(rawValue)
        detail = `ISO changed to ${rawValue} over PTP/IP`
    } else if (action === 'set-aperture') {
        if (!rawValue) throw new Error('set-aperture requires --value')
        ensureAdvertised(controls, 'CanonAperture', rawValue)
        await camera.setAperture(rawValue)
        detail = `Aperture changed to ${rawValue} over PTP/IP`
    } else if (action === 'set-shutter-speed') {
        if (!rawValue) throw new Error('set-shutter-speed requires --value')
        ensureAdvertised(controls, 'CanonShutterSpeed', rawValue)
        await camera.setShutterSpeed(rawValue)
        detail = `Shutter speed changed to ${rawValue} over PTP/IP`
    } else if (action === 'probe-movie-mode' || action === 'set-movie-format') {
        try {
            await camera.enterMovieMode()
            await new Promise(resolve => setTimeout(resolve, 700))
            controls = await camera.getCanonPropertyStates()
            if (action === 'set-movie-format') {
                if (!rawValue) throw new Error('set-movie-format requires --value')
                const formats = property(controls, 'CanonMovieFormat')?.allowedValues || []
                if (!formats.some(value => (value as { key?: string }).key === rawValue)) {
                    throw new Error(`Movie format ${rawValue} was not advertised by the attached camera`)
                }
                await camera.setMovieFormat(rawValue)
                detail = `Movie format changed to ${rawValue} over PTP/IP`
            } else {
                detail = 'Entered Canon movie-select mode and read its PTP/IP controls without recording'
            }
            extra = { movieMode: { entered: true, restored: true } }
        } finally {
            await camera.leaveMovieMode()
        }
    } else if (action === 'storage-status') {
        const storages = await storageStatus(camera)
        detail = `Read ${storages.length} camera storage ${storages.length === 1 ? 'volume' : 'volumes'} over PTP/IP`
        extra = { storages }
    } else if (action === 'recent-images') {
        const objects = await recentMedia(camera, recentLimit)
        detail = `Read ${objects.length} recent camera ${objects.length === 1 ? 'image' : 'images'} over PTP/IP`
        extra = { recentImages: objects.map(compactObject) }
    } else if (action === 'download-latest') {
        const latest = (await recentMedia(camera, 1))[0]
        if (!latest) throw new Error('No downloadable image was found in the camera’s 80 most recent objects')
        extra = await saveObject(camera, latest, outputPath)
        detail = `Downloaded ${latest.filename} over PTP/IP`
    } else if (action === 'capture' || action === 'capture-download') {
        const baseline = await objectHandles(camera)
        await camera.captureImage({ includeInfo: false, includeData: false })
        const captured = await waitForNewMedia(camera, baseline, true)
        extra = {
            captured: compactObject(captured),
            ...(action === 'capture-download' ? await saveObject(camera, captured, outputPath) : {}),
        }
        detail =
            action === 'capture-download'
                ? `Captured, verified, and downloaded ${captured.filename} over PTP/IP`
                : `Captured and verified new image ${captured.filename} over PTP/IP`
    } else if (action === 'record-clip') {
        const baseline = await objectHandles(camera)
        await camera.enterMovieMode()
        try {
            await camera.startRecording()
            await new Promise(resolve => setTimeout(resolve, clipDurationMilliseconds))
        } finally {
            await camera.stopRecording().catch(() => undefined)
            await camera.leaveMovieMode().catch(() => undefined)
        }
        const recorded = await waitForNewMedia(camera, baseline, false)
        extra = { recorded: compactObject(recorded), durationMilliseconds: clipDurationMilliseconds }
        detail = `Recorded and verified new media ${recorded.filename} over PTP/IP`
    }

    if (action.startsWith('set-')) controls = await camera.getCanonPropertyStates()
    result = {
        responsive: true,
        action,
        detail,
        endpoint: { host, port, localAddress },
        device: {
            manufacturer: deviceInfo.data.manufacturer,
            model: deviceInfo.data.model,
            serialNumber: deviceInfo.data.serialNumber,
            operationsSupportedRaw: deviceInfo.data.operationsSupportedRaw,
        },
        controls,
        exposure: exposure(controls),
        unknownProperties: await camera.getCanonUnknownPropertyStates(),
        network: camera.getCanonNetworkState(),
        ...extra,
    }
} catch (error) {
    result = { responsive: false, action, detail: error instanceof Error ? error.message : String(error) }
} finally {
    clearTimeout(watchdog)
    if (transport.isConnected()) {
        await Promise.race([
            camera.disconnect().catch(() => transport.disconnect()),
            new Promise<void>(resolve => setTimeout(resolve, 3_000)),
        ])
        if (transport.isConnected()) await transport.disconnect()
    }
}

process.stdout.write(`${JSON.stringify(result, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}\n`)
process.exitCode = result.responsive ? 0 : 1
