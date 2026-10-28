import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import {
    formatCode,
    parseBytes,
    parseCode,
    type CameraProfile,
    type ProfileProperty,
    type QuirkBehaviour,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import {
    concatenateBytes,
    encodeDescriptor,
    encodeDeviceInfo,
    encodeUint16,
    encodeUint32,
    readDescriptorLayout,
} from '@transport/simulated/ptp-dataset-encoding'

const CONTAINER = { command: 1, data: 2, response: 3 } as const

const OPERATION = {
    GetDeviceInfo: 0x1001,
    OpenSession: 0x1002,
    CloseSession: 0x1003,
    GetDevicePropDesc: 0x1014,
    GetDevicePropValue: 0x1015,
    SetDevicePropValue: 0x1016,
} as const

const RESPONSE = {
    OK: 0x2001,
    InvalidTransactionID: 0x2004,
    OperationNotSupported: 0x2005,
    DevicePropNotSupported: 0x200a,
    AccessDenied: 0x200f,
    DeviceBusy: 0x2019,
    InvalidDevicePropValue: 0x201c,
    InvalidParameter: 0x201d,
    SessionAlreadyOpen: 0x201e,
} as const

const DEVICE_PROP_CHANGED = 0x4006

/** Thrown when answering a request would require data the profile does not contain. */
export class ProfileDataMissingError extends Error {
    constructor(
        readonly profileId: string,
        readonly operation: number,
        readonly parameters: number[]
    ) {
        super(
            `Profile ${profileId} has no captured response for ${formatCode(operation)}` +
                (parameters.length ? ` [${parameters.map(value => formatCode(value, 1)).join(', ')}]` : '')
        )
        this.name = 'ProfileDataMissingError'
    }
}

/** Thrown when a profile quirk records that the camera dropped off the bus for a request. */
export class SimulatedDisconnectError extends Error {
    constructor(operation: number) {
        super(`Camera disconnected without responding to ${formatCode(operation)} (recorded behaviour)`)
        this.name = 'SimulatedDisconnectError'
    }
}

interface Transaction {
    operation: number
    transactionId: number
    parameters: number[]
    data?: Uint8Array
}

interface Reply {
    code: number
    parameters?: number[]
    data?: Uint8Array
}

function sameNumbers(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * A TransportInterface that answers PTP USB containers from a CameraProfile.
 *
 * Resolution order for every request: quirk behaviours, recorded exchanges (consumed in recorded
 * order; the last match repeats), then standard answers derived from the profile's DeviceInfo and
 * property descriptors. An operation absent from a complete advertised operation list is answered
 * with OperationNotSupported; anything else the profile cannot answer raises ProfileDataMissingError.
 */
export class SimulatedTransport implements TransportInterface {
    /** Every request the profile could not answer, in order. */
    readonly missingData: ProfileDataMissingError[] = []
    /** Response codes in the order they were returned. */
    readonly responseCodes: number[] = []

    private connected = false
    private pending?: Transaction
    private outgoing: Uint8Array[] = []
    private eventHandlers = new Set<(event: PTPEvent) => void>()
    private propertyValues = new Map<number, Uint8Array>()
    private exchangeUses = new Map<RecordedExchange, number>()
    private busyResponsesSent = new Map<number, number>()
    private sessionOpen = false
    private lastTransactionId?: number
    private pendingPropertyChange?: number
    private readonly properties: Map<number, ProfileProperty>
    private readonly quirks: QuirkBehaviour[]

    constructor(readonly profile: CameraProfile) {
        this.properties = new Map(profile.properties.map(property => [parseCode(property.code), property]))
        this.quirks = profile.quirks.map(quirk => quirk.behaviour)
    }

    async connect(_device?: DeviceDescriptor): Promise<void> {
        this.connected = true
    }

    async disconnect(): Promise<void> {
        this.connected = false
        this.sessionOpen = false
        this.pending = undefined
        this.outgoing = []
    }

    isConnected(): boolean {
        return this.connected
    }

    async classRequestReset(): Promise<void> {
        this.pending = undefined
        this.outgoing = []
    }

    getType(): TransportType {
        return TransportType.USB
    }

    isLittleEndian(): boolean {
        return true
    }

    on(handler: (event: PTPEvent) => void): void {
        this.eventHandlers.add(handler)
    }

    off(handler: (event: PTPEvent) => void): void {
        this.eventHandlers.delete(handler)
    }

    async send(data: Uint8Array, _sessionId: number, _transactionId: number): Promise<void> {
        if (!this.connected) throw new Error('Simulated camera is not connected')
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const type = view.getUint16(4, true)
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)

        if (type === CONTAINER.command) {
            const parameters: number[] = []
            for (let offset = 12; offset + 4 <= data.length; offset += 4) parameters.push(view.getUint32(offset, true))
            this.pending = { operation: code, transactionId, parameters }
            this.outgoing = []
            return
        }
        if (type === CONTAINER.data && this.pending?.transactionId === transactionId) {
            this.pending.data = data.slice(12)
            return
        }
        throw new Error(`Unexpected container type ${type} for transaction ${transactionId}`)
    }

    async receive(_maxLength: number, _sessionId: number, _transactionId: number): Promise<Uint8Array> {
        if (!this.connected) throw new Error('Simulated camera is not connected')
        if (this.outgoing.length === 0 && this.pending) {
            const transaction = this.pending
            this.pending = undefined
            this.outgoing = this.containersFor(transaction, this.resolve(transaction))
        }
        const next = this.outgoing.shift()
        if (!next) throw new Error('No simulated response is pending')
        return next
    }

    private containersFor(transaction: Transaction, reply: Reply): Uint8Array[] {
        this.responseCodes.push(reply.code)
        this.trackSession(transaction, reply.code)
        this.scheduleEvents(transaction.operation, reply.code)

        const header = (length: number, type: number, code: number) =>
            concatenateBytes([
                encodeUint32(length),
                encodeUint16(type),
                encodeUint16(code),
                encodeUint32(transaction.transactionId),
            ])
        const parameters = (reply.parameters ?? []).map(encodeUint32)
        const response = concatenateBytes([
            header(12 + parameters.length * 4, CONTAINER.response, reply.code),
            ...parameters,
        ])
        if (!reply.data) return [response]
        return [
            concatenateBytes([header(12 + reply.data.length, CONTAINER.data, transaction.operation), reply.data]),
            response,
        ]
    }

    private resolve(transaction: Transaction): Reply {
        const quirkReply = this.applyQuirks(transaction)
        if (quirkReply) return quirkReply

        const exchange = this.matchExchange(transaction)
        if (exchange) {
            return {
                code: parseCode(exchange.response.code),
                parameters: exchange.response.parameters?.map(parseCode),
                data: exchange.response.data !== undefined ? parseBytes(exchange.response.data) : undefined,
            }
        }

        const standardReply = this.answerFromProfile(transaction)
        if (standardReply) return standardReply

        const advertised = this.profile.deviceInfo?.operationsSupported?.map(parseCode)
        if (advertised && !advertised.includes(transaction.operation)) return { code: RESPONSE.OperationNotSupported }

        const missing = new ProfileDataMissingError(this.profile.id, transaction.operation, transaction.parameters)
        this.missingData.push(missing)
        throw missing
    }

    private applyQuirks(transaction: Transaction): Reply | undefined {
        for (const quirk of this.quirks) {
            const reply = this.applyQuirk(quirk, transaction)
            if (reply) return reply
        }
        return undefined
    }

    private applyQuirk(quirk: QuirkBehaviour, transaction: Transaction): Reply | undefined {
        switch (quirk.kind) {
            case 'disconnect-on-request': {
                if (parseCode(quirk.operation) !== transaction.operation) return undefined
                if (quirk.parameters && !sameNumbers(quirk.parameters.map(parseCode), transaction.parameters))
                    return undefined
                this.connected = false
                this.sessionOpen = false
                throw new SimulatedDisconnectError(transaction.operation)
            }
            case 'device-busy': {
                if (parseCode(quirk.operation) !== transaction.operation) return undefined
                const sent = this.busyResponsesSent.get(transaction.operation) ?? 0
                if (sent >= quirk.times) return undefined
                this.busyResponsesSent.set(transaction.operation, sent + 1)
                return { code: RESPONSE.DeviceBusy }
            }
            case 'session-id': {
                if (transaction.operation !== OPERATION.OpenSession) return undefined
                const sessionId = transaction.parameters[0] ?? 0
                const accepted = quirk.rule === 'nonzero' ? sessionId !== 0 : sessionId === quirk.sessionId
                return accepted ? undefined : { code: RESPONSE.InvalidParameter }
            }
            case 'strict-transaction-ids': {
                const previous = this.lastTransactionId
                this.lastTransactionId = transaction.transactionId
                if (transaction.operation === OPERATION.OpenSession || previous === undefined) return undefined
                return transaction.transactionId === previous + 1 ? undefined : { code: RESPONSE.InvalidTransactionID }
            }
            default:
                return undefined
        }
    }

    private matchExchange(transaction: Transaction): RecordedExchange | undefined {
        const candidates = this.profile.exchanges.filter(exchange => {
            if (parseCode(exchange.operation) !== transaction.operation) return false
            if (exchange.parameters && !sameNumbers(exchange.parameters.map(parseCode), transaction.parameters))
                return false
            if (exchange.dataFromHost === undefined) return true
            return transaction.data !== undefined && sameBytes(parseBytes(exchange.dataFromHost), transaction.data)
        })
        if (candidates.length === 0) return undefined
        const next =
            candidates.find(candidate => !this.exchangeUses.has(candidate)) ?? candidates[candidates.length - 1]
        this.exchangeUses.set(next, (this.exchangeUses.get(next) ?? 0) + 1)
        return next
    }

    private answerFromProfile(transaction: Transaction): Reply | undefined {
        const advertised = (code: number) =>
            this.profile.deviceInfo?.operationsSupported?.map(parseCode).includes(code) ?? false

        switch (transaction.operation) {
            case OPERATION.GetDeviceInfo: {
                const deviceInfo = this.profile.deviceInfo
                if (!deviceInfo) return undefined
                const data = deviceInfo.raw !== undefined ? parseBytes(deviceInfo.raw) : encodeDeviceInfo(deviceInfo)
                return data ? { code: RESPONSE.OK, data } : undefined
            }
            case OPERATION.OpenSession:
                if (!advertised(OPERATION.OpenSession)) return undefined
                return { code: this.sessionOpen ? RESPONSE.SessionAlreadyOpen : RESPONSE.OK }
            case OPERATION.CloseSession:
                return advertised(OPERATION.CloseSession) ? { code: RESPONSE.OK } : undefined
            case OPERATION.GetDevicePropDesc:
            case OPERATION.GetDevicePropValue:
            case OPERATION.SetDevicePropValue:
                return this.answerProperty(transaction)
            default:
                return undefined
        }
    }

    private answerProperty(transaction: Transaction): Reply | undefined {
        const code = transaction.parameters[0] ?? 0
        const property = this.properties.get(code)
        const descriptor = property ? this.descriptorBytes(code, property) : undefined
        if (!descriptor) {
            const advertised = this.profile.deviceInfo?.devicePropertiesSupported?.map(parseCode)
            return advertised && !advertised.includes(code) ? { code: RESPONSE.DevicePropNotSupported } : undefined
        }

        const layout = readDescriptorLayout(descriptor)
        if (transaction.operation === OPERATION.GetDevicePropDesc) return { code: RESPONSE.OK, data: descriptor }
        if (transaction.operation === OPERATION.GetDevicePropValue) {
            return { code: RESPONSE.OK, data: descriptor.slice(layout.currentValueStart, layout.currentValueEnd) }
        }

        if (!layout.writable) return { code: RESPONSE.AccessDenied }
        const value = transaction.data
        if (!value) return { code: RESPONSE.InvalidDevicePropValue }
        if (layout.enumeration && !layout.enumeration.some(allowed => sameBytes(allowed, value))) {
            return { code: RESPONSE.InvalidDevicePropValue }
        }
        this.propertyValues.set(code, value)
        this.pendingPropertyChange = code
        return { code: RESPONSE.OK }
    }

    /** The descriptor with any value written during this session substituted for the current value. */
    private descriptorBytes(code: number, property: ProfileProperty): Uint8Array | undefined {
        const descriptor = property.descriptor
        if (!descriptor) return undefined
        const datatypeQuirk = this.quirks.find(
            quirk => quirk.kind === 'property-datatype' && parseCode(quirk.property) === code
        ) as Extract<QuirkBehaviour, { kind: 'property-datatype' }> | undefined
        const captured =
            descriptor.raw !== undefined
                ? parseBytes(descriptor.raw)
                : encodeDescriptor(code, descriptor, datatypeQuirk ? parseCode(datatypeQuirk.dataType) : undefined)
        const written = this.propertyValues.get(code)
        if (!captured || !written) return captured
        const layout = readDescriptorLayout(captured)
        return concatenateBytes([
            captured.slice(0, layout.currentValueStart),
            written,
            captured.slice(layout.currentValueEnd),
        ])
    }

    private trackSession(transaction: Transaction, responseCode: number): void {
        if (responseCode !== RESPONSE.OK) return
        if (transaction.operation === OPERATION.OpenSession) this.sessionOpen = true
        if (transaction.operation === OPERATION.CloseSession) this.sessionOpen = false
    }

    private scheduleEvents(operation: number, responseCode: number): void {
        const delivery = this.quirks.find(quirk => quirk.kind === 'event-delivery')
        if (delivery?.kind === 'event-delivery' && delivery.mode === 'polled') {
            this.pendingPropertyChange = undefined
            return
        }

        const events: PTPEvent[] = this.profile.events
            .filter(event => parseCode(event.afterOperation) === operation && responseCode === RESPONSE.OK)
            .map(event => ({
                code: parseCode(event.code),
                transactionId: 0,
                parameters: (event.parameters ?? []).map(parseCode),
            }))

        const changedProperty = this.pendingPropertyChange
        this.pendingPropertyChange = undefined
        const announcesChanges = this.profile.deviceInfo?.eventsSupported?.map(parseCode).includes(DEVICE_PROP_CHANGED)
        if (changedProperty !== undefined && announcesChanges) {
            events.push({ code: DEVICE_PROP_CHANGED, transactionId: 0, parameters: [changedProperty] })
        }
        if (events.length === 0) return
        setTimeout(() => events.forEach(event => this.eventHandlers.forEach(handler => handler(event))), 0)
    }
}
