import { PTPProtocolError, PTPTimeoutError, type PTPErrorContext, type PTPProtocolViolation } from '@core/ptp-errors'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { CONTAINER_HEADER_BYTES, ContainerType, isParameterBlock, readContainerHeader } from '@ptp/container'

/** How long and how often darkgrade waits for a camera before giving up on a transaction. */
export interface TransactionPolicy {
    /** Base time a single send or receive phase may take. */
    timeoutMilliseconds: number
    /** Large data phases get extra time at this rate on top of the base timeout. */
    minimumThroughputBytesPerSecond: number
    /** Standard (0x1xxx) operations answered DeviceBusy are retried at most this many times. */
    deviceBusyRetries: number
    /** First retry delay; each further retry doubles it. */
    deviceBusyBackoffMilliseconds: number
    /** Retries stop once this much time has passed since the first attempt; the last delay is shortened to fit. */
    deviceBusyBudgetMilliseconds: number
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
    // 50, 100, 200, 400, 800 ms, then whatever is left of the two-second budget.
    deviceBusyRetries: 6,
    deviceBusyBackoffMilliseconds: 50,
    deviceBusyBudgetMilliseconds: 2_000,
    automaticUSBReset: true,
}

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
    dataOperationCode?: number
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
        const integerWithin = (value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
            Number.isSafeInteger(value) && value >= minimum && value <= maximum
        if (!integerWithin(policy.timeoutMilliseconds, 1, 0x7fffffff))
            throw new Error('Transaction timeout must be a positive bounded integer')
        if (!Number.isFinite(policy.minimumThroughputBytesPerSecond) || policy.minimumThroughputBytesPerSecond <= 0)
            throw new Error('Transaction minimum throughput must be positive and finite')
        if (!integerWithin(policy.deviceBusyRetries, 0, 32))
            throw new Error('DeviceBusy retries must be an integer from 0 to 32')
        if (!integerWithin(policy.deviceBusyBackoffMilliseconds, 0))
            throw new Error('DeviceBusy backoff must be a nonnegative integer')
        if (!integerWithin(policy.deviceBusyBudgetMilliseconds, 0))
            throw new Error('DeviceBusy budget must be a nonnegative integer')
        if (typeof policy.automaticUSBReset !== 'boolean')
            throw new Error('Automatic USB reset must be enabled or disabled with a boolean')
        if (policy.recoverTransport !== undefined && typeof policy.recoverTransport !== 'function')
            throw new Error('Transport recovery must be an explicitly supplied callback')
        this.policy = policy
    }

    /**
     * The wait before DeviceBusy retry `retry` (0 for the first), or undefined when the retry count
     * or the time budget is spent. Delays double from the base and never exceed the transaction timeout.
     */
    deviceBusyDelay(retry: number, elapsedMilliseconds: number): number | undefined {
        const { deviceBusyRetries, deviceBusyBackoffMilliseconds, deviceBusyBudgetMilliseconds, timeoutMilliseconds } =
            this.policy
        const remainingMilliseconds = deviceBusyBudgetMilliseconds - elapsedMilliseconds
        if (retry >= deviceBusyRetries || remainingMilliseconds <= 0) return undefined
        return Math.min(timeoutMilliseconds, remainingMilliseconds, deviceBusyBackoffMilliseconds * 2 ** retry)
    }

    async send(container: Uint8Array, sessionId: number, context: PTPErrorContext): Promise<void> {
        const sent = this.transport.send(container, sessionId, context.transactionId ?? 0)
        await this.guard(sent, 'send', this.timeoutFor(container.length), context)
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
        if (raw.length < CONTAINER_HEADER_BYTES)
            throw new PTPProtocolError(
                'short-container',
                `container of ${raw.length} bytes has no complete header`,
                context
            )
        const { length: declaredLength, type, code, transactionId } = readContainerHeader(raw)
        if (declaredLength < CONTAINER_HEADER_BYTES)
            throw new PTPProtocolError('short-container', `container declares ${declaredLength} bytes`, context)
        if (raw.length < declaredLength) {
            const detail = `container declares ${declaredLength} bytes but ${raw.length} arrived`
            throw new PTPProtocolError('truncated-container', detail, context)
        }
        return {
            type,
            code,
            transactionId,
            // Bytes past the declared length are not part of the container and are ignored.
            payload: raw.slice(CONTAINER_HEADER_BYTES, declaredLength),
        }
    }

    private discardReason(container: Container, expected: ExpectedContainer): string | undefined {
        if (container.transactionId === expected.transactionId) return undefined
        // Some cameras (Leica per libgphoto2 ptp.c ptp_transaction_new) answer CloseSession with transaction 0.
        if (this.isCloseSessionReply(container, expected)) return undefined
        if (!isStale(container.transactionId, expected.transactionId)) return undefined
        return `late container for transaction ${container.transactionId} while waiting for ${expected.transactionId}`
    }

    private isCloseSessionReply(container: Container, expected: ExpectedContainer): boolean {
        return (
            expected.operationCode === CLOSE_SESSION &&
            container.type === ContainerType.RESPONSE &&
            container.transactionId === 0
        )
    }

    private check(container: Container, expected: ExpectedContainer, context: PTPErrorContext): Container {
        const allowed: number[] =
            expected.phase === 'data' ? [ContainerType.DATA, ContainerType.RESPONSE] : [ContainerType.RESPONSE]
        const fail = (reason: PTPProtocolViolation, detail: string): never => {
            throw new PTPProtocolError(reason, detail, context)
        }
        if (!allowed.includes(container.type))
            fail('unexpected-container-type', `expected a ${expected.phase} container, got type ${container.type}`)
        if (container.transactionId !== expected.transactionId && !this.isCloseSessionReply(container, expected))
            fail(
                'transaction-mismatch',
                `reply belongs to transaction ${container.transactionId}, expected ${expected.transactionId}`
            )
        const { type, code, payload } = container
        if (type === ContainerType.DATA && code !== expected.operationCode && code !== expected.dataOperationCode)
            fail(
                'operation-mismatch',
                `data belongs to opcode 0x${code.toString(16)}, expected 0x${expected.operationCode.toString(16)}`
            )
        if (type === ContainerType.RESPONSE && !isParameterBlock(payload))
            fail('unexpected-container-type', 'response has invalid UINT32 parameter framing')
        return container
    }
}
