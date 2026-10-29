import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

export interface CapturedPtpTransaction {
    operation: number
    transactionId: number
    parameters: number[]
    dataFromHost?: Uint8Array
    response: { code: number; parameters: number[]; data?: Uint8Array }
}

/** Observes complete USB-framed PTP exchanges; the caller must sanitize before persistence. */
export function recordPtpTransport(source: TransportInterface, accept: (transaction: CapturedPtpTransaction) => void) {
    const pending = new Map<number, Omit<CapturedPtpTransaction, 'response'> & { data?: Uint8Array }>()
    const events: Array<{ code: number; parameters: number[]; afterOperation?: number }> = []
    let incomplete = 0
    let lastOperation: number | undefined
    let eventHandler: ((event: PTPEvent) => void) | undefined
    const maximumPayload = 1024 * 1024
    const words = (bytes: Uint8Array) => {
        if (bytes.length % 4 || bytes.length > 20) throw new Error('Invalid PTP parameter words')
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        return Array.from({ length: bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true))
    }
    const observe = (bytes: Uint8Array, outgoing: boolean) => {
        let observedTransaction: number | undefined
        try {
            if (bytes.length < 12) throw new Error('Incomplete PTP header')
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            observedTransaction = view.getUint32(8, true)
            if (view.getUint32(0, true) !== bytes.length) throw new Error('Incomplete PTP container')
            const type = view.getUint16(4, true)
            const code = view.getUint16(6, true)
            const transactionId = view.getUint32(8, true)
            const body = bytes.subarray(12)
            if (body.length > maximumPayload) throw new Error('PTP trace payload limit exceeded')
            if (outgoing && type === 1) {
                if (pending.has(transactionId)) incomplete++
                pending.set(transactionId, { operation: code, transactionId, parameters: words(body) })
                lastOperation = code
                return
            }
            const transaction = pending.get(transactionId)
            if (!transaction) return
            if (type === 2) {
                if (code !== transaction.operation) throw new Error('PTP data operation mismatch')
                if (outgoing) transaction.dataFromHost = body.slice()
                else transaction.data = body.slice()
            } else if (!outgoing && type === 3) {
                const { data, ...request } = transaction
                pending.delete(transactionId)
                accept({ ...request, response: { code, parameters: words(body), ...(data && { data }) } })
            }
        } catch {
            incomplete++
            if (observedTransaction !== undefined) pending.delete(observedTransaction)
            else pending.clear()
        }
    }
    source.on?.(event => {
        if (events.length < 4096 && event.parameters.length <= 5)
            events.push({ code: event.code, parameters: [...event.parameters], afterOperation: lastOperation })
        eventHandler?.(event)
    })
    const transport: TransportInterface = {
        connect: device => source.connect(device),
        disconnect: () => source.disconnect(),
        isConnected: () => source.isConnected(),
        isLittleEndian: () => source.isLittleEndian(),
        getType: () => source.getType(),
        classRequestReset: () => source.classRequestReset(),
        on: handler => {
            eventHandler = handler
        },
        off: handler => {
            if (eventHandler === handler) eventHandler = undefined
        },
        send: async (bytes, sessionId, transactionId) => {
            observe(bytes, true)
            await source.send(bytes, sessionId, transactionId)
        },
        receive: async (maxLength, sessionId, transactionId) => {
            const bytes = await source.receive(maxLength, sessionId, transactionId)
            observe(bytes, false)
            return bytes
        },
    }
    return { transport, events, skippedIncomplete: () => incomplete + pending.size }
}
