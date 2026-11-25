import { TransportType } from '@transport/interfaces/transport-types'
import type { TransportInterface } from '@transport/interfaces/transport.interface'

/** One little-endian PTP container: length, type, code and transaction ID, then the payload. */
export function ptpContainer(type: number, code: number, transactionId: number, payload: Uint8Array = new Uint8Array()) {
    const bytes = new Uint8Array(12 + payload.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transactionId, true)
    bytes.set(payload, 12)
    return bytes
}

export interface SentContainer {
    type: number
    code: number
    transactionId: number
    /** The payload read as UINT32 words: a command's parameters. */
    parameters: number[]
    payload: Uint8Array
}

export function readContainer(bytes: Uint8Array): SentContainer {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const parameters: number[] = []
    for (let offset = 12; offset + 4 <= bytes.length; offset += 4) parameters.push(view.getUint32(offset, true))
    return {
        type: view.getUint16(4, true),
        code: view.getUint16(6, true),
        transactionId: view.getUint32(8, true),
        parameters,
        payload: bytes.slice(12),
    }
}

/**
 * A USB transport (connected unless `connected` is false, until connect): each container the host
 * sends is recorded and answered by `reply`, whose containers are then received in order. A receive
 * with nothing queued fails the test.
 */
export function answeringTransport(
    reply: (sent: SentContainer) => Uint8Array[] | void = () => undefined,
    { connected = true }: { connected?: boolean } = {}
) {
    const sent: SentContainer[] = []
    const queued: Uint8Array[] = []
    const transport: TransportInterface = {
        connect: async () => void (connected = true),
        disconnect: async () => void (connected = false),
        isConnected: () => connected,
        classRequestReset: async () => undefined,
        getType: () => TransportType.USB,
        isLittleEndian: () => true,
        send: async bytes => {
            const container = readContainer(bytes.slice())
            sent.push(container)
            queued.push(...(reply(container) ?? []))
        },
        receive: async () => {
            const bytes = queued.shift()
            if (!bytes) throw new Error('Unexpected read')
            return bytes
        },
    }
    return { transport, sent }
}
