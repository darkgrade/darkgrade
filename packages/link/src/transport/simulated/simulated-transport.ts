import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import {
    formatCode,
    parseBytes,
    parseCode,
    type CameraProfile,
    type ProfileProperty,
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
import { QuirkBehaviours, SimulatedDisconnectError, type SimulatedRequest } from '@transport/simulated/quirk-behaviours'

export { SimulatedDisconnectError }

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
    OperationNotSupported: 0x2005,
    DevicePropNotSupported: 0x200a,
    AccessDenied: 0x200f,
    InvalidDevicePropValue: 0x201c,
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
 * property descriptors. A code absent from a DeviceInfo whose lists are marked complete is answered
 * with OperationNotSupported or DevicePropNotSupported; anything else the profile cannot answer
 * raises ProfileDataMissingError instead of inventing a response.
 */
export class SimulatedTransport implements TransportInterface {
    /** Every request the profile could not answer, in order. */
    readonly missingData: ProfileDataMissingError[] = []
    /** Response codes in the order they were returned. */
    readonly responseCodes: number[] = []

    private connected = false
    private pending?: SimulatedRequest
    private outgoing: Uint8Array[] = []
    private eventHandlers = new Set<(event: PTPEvent) => void>()
    private propertyValues = new Map<number, Uint8Array>()
    private exchangeUses = new Set<RecordedExchange>()
    private sessionOpen = false
    private changedProperty?: number
    private readonly properties: Map<number, ProfileProperty>
    private readonly quirks: QuirkBehaviours

    constructor(readonly profile: CameraProfile) {
        this.properties = new Map(profile.properties.map(property => [parseCode(property.code), property]))
        this.quirks = new QuirkBehaviours(profile.quirks.map(quirk => quirk.behaviour))
    }

    async connect(_device?: DeviceDescriptor): Promise<void> {
        this.connected = true
    }

    async disconnect(): Promise<void> {
        this.connected = false
        this.sessionOpen = false
        this.pending = undefined
        this.outgoing = []
        this.quirks.reset()
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
            const request = this.pending
            this.pending = undefined
            this.outgoing = this.containersFor(request, this.resolve(request))
        }
        const next = this.outgoing.shift()
        if (!next) throw new Error('No simulated response is pending')
        return next
    }

    private containersFor(request: SimulatedRequest, reply: Reply): Uint8Array[] {
        this.responseCodes.push(reply.code)
        if (reply.code === RESPONSE.OK && request.operation === OPERATION.OpenSession) this.sessionOpen = true
        if (reply.code === RESPONSE.OK && request.operation === OPERATION.CloseSession) this.sessionOpen = false
        this.deliver([
            ...this.recordedEventsAfter(request.operation, reply.code),
            ...this.quirks.afterReply(request, reply.code),
        ])

        const header = (length: number, type: number, code: number) =>
            concatenateBytes([
                encodeUint32(length),
                encodeUint16(type),
                encodeUint16(code),
                encodeUint32(request.transactionId),
            ])
        const parameters = (reply.parameters ?? []).map(encodeUint32)
        const response = concatenateBytes([
            header(12 + parameters.length * 4, CONTAINER.response, reply.code),
            ...parameters,
        ])
        if (!reply.data) return [response]
        return [
            concatenateBytes([header(12 + reply.data.length, CONTAINER.data, request.operation), reply.data]),
            response,
        ]
    }

    private resolve(request: SimulatedRequest): Reply {
        let quirkCode: number | undefined
        try {
            quirkCode = this.quirks.responseBefore(request)
        } catch (error) {
            if (error instanceof SimulatedDisconnectError) void this.disconnect()
            throw error
        }
        if (quirkCode !== undefined) return { code: quirkCode }

        const exchange = this.matchExchange(request)
        if (exchange) {
            return {
                code: parseCode(exchange.response.code),
                parameters: exchange.response.parameters?.map(parseCode),
                data: exchange.response.data !== undefined ? parseBytes(exchange.response.data) : undefined,
            }
        }

        const standardReply = this.answerFromProfile(request)
        if (standardReply) return standardReply

        if (this.completeList('operationsSupported') && !this.advertises(request.operation)) {
            return { code: RESPONSE.OperationNotSupported }
        }

        const missing = new ProfileDataMissingError(this.profile.id, request.operation, request.parameters)
        this.missingData.push(missing)
        throw missing
    }

    private completeList(list: 'operationsSupported' | 'devicePropertiesSupported'): string[] | undefined {
        const deviceInfo = this.profile.deviceInfo
        return deviceInfo?.listsComplete ? deviceInfo[list] : undefined
    }

    private advertises(operation: number): boolean {
        return this.profile.deviceInfo?.operationsSupported?.map(parseCode).includes(operation) ?? false
    }

    private matchExchange(request: SimulatedRequest): RecordedExchange | undefined {
        const candidates = this.profile.exchanges.filter(exchange => {
            if (parseCode(exchange.operation) !== request.operation) return false
            if (exchange.parameters && !sameNumbers(exchange.parameters.map(parseCode), request.parameters))
                return false
            if (exchange.dataFromHost === undefined) return true
            return request.data !== undefined && sameBytes(parseBytes(exchange.dataFromHost), request.data)
        })
        const next = candidates.find(candidate => !this.exchangeUses.has(candidate)) ?? candidates.at(-1)
        if (next) this.exchangeUses.add(next)
        return next
    }

    private answerFromProfile(request: SimulatedRequest): Reply | undefined {
        switch (request.operation) {
            case OPERATION.GetDeviceInfo: {
                const data = this.deviceInfoBytes()
                return data ? { code: RESPONSE.OK, data } : undefined
            }
            case OPERATION.OpenSession:
                if (!this.advertises(OPERATION.OpenSession)) return undefined
                return { code: this.sessionOpen ? RESPONSE.SessionAlreadyOpen : RESPONSE.OK }
            case OPERATION.CloseSession:
                return this.advertises(OPERATION.CloseSession) ? { code: RESPONSE.OK } : undefined
            case OPERATION.GetDevicePropDesc:
            case OPERATION.GetDevicePropValue:
            case OPERATION.SetDevicePropValue:
                return this.answerProperty(request)
        }
        const polled = this.quirks.polledDelivery()
        if (
            polled?.emptyResponse !== undefined &&
            polled.pollOperation &&
            parseCode(polled.pollOperation) === request.operation
        ) {
            return { code: RESPONSE.OK, data: parseBytes(polled.emptyResponse) }
        }
        return undefined
    }

    private deviceInfoBytes(): Uint8Array | undefined {
        const deviceInfo = this.profile.deviceInfo
        if (!deviceInfo) return undefined
        if (deviceInfo.raw !== undefined) return parseBytes(deviceInfo.raw)
        const hidden = this.quirks.hiddenCodes()
        const visible = (codes: string[] | undefined, hiddenCodes: Set<number>) =>
            codes?.filter(code => !hiddenCodes.has(parseCode(code)))
        return encodeDeviceInfo({
            ...deviceInfo,
            operationsSupported: visible(deviceInfo.operationsSupported, hidden.operations),
            devicePropertiesSupported: visible(deviceInfo.devicePropertiesSupported, hidden.properties),
        })
    }

    private answerProperty(request: SimulatedRequest): Reply | undefined {
        const code = request.parameters[0] ?? 0
        const property = this.properties.get(code)
        const descriptor = property ? this.descriptorBytes(code, property) : undefined
        if (!descriptor) {
            const advertised = this.completeList('devicePropertiesSupported')?.map(parseCode)
            return advertised && !advertised.includes(code) ? { code: RESPONSE.DevicePropNotSupported } : undefined
        }

        const layout = readDescriptorLayout(descriptor)
        if (request.operation === OPERATION.GetDevicePropDesc) return { code: RESPONSE.OK, data: descriptor }
        if (request.operation === OPERATION.GetDevicePropValue) {
            return { code: RESPONSE.OK, data: descriptor.slice(layout.currentValueStart, layout.currentValueEnd) }
        }

        if (!layout.writable) return { code: RESPONSE.AccessDenied }
        const value = request.data
        if (!value) return { code: RESPONSE.InvalidDevicePropValue }
        if (layout.enumeration && !layout.enumeration.some(allowed => sameBytes(allowed, value))) {
            return { code: RESPONSE.InvalidDevicePropValue }
        }
        this.propertyValues.set(code, value)
        this.changedProperty = code
        return { code: RESPONSE.OK }
    }

    /** The descriptor with any value written during this session substituted for the current value. */
    private descriptorBytes(code: number, property: ProfileProperty): Uint8Array | undefined {
        const descriptor = property.descriptor
        if (!descriptor) return undefined
        const captured =
            descriptor.raw !== undefined
                ? parseBytes(descriptor.raw)
                : encodeDescriptor(code, descriptor, this.quirks.dataTypeOverride(code))
        const written = this.propertyValues.get(code)
        if (!captured || !written) return captured
        const layout = readDescriptorLayout(captured)
        return concatenateBytes([
            captured.slice(0, layout.currentValueStart),
            written,
            captured.slice(layout.currentValueEnd),
        ])
    }

    private recordedEventsAfter(operation: number, responseCode: number): PTPEvent[] {
        const changedProperty = this.changedProperty
        this.changedProperty = undefined
        if (responseCode !== RESPONSE.OK || this.quirks.polledDelivery()) return []

        const events: PTPEvent[] = this.profile.events
            .filter(event => parseCode(event.afterOperation) === operation)
            .map(event => ({
                code: parseCode(event.code),
                transactionId: 0,
                parameters: (event.parameters ?? []).map(parseCode),
            }))
        const announcesChanges = this.profile.deviceInfo?.eventsSupported?.map(parseCode).includes(DEVICE_PROP_CHANGED)
        if (changedProperty !== undefined && announcesChanges) {
            events.push({ code: DEVICE_PROP_CHANGED, transactionId: 0, parameters: [changedProperty] })
        }
        return events
    }

    private deliver(events: PTPEvent[]): void {
        if (events.length === 0) return
        setTimeout(() => events.forEach(event => this.eventHandlers.forEach(handler => handler(event))), 0)
    }
}
