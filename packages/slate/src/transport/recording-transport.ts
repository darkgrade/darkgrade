import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

export interface TransportRecordingEntry {
    sequence: number
    kind: 'connect' | 'disconnect' | 'reset' | 'send' | 'receive' | 'event'
    startedMilliseconds: number
    finishedMilliseconds: number
    sessionId?: number
    transactionId?: number
    maxLength?: number
    event?: PTPEvent
    /** Full bytes at the library transport boundary, including PTP framing. Private by default. */
    bytes?: Uint8Array
    failed?: true
}

export interface TransportRecordingOptions {
    /** Called serially outside the camera operation; must persist before resolving. */
    write(entry: TransportRecordingEntry): Promise<void>
    maximumPendingBytes?: number
    maximumTotalBytes?: number
    maximumEntries?: number
}

/**
 * Wrap before constructing the camera. Observes its transport, never a second connection.
 * Storage failures invalidate the recording, not the camera's operation or cleanup.
 * Call finish only after camera operations and disconnect have settled.
 */
export function recordFullTransport(source: TransportInterface, options: TransportRecordingOptions) {
    const maximumPendingBytes = options.maximumPendingBytes ?? 64 * 1024 * 1024
    const maximumTotalBytes = options.maximumTotalBytes ?? 512 * 1024 * 1024
    const maximumEntries = options.maximumEntries ?? 100_000
    for (const value of [maximumPendingBytes, maximumTotalBytes, maximumEntries])
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid recording limit')
    const started = performance.now()
    const elapsed = () => performance.now() - started
    let sequence = 0
    let pendingBytes = 0
    let pendingEntries = 0
    let totalBytes = 0
    let droppedEntries = 0
    let recordingError: string | undefined
    let closed = false
    let activeOperations = 0
    let writes = Promise.resolve()
    const listeners = new Set<(event: PTPEvent) => void>()
    const fail = (reason: string) => {
        recordingError ??= reason
    }
    const append = (entry: TransportRecordingEntry) => {
        const size = entry.bytes?.byteLength ?? 0
        if (
            closed ||
            recordingError ||
            entry.sequence >= maximumEntries ||
            pendingBytes + size > maximumPendingBytes ||
            totalBytes + size > maximumTotalBytes
        ) {
            droppedEntries++
            fail(closed ? 'Recording closed during camera activity' : 'Recording capacity exceeded')
            return
        }
        const saved = { ...entry, ...(entry.bytes && { bytes: Uint8Array.from(entry.bytes) }) }
        pendingBytes += size
        pendingEntries++
        totalBytes += size
        writes = writes.then(async () => {
            try {
                await options.write(saved)
            } catch {
                fail('Recording storage failed')
            } finally {
                pendingBytes -= size
                pendingEntries--
            }
        })
    }
    const operation = async <T>(
        kind: TransportRecordingEntry['kind'],
        run: () => Promise<T>,
        fields: Partial<TransportRecordingEntry> = {}
    ): Promise<T> => {
        const entry = { ...fields, sequence: sequence++, kind, startedMilliseconds: elapsed() }
        // Source transports may reuse their outbound buffer before an async write completes.
        if (entry.bytes) entry.bytes = Uint8Array.from(entry.bytes)
        activeOperations++
        try {
            const result = await run()
            append({
                ...entry,
                finishedMilliseconds: elapsed(),
                ...(kind === 'receive' && { bytes: result as Uint8Array }),
            })
            return result
        } catch (error) {
            append({ ...entry, finishedMilliseconds: elapsed(), failed: true })
            throw error
        } finally {
            activeOperations--
        }
    }
    const onEvent = (event: PTPEvent) => {
        const now = elapsed()
        append({
            sequence: sequence++,
            kind: 'event',
            startedMilliseconds: now,
            finishedMilliseconds: now,
            event: { code: event.code, transactionId: event.transactionId, parameters: [...event.parameters] },
        })
        for (const listener of listeners) listener(event)
    }
    source.on?.(onEvent)
    const transport: TransportInterface = {
        connect: (device?: DeviceDescriptor) =>
            operation('connect', () => {
                source.on?.(onEvent)
                return source.connect(device)
            }),
        disconnect: () => operation('disconnect', () => source.disconnect()),
        classRequestReset: () =>
            operation('reset', async () => {
                try {
                    await source.classRequestReset()
                } finally {
                    source.on?.(onEvent)
                }
            }),
        isConnected: () => source.isConnected(),
        isLittleEndian: () => source.isLittleEndian(),
        getType: () => source.getType(),
        send: (bytes, sessionId, transactionId) =>
            operation('send', () => source.send(bytes, sessionId, transactionId), { bytes, sessionId, transactionId }),
        receive: (maxLength, sessionId, transactionId) =>
            operation('receive', () => source.receive(maxLength, sessionId, transactionId), {
                maxLength,
                sessionId,
                transactionId,
            }),
        on: handler => {
            listeners.add(handler)
        },
        off: handler => {
            listeners.delete(handler)
        },
    }
    const status = () => ({
        complete: closed && !recordingError && activeOperations === 0 && pendingEntries === 0,
        entries: sequence,
        totalBytes,
        droppedEntries,
        ...(recordingError && { error: recordingError }),
    })
    return {
        transport,
        status,
        async finish() {
            if (activeOperations) throw new Error('Camera operations must settle before finishing the recording')
            closed = true
            source.off?.(onEvent)
            await writes
            return status()
        },
    }
}
