import { Logger } from '@core/logger'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfo } from '@ptp/datasets/storage-info-dataset'
import { OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { randomSessionId } from '@ptp/definitions/session'
import { createPTPRegistry, Registry } from '@ptp/registry'
import type { CodecDefinition, CodecInstance, CodecType } from '@ptp/types/codec'
import { EventDefinition, EventEmitter } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams, OperationParams, OperationResponse } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

export interface StandardPropertyState {
    code: number
    codeHex: string
    name: string
    description: string
    value: number | bigint | string
    rawValue: number | bigint | string
    writable: boolean
    form: 'none' | 'range' | 'enum'
    allowedValues?: (number | bigint | string)[]
    minimumValue?: number | bigint | string
    maximumValue?: number | bigint | string
    stepSize?: number | bigint | string
}

export class GenericCamera {
    protected emitter = new EventEmitter()
    public vendorId: number | null = null
    public sessionId: number | null = null
    private transactionId = 0
    private transactionQueue: Promise<void> = Promise.resolve()
    public transport: TransportInterface
    protected logger: Logger
    public registry: Registry

    protected liveViewBufferSize = 5 * 1024 * 1024 // 5MB
    protected captureBufferSize = 100 * 1024 * 1024 // 100MB
    protected bufferPadding = 1024 * 1024 // 1MB
    protected defaultChunkSize = 10 * 1024 * 1024 // 10MB

    constructor(transport: TransportInterface, logger: Logger) {
        this.transport = transport
        this.logger = logger
        this.registry = createPTPRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)

        this.transport.on?.(event => this.handleEvent(event))
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (!this.transport.isConnected()) {
            await this.transport.connect(device)
        }

        this.sessionId = randomSessionId()
        const openResult = await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })

        if (openResult.code === SessionAlreadyOpen.code) {
            await this.send(this.registry.operations.CloseSession, {})
            await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
        }
    }

    async disconnect(): Promise<void> {
        this.emitter.removeAllListeners()

        if (this.sessionId !== null) {
            await this.send(this.registry.operations.CloseSession, {})
        }

        this.sessionId = null
        await this.transport.disconnect()
    }

    /**
     * PTP is strictly request/response over a single pair of bulk endpoints, so only one
     * transaction may be in flight at a time. Vendor subclasses poll for events on a timer, and
     * setInterval does not wait for its async callback, so polls can overlap each other and any
     * caller-initiated operation. Overlapping transactions interleave on the shared endpoints and
     * abort libusb. Queueing every transaction here keeps the bus serialized.
     */
    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        const result = this.transactionQueue.then(
            () => this.sendTransaction(operation, params, data, maxDataLength),
            () => this.sendTransaction(operation, params, data, maxDataLength)
        )

        // Keep the chain alive after a rejection so one failed transaction cannot wedge the queue.
        this.transactionQueue = result.then(
            () => undefined,
            () => undefined
        )

        return result
    }

    private async sendTransaction<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        const transactionId = this.getNextTransactionId()

        const encodedParams: Uint8Array[] = []
        const paramsRecord: Record<string, number | bigint | string> = params

        // TODO: Move this to the logger since logger has access to the registry now
        for (const paramDef of operation.operationParameters) {
            if (!paramDef) continue

            let value = paramsRecord[paramDef.name]

            if (value === undefined && 'defaultValue' in paramDef && paramDef.defaultValue !== undefined) {
                value = paramDef.defaultValue
            }

            if (value === undefined && !paramDef.required) continue

            if (value === undefined && paramDef.required) {
                throw new Error(`Required parameter ${paramDef.name} missing`)
            }

            const codec = this.resolveCodec(paramDef.codec)
            encodedParams.push(codec.encode(value))
        }

        // Check if this is part of an active transfer (managed externally via logger.startTransfer)
        const objectHandleValue = paramsRecord.ObjectHandle
        const objectHandle: number | null = typeof objectHandleValue === 'number' ? objectHandleValue : null
        const existingTransferLogId = objectHandle !== null ? this.logger.getActiveTransfer(objectHandle) : undefined

        let logId: number
        if (existingTransferLogId !== undefined) {
            // This operation is part of an active transfer, don't create a new log
            logId = existingTransferLogId
        } else {
            const shouldLog = operation.name !== 'CanonGetEventData'

            if (shouldLog) {
                logId = this.logger.addLog({
                    type: 'ptp_operation',
                    level: 'info',
                    sessionId: this.sessionId!,
                    transactionId,
                    requestPhase: {
                        timestamp: Date.now(),
                        operationName: operation.name,
                        encodedParams,
                        decodedParams: paramsRecord,
                    },
                })
            } else {
                logId = -1
            }
        }

        const commandContainer = this.buildCommand(operation.code, transactionId, encodedParams)
        await this.transport.send(commandContainer, this.sessionId!, transactionId)

        let receivedData: Uint8Array | undefined
        if (operation.dataDirection === 'in') {
            if (!data) throw new Error('Data required for dataDirection=in')
            const dataContainer = this.buildData(operation.code, transactionId, data)

            let decodedData: number | bigint | string | object | Uint8Array | undefined = undefined
            if (data && data.length > 0 && 'dataCodec' in operation && operation.dataCodec) {
                const codec = this.resolveCodec(operation.dataCodec)
                const result = codec.decode(data)
                decodedData = result.value
            }

            // Decode property values for SetDevicePropValue operations
            if (
                data &&
                data.length > 0 &&
                !decodedData &&
                (operation.name.includes('SetDevicePropValue') || operation.name.includes('ControlDevice'))
            ) {
                const propCode =
                    paramsRecord.DevicePropCode !== undefined
                        ? paramsRecord.DevicePropCode
                        : paramsRecord.sdiControlCode !== undefined
                          ? paramsRecord.sdiControlCode
                          : undefined

                if (propCode !== undefined) {
                    const property = Object.values(this.registry.properties).find((p: any) => p.code === propCode)
                    if (property) {
                        try {
                            const codec = this.resolveCodec(property.codec)
                            const result = codec.decode(data)
                            decodedData = {
                                propertyName: property.name,
                                propertyCode: propCode,
                                value: result.value,
                            }
                        } catch {
                            // Sony SDIO_ControlDevice uses a small signed direction
                            // payload for otherwise UINT16/UINT32 properties. Logging
                            // must never prevent the correctly encoded transaction.
                            decodedData = {
                                propertyName: property.name,
                                propertyCode: propCode,
                                controlPayload: [...data],
                            }
                        }
                    }
                }
            }

            if (logId !== -1) {
                this.logger.updateLog(logId, {
                    dataPhase: {
                        timestamp: Date.now(),
                        direction: 'in',
                        bytes: data.length,
                        encodedData: data,
                        decodedData,
                        maxDataLength,
                    },
                })
            }

            await this.transport.send(dataContainer, this.sessionId!, transactionId)
        } else if (operation.dataDirection === 'out') {
            const bufferSize = maxDataLength || 256 * 1024
            const dataRaw = await this.transport.receive(bufferSize, this.sessionId!, transactionId)
            const dataContainer = this.parseContainer(dataRaw)
            receivedData = dataContainer.payload

            // If we received a response container instead of data, treat it as the response
            if (dataContainer.type === 3) {
                const responseCode = dataContainer.code

                // Update logger with response phase before returning
                if (logId !== -1) {
                    this.logger.updateLog(logId, {
                        responsePhase: {
                            timestamp: Date.now(),
                            code: responseCode,
                        },
                    })
                }

                return {
                    code: responseCode,
                    data: receivedData && receivedData.length > 0 ? receivedData : undefined,
                } as OperationResponse<Op>
            }

            let decodedData: number | bigint | string | object | Uint8Array | undefined = undefined
            if (receivedData && receivedData.length > 0 && 'dataCodec' in operation && operation.dataCodec) {
                const codec = this.resolveCodec(operation.dataCodec)
                const result = codec.decode(receivedData)
                decodedData = result.value
            }

            if (
                receivedData &&
                receivedData.length > 0 &&
                !decodedData &&
                operation.name.includes('GetDevicePropValue')
            ) {
                const propCode = paramsRecord.DevicePropCode
                if (propCode !== undefined) {
                    const property = Object.values(this.registry.properties).find((p: any) => p.code === propCode)
                    if (property) {
                        const codec = this.resolveCodec(property.codec)
                        const result = codec.decode(receivedData)
                        decodedData = {
                            propertyName: property.name,
                            propertyCode: propCode,
                            value: result.value,
                        }
                    }
                }
            }

            if (logId !== -1) {
                const currentLog = this.logger.getLogById(logId)
                if (!currentLog || currentLog.type !== 'ptp_transfer') {
                    this.logger.updateLog(logId, {
                        dataPhase: {
                            timestamp: Date.now(),
                            direction: 'out',
                            bytes: receivedData?.length || 0,
                            encodedData: receivedData,
                            decodedData: decodedData,
                            maxDataLength,
                        },
                    })
                }
            }
        }

        const responseBufferSize = 512
        const responseRaw = await this.transport.receive(responseBufferSize, this.sessionId!, transactionId)
        const responseContainer = this.parseContainer(responseRaw)

        const currentLog = logId !== -1 ? this.logger.getLogById(logId) : undefined
        const isTransferLog = currentLog && currentLog.type === 'ptp_transfer'

        // If data phase had empty payload but response has payload, use response payload as data
        if (
            operation.dataDirection === 'out' &&
            (!receivedData || receivedData.length === 0) &&
            responseContainer.payload.length > 0
        ) {
            receivedData = responseContainer.payload

            // Decode the response payload if we have a dataCodec
            let decodedData: number | bigint | string | object | Uint8Array | undefined = undefined
            if ('dataCodec' in operation && operation.dataCodec) {
                const codec = this.resolveCodec(operation.dataCodec)
                const result = codec.decode(receivedData)
                decodedData = result.value
            }

            if (logId !== -1) {
                this.logger.updateLog(logId, {
                    dataPhase: {
                        timestamp: Date.now(),
                        direction: 'out',
                        bytes: receivedData.length,
                        encodedData: receivedData,
                        decodedData,
                        maxDataLength,
                    },
                })
            }
        }

        if (logId !== -1 && !isTransferLog) {
            this.logger.updateLog(logId, {
                responsePhase: {
                    timestamp: Date.now(),
                    code: responseContainer.code,
                },
            })
        }

        const isPropertyOp = operation.name.includes('GetDevicePropValue')
        const finalData = logId !== -1 ? this.logger.getLogs().find(l => l.id === logId) : undefined
        let returnData: any =
            !isPropertyOp &&
            finalData &&
            finalData.type === 'ptp_operation' &&
            finalData.dataPhase?.decodedData !== undefined
                ? finalData.dataPhase.decodedData
                : receivedData

        // If logId is -1 (operation wasn't logged), still decode if dataCodec exists
        if (
            logId === -1 &&
            receivedData &&
            receivedData.length > 0 &&
            'dataCodec' in operation &&
            operation.dataCodec
        ) {
            const codec = this.resolveCodec(operation.dataCodec)
            const result = codec.decode(receivedData)
            returnData = result.value
        }

        return {
            code: responseContainer.code,
            data: returnData,
        } as OperationResponse<Op>
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        const response = await this.send(this.registry.operations.GetDevicePropDesc, {
            DevicePropCode: property.code,
        })

        if (!('data' in response) || !response.data) {
            throw new Error('No data received from GetDevicePropDesc')
        }

        // DevicePropDesc uses the registered property codec for the decoded current value.
        return response.data.currentValueDecoded as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) {
            throw new Error(`Property ${property.name} is not writable`)
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        await this.send(this.registry.operations.SetDevicePropValue, { DevicePropCode: property.code }, encodedValue)
    }

    async getStandardPropertyStates(): Promise<StandardPropertyState[]> {
        const deviceInfoResponse = await this.send(this.registry.operations.GetDeviceInfo, {})
        if (!deviceInfoResponse.data) throw new Error('GetDeviceInfo returned no device dataset')

        const deviceInfo = deviceInfoResponse.data as DeviceInfo
        const states: StandardPropertyState[] = []
        for (const code of deviceInfo.devicePropertiesSupported) {
            const property = Object.values(this.registry.properties).find(candidate => candidate.code === code)
            if (!property) continue

            try {
                const response = await this.send(this.registry.operations.GetDevicePropDesc, { DevicePropCode: code })
                if (!response.data) continue
                states.push(this.standardPropertyState(response.data as DevicePropDesc))
            } catch (error) {
                this.logger.addLog({
                    type: 'console',
                    level: 'warn',
                    consoleLevel: 'warn',
                    args: [
                        `Could not decode advertised property 0x${code.toString(16).padStart(4, '0')}`,
                        error instanceof Error ? error.message : String(error),
                    ],
                })
            }
        }
        return states
    }

    async setStandardProperty(propertyNameOrCode: string | number, requestedValue: string | number): Promise<void> {
        const states = await this.getStandardPropertyStates()
        const requestedName = String(propertyNameOrCode).toLowerCase()
        const state = states.find(candidate =>
            typeof propertyNameOrCode === 'number'
                ? candidate.code === propertyNameOrCode
                : candidate.name.toLowerCase() === requestedName || candidate.codeHex.toLowerCase() === requestedName
        )
        if (!state) throw new Error(`The attached camera does not advertise ${propertyNameOrCode}`)
        if (!state.writable) throw new Error(`${state.name} is read-only on the attached camera`)

        const property = Object.values(this.registry.properties).find(candidate => candidate.code === state.code)
        if (!property) throw new Error(`${state.codeHex} has no standard PTP property definition`)

        let value: number | bigint | string = requestedValue
        if (state.allowedValues?.length) {
            const matched = state.allowedValues.find(candidate => String(candidate) === String(requestedValue))
            if (matched === undefined) {
                throw new Error(
                    `${requestedValue} is not advertised for ${state.name}; choose ${state.allowedValues.map(String).join(', ')}`
                )
            }
            value = matched
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)
        const response = await this.send(
            this.registry.operations.SetDevicePropValue,
            { DevicePropCode: property.code },
            encodedValue
        )
        if (response.code !== OK.code) {
            throw new Error(`SetDevicePropValue for ${state.name} returned 0x${response.code.toString(16)}`)
        }
    }

    private standardPropertyState(descriptor: DevicePropDesc): StandardPropertyState {
        return {
            code: descriptor.devicePropertyCode,
            codeHex: `0x${descriptor.devicePropertyCode.toString(16).padStart(4, '0')}`,
            name: descriptor.devicePropertyName,
            description: descriptor.devicePropertyDescription,
            value: descriptor.currentValueDecoded,
            rawValue: descriptor.currentValueRaw,
            writable: descriptor.getSet === 'GET_SET',
            form: descriptor.formFlag === 0x02 ? 'enum' : descriptor.formFlag === 0x01 ? 'range' : 'none',
            ...(descriptor.supportedValuesDecoded ? { allowedValues: descriptor.supportedValuesDecoded } : {}),
            ...(descriptor.minimumValue !== undefined ? { minimumValue: descriptor.minimumValue } : {}),
            ...(descriptor.maximumValue !== undefined ? { maximumValue: descriptor.maximumValue } : {}),
            ...(descriptor.stepSize !== undefined ? { stepSize: descriptor.stepSize } : {}),
        }
    }

    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void {
        this.emitter.on<EventParams<E>>(event.name, handler)
    }

    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void {
        if (handler) {
            this.emitter.off<EventParams<E>>(event.name, handler)
        } else {
            this.emitter.removeAllListeners(event.name)
        }
    }

    async getAperture(): Promise<string> {
        return this.get(this.registry.properties.FNumber)
    }

    async setAperture(value: string): Promise<void> {
        return this.setStandardProperty('FNumber', value)
    }

    async getShutterSpeed(): Promise<string> {
        return this.get(this.registry.properties.ExposureTime)
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.setStandardProperty('ExposureTime', value)
    }

    async getIso(): Promise<string> {
        return this.get(this.registry.properties.ExposureIndex)
    }

    async setIso(value: string): Promise<void> {
        return this.setStandardProperty('ExposureIndex', value)
    }

    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        if (!includeInfo && !includeData) {
            const captureResponse = await this.send(this.registry.operations.InitiateCapture, {})
            if (captureResponse.code !== OK.code) {
                throw new Error(`InitiateCapture returned 0x${captureResponse.code.toString(16)}`)
            }
            return {}
        }

        const capturedImageObjectHandle = await this.initiateCaptureAndWaitForObjectHandle()

        let info: ObjectInfo | undefined = undefined
        let data: Uint8Array | undefined = undefined

        if (includeInfo) {
            const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                ObjectHandle: capturedImageObjectHandle,
            })
            info = objectInfoResponse.data
        }
        if (includeData) {
            const objectResponse = await this.send(
                this.registry.operations.GetObject,
                {
                    ObjectHandle: capturedImageObjectHandle,
                },
                undefined,
                (info?.objectCompressedSize || this.liveViewBufferSize) + this.bufferPadding
            )
            data = objectResponse.data
        }

        return {
            info: info,
            data: data,
        }
    }

    async captureLiveView({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        throw new Error('Live view capture not supported on generic PTP cameras')
    }

    async startRecording(): Promise<void> {
        throw new Error('Video recording not supported on generic PTP cameras')
    }

    async stopRecording(): Promise<void> {
        throw new Error('Video recording not supported on generic PTP cameras')
    }

    /*
     * WARNING: This operation is extremely slow for >100 objects/images on card.
     */
    async listObjects(): Promise<{
        [storageId: number]: {
            info: StorageInfo
            objects: { [objectHandle: number]: ObjectInfo }
        }
    }> {
        type StorageEntry = { info: StorageInfo; objects: { [objectHandle: number]: ObjectInfo } }
        const result: { [storageId: number]: StorageEntry } = {}

        const storageIdsResponse = await this.send(this.registry.operations.GetStorageIDs, {})
        const storageIds = storageIdsResponse.data

        for (const storageId of storageIds) {
            // Get info for this storage
            const storageInfoResponse = await this.send(this.registry.operations.GetStorageInfo, {
                StorageID: storageId,
            })
            const storageInfo = storageInfoResponse.data

            // Prepare container for objects in this storage
            const storageObjects: { [objectHandle: number]: ObjectInfo } = {}

            // Get all object handles for this storage
            const objectIdsResponse = await this.send(this.registry.operations.GetObjectHandles, {
                StorageID: storageId,
            })
            const objectHandles = objectIdsResponse.data

            // Get detailed info for each object handle
            for (const objectHandle of objectHandles) {
                const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                    ObjectHandle: objectHandle,
                })
                storageObjects[objectHandle] = objectInfoResponse.data
            }

            result[storageId] = {
                info: storageInfo,
                objects: storageObjects,
            }
        }

        return result
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        // Start transfer tracking
        this.logger.startTransfer(objectHandle, this.sessionId!, 0, 'GetPartialObject', objectSize)

        const chunks: Uint8Array[] = []
        let offset = 0

        while (offset < objectSize) {
            const bytesToRead = Math.min(this.defaultChunkSize, objectSize - offset)

            const chunkResponse = await this.send(
                this.registry.operations.GetPartialObject,
                {
                    ObjectHandle: objectHandle,
                    Offset: offset,
                    MaxBytes: bytesToRead,
                },
                undefined,
                bytesToRead + 12
            )

            if (!chunkResponse.data) {
                throw new Error('No data received from GetPartialObject')
            }

            // Update transfer progress
            this.logger.updateTransferProgress(objectHandle, chunkResponse.data.length, this.getCurrentTransactionId())

            chunks.push(chunkResponse.data)
            offset += chunkResponse.data.length
        }

        // Complete transfer tracking
        this.logger.completeTransfer(objectHandle)

        // Combine all chunks
        const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const completeFile = new Uint8Array(totalBytes)
        let writeOffset = 0
        for (const chunk of chunks) {
            completeFile.set(chunk, writeOffset)
            writeOffset += chunk.length
        }

        return completeFile
    }

    public resolveCodec<T>(codec: CodecDefinition<T> | CodecDefinition<any>): CodecInstance<T> {
        if (typeof codec === 'function') {
            return codec(this.registry)
        }

        return codec
    }

    protected async waitMs(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    protected handleEvent(event: PTPEvent): void {
        const eventDef = Object.values(this.registry.events).find(e => e.code === event.code) as
            | EventDefinition
            | undefined
        if (!eventDef) return

        // Decode event parameters using their codecs
        const decodedParams: Record<string, number | bigint | string> = {}
        const encodedParams = event.parameters || []

        for (let i = 0; i < eventDef.parameters.length; i++) {
            const paramDef = eventDef.parameters[i]
            if (!paramDef || i >= encodedParams.length) continue

            const codec = this.resolveCodec(paramDef.codec)
            const rawValue = encodedParams[i]

            // If raw value is a number/bigint/string, decode it
            if (typeof rawValue === 'number' || typeof rawValue === 'bigint' || typeof rawValue === 'string') {
                // Encode to bytes first, then decode to get the proper type
                const bytes = codec.encode(rawValue)
                const result = codec.decode(bytes)
                decodedParams[paramDef.name] = result.value
            } else {
                decodedParams[paramDef.name] = rawValue
            }
        }

        // If event has a PropertyCode parameter, look up and add PropertyName
        if (decodedParams.PropertyCode !== undefined && typeof decodedParams.PropertyCode === 'number') {
            const property = Object.values(this.registry.properties).find(p => p.code === decodedParams.PropertyCode)
            if (property) {
                decodedParams.PropertyName = property.name
            }
        }

        this.logger.addLog({
            type: 'ptp_event',
            level: 'info',
            sessionId: this.sessionId!,
            eventCode: eventDef.code,
            eventName: eventDef.name,
            encodedParams,
            decodedParams,
        })

        this.emitter.emit<Record<string, number | bigint | string>>(eventDef.name, decodedParams)
    }

    protected initiateCaptureAndWaitForObjectHandle(timeoutMilliseconds = 15_000): Promise<number> {
        return new Promise((resolve, reject) => {
            const objectAdded = this.registry.events.ObjectAdded
            const cleanup = () => {
                clearTimeout(timeout)
                this.off(objectAdded, handleObjectAdded)
            }
            const fail = (error: unknown) => {
                cleanup()
                reject(error instanceof Error ? error : new Error(String(error)))
            }
            const handleObjectAdded = (event: { ObjectHandle?: number }) => {
                if (!event.ObjectHandle) return
                cleanup()
                resolve(event.ObjectHandle)
            }
            const timeout = setTimeout(
                () => fail(new Error(`Timed out after ${timeoutMilliseconds}ms waiting for the captured image object`)),
                timeoutMilliseconds
            )

            this.on(objectAdded, handleObjectAdded)
            void this.send(this.registry.operations.InitiateCapture, {})
                .then(response => {
                    if (response.code !== OK.code) fail(new Error(`InitiateCapture returned 0x${response.code.toString(16)}`))
                })
                .catch(fail)
        })
    }

    protected getCurrentTransactionId(): number {
        return this.transactionId
    }

    private getNextTransactionId(): number {
        this.transactionId = (this.transactionId + 1) & 0xffffffff
        if (this.transactionId === 0) this.transactionId = 1
        return this.transactionId
    }

    private buildCommand(code: number, transactionId: number, params: Uint8Array[]): Uint8Array {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        const paramBytes = params.reduce((sum, p) => sum + p.length, 0)
        const length = 12 + paramBytes

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(1),
            u16.encode(code),
            u32.encode(transactionId),
            ...params,
        ]

        const buffer = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
            buffer.set(part, offset)
            offset += part.length
        }

        return buffer
    }

    private buildData(code: number, transactionId: number, data: Uint8Array): Uint8Array {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        const length = 12 + data.length

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(2),
            u16.encode(code),
            u32.encode(transactionId),
            data,
        ]

        const buffer = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
            buffer.set(part, offset)
            offset += part.length
        }

        return buffer
    }

    private parseContainer(data: Uint8Array): {
        type: number
        code: number
        transactionId: number
        payload: Uint8Array
    } {
        if (data.length < 12) {
            throw new Error(`Container too short: ${data.length} bytes`)
        }

        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        let offset = 0

        const lengthResult = u32.decode(data, offset)
        const length = lengthResult.value
        offset += lengthResult.bytesRead

        const typeResult = u16.decode(data, offset)
        const type = typeResult.value
        offset += typeResult.bytesRead

        const codeResult = u16.decode(data, offset)
        const code = codeResult.value
        offset += codeResult.bytesRead

        const transactionIdResult = u32.decode(data, offset)
        const transactionId = transactionIdResult.value
        offset += transactionIdResult.bytesRead

        const payload = data.slice(offset)

        return { type, code, transactionId, payload }
    }
}
