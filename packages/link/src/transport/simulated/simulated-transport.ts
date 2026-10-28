import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import {
    formatCode,
    parseBytes,
    parseCode,
    ptpIpPersonality,
    validateCameraProfile,
    type CameraProfile,
    type ProfileProperty,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import {
    concatenateBytes,
    descriptorAcceptsValue,
    encodeDescriptor,
    encodeDeviceInfo,
    encodeUint16,
    encodeUint32,
    readDescriptorLayout,
} from '@transport/simulated/ptp-dataset-encoding'
import {
    QuirkBehaviours,
    sameValues,
    SimulatedDisconnectError,
    type SimulatedRequest,
} from '@transport/simulated/quirk-behaviours'

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
    SessionNotOpen: 0x2003,
    OperationNotSupported: 0x2005,
    DevicePropNotSupported: 0x200a,
    AccessDenied: 0x200f,
    InvalidDevicePropValue: 0x201c,
    InvalidParameter: 0x201d,
    SessionAlreadyOpen: 0x201e,
} as const

const DEVICE_PROP_CHANGED = 0x4006
const SESSION_OPERATIONS = new Set<number>([0x1003, 0x1014, 0x1015, 0x1016])

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

/** A recorded exchange with its codes and bytes parsed once. */
interface ParsedExchange {
    operation: number
    parameters?: number[]
    dataFromHost?: Uint8Array
    reply: Reply
}

function parseExchange(exchange: RecordedExchange): ParsedExchange {
    const { response } = exchange
    return {
        operation: parseCode(exchange.operation),
        parameters: exchange.parameters?.map(parseCode),
        dataFromHost: exchange.dataFromHost !== undefined ? parseBytes(exchange.dataFromHost) : undefined,
        reply: {
            code: parseCode(response.code),
            parameters: response.parameters?.map(parseCode),
            data: response.data !== undefined ? parseBytes(response.data) : undefined,
        },
    }
}

export interface SimulatedTransportOptions {
    /**
     * The link the camera is reached over. "ptp-ip" applies the profile's `ptp-ip-personality`
     * DeviceInfo fields; SimulatedPtpIpCamera serves the transport over TCP in that mode.
     */
    connection?: 'usb' | 'ptp-ip'
}

const codeSet = (codes: string[] | undefined) => (codes ? new Set(codes.map(parseCode)) : undefined)

/**
 * A TransportInterface that answers PTP USB containers from a CameraProfile.
 *
 * Active quirks and known session state guard every request. Exact captured requests outrank
 * wildcard captures; equally specific replies replay in order and the last one repeats. Successful
 * standard writes update readback and obey descriptor datatype/range/choices; a capture without
 * request bytes cannot prove an arbitrary write succeeded. Settings persist across connections,
 * while trace cursors, pending events and session prerequisites reset. Unverified quirks stay inert.
 * A code absent from a DeviceInfo whose lists are marked complete is answered
 * with OperationNotSupported or DevicePropNotSupported; anything else the profile cannot answer
 * raises ProfileDataMissingError instead of inventing a response. Hidden-but-implemented codes
 * are excluded from absence-based rejection. Partial snapshots start with unknown session state;
 * an observed open/close/reset establishes the standard session lifecycle.
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
    private exchangeUses = new Set<ParsedExchange>()
    private sessionOpen = false
    /** Partial captures may begin inside an existing session; closure is enforced once observed. */
    private sessionStateKnown = false
    private changedProperty?: number
    private eventGeneration = 0
    private pendingPolledEvents = false
    private readonly properties: Map<number, ProfileProperty>
    private readonly exchanges: ParsedExchange[]
    private readonly quirks: QuirkBehaviours
    private readonly advertisedOperations: Set<number>
    /** Only set when the DeviceInfo lists are the camera's complete lists. */
    private readonly completeOperations?: Set<number>
    private readonly completeProperties?: Set<number>
    private readonly announcesPropertyChanges: boolean
    private readonly hiddenOperations: Set<number>
    private readonly hiddenProperties: Set<number>

    constructor(
        readonly profile: CameraProfile,
        private readonly options: SimulatedTransportOptions = {}
    ) {
        const problems = validateCameraProfile(profile)
        if (problems.length) throw new Error(`Invalid simulated profile ${profile.id}: ${problems.join('; ')}`)
        const deviceInfo = profile.deviceInfo
        this.properties = new Map(profile.properties.map(property => [parseCode(property.code), property]))
        this.exchanges = profile.exchanges.map(parseExchange)
        this.quirks = new QuirkBehaviours(
            profile.quirks.filter(quirk => !quirk.unverified).map(quirk => quirk.behaviour)
        )
        const hidden = this.quirks.hiddenCodes()
        this.hiddenOperations = hidden.operations
        this.hiddenProperties = hidden.properties
        this.advertisedOperations = codeSet(deviceInfo?.operationsSupported) ?? new Set()
        if (deviceInfo?.listsComplete) {
            this.completeOperations = this.advertisedOperations
            this.completeProperties = codeSet(deviceInfo.devicePropertiesSupported)
        }
        this.announcesPropertyChanges = codeSet(deviceInfo?.eventsSupported)?.has(DEVICE_PROP_CHANGED) ?? false
    }

    async connect(_device?: DeviceDescriptor): Promise<void> {
        this.connected = true
    }

    async disconnect(): Promise<void> {
        this.connected = false
        this.pending = undefined
        this.outgoing = []
        this.resetSession()
    }

    isConnected(): boolean {
        return this.connected
    }

    async classRequestReset(): Promise<void> {
        this.pending = undefined
        this.outgoing = []
        this.resetSession()
    }

    private resetSession(): void {
        this.sessionOpen = false
        this.sessionStateKnown = true
        this.changedProperty = undefined
        this.pendingPolledEvents = false
        this.exchangeUses.clear()
        this.eventGeneration++
        this.quirks.reset()
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
        if (data.length < 12) throw new Error('Truncated PTP container header')
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        if (view.getUint32(0, true) !== data.length) throw new Error('PTP container length does not match its bytes')
        const type = view.getUint16(4, true)
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)

        if (type === CONTAINER.command) {
            if ((data.length - 12) % 4 || data.length > 32)
                throw new Error('PTP commands accept at most five UINT32 parameters')
            if (this.pending || this.outgoing.length)
                throw new Error('Previous simulated transaction has not been drained')
            const parameters: number[] = []
            for (let offset = 12; offset + 4 <= data.length; offset += 4) parameters.push(view.getUint32(offset, true))
            this.pending = { operation: code, transactionId, parameters }
            return
        }
        if (type === CONTAINER.data && this.pending?.transactionId === transactionId) {
            if (code !== this.pending.operation) throw new Error('PTP data operation does not match its command')
            if (this.pending.data !== undefined) throw new Error('Duplicate PTP data container')
            this.pending.data = data.slice(12)
            return
        }
        throw new Error(`Unexpected container type ${type} for transaction ${transactionId}`)
    }

    async receive(maxLength: number, _sessionId: number, _transactionId: number): Promise<Uint8Array> {
        if (!this.connected) throw new Error('Simulated camera is not connected')
        if (!Number.isSafeInteger(maxLength) || maxLength < 1)
            throw new Error('Receive length must be a positive integer')
        if (this.outgoing.length === 0 && this.pending) {
            const request = this.pending
            this.pending = undefined
            this.outgoing = this.containersFor(request, this.resolve(request))
        }
        const next = this.outgoing.shift()
        if (!next) throw new Error('No simulated response is pending')
        if (next.length <= maxLength) return next
        this.outgoing.unshift(next.slice(maxLength))
        return next.slice(0, maxLength)
    }

    private containersFor(request: SimulatedRequest, reply: Reply): Uint8Array[] {
        this.responseCodes.push(reply.code)
        if (reply.code === RESPONSE.OK && request.operation === OPERATION.SetDevicePropValue && request.data) {
            this.propertyValues.set(request.parameters[0], request.data.slice())
            this.changedProperty = request.parameters[0]
        }
        if (
            request.operation === OPERATION.OpenSession &&
            (reply.code === RESPONSE.OK || reply.code === RESPONSE.SessionAlreadyOpen)
        ) {
            this.sessionOpen = true
            this.sessionStateKnown = true
        }
        if (reply.code === RESPONSE.SessionNotOpen) this.resetSession()
        if (reply.code === RESPONSE.OK && request.operation === OPERATION.CloseSession) this.resetSession()
        const events = [
            ...this.recordedEventsAfter(request.operation, reply.code),
            ...this.quirks.afterReply(request, reply.code),
        ]
        if (this.quirks.polledDelivery()) this.pendingPolledEvents ||= events.length > 0
        else this.deliver(events)

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

        if (!this.validStandardParameters(request)) return { code: RESPONSE.InvalidParameter }
        if (request.operation === OPERATION.OpenSession && this.sessionOpen)
            return { code: RESPONSE.SessionAlreadyOpen }
        if (this.sessionStateKnown && !this.sessionOpen && SESSION_OPERATIONS.has(request.operation))
            return { code: RESPONSE.SessionNotOpen }

        if (this.quirks.hasUnknownSequenceResponse(request)) return this.missingReply(request)

        const code = request.parameters[0]
        const propertyWrite = request.operation === OPERATION.SetDevicePropValue
        const changedPropertyRead =
            this.propertyValues.has(code) &&
            (request.operation === OPERATION.GetDevicePropDesc || request.operation === OPERATION.GetDevicePropValue)
        if (changedPropertyRead && request.operation === OPERATION.GetDevicePropValue)
            return { code: RESPONSE.OK, data: this.propertyValues.get(code) }
        if (changedPropertyRead) return this.answerProperty(request) ?? this.missingReply(request)

        const exchange = this.matchExchange(request)
        if (exchange && (!propertyWrite || exchange.reply.code !== RESPONSE.OK)) return exchange.reply

        if (propertyWrite) {
            const derived = this.answerProperty(request)
            if (derived) return derived
            if (exchange) return exchange.reply
        }

        const standardReply = this.answerFromProfile(request)
        if (standardReply) return standardReply

        if (
            this.completeOperations &&
            !this.completeOperations.has(request.operation) &&
            !this.hiddenOperations.has(request.operation)
        ) {
            return { code: RESPONSE.OperationNotSupported }
        }

        return this.missingReply(request)
    }

    private validStandardParameters(request: SimulatedRequest): boolean {
        switch (request.operation) {
            case OPERATION.OpenSession:
                return request.parameters.length === 1 && request.parameters[0] !== 0 && request.data === undefined
            case OPERATION.CloseSession:
            case OPERATION.GetDeviceInfo:
                return request.parameters.length === 0 && request.data === undefined
            case OPERATION.GetDevicePropDesc:
            case OPERATION.GetDevicePropValue:
                return request.parameters.length === 1 && request.data === undefined
            case OPERATION.SetDevicePropValue:
                return request.parameters.length === 1
            default:
                return true
        }
    }

    private missingReply(request: SimulatedRequest): never {
        const missing = new ProfileDataMissingError(this.profile.id, request.operation, request.parameters)
        this.missingData.push(missing)
        throw missing
    }

    private matchExchange(request: SimulatedRequest): ParsedExchange | undefined {
        const candidates = this.exchanges.filter(exchange => {
            if (exchange.operation !== request.operation) return false
            if (exchange.parameters && !sameValues(exchange.parameters, request.parameters)) return false
            if (
                request.operation === OPERATION.SetDevicePropValue &&
                exchange.reply.code === RESPONSE.OK &&
                (exchange.parameters === undefined || exchange.dataFromHost === undefined)
            )
                return false
            if (exchange.dataFromHost === undefined) return true
            return request.data !== undefined && sameValues(exchange.dataFromHost, request.data)
        })
        const specificity = (exchange: ParsedExchange) =>
            Number(exchange.parameters !== undefined) + Number(exchange.dataFromHost !== undefined)
        const mostSpecific = Math.max(...candidates.map(specificity))
        const specific = candidates.filter(candidate => specificity(candidate) === mostSpecific)
        const next = specific.find(candidate => !this.exchangeUses.has(candidate)) ?? specific.at(-1)
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
                if (!this.advertisedOperations.has(OPERATION.OpenSession)) return undefined
                return { code: this.sessionOpen ? RESPONSE.SessionAlreadyOpen : RESPONSE.OK }
            case OPERATION.CloseSession:
                return this.advertisedOperations.has(OPERATION.CloseSession) ? { code: RESPONSE.OK } : undefined
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
            // Empty framing is not evidence for encoding a nonempty vendor event queue.
            if (this.pendingPolledEvents) return this.missingReply(request)
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
        const personality = this.options.connection === 'ptp-ip' ? ptpIpPersonality(this.profile) : undefined
        return encodeDeviceInfo({
            ...deviceInfo,
            ...(personality?.vendorExtensionId && { vendorExtensionId: personality.vendorExtensionId }),
            ...(personality?.manufacturer && { manufacturer: personality.manufacturer }),
            operationsSupported: visible(deviceInfo.operationsSupported, hidden.operations),
            devicePropertiesSupported: visible(deviceInfo.devicePropertiesSupported, hidden.properties),
        })
    }

    private answerProperty(request: SimulatedRequest): Reply | undefined {
        const code = request.parameters[0] ?? 0
        const property = this.properties.get(code)
        const descriptor = property ? this.descriptorBytes(code, property) : undefined
        if (!descriptor) {
            return this.completeProperties && !this.completeProperties.has(code) && !this.hiddenProperties.has(code)
                ? { code: RESPONSE.DevicePropNotSupported }
                : undefined
        }

        const layout = readDescriptorLayout(descriptor)
        if (request.operation === OPERATION.GetDevicePropDesc) return { code: RESPONSE.OK, data: descriptor }
        if (request.operation === OPERATION.GetDevicePropValue) {
            return { code: RESPONSE.OK, data: descriptor.slice(layout.currentValueStart, layout.currentValueEnd) }
        }

        if (!layout.writable) return { code: RESPONSE.AccessDenied }
        const value = request.data
        if (!value || !descriptorAcceptsValue(layout, value)) {
            return { code: RESPONSE.InvalidDevicePropValue }
        }
        return { code: RESPONSE.OK }
    }

    /** Camera settings survive session close/reconnect; trace cursors and session prerequisites do not. */
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
        if (responseCode !== RESPONSE.OK) return []

        const events: PTPEvent[] = this.profile.events
            .filter(event => parseCode(event.afterOperation) === operation)
            .map(event => ({
                code: parseCode(event.code),
                transactionId: 0,
                parameters: (event.parameters ?? []).map(parseCode),
            }))
        if (changedProperty !== undefined && this.announcesPropertyChanges) {
            events.push({ code: DEVICE_PROP_CHANGED, transactionId: 0, parameters: [changedProperty] })
        }
        return events
    }

    private deliver(events: PTPEvent[]): void {
        if (events.length === 0) return
        const generation = this.eventGeneration
        setTimeout(() => {
            if (!this.connected || generation !== this.eventGeneration) return
            events.forEach(event => this.eventHandlers.forEach(handler => handler(event)))
        }, 0)
    }
}
