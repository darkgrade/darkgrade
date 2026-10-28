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
    /**
     * After a timeout or framing violation on a USB transport, automatically send the still-image
     * class Device Reset Request, wait for the abandoned I/O to settle and reopen the session before
     * the next command (libgphoto2 resets the same way after an I/O error). On by default. If the
     * automatic reset fails, later commands fail with PTPRecoveryRequiredError until a
     * disconnect/connect. Transports without a class reset (PTP/IP) always latch instead.
     */
    automaticUSBReset: boolean
    /**
     * Caller-owned recovery that replaces the automatic USB reset, for example to honor
     * recording/lease guards. It must settle outstanding transport I/O before resolving and must
     * not call this camera's queued methods. Failed or pending recovery blocks further commands;
     * use an explicit disconnect/connect to establish a new transport instead.
     */
    recoverTransport?: (failure: PTPErrorContext) => Promise<void>
}

export const DEFAULT_TRANSACTION_POLICY: TransactionPolicy = {
    timeoutMilliseconds: 30_000,
    minimumThroughputBytesPerSecond: 2 * 1024 * 1024,
    deviceBusyRetries: 4,
    deviceBusyBackoffMilliseconds: 25,
    automaticUSBReset: true,
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
    private readonly pendingOperations = new Set<Promise<unknown>>()

    constructor(
        private readonly transport: TransportInterface,
        private readonly onDiscard: (discarded: DiscardedContainer) => void = () => undefined
    ) {}

    get hasPendingIO(): boolean {
        return this.pendingOperations.size > 0
    }

    /** Waits up to `milliseconds` for abandoned transport I/O to finish; true when none is left. */
    async settle(milliseconds: number): Promise<boolean> {
        if (!this.hasPendingIO) return true
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
            Promise.allSettled([...this.pendingOperations]),
            new Promise<void>(resolve => {
                timer = setTimeout(resolve, milliseconds)
            }),
        ]).finally(() => clearTimeout(timer))
        return !this.hasPendingIO
    }

    /** The caller has explicitly replaced the closed transport connection; old replies are isolated. */
    newConnection(): void {
        this.pendingOperations.clear()
    }

    configure(update: Partial<TransactionPolicy>): void {
        const policy = { ...this.policy, ...update }
        if (
            !Number.isSafeInteger(policy.timeoutMilliseconds) ||
            policy.timeoutMilliseconds < 1 ||
            policy.timeoutMilliseconds > 0x7fffffff
        )
            throw new Error('Transaction timeout must be a positive bounded integer')
        if (!Number.isFinite(policy.minimumThroughputBytesPerSecond) || policy.minimumThroughputBytesPerSecond <= 0)
            throw new Error('Transaction minimum throughput must be positive and finite')
        if (
            !Number.isSafeInteger(policy.deviceBusyRetries) ||
            policy.deviceBusyRetries < 0 ||
            policy.deviceBusyRetries > 32
        )
            throw new Error('DeviceBusy retries must be an integer from 0 to 32')
        if (!Number.isSafeInteger(policy.deviceBusyBackoffMilliseconds) || policy.deviceBusyBackoffMilliseconds < 0)
            throw new Error('DeviceBusy backoff must be a nonnegative integer')
        if (typeof policy.automaticUSBReset !== 'boolean')
            throw new Error('Automatic USB reset must be enabled or disabled with a boolean')
        if (policy.recoverTransport !== undefined && typeof policy.recoverTransport !== 'function')
            throw new Error('Transport recovery must be an explicitly supplied callback')
        this.policy = policy
    }

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
        const timeout = this.timeoutFor(expected.maxLength)
        const deadline = Date.now() + timeout
        for (let discarded = 0; discarded <= MAXIMUM_DISCARDED_CONTAINERS; discarded++) {
            const remaining = deadline - Date.now()
            if (remaining <= 0) throw new PTPTimeoutError(expected.phase, timeout, context)
            const raw = await this.guard(
                this.transport.receive(expected.maxLength, sessionId, expected.transactionId),
                expected.phase,
                remaining,
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
        if (!Number.isSafeInteger(bytes) || bytes < 0)
            throw new Error('Transaction buffer length must be a nonnegative integer')
        const transferMilliseconds = (bytes / this.policy.minimumThroughputBytesPerSecond) * 1000
        return Math.min(0x7fffffff, Math.ceil(this.policy.timeoutMilliseconds + transferMilliseconds))
    }

    private async guard<T>(
        operation: Promise<T>,
        phase: 'send' | 'data' | 'response',
        timeoutMilliseconds: number,
        context: PTPErrorContext
    ): Promise<T> {
        this.pendingOperations.add(operation)
        void operation.then(
            () => this.pendingOperations.delete(operation),
            () => this.pendingOperations.delete(operation)
        )
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
        if (container.type === CONTAINER_TYPE.data && container.code !== expected.operationCode)
            throw new PTPProtocolError(
                'operation-mismatch',
                `data belongs to opcode 0x${container.code.toString(16)}, expected 0x${expected.operationCode.toString(16)}`,
                context
            )
        if (
            container.type === CONTAINER_TYPE.response &&
            (container.payload.length % 4 || container.payload.length > 20)
        )
            throw new PTPProtocolError(
                'unexpected-container-type',
                'response has invalid UINT32 parameter framing',
                context
            )
        return container
    }
}
