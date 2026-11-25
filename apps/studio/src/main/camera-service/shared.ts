import {
    Camera,
    identifyCamera,
    PTPDisconnectedError,
    PTPRecoveryRequiredError,
    VendorIDs,
    type SonyContent,
    type SonyContentFile,
    type TransactionPolicy,
} from '@darkgrade/slate'
import type { CameraControlName, FileEntry, FilePreview } from '@shared/ipc'

// Constants and helpers the camera service's area modules share.

export type Broadcast = (channel: string, payload: unknown) => void

export type DeviceDescriptor = NonNullable<ConstructorParameters<typeof Camera>[0]>['device']

export const PREVIEWABLE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp']

export const PREVIEW_MAX_BYTES = 40 * 1024 * 1024

/** Slate waits for each new frame itself (Sony makes up to 30 a second), so only yield between frames. */
export const LIVE_VIEW_FRAME_DELAY_MS = 0

export const LIVE_VIEW_STATISTICS_INTERVAL_MS = 10_000

export const LIVE_VIEW_ERROR_DELAY_MS = 500

export const LIVE_VIEW_MAX_CONSECUTIVE_ERRORS = 3

export const CONNECT_RETRY_DELAY_MS = 400

export const DISCOVERY_ATTEMPTS = 5

export const DISCOVERY_RETRY_DELAY_MS = 700

export const HOTPLUG_CONNECT_DELAY_MS = 1500

export const FOCUS_DURATION_MS = 800

export const BATTERY_POLL_INTERVAL_MS = 60_000

export const RECOVERY_RECONNECT_DELAY_MS = 1200

/**
 * Slate resets the USB pipe itself after a timeout or framing fault. A shorter base timeout than
 * Slate's 30s default keeps the UI responsive; large transfers still get throughput-scaled time.
 */
export const TRANSACTION_POLICY: Partial<TransactionPolicy> = {
    timeoutMilliseconds: 12_000,
    automaticUSBReset: true,
}

export const SETTINGS_EVENT_DEBOUNCE_MS = 400

export const STILL_IMAGE_CLASS = 0x06

export const PTP_OK = 0x2001

export const DOWNLOAD_PROGRESS_INTERVAL_MS = 100

/** Settings that change what the camera focuses on: changing one refocuses. */
export const REFOCUS_CONTROLS = new Set<CameraControlName>([
    'focusArea',
    'subjectRecognition',
    'recognitionTarget',
    'eyeSelect',
])

/** How often the camera's on-screen display is refreshed while it is overlaid. */
export const OSD_FRAME_INTERVAL_MS = 250

export const CLOCK_SYNC_INTERVAL_MS = 60 * 60 * 1000

export const KELVIN_MIN = 2500

export const KELVIN_MAX = 9900

export const KELVIN_STEP = 100

/** Sony property names per setting, newest first: bodies report one or the other. */
/** Sony's touch-focus coordinates are on a fixed 640×480 grid regardless of the picture size. */
export const SONY_AF_GRID_WIDTH = 640

export const SONY_AF_GRID_HEIGHT = 480

export const PTP_ACCESS_DENIED = 0x200f

export const FILES_REFRESH_DELAY_MS = 1500

export const PREVIEW_CACHE_MAX_BYTES = 64 * 1024 * 1024

export const VENDOR_NAMES: Record<number, string> = {
    [VendorIDs.SONY]: 'Sony',
    [VendorIDs.NIKON]: 'Nikon',
    [VendorIDs.CANON]: 'Canon',
}

export const KNOWN_CAMERA_VENDOR_IDS = new Set<number>([VendorIDs.SONY, VendorIDs.NIKON, VendorIDs.CANON])

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/** The session is unusable until a fresh disconnect/connect. */
export function requiresReconnect(error: unknown): boolean {
    return error instanceof PTPDisconnectedError || error instanceof PTPRecoveryRequiredError
}

/** Sony's colour-temperature range in its own 100 K steps, for bodies that report a range, not a list. */
export function kelvinSteps(): string[] {
    const steps: string[] = []
    for (let kelvin = KELVIN_MIN; kelvin <= KELVIN_MAX; kelvin += KELVIN_STEP) steps.push(String(kelvin))
    return steps
}

/** One card file from Sony's content index, shaped like a PTP listing entry (no object handle yet). */
export function sonyContentEntry(slot: 1 | 2, content: SonyContent, file: SonyContentFile): FileEntry {
    const filename = file.path.split('/').pop() ?? file.path
    const local = new Date(content.createdLocalMs)
    const pad = (value: number): string => String(value).padStart(2, '0')
    // The camera's local wall time stored as if UTC; format it as PTP's YYYYMMDDThhmmss.
    const captureDate = `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}`
    return {
        storageId: slot === 2 ? 0x20001 : 0x10001,
        storageDescription: `Slot ${slot}`,
        objectHandle: -1,
        filename,
        sizeBytes: file.sizeBytes,
        format: file.video ? 'Video' : (filename.split('.').pop()?.toUpperCase() ?? ''),
        captureDate,
        width: file.video?.width ?? file.width,
        height: file.video?.height ?? file.height,
        sonyContent: { contentId: content.contentId, fileId: file.fileId, slot },
    }
}

export function describeModel(vendorId: number, productId: number): string | null {
    const identification = identifyCamera({ vendorId, productId })
    if (identification.status === 'unknown') return null
    const [candidate] = identification.candidates
    const model = candidate?.models[0]?.replace(/\s*\(.*\)$/, '')
    if (!model) return null
    return identification.status === 'matched' ? model : `${model} (or similar)`
}

export function vendorKind(vendorId: number | null): 'sony' | 'canon' | 'standard' {
    if (vendorId === VendorIDs.SONY) return 'sony'
    if (vendorId === VendorIDs.CANON) return 'canon'
    return 'standard'
}

export interface DiscoveredCamera {
    vendorId: number
    productId: number
    name: string
    model: string | null
}

/**
 * Studio discovers first to present a body identity and select an explicit device.
 * Slate also selects the actual USB vendor itself when Camera.connect() is used alone.
 */
export async function discoverCamera(): Promise<DiscoveredCamera | null> {
    const { webusb } = await import('usb')

    const toDiscovered = (device: USBDevice): DiscoveredCamera => ({
        vendorId: device.vendorId,
        productId: device.productId,
        name: [device.manufacturerName, device.productName].filter(Boolean).join(' ') || 'Unknown camera',
        model: describeModel(device.vendorId, device.productId),
    })

    const isCamera = (device: USBDevice): boolean => {
        if (KNOWN_CAMERA_VENDOR_IDS.has(device.vendorId)) return true
        return (
            device.configuration?.interfaces?.some(usbInterface =>
                usbInterface.alternates?.some(alternate => alternate.interfaceClass === STILL_IMAGE_CLASS)
            ) ?? false
        )
    }

    const devices = await webusb.getDevices().catch(() => [] as USBDevice[])
    const known = devices.find(device => KNOWN_CAMERA_VENDOR_IDS.has(device.vendorId))
    if (known) return toDiscovered(known)
    const anyCamera = devices.find(isCamera)
    if (anyCamera) return toDiscovered(anyCamera)

    // Fallback: explicitly request per known vendor (mirrors link's discover())
    for (const vendorId of KNOWN_CAMERA_VENDOR_IDS) {
        try {
            const device = await webusb.requestDevice({ filters: [{ vendorId, classCode: STILL_IMAGE_CLASS }] })
            if (device) return toDiscovered(device)
        } catch {
            // no device for this vendor
        }
    }
    return null
}

export function formatBytes(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`
    if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
    return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

export const VIDEO_MIME_TYPES: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4' }

export const IMAGE_MIME_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    hif: 'image/heic',
}

export function buildPreview(filename: string, data: Uint8Array): FilePreview {
    const extension = filename.split('.').pop()?.toLowerCase() ?? ''
    if (VIDEO_MIME_TYPES[extension]) return { kind: 'video', mimeType: VIDEO_MIME_TYPES[extension], data }
    if (IMAGE_MIME_TYPES[extension]) return { kind: 'image', mimeType: IMAGE_MIME_TYPES[extension], data }
    const embedded = largestEmbeddedJpeg(data)
    if (embedded) return { kind: 'image', mimeType: 'image/jpeg', data: embedded }
    return { kind: 'unsupported', mimeType: '', data: new Uint8Array() }
}

/**
 * RAW files (Sony ARW, Nikon NEF, Canon CR2…) are TIFF containers that carry full-size JPEG
 * previews. Walks every IFD and SubIFD and returns the largest JPEGInterchangeFormat block.
 */
export function largestEmbeddedJpeg(data: Uint8Array): Uint8Array | null {
    if (data.byteLength < 8) return null
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const order = String.fromCharCode(data[0], data[1])
    if (order !== 'II' && order !== 'MM') return null
    const littleEndian = order === 'II'
    const u16 = (offset: number): number => view.getUint16(offset, littleEndian)
    const u32 = (offset: number): number => view.getUint32(offset, littleEndian)
    const pending = [u32(4)]
    const visited = new Set<number>()
    let best: { offset: number; length: number } | null = null
    while (pending.length > 0) {
        const ifd = pending.pop() as number
        if (ifd === 0 || ifd + 2 > data.byteLength || visited.has(ifd)) continue
        visited.add(ifd)
        const count = u16(ifd)
        let jpegOffset = 0
        let jpegLength = 0
        for (let index = 0; index < count; index++) {
            const entry = ifd + 2 + index * 12
            if (entry + 12 > data.byteLength) break
            const tag = u16(entry)
            const valueCount = u32(entry + 4)
            if (tag === 0x0201) jpegOffset = u32(entry + 8)
            if (tag === 0x0202) jpegLength = u32(entry + 8)
            if (tag === 0x014a) {
                const first = valueCount === 1 ? entry + 8 : u32(entry + 8)
                for (let sub = 0; sub < valueCount && first + sub * 4 + 4 <= data.byteLength; sub++)
                    pending.push(u32(first + sub * 4))
            }
        }
        const fits = jpegOffset > 0 && jpegLength > 0 && jpegOffset + jpegLength <= data.byteLength
        if (fits && (!best || jpegLength > best.length)) best = { offset: jpegOffset, length: jpegLength }
        const next = ifd + 2 + count * 12
        if (next + 4 <= data.byteLength) pending.push(u32(next))
    }
    return best ? data.slice(best.offset, best.offset + best.length) : null
}
