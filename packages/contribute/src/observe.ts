import type { DiagnosticEntry } from '#contribute/schema'

export interface CameraEvent {
    code: number
    transactionId: number
    parameters: number[]
}
/** Structural compatibility with Darkgrade Link, without loading its USB/native dependencies. */
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

export function observeTransport<Device, Kind extends string>(
    source: CameraTransport<Device, Kind>,
    enabled: () => boolean,
    record: (entry: DiagnosticEntry) => void,
    generation: () => number
) {
    let detached = false
    let sessionId = crypto.randomUUID()
    const listeners = new Set<(event: CameraEvent) => void>()
    const save = (entry: DiagnosticEntry) => {
        if (!detached && enabled()) {
            try {
                record({ ...entry, occurredAt: new Date().toISOString(), sessionId })
            } catch {
                /* Diagnostics must not break camera cleanup. */
            }
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
        try {
            const result = await run()
            if (collecting && epoch === generation())
                save({
                    ...fields,
                    ...(name ? { operation: name } : {}),
                    ...(result instanceof Uint8Array && header(result)),
                    direction,
                    bytes: bytes?.byteLength ?? (result instanceof Uint8Array ? result.byteLength : 0),
                    durationMilliseconds: Math.min(3_600_000, Math.round(performance.now() - started)),
                    failed: false,
                })
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
                source.on?.(onEvent)
                return source.connect(device)
            }),
        disconnect: () => operation('lifecycle', 'disconnect', () => source.disconnect()),
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
        on: listener => {
            listeners.add(listener)
        },
        off: listener => {
            listeners.delete(listener)
        },
    }
    return {
        transport,
        operation: <Result>(name: string, work: () => Promise<Result>) =>
            /^[a-z_]{1,40}$/.test(name) ? operation('lifecycle', 'command', work, undefined, name) : work(),
        detach: () => {
            detached = true
            source.off?.(onEvent)
            listeners.clear()
        },
    }
}
