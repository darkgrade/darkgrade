import { DISCLOSURE, SCHEMA, type CameraContext, type Contribution, type DiagnosticEntry } from '@contribute/schema'

export function newContribution(camera: CameraContext, entries: DiagnosticEntry[], droppedEntries = 0): Contribution {
    return { schema: SCHEMA, disclosure: DISCLOSURE, id: crypto.randomUUID(), camera, entries, droppedEntries }
}

export function environmentDisabled() {
    const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    return environment?.DARKGRADE_CONTRIBUTIONS === '0' || environment?.DO_NOT_TRACK === '1'
}

export interface CameraEvent {
    code: number
    transactionId: number
    parameters: number[]
}
/** Structural compatibility with Darkgrade Slate, without loading its USB/native dependencies. */
export interface CameraTransport<Device = unknown, Kind extends string = string> {
    connect(device?: Device): Promise<void>
    disconnect(): Promise<void>
    send(bytes: Uint8Array, session: number, transaction: number): Promise<void>
    receive(length: number, session: number, transaction: number): Promise<Uint8Array>
    classRequestReset(): Promise<void>
    resetPort?(): Promise<void>
    isConnected(): boolean
    isLittleEndian(): boolean
    getType(): Kind
    on?(listener: (event: CameraEvent) => void): void
    off?(listener: (event: CameraEvent) => void): void
}

/** Read only a complete normalized PTP container header. Never retain payloads or parameters. */
const containerKinds: Partial<Record<number, DiagnosticEntry['kind']>> = {
    1: 'command',
    2: 'data',
    3: 'response',
    4: 'event',
}
function header(bytes: Uint8Array): Pick<DiagnosticEntry, 'kind' | 'code' | 'transactionId'> {
    if (bytes.byteLength < 12) return { kind: 'unknown' }
    const view = new DataView(bytes.buffer, bytes.byteOffset, 12)
    if (view.getUint32(0, true) !== bytes.byteLength) return { kind: 'unknown' }
    const kind = containerKinds[view.getUint16(4, true)]
    return kind ? { kind, code: view.getUint16(6, true), transactionId: view.getUint32(8, true) } : { kind: 'unknown' }
}

const STANDARD_OPERATION_NAMES: Readonly<Record<number, string>> = {
    0x1001: 'get_device_info',
    0x1004: 'get_storage_ids',
    0x1005: 'get_storage_info',
    0x1007: 'get_object_handles',
    0x1008: 'get_object_info',
    0x1009: 'get_object',
    0x101b: 'get_partial_object',
}
const SONY_OPERATION_NAMES: Readonly<Record<number, string>> = {
    0x9211: 'sony_partial_object',
    0x9212: 'sony_transfer_mode',
    0x923c: 'sony_card_index',
    0x923e: 'sony_card_preview',
}

/** Fixed labels only: inspect Sony's reserved live-view handle without retaining object IDs or other parameters. */
function operationName(bytes: Uint8Array, manufacturer: string): string | undefined {
    const fields = header(bytes)
    if (fields.kind !== 'command') return
    if (/^sony(?:\b|$)/i.test(manufacturer)) {
        if (
            fields.code === 0x1009 &&
            bytes.byteLength === 16 &&
            new DataView(bytes.buffer, bytes.byteOffset + 12, 4).getUint32(0, true) === 0xffffc002
        )
            return 'sony_live_view_frame'
        return SONY_OPERATION_NAMES[fields.code ?? 0] ?? STANDARD_OPERATION_NAMES[fields.code ?? 0]
    }
    return STANDARD_OPERATION_NAMES[fields.code ?? 0]
}

export function observeTransport<Device, Kind extends string>(
    source: CameraTransport<Device, Kind>,
    enabled: () => boolean,
    record: (entry: DiagnosticEntry) => void,
    generation: () => number,
    camera: () => Pick<CameraContext, 'manufacturer'> = () => ({ manufacturer: 'Unknown' })
) {
    let detached = false
    let sessionId = crypto.randomUUID()
    const listeners = new Set<(event: CameraEvent) => void>()
    const pending = new Map<number, { operation: string; generation: number }>()
    const save = (entry: DiagnosticEntry) => {
        if (detached || !enabled()) return
        try {
            record({ ...entry, occurredAt: new Date().toISOString(), sessionId })
        } catch {
            /* Diagnostics must not break camera cleanup. */
        }
    }
    const operation = async <Result>(
        direction: DiagnosticEntry['direction'],
        kind: DiagnosticEntry['kind'],
        run: () => Promise<Result>,
        bytes?: Uint8Array,
        name?: string
    ): Promise<Result> => {
        const started = performance.now()
        const epoch = generation()
        const collecting = !detached && enabled()
        const fields = collecting && bytes ? header(bytes) : { kind }
        if (bytes && fields.kind === 'command' && fields.transactionId !== undefined)
            pending.delete(fields.transactionId)
        try {
            const result = await run()
            if (collecting && epoch === generation()) {
                const completed = result instanceof Uint8Array ? header(result) : fields
                const label =
                    bytes && fields.kind === 'command'
                        ? operationName(bytes, camera().manufacturer)
                        : pending.get(completed.transactionId ?? -1)?.generation === epoch
                          ? pending.get(completed.transactionId ?? -1)?.operation
                          : undefined
                if (bytes && fields.kind === 'command' && fields.transactionId !== undefined && label) {
                    if (pending.size >= 128) pending.delete(pending.keys().next().value!)
                    pending.set(fields.transactionId, { operation: label, generation: epoch })
                }
                save({
                    ...fields,
                    ...((name ?? label) ? { operation: name ?? label } : {}),
                    ...(result instanceof Uint8Array && header(result)),
                    direction,
                    bytes: bytes?.byteLength ?? (result instanceof Uint8Array ? result.byteLength : 0),
                    durationMilliseconds: Math.min(3_600_000, Math.round(performance.now() - started)),
                    failed: false,
                })
                if (completed.kind === 'response' && completed.transactionId !== undefined)
                    pending.delete(completed.transactionId)
            }
            return result
        } catch (error) {
            if (collecting && epoch === generation())
                save({
                    ...fields,
                    ...(name ? { operation: name } : {}),
                    direction,
                    bytes: bytes?.byteLength ?? 0,
                    durationMilliseconds: Math.min(3_600_000, Math.round(performance.now() - started)),
                    failed: true,
                })
            throw error
        }
    }
    const onEvent = (event: CameraEvent) => {
        save({ kind: 'event', direction: 'in', code: event.code, bytes: 0, durationMilliseconds: 0, failed: false })
        for (const listener of listeners) listener(event)
    }
    source.on?.(onEvent)
    const transport: CameraTransport<Device, Kind> = {
        connect: device =>
            operation('lifecycle', 'connect', () => {
                sessionId = crypto.randomUUID()
                pending.clear()
                source.on?.(onEvent)
                return source.connect(device)
            }),
        disconnect: () =>
            operation('lifecycle', 'disconnect', async () => {
                try {
                    await source.disconnect()
                } finally {
                    pending.clear()
                }
            }),
        classRequestReset: () =>
            operation('lifecycle', 'reset', async () => {
                try {
                    await source.classRequestReset()
                } finally {
                    source.on?.(onEvent)
                }
            }),
        ...(source.resetPort && { resetPort: () => operation('lifecycle', 'reset', () => source.resetPort!()) }),
        send: (bytes, session, transaction) =>
            operation('out', 'unknown', () => source.send(bytes, session, transaction), bytes),
        receive: (length, session, transaction) =>
            operation('in', 'unknown', () => source.receive(length, session, transaction)),
        isConnected: () => source.isConnected(),
        isLittleEndian: () => source.isLittleEndian(),
        getType: () => source.getType(),
        on: listener => void listeners.add(listener),
        off: listener => void listeners.delete(listener),
    }
    return {
        transport,
        session: () => sessionId,
        record: save,
        operation: <Result>(name: string, work: () => Promise<Result>) =>
            /^[a-z_]{1,40}$/.test(name) ? operation('lifecycle', 'command', work, undefined, name) : work(),
        detach: () => {
            detached = true
            source.off?.(onEvent)
            listeners.clear()
            pending.clear()
        },
    }
}
