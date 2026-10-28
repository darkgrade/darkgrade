import { PTPProtocolError, PTPTimeoutError, type PTPErrorContext } from '@core/ptp-errors'
import { TransportInterface } from '@transport/interfaces/transport.interface'

/** How long and how often darkgrade waits for a camera before giving up on a transaction. */
export interface TransactionPolicy {
    /** Base time a single send or receive phase may take. */
    timeoutMilliseconds: number
    /** Large data phases get extra time at this rate on top of the base timeout. */
    minimumThroughputBytesPerSecond: number
    /** Standard (0x1xxx) operations answered DeviceBusy are retried this many times. */
    deviceBusyRetries: number
    /** First retry delay; each further retry doubles it. */
    deviceBusyBackoffMilliseconds: number
}

export const DEFAULT_TRANSACTION_POLICY: TransactionPolicy = {
    timeoutMilliseconds: 30_000,
    minimumThroughputBytesPerSecond: 2 * 1024 * 1024,
    deviceBusyRetries: 4,
    deviceBusyBackoffMilliseconds: 25,
}

export const CONTAINER_TYPE = { command: 1, data: 2, response: 3, event: 4 } as const
const HEADER_BYTES = 12
const CLOSE_SESSION = 0x1003
/** A reply this many transactions old is treated as a late answer to an abandoned transaction. */
const STALE_WINDOW = 1024
const MAXIMUM_DISCARDED_CONTAINERS = 8

export interface Container {
    type: number
    code: number
    transactionId: number
    payload: Uint8Array
}

export interface ExpectedContainer {
    operation: string
    operationCode: number
    transactionId: number
    /** "data" accepts a data container or an early response; "response" accepts only a response. */
    phase: 'data' | 'response'
    maxLength: number
}

/** A container that arrived but belongs to no transaction in flight. */
export interface DiscardedContainer {
    container: Container
    reason: string
}

function isStale(transactionId: number, expected: number): boolean {
    return transactionId !== 0 && transactionId < expected && expected - transactionId <= STALE_WINDOW
}

/**
 * Sends and receives the containers of one PTP transaction with ISO 15740 framing checks and
 * timeouts. Framing violations raise PTPProtocolError and slow phases PTPTimeoutError; errors the
 * transport itself throws (USB stalls, closed sockets) pass through unchanged.
 */
export class TransactionChannel {
    policy: TransactionPolicy = { ...DEFAULT_TRANSACTION_POLICY }

    constructor(
        private readonly transport: TransportInterface,
        private readonly onDiscard: (discarded: DiscardedContainer) => void = () => undefined
    ) {}

    async send(container: Uint8Array, sessionId: number, context: PTPErrorContext): Promise<void> {
        const timeout = this.timeoutFor(container.length)
        await this.guard(
            this.transport.send(container, sessionId, context.transactionId ?? 0),
            'send',
            timeout,
            context
        )
    }

    async receive(sessionId: number, expected: ExpectedContainer): Promise<Container> {
        const context = { operation: expected.operation, transactionId: expected.transactionId }
        for (let discarded = 0; discarded <= MAXIMUM_DISCARDED_CONTAINERS; discarded++) {
            const raw = await this.guard(
                this.transport.receive(expected.maxLength, sessionId, expected.transactionId),
                expected.phase,
                this.timeoutFor(expected.maxLength),
                context
            )
            const container = this.parse(raw, context)
            const reason = this.discardReason(container, expected)
            if (!reason) return this.check(container, expected, context)
            this.onDiscard({ container, reason })
        }
        throw new PTPProtocolError(
            'transaction-mismatch',
            `more than ${MAXIMUM_DISCARDED_CONTAINERS} late containers from earlier transactions`,
            context
        )
    }

    timeoutFor(bytes: number): number {
        const transferMilliseconds = (bytes / this.policy.minimumThroughputBytesPerSecond) * 1000
        return Math.ceil(this.policy.timeoutMilliseconds + transferMilliseconds)
    }

    private async guard<T>(
        operation: Promise<T>,
        phase: 'send' | 'data' | 'response',
        timeoutMilliseconds: number,
        context: PTPErrorContext
    ): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new PTPTimeoutError(phase, timeoutMilliseconds, context)),
                timeoutMilliseconds
            )
        })
        try {
            return await Promise.race([operation, timeout])
        } catch (error) {
            if (error instanceof PTPTimeoutError) operation.catch(() => undefined)
            throw error
        } finally {
            clearTimeout(timer)
        }
    }

    private parse(raw: Uint8Array, context: PTPErrorContext): Container {
        if (raw.length < HEADER_BYTES) {
            throw new PTPProtocolError(
                'short-container',
                `container of ${raw.length} bytes has no complete header`,
                context
            )
        }
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
        const declaredLength = view.getUint32(0, true)
        if (declaredLength < HEADER_BYTES) {
            throw new PTPProtocolError('short-container', `container declares ${declaredLength} bytes`, context)
        }
        if (raw.length < declaredLength) {
            throw new PTPProtocolError(
                'truncated-container',
                `container declares ${declaredLength} bytes but ${raw.length} arrived`,
                context
            )
        }
        return {
            type: view.getUint16(4, true),
            code: view.getUint16(6, true),
            transactionId: view.getUint32(8, true),
            // Bytes past the declared length are not part of the container and are ignored.
            payload: raw.slice(HEADER_BYTES, declaredLength),
        }
    }

    private discardReason(container: Container, expected: ExpectedContainer): string | undefined {
        if (container.transactionId === expected.transactionId) return undefined
        // Some cameras (Leica per libgphoto2 ptp.c ptp_transaction_new) answer CloseSession with transaction 0.
        if (this.isCloseSessionReply(container, expected)) return undefined
        if (isStale(container.transactionId, expected.transactionId)) {
            return `late container for transaction ${container.transactionId} while waiting for ${expected.transactionId}`
        }
        return undefined
    }

    private isCloseSessionReply(container: Container, expected: ExpectedContainer): boolean {
        return (
            expected.operationCode === CLOSE_SESSION &&
            container.type === CONTAINER_TYPE.response &&
            container.transactionId === 0
        )
    }

    private check(container: Container, expected: ExpectedContainer, context: PTPErrorContext): Container {
        const allowed: number[] =
            expected.phase === 'data' ? [CONTAINER_TYPE.data, CONTAINER_TYPE.response] : [CONTAINER_TYPE.response]
        if (!allowed.includes(container.type)) {
            throw new PTPProtocolError(
                'unexpected-container-type',
                `expected a ${expected.phase} container, got type ${container.type}`,
                context
            )
        }
        const transactionMatches =
            container.transactionId === expected.transactionId || this.isCloseSessionReply(container, expected)
        if (!transactionMatches) {
            throw new PTPProtocolError(
                'transaction-mismatch',
                `reply belongs to transaction ${container.transactionId}, expected ${expected.transactionId}`,
                context
            )
        }
        return container
    }
}
