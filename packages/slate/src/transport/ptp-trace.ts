import { CONTAINER_HEADER_BYTES, ContainerType, MAXIMUM_PARAMETERS, readContainerHeader, readParameters } from '@ptp/container'
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
        const parameters = readParameters(bytes)
        if (!parameters) throw new Error('Invalid PTP parameter words')
        return parameters
    }
    const observe = (bytes: Uint8Array, outgoing: boolean) => {
        let observedTransaction: number | undefined
        try {
            if (bytes.length < CONTAINER_HEADER_BYTES) throw new Error('Incomplete PTP header')
            const { length, type, code, transactionId } = readContainerHeader(bytes)
            observedTransaction = transactionId
            if (length !== bytes.length) throw new Error('Incomplete PTP container')
            const body = bytes.subarray(CONTAINER_HEADER_BYTES)
            if (body.length > maximumPayload) throw new Error('PTP trace payload limit exceeded')
            if (outgoing && type === ContainerType.COMMAND) {
                if (pending.has(transactionId)) incomplete++
                pending.set(transactionId, { operation: code, transactionId, parameters: words(body) })
                lastOperation = code
                return
            }
            const transaction = pending.get(transactionId)
            if (!transaction) return
            if (type === ContainerType.DATA) {
                if (code !== transaction.operation) throw new Error('PTP data operation mismatch')
                if (outgoing) transaction.dataFromHost = body.slice()
                else transaction.data = body.slice()
            } else if (!outgoing && type === ContainerType.RESPONSE) {
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
        if (events.length < 4096 && event.parameters.length <= MAXIMUM_PARAMETERS)
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
