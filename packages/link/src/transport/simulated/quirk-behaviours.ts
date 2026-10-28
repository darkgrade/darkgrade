import type { PTPEvent } from '@transport/interfaces/transport.interface'
import { formatCode, parseCode, type OperationRange, type QuirkBehaviour } from '@transport/simulated/camera-profile'

const OPEN_SESSION = 0x1002
const OK = 0x2001
const DEVICE_BUSY = 0x2019
const INVALID_PARAMETER = 0x201d
const INVALID_TRANSACTION_ID = 0x2004

export interface SimulatedRequest {
    operation: number
    transactionId: number
    parameters: number[]
    data?: Uint8Array
}

/** Thrown when a profile quirk records that the camera dropped off the bus for a request. */
export class SimulatedDisconnectError extends Error {
    constructor(operation: number) {
        super(`Camera disconnected without responding to ${formatCode(operation)} (recorded behaviour)`)
        this.name = 'SimulatedDisconnectError'
    }
}

function sameNumbers(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
}

function inRange(code: number, range: OperationRange): boolean {
    if (range.except?.map(parseCode).includes(code)) return false
    return code >= parseCode(range.from) && code <= parseCode(range.to)
}

type Behaviour<Kind extends QuirkBehaviour['kind']> = Extract<QuirkBehaviour, { kind: Kind }>

/**
 * Applies a profile's quirk behaviours around each simulated transaction. Holds the per-session
 * state the behaviours need: busy counters, unlocked operations and transaction ordering.
 */
export class QuirkBehaviours {
    private busyResponsesSent = new Map<Behaviour<'device-busy'>, number>()
    private busyArmed = new Set<Behaviour<'device-busy'>>()
    private succeededOperations = new Set<number>()
    private lastTransactionId?: number

    constructor(private readonly behaviours: QuirkBehaviour[]) {}

    private all<Kind extends QuirkBehaviour['kind']>(kind: Kind): Behaviour<Kind>[] {
        return this.behaviours.filter((behaviour): behaviour is Behaviour<Kind> => behaviour.kind === kind)
    }

    /** A response code that pre-empts normal handling, or undefined. Throws for a recorded disconnect. */
    responseBefore(request: SimulatedRequest): number | undefined {
        for (const behaviour of this.behaviours) {
            const code = this.responseFor(behaviour, request)
            if (code !== undefined) return code
        }
        return undefined
    }

    private responseFor(behaviour: QuirkBehaviour, request: SimulatedRequest): number | undefined {
        const { operation } = request
        switch (behaviour.kind) {
            case 'disconnect-on-request':
                if (parseCode(behaviour.operation) !== operation) return undefined
                if (behaviour.parameters && !sameNumbers(behaviour.parameters.map(parseCode), request.parameters))
                    return undefined
                throw new SimulatedDisconnectError(operation)
            case 'rejects-operations':
                return behaviour.operations.map(parseCode).includes(operation)
                    ? parseCode(behaviour.response)
                    : undefined
            case 'requires-operations': {
                if (!inRange(operation, behaviour.gated)) return undefined
                const unlocked = behaviour.unlockedBy.every(code => this.succeededOperations.has(parseCode(code)))
                return unlocked ? undefined : parseCode(behaviour.response)
            }
            case 'device-busy':
                return this.busyResponse(behaviour, operation)
            case 'session-id': {
                if (operation !== OPEN_SESSION) return undefined
                const sessionId = request.parameters[0] ?? 0
                const accepted = behaviour.rule === 'nonzero' ? sessionId !== 0 : sessionId === behaviour.sessionId
                return accepted ? undefined : INVALID_PARAMETER
            }
            case 'strict-transaction-ids': {
                const previous = this.lastTransactionId
                this.lastTransactionId = request.transactionId
                if (operation === OPEN_SESSION || previous === undefined) return undefined
                return request.transactionId === previous + 1 ? undefined : INVALID_TRANSACTION_ID
            }
            default:
                return undefined
        }
    }

    private busyResponse(behaviour: Behaviour<'device-busy'>, operation: number): number | undefined {
        if (parseCode(behaviour.operation) !== operation) return undefined
        if (behaviour.afterOperation && !this.busyArmed.has(behaviour)) return undefined
        const sent = this.busyResponsesSent.get(behaviour) ?? 0
        if (sent >= behaviour.times) return undefined
        this.busyResponsesSent.set(behaviour, sent + 1)
        return behaviour.response ? parseCode(behaviour.response) : DEVICE_BUSY
    }

    /** Records a reply and returns the events quirks emit because of it. */
    afterReply(request: SimulatedRequest, responseCode: number): PTPEvent[] {
        if (responseCode !== OK) return []
        this.succeededOperations.add(request.operation)
        for (const behaviour of this.all('device-busy')) {
            if (!behaviour.afterOperation || parseCode(behaviour.afterOperation) !== request.operation) continue
            this.busyArmed.add(behaviour)
            this.busyResponsesSent.set(behaviour, 0)
        }
        return this.all('emit-event')
            .filter(behaviour => parseCode(behaviour.afterOperation) === request.operation)
            .map(behaviour => ({
                code: parseCode(behaviour.event),
                transactionId: 0,
                parameters: behaviour.copyParameters ? request.parameters : [],
            }))
    }

    /** Codes the camera implements but leaves out of DeviceInfo. */
    hiddenCodes(): { operations: Set<number>; properties: Set<number> } {
        const hidden = this.all('hidden-from-device-info')
        return {
            operations: new Set(hidden.flatMap(behaviour => (behaviour.operations ?? []).map(parseCode))),
            properties: new Set(hidden.flatMap(behaviour => (behaviour.properties ?? []).map(parseCode))),
        }
    }

    polledDelivery(): Behaviour<'event-delivery'> | undefined {
        return this.all('event-delivery').find(behaviour => behaviour.mode === 'polled')
    }

    dataTypeOverride(property: number): number | undefined {
        const override = this.all('property-datatype').find(behaviour => parseCode(behaviour.property) === property)
        return override ? parseCode(override.dataType) : undefined
    }

    /** Forgets session state after a recorded disconnect or a transport disconnect. */
    reset(): void {
        this.succeededOperations.clear()
        this.busyArmed.clear()
        this.busyResponsesSent.clear()
        this.lastTransactionId = undefined
    }
}
