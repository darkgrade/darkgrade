import type { PTPEvent } from '@transport/interfaces/transport.interface'
import { formatCode } from '@transport/simulated/camera-profile'
import {
    concatenateBytes,
    encodeUint16,
    encodeUint32,
    readDescriptorLayout,
} from '@transport/simulated/ptp-dataset-encoding'
import type { SimulatedRequest } from '@transport/simulated/quirk-behaviours'

/**
 * Faults a misbehaving camera, cable or firmware can produce. None of them is recorded camera
 * behaviour: chaos mode exists to show how darkgrade copes when a camera breaks the protocol.
 */
export const CHAOS_FAULTS = [
    'truncated-container',
    'oversized-container',
    'wrong-transaction-id',
    'stale-response',
    'wrong-container-type',
    'device-busy-storm',
    'session-not-open',
    'invalid-transaction-id',
    'general-error',
    'stall',
    'disconnect-mid-transaction',
    'events-out-of-order',
    'malformed-dataset',
] as const

export type ChaosFault = (typeof CHAOS_FAULTS)[number]

/** The simulated camera dropped off the bus mid-transaction because chaos mode said so. */
export class ChaosDisconnectError extends Error {
    constructor() {
        super('Simulated camera dropped off the bus mid-transaction (chaos fault)')
        this.name = 'ChaosDisconnectError'
    }
}

export interface ChaosOptions {
    /** Seeds the fault schedule; the same seed, profile and request sequence inject the same faults. */
    seed: number
    faults: readonly ChaosFault[]
    /** Chance that a transaction is disturbed, 0..1 (default 0.35). */
    probability?: number
    /** Consecutive DeviceBusy answers in one storm (default 12). */
    busyStormLength?: number
    /** Transactions answered normally before the first fault (default 0). */
    graceTransactions?: number
}

export interface InjectedFault {
    fault: ChaosFault
    transactionId: number
    operation: string
    detail: string
}

/** What one disturbed transaction looks like on the wire. */
export interface ChaosOutcome {
    containers: Uint8Array[]
    /** Events delivered synchronously, before the host sees any container. */
    eventsBeforeReply: PTPEvent[]
    /** Never answer this transaction until the transport is reset or disconnected. */
    stall: boolean
    /** Drop off the bus after delivering this many containers. */
    disconnectAfter?: number
}

const CONTAINER_TYPE = { data: 2, response: 3, event: 4 } as const
const RESPONSE = {
    GeneralError: 0x2002,
    SessionNotOpen: 0x2003,
    InvalidTransactionID: 0x2004,
    DeviceBusy: 0x2019,
} as const
const OPERATION = { GetDeviceInfo: 0x1001, OpenSession: 0x1002, CloseSession: 0x1003, GetDevicePropDesc: 0x1014 }
const EVENT = { ObjectAdded: 0x4002, DevicePropChanged: 0x4006, CaptureComplete: 0x400d, Unknown: 0xc9ff }
const RESPONSE_CODE_FAULTS: Partial<Record<ChaosFault, number>> = {
    'session-not-open': RESPONSE.SessionNotOpen,
    'invalid-transaction-id': RESPONSE.InvalidTransactionID,
    'general-error': RESPONSE.GeneralError,
}

/** mulberry32: small, fast and reproducible across runtimes. */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }
}

function containerType(container: Uint8Array): number {
    return container.length >= 6 ? new DataView(container.buffer, container.byteOffset).getUint16(4, true) : 0
}

function withHeaderField(container: Uint8Array, offset: number, bytes: Uint8Array): Uint8Array {
    const copy = container.slice()
    copy.set(bytes, offset)
    return copy
}

/**
 * Decides, per transaction, whether and how to break the simulated camera's answer. Session
 * management (OpenSession/CloseSession) is left alone unless the fault targets it, so a run
 * exercises the operations a client issues after connecting as well as connecting itself.
 */
export class ChaosInjector {
    readonly injected: InjectedFault[] = []
    enabled = true

    private readonly random: () => number
    private readonly probability: number
    private readonly busyStormLength: number
    private transactionsSeen = 0
    private busyRemaining = 0
    private previousTransactionId?: number

    constructor(private readonly options: ChaosOptions) {
        this.random = seededRandom(options.seed)
        this.probability = options.probability ?? 0.35
        this.busyStormLength = options.busyStormLength ?? 12
    }

    private pick<T>(values: readonly T[]): T {
        return values[Math.floor(this.random() * values.length)]
    }

    private record(fault: ChaosFault, request: SimulatedRequest, detail: string): void {
        this.injected.push({
            fault,
            transactionId: request.transactionId,
            operation: formatCode(request.operation),
            detail,
        })
    }

    /** A response code that replaces the camera's real answer, or undefined. */
    responseOverride(request: SimulatedRequest): number | undefined {
        if (!this.enabled) return undefined
        if (this.busyRemaining > 0) {
            this.busyRemaining--
            this.record('device-busy-storm', request, `DeviceBusy (${this.busyRemaining} left in storm)`)
            return RESPONSE.DeviceBusy
        }
        const fault = this.chooseFault(request, ['device-busy-storm', ...Object.keys(RESPONSE_CODE_FAULTS)])
        if (!fault) return undefined
        if (fault === 'device-busy-storm') {
            this.busyRemaining = this.busyStormLength - 1
            this.record(fault, request, `DeviceBusy storm of ${this.busyStormLength}`)
            return RESPONSE.DeviceBusy
        }
        const code = RESPONSE_CODE_FAULTS[fault]!
        this.record(fault, request, `answered ${formatCode(code)}`)
        return code
    }

    /** Rewrites the containers that answer one transaction. */
    disturb(request: SimulatedRequest, containers: Uint8Array[], recordedEvents: PTPEvent[]): ChaosOutcome {
        const previousTransactionId = this.previousTransactionId
        this.previousTransactionId = request.transactionId
        const outcome: ChaosOutcome = { containers, eventsBeforeReply: [], stall: false }
        if (!this.enabled) return outcome
        const fault = this.chooseFault(
            request,
            CHAOS_FAULTS.filter(candidate => !(candidate in RESPONSE_CODE_FAULTS) && candidate !== 'device-busy-storm')
        )
        if (!fault) return outcome

        switch (fault) {
            case 'truncated-container':
                return { ...outcome, containers: this.truncate(request, containers) }
            case 'oversized-container':
                return { ...outcome, containers: this.oversize(request, containers) }
            case 'wrong-transaction-id':
                return { ...outcome, containers: this.wrongTransactionId(request, containers) }
            case 'stale-response':
                return { ...outcome, containers: this.staleResponse(request, containers, previousTransactionId) }
            case 'wrong-container-type':
                return { ...outcome, containers: this.wrongContainerType(request, containers) }
            case 'stall':
                this.record(fault, request, 'no answer until the transport is reset')
                return { ...outcome, containers: [], stall: true }
            case 'disconnect-mid-transaction': {
                const disconnectAfter = Math.floor(this.random() * containers.length)
                this.record(fault, request, `disconnected after ${disconnectAfter}/${containers.length} containers`)
                return { ...outcome, disconnectAfter }
            }
            case 'events-out-of-order':
                return { ...outcome, eventsBeforeReply: this.disorderedEvents(request, recordedEvents) }
            case 'malformed-dataset':
                return { ...outcome, containers: this.malformDataset(request, containers) }
            default:
                return outcome
        }
    }

    private chooseFault(request: SimulatedRequest, eligible: readonly string[]): ChaosFault | undefined {
        if (this.options.faults.length === 0) return undefined
        const candidates = this.options.faults.filter(fault => eligible.includes(fault))
        if (candidates.length === 0) return undefined
        if (request.operation === OPERATION.CloseSession) return undefined
        this.transactionsSeen++
        if (this.transactionsSeen <= (this.options.graceTransactions ?? 0)) return undefined
        if (this.random() >= this.probability) return undefined
        return this.pick(candidates)
    }

    private truncate(request: SimulatedRequest, containers: Uint8Array[]): Uint8Array[] {
        const index = this.random() < 0.5 && containers.length > 1 ? 0 : containers.length - 1
        const target = containers[index]
        const keep = Math.floor(this.random() * target.length)
        this.record('truncated-container', request, `container ${index} cut to ${keep}/${target.length} bytes`)
        return containers.map((container, position) => (position === index ? container.slice(0, keep) : container))
    }

    private oversize(request: SimulatedRequest, containers: Uint8Array[]): Uint8Array[] {
        const index = Math.floor(this.random() * containers.length)
        const extra = new Uint8Array(1 + Math.floor(this.random() * 64)).map(() => Math.floor(this.random() * 256))
        this.record('oversized-container', request, `${extra.length} bytes after container ${index}`)
        return containers.map((container, position) =>
            position === index ? concatenateBytes([container, extra]) : container
        )
    }

    private wrongTransactionId(request: SimulatedRequest, containers: Uint8Array[]): Uint8Array[] {
        const transactionId = this.pick([0, request.transactionId + 1, request.transactionId + 1000, 0xffffffff])
        this.record('wrong-transaction-id', request, `answered as transaction ${transactionId}`)
        return containers.map(container => withHeaderField(container, 8, encodeUint32(transactionId)))
    }

    private staleResponse(
        request: SimulatedRequest,
        containers: Uint8Array[],
        previousTransactionId: number | undefined
    ): Uint8Array[] {
        const staleTransactionId = previousTransactionId ?? Math.max(0, request.transactionId - 1)
        const stale = concatenateBytes([
            encodeUint32(12),
            encodeUint16(CONTAINER_TYPE.response),
            encodeUint16(0x2001),
            encodeUint32(staleTransactionId),
        ])
        this.record('stale-response', request, `late OK for transaction ${staleTransactionId} arrived first`)
        return [stale, ...containers]
    }

    private wrongContainerType(request: SimulatedRequest, containers: Uint8Array[]): Uint8Array[] {
        const index = Math.floor(this.random() * containers.length)
        const current = containerType(containers[index])
        const replacement =
            current === CONTAINER_TYPE.data
                ? CONTAINER_TYPE.response
                : this.pick([CONTAINER_TYPE.data, CONTAINER_TYPE.event, 0x0007])
        this.record('wrong-container-type', request, `container ${index} typed ${replacement} instead of ${current}`)
        return containers.map((container, position) =>
            position === index ? withHeaderField(container, 4, encodeUint16(replacement)) : container
        )
    }

    private disorderedEvents(request: SimulatedRequest, recordedEvents: PTPEvent[]): PTPEvent[] {
        const handle = 0x1000 + Math.floor(this.random() * 0x1000)
        const events: PTPEvent[] = [
            ...[...recordedEvents].reverse(),
            { code: EVENT.CaptureComplete, transactionId: request.transactionId, parameters: [request.transactionId] },
            { code: EVENT.ObjectAdded, transactionId: 0, parameters: [handle] },
            { code: EVENT.ObjectAdded, transactionId: 0, parameters: [handle] },
            { code: EVENT.DevicePropChanged, transactionId: 0, parameters: [0xdfff] },
            { code: EVENT.DevicePropChanged, transactionId: 0, parameters: [] },
            { code: EVENT.Unknown, transactionId: 0, parameters: [1, 2, 3, 4, 5] },
        ]
        this.record('events-out-of-order', request, `${events.length} events before the reply, completion first`)
        return events
    }

    private malformDataset(request: SimulatedRequest, containers: Uint8Array[]): Uint8Array[] {
        const index = containers.findIndex(container => containerType(container) === CONTAINER_TYPE.data)
        if (index < 0) return containers
        const container = containers[index]
        const payload = container.slice(12)
        const malformed = this.malformPayload(request, payload)
        const rebuilt = concatenateBytes([encodeUint32(12 + malformed.length), container.slice(4, 12), malformed])
        return containers.map((original, position) => (position === index ? rebuilt : original))
    }

    private malformPayload(request: SimulatedRequest, payload: Uint8Array): Uint8Array {
        const copy = payload.slice()
        if (request.operation === OPERATION.GetDeviceInfo && copy.length > 8) {
            copy[8] = 0xff
            this.record('malformed-dataset', request, 'VendorExtensionDesc string length 255 overruns the dataset')
            return copy
        }
        if (request.operation === OPERATION.GetDevicePropDesc && copy.length >= 5) {
            return this.malformDescriptor(request, copy)
        }
        if (copy.length >= 4) {
            copy.set(encodeUint32(0xffffffff), 0)
            this.record('malformed-dataset', request, 'leading count/length field set to 0xFFFFFFFF')
            return copy
        }
        this.record('malformed-dataset', request, 'empty dataset')
        return new Uint8Array()
    }

    private malformDescriptor(request: SimulatedRequest, descriptor: Uint8Array): Uint8Array {
        const view = new DataView(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength)
        const variant = this.pick(['datatype', 'value-outside-form', 'string-length'] as const)
        if (variant === 'datatype') {
            const original = view.getUint16(2, true)
            const replacement = this.pick([0x0000, 0x0009, 0x4006, 0xfffe])
            view.setUint16(2, replacement, true)
            this.record(
                'malformed-dataset',
                request,
                `datatype ${formatCode(original)} reported as ${formatCode(replacement)}`
            )
            return descriptor
        }
        if (variant === 'string-length') {
            descriptor[5] = 0xfe
            this.record('malformed-dataset', request, 'factory default length byte set to 0xFE')
            return descriptor
        }
        try {
            const layout = readDescriptorLayout(descriptor)
            descriptor.fill(0xee, layout.currentValueStart, layout.currentValueEnd)
            this.record('malformed-dataset', request, 'current value 0xEE… is outside the advertised form')
        } catch {
            descriptor.fill(0xee, 5)
            this.record('malformed-dataset', request, 'values and form replaced with 0xEE')
        }
        return descriptor
    }
}
