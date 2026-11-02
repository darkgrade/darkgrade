export const SCHEMA = 'darkgrade.diagnostics/v1'
export const DISCLOSURE = 'protocol-metadata-only/v1'
export const MAXIMUM_ENTRIES = 1000
export const MAXIMUM_BODY_BYTES = 256 * 1024

export interface DiagnosticEntry {
    kind: 'connect' | 'disconnect' | 'reset' | 'command' | 'response' | 'data' | 'event' | 'unknown'
    direction: 'out' | 'in' | 'lifecycle'
    code?: number
    bytes: number
    durationMilliseconds: number
    failed: boolean
}

export interface CameraContext {
    manufacturer: string
    model: string
    firmware: string
    revision: string
    dirty: boolean
    transport: 'usb' | 'ptp-ip' | 'sony-sdk'
    evidence: 'hardware' | 'synthetic'
}

export interface Contribution {
    schema: typeof SCHEMA
    disclosure: typeof DISCLOSURE
    id: string
    camera: CameraContext
    entries: DiagnosticEntry[]
    droppedEntries: number
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const isContributionId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)
const integer = (value: unknown, maximum: number): value is number =>
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
const keys = (value: unknown, allowed: string[]): value is Record<string, unknown> =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key))
const label = (value: unknown, maximum: number) =>
    typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[\w .()+/-]+$/.test(value)

/** Reject extra fields instead of silently accepting images, serials, paths or free-form logs. */
export function validateContribution(value: unknown): asserts value is Contribution {
    if (
        !keys(value, ['schema', 'disclosure', 'id', 'camera', 'entries', 'droppedEntries']) ||
        value.schema !== SCHEMA ||
        value.disclosure !== DISCLOSURE ||
        !isContributionId(value.id)
    )
        throw new Error('Invalid contribution envelope')
    const camera = value.camera
    if (
        !keys(camera, ['manufacturer', 'model', 'firmware', 'revision', 'dirty', 'transport', 'evidence']) ||
        !label(camera.manufacturer, 32) ||
        !label(camera.model, 80) ||
        !label(camera.firmware, 40) ||
        typeof camera.revision !== 'string' ||
        !/^[a-f0-9]{7,40}$/.test(camera.revision) ||
        typeof camera.dirty !== 'boolean' ||
        !['usb', 'ptp-ip', 'sony-sdk'].includes(String(camera.transport)) ||
        !['hardware', 'synthetic'].includes(String(camera.evidence))
    )
        throw new Error('Invalid camera context')
    if (
        !Array.isArray(value.entries) ||
        value.entries.length > MAXIMUM_ENTRIES ||
        !integer(value.droppedEntries, Number.MAX_SAFE_INTEGER)
    )
        throw new Error('Invalid diagnostic count')
    for (const entry of value.entries) {
        if (
            !keys(entry, ['kind', 'direction', 'code', 'bytes', 'durationMilliseconds', 'failed']) ||
            !['connect', 'disconnect', 'reset', 'command', 'response', 'data', 'event', 'unknown'].includes(
                String(entry.kind)
            ) ||
            !['out', 'in', 'lifecycle'].includes(String(entry.direction)) ||
            (entry.code !== undefined && !integer(entry.code, 65535)) ||
            !integer(entry.bytes, 2 ** 32 - 1) ||
            !integer(entry.durationMilliseconds, 3_600_000) ||
            typeof entry.failed !== 'boolean'
        )
            throw new Error('Invalid diagnostic entry')
    }
}
