import { validateProtocol, type ProtocolEvidence } from '@contribute/protocol'
export const SCHEMA = 'darkgrade.diagnostics/v1'
export const DISCLOSURE = 'protocol-metadata-only/v1'
export const MAXIMUM_ENTRIES = 1000
export const MAXIMUM_BODY_BYTES = 256 * 1024

export interface DiagnosticEntry {
    protocol?: ProtocolEvidence
    operation?: string
    occurredAt?: string
    sessionId?: string
    transactionId?: number
    /** The public Camera call this entry belongs to: the `call` entry itself and the protocol work under it. */
    callId?: string
    /** Only on a `call` entry: which public operation was asked for, through which surface, and how it ended. */
    call?: ApiCall
    /**
     * `attach`: observation began on a connection that was already open, so the connection's
     * earlier work is not in this session.
     */
    kind: 'connect' | 'disconnect' | 'reset' | 'command' | 'response' | 'data' | 'event' | 'unknown' | 'call' | 'attach'
    direction: 'out' | 'in' | 'lifecycle'
    code?: number
    /** On `data` and `response` entries: the operation code of the command in the same transaction. */
    commandCode?: number
    bytes: number
    durationMilliseconds: number
    failed: boolean
}

/** One input of a public call. Values are kept only for switches, numbers, listed choices and setting values. */
export interface ApiCallArgument {
    name: string
    type: 'switch' | 'number' | 'choice' | 'text' | 'time' | 'object'
    value?: boolean | number | string
}
/** A failed call's typed error. `operation` is the method or setting id the error names. */
export interface ApiCallError {
    type: string
    operation?: string
    /** Slate's message with paths, addresses and long identifiers removed. */
    message?: string
    /** The PTP response code the camera answered, when the error came from one. */
    response?: number
    /** The class of the underlying transport or protocol error (`PTPTimeoutError`). */
    cause?: string
}
export const API_CALL_SURFACES = ['library', 'mcp', 'cli', 'studio'] as const
export const API_CALL_OUTCOMES = ['ok', 'unsupported', 'refused', 'outcome-unknown', 'invalid-input', 'error'] as const
/**
 * A public Camera operation as the caller asked for it: the operation table's name
 * (`setShutterSpeed`) with its MCP tool and CLI command, where it came from, and how it ended.
 * `attribution` says how its protocol entries were linked: by the call's own async context, or
 * (hosts without one) because it was the only call running.
 */
export interface ApiCall {
    operation: string
    tool: string
    command: string
    surface: (typeof API_CALL_SURFACES)[number]
    outcome: (typeof API_CALL_OUTCOMES)[number]
    attribution: 'async-context' | 'only-active-call'
    arguments?: ApiCallArgument[]
    error?: ApiCallError
}

export interface CameraContext {
    /** Versioned hash of the camera's manufacturer/model/serial. Never the installation identity or raw serial. */
    hardwareFingerprint?: string
    manufacturer: string
    model: string
    firmware: string
    revision: string
    dirty: boolean
    transport: 'usb' | 'ptp-ip' | 'wifi' | 'unknown' | 'sony-sdk'
    backend?: 'ptp' | 'vendor-api' | 'unknown'
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

/** A setting value as Slate spells it (`1/250`, `F2.8`, `IPB (Standard)`), never a path. */
export const isSafeArgumentText = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^[A-Za-z0-9 .,:;()+\-/·'"×%]{1,48}$/.test(value) &&
    !/^[/\\]|\/\/|(?:\/[^/]*){2,}/.test(value)
const pathLike = /(?:[A-Za-z]:)?(?:[\\/][^\s\\/'"`]+){2,}/
const emailLike = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const identifierLike = /(?=[A-Za-z0-9]*(?:\d[A-Za-z0-9]*){4})\b[A-Za-z0-9]{7,}\b/
/** Removes paths, addresses and long identifiers (serials, object ids) from an error message. */
export function redactMessage(message: string): string {
    return message
        .replace(/\s+/g, ' ')
        .trim()
        .replace(new RegExp(emailLike, 'g'), '[email]')
        .replace(new RegExp(pathLike, 'g'), '[path]')
        .replace(new RegExp(identifierLike, 'g'), (match: string) =>
            /^0x[0-9a-f]{4,8}$/i.test(match) ? match : '[id]'
        )
        .replace(/[^\x20-\x7e·–—…]/g, '?')
        .slice(0, 200)
}
const className = (value: unknown) => typeof value === 'string' && /^[A-Z][A-Za-z]{2,47}$/.test(value)
function validateApiCall(value: unknown): asserts value is ApiCall {
    if (
        !keys(value, ['operation', 'tool', 'command', 'surface', 'outcome', 'attribution', 'arguments', 'error']) ||
        typeof value.operation !== 'string' ||
        !/^[a-z][A-Za-z]{1,47}$/.test(value.operation) ||
        typeof value.tool !== 'string' ||
        !/^camera_[a-z_]{1,60}$/.test(value.tool) ||
        typeof value.command !== 'string' ||
        !/^darkgrade cameras?(?: [a-z-]{1,60})?$/.test(value.command) ||
        !API_CALL_SURFACES.includes(value.surface as ApiCall['surface']) ||
        !API_CALL_OUTCOMES.includes(value.outcome as ApiCall['outcome']) ||
        !['async-context', 'only-active-call'].includes(String(value.attribution))
    )
        throw new Error('Invalid API call')
    if (value.arguments !== undefined) {
        if (!Array.isArray(value.arguments) || value.arguments.length > 8) throw new Error('Invalid API call arguments')
        for (const argument of value.arguments)
            if (
                !keys(argument, ['name', 'type', 'value']) ||
                typeof argument.name !== 'string' ||
                !/^[a-zA-Z]{1,48}$/.test(argument.name) ||
                !['switch', 'number', 'choice', 'text', 'time', 'object'].includes(String(argument.type)) ||
                (argument.value !== undefined &&
                    !(argument.type === 'switch' && typeof argument.value === 'boolean') &&
                    !(
                        argument.type === 'number' &&
                        typeof argument.value === 'number' &&
                        Number.isFinite(argument.value)
                    ) &&
                    !(['choice', 'text'].includes(String(argument.type)) && isSafeArgumentText(argument.value)))
            )
                throw new Error('Invalid API call argument')
    }
    const error = value.error
    if (error === undefined) {
        if (value.outcome !== 'ok') throw new Error('A failed API call needs its error')
        return
    }
    if (
        value.outcome === 'ok' ||
        !keys(error, ['type', 'operation', 'message', 'response', 'cause']) ||
        !className(error.type) ||
        (error.cause !== undefined && !className(error.cause)) ||
        (error.operation !== undefined &&
            (typeof error.operation !== 'string' || !/^[a-zA-Z]{1,48}$/.test(error.operation))) ||
        (error.response !== undefined && !integer(error.response, 0xffff)) ||
        (error.message !== undefined &&
            (typeof error.message !== 'string' ||
                error.message !== redactMessage(error.message) ||
                pathLike.test(error.message) ||
                emailLike.test(error.message)))
    )
        throw new Error('Invalid API call error')
}

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
        !keys(camera, [
            'manufacturer',
            'model',
            'firmware',
            'revision',
            'dirty',
            'transport',
            'evidence',
            'hardwareFingerprint',
            'backend',
        ]) ||
        (camera.hardwareFingerprint !== undefined &&
            (typeof camera.hardwareFingerprint !== 'string' ||
                !/^camera-v1:[a-f0-9]{64}$/.test(camera.hardwareFingerprint) ||
                camera.evidence !== 'hardware')) ||
        !label(camera.manufacturer, 32) ||
        !label(camera.model, 80) ||
        !label(camera.firmware, 40) ||
        typeof camera.revision !== 'string' ||
        !/^[a-f0-9]{7,40}$/.test(camera.revision) ||
        typeof camera.dirty !== 'boolean' ||
        !['usb', 'ptp-ip', 'wifi', 'unknown', 'sony-sdk'].includes(String(camera.transport)) ||
        (camera.backend !== undefined && !['ptp', 'vendor-api', 'unknown'].includes(String(camera.backend))) ||
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
            !keys(entry, [
                'kind',
                'direction',
                'code',
                'bytes',
                'protocol',
                'durationMilliseconds',
                'failed',
                'occurredAt',
                'sessionId',
                'transactionId',
                'operation',
                'callId',
                'call',
                'commandCode',
            ]) ||
            ![
                'connect',
                'disconnect',
                'reset',
                'command',
                'response',
                'data',
                'event',
                'unknown',
                'call',
                'attach',
            ].includes(String(entry.kind)) ||
            (entry.commandCode !== undefined &&
                (!integer(entry.commandCode, 65535) || !['data', 'response'].includes(String(entry.kind)))) ||
            (entry.kind === 'attach' && (entry.direction !== 'lifecycle' || entry.code !== undefined)) ||
            (entry.callId !== undefined && !isContributionId(entry.callId)) ||
            (entry.kind === 'call') !== (entry.call !== undefined) ||
            (entry.kind === 'call' && (entry.callId === undefined || entry.direction !== 'lifecycle')) ||
            !['out', 'in', 'lifecycle'].includes(String(entry.direction)) ||
            (entry.code !== undefined && !integer(entry.code, 65535)) ||
            !integer(entry.bytes, 2 ** 32 - 1) ||
            !integer(entry.durationMilliseconds, 3_600_000) ||
            typeof entry.failed !== 'boolean' ||
            (entry.operation !== undefined &&
                (typeof entry.operation !== 'string' || !/^[a-z_]{1,40}$/.test(entry.operation))) ||
            (entry.sessionId !== undefined && !isContributionId(entry.sessionId)) ||
            (entry.transactionId !== undefined && !integer(entry.transactionId, 2 ** 32 - 1)) ||
            (entry.occurredAt !== undefined &&
                (typeof entry.occurredAt !== 'string' ||
                    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.occurredAt) ||
                    !Number.isFinite(Date.parse(entry.occurredAt))))
        )
            throw new Error('Invalid diagnostic entry')
        if (entry.protocol !== undefined) validateProtocol(entry.protocol)
        if (entry.call !== undefined) {
            validateApiCall(entry.call)
            if (entry.failed !== (entry.call.outcome !== 'ok')) throw new Error('Invalid API call outcome')
        }
    }
}

/** Stable across reconnects, firmware updates and installations; absent when no reliable body serial exists. */
export async function cameraHardwareFingerprint(info: {
    manufacturer: string
    model: string
    serialNumber?: string
}): Promise<string | undefined> {
    const serial = info.serialNumber?.replace(/\0+$/, '').trim()
    if (!serial || serial.length > 256 || /[\x00-\x1f\x7f]/.test(serial) || /^(unknown|none|n\/a|0+|f+)$/i.test(serial))
        return
    const manufacturer = info.manufacturer.trim().toLowerCase().replace(/\s+/g, ' ')
    const model = info.model.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!manufacturer || !model || manufacturer === 'unknown' || model === 'unknown') return
    const bytes = new TextEncoder().encode(JSON.stringify(['darkgrade.camera/v1', manufacturer, model, serial]))
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return 'camera-v1:' + Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}
