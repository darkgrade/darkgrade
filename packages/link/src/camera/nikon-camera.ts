import { Logger } from '@core/logger'
import type { NikonLiveViewDataset } from '@ptp/datasets/vendors/nikon/nikon-live-view-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { DeviceBusy, OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { ISOAutoControl } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import { NotLiveView, OutOfFocus } from '@ptp/definitions/vendors/nikon/nikon-response-definitions'
import { createNikonRegistry, type NikonRegistry } from '@ptp/registry'
import type { CodecType } from '@ptp/types/codec'
import { EventDefinition } from '@ptp/types/event'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams } from '@ptp/types/type-helpers'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { GenericCamera } from './generic-camera'

export type NikonLiveViewMetadata = Omit<NikonLiveViewDataset, 'liveViewImage' | 'reserved' | 'afFrameData' | 'autoCaptureSubjectDetection' | 'reservedEnd'>

export interface NikonFocusResult {
    commandSent: true
    focusAcquired: boolean
    metadata: NikonLiveViewMetadata
}

export interface NikonFocusPointResult {
    commandSent: true
    positionVerified: boolean
    normalized: { x: number; y: number }
    x: number
    y: number
    width: number
    height: number
    tolerance: { x: number; y: number }
    metadata: NikonLiveViewMetadata
    focus?: NikonFocusResult
}

export class NikonCamera extends GenericCamera {
    private cameraMode: 'PC_CAMERA' | 'REMOTE' | 'UNKNOWN' = 'UNKNOWN'
    private liveViewMode: 'PHOTO' | 'VIDEO' | 'UNKNOWN' = 'UNKNOWN'
    private applicationMode: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN'
    private liveViewStatus: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN'
    private liveViewStartPending = false

    vendorId = VendorIDs.NIKON
    declare public registry: NikonRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createNikonRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)
    }

    async disconnect(): Promise<void> {
        try {
            if (this.liveViewStatus === 'ON' || this.liveViewStartPending) await this.disableLiveView()
        } finally { await super.disconnect() }
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        const response = await this.send(this.registry.operations.GetDevicePropDescEx, {
            DevicePropCode: property.code,
        })

        if (!response.data) {
            throw new Error('No data received from GetDevicePropDescEx')
        }

        const descriptor = response.data

        if (!descriptor || typeof descriptor !== 'object' || !('currentValueDecoded' in descriptor)) {
            throw new Error('Invalid property descriptor structure')
        }

        // Cast needed: TypeScript knows data exists but can't narrow to specific property's codec type
        return descriptor.currentValueDecoded as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) {
            throw new Error(`Property ${property.name} is not writable`)
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        const response = await this.send(
            this.registry.operations.SetDevicePropValueEx,
            {
                DevicePropCode: property.code,
            },
            encodedValue
        )
        if (response.code !== OK.code) throw new Error(`Nikon ${property.name} write failed: ${this.responseDescription(response.code)}`)
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

    async setIso(value: string): Promise<void> {
        const isAuto = value.toLowerCase().includes('auto')

        if (isAuto) {
            return await this.set(ISOAutoControl, 'ON')
        } else {
            await this.set(ISOAutoControl, 'OFF')
            return await this.set(this.registry.properties.ExposureIndex, value)
        }
    }

    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        // TODO: Implement this
        let info: ObjectInfo | undefined = undefined
        let data: Uint8Array | undefined = undefined

        // Setup capture

        // Older Nikon bodies can support StartLiveView/InitiateCapture while returning
        // no data for the newer GetDevicePropDescEx status properties. In that case,
        // use the photo-capture path directly instead of failing before the shutter.
        try {
            await this.getLiveViewStatus()
        } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('No data received from GetDevicePropDescEx')) {
                throw error
            }
            await this.enableLiveView()
            await this.send(this.registry.operations.InitiateCapture, {})
            await this.waitForDeviceReady()
            return { info, data }
        }

        // camera's hardware dial is in photo mode, great, screen will stay on
        if (this.liveViewMode === 'PHOTO') {
            await this.enableLiveView()
            await this.send(this.registry.operations.InitiateCapture, {})
            await this.waitForDeviceReady()
            await this.waitForImageBufferReady()
        }

        // camera's hardware dial is not in photo mode
        // we must temporarily enable remote mode which will blank out the screen, then go back to PC Camera mode
        else if (this.liveViewMode === 'VIDEO') {
            await this.enableRemoteMode()
            await this.enablePhotoMode()
            await this.enableLiveView()
            await this.send(this.registry.operations.InitiateCapture, {})
            await this.waitForDeviceReady()
            await this.waitForImageBufferReady()
            await this.enablePcCameraMode()
            await this.waitForDeviceReady()
        }

        // if (includeInfo) {
        //     // Nikon does not support this for live view images
        // }
        // if (includeData) {
        //     const response = await this.send(this.registry.operations.InitiateCapture, {})
        // }

        return { info: info, data: data }
    }

    async captureLiveView({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
        nikonMetadata?: NikonLiveViewMetadata
    }> {
        await this.enableLiveView()

        let info: ObjectInfo | undefined = undefined
        let data: Uint8Array | undefined = undefined
        let nikonMetadata: NikonLiveViewMetadata | undefined

        if (includeInfo) {
            // Nikon does not support this for live view images
        }
        if (includeData) {
            let response: Awaited<ReturnType<typeof this.send<typeof this.registry.operations.GetLiveViewImageEx>>> | undefined
            for (let attempt = 0; attempt < 20; attempt += 1) {
                response = await this.send(
                    this.registry.operations.GetLiveViewImageEx,
                    {},
                    undefined,
                    this.liveViewBufferSize + this.bufferPadding
                )
                if (response.code === NotLiveView.code) {
                    this.liveViewStatus = 'OFF'
                    await this.enableLiveView()
                    continue
                }
                if (response.code !== DeviceBusy.code) break
                await this.waitMs(10)
            }
            if (!response || response.code !== OK.code || !response.data?.liveViewImage) {
                throw new Error(
                    `Nikon GetLiveViewImageEx failed with response ${response ? `0x${response.code.toString(16)}` : 'unknown'}`
                )
            }
            const { liveViewImage, reserved, afFrameData, autoCaptureSubjectDetection, reservedEnd, ...metadata } = response.data
            data = liveViewImage
            nikonMetadata = metadata
        }

        return { info, data, ...(nikonMetadata ? { nikonMetadata } : {}) }
    }

    private async requireFocusOperations(operations: readonly OperationDefinition[]): Promise<void> {
        const response = await this.send(this.registry.operations.GetDeviceInfo, {})
        const supported = response.data?.operationsSupportedRaw
        if (response.code !== OK.code || !Array.isArray(supported))
            throw new Error('Nikon operation capabilities could not be read')
        for (const operation of operations) {
            if (!supported.includes(operation.code))
                throw new Error(`The Nikon does not advertise ${operation.name}`)
        }
    }

    /** Read the advertised extended-property IDs; this does not read or write their values. */
    async getVendorPropertyCodes(): Promise<number[]> {
        const operation = this.registry.operations.GetVendorCodes
        await this.requireFocusOperations([operation])
        const maximumCount = 4096
        const response = await this.send(operation, { Kind: 13 }, undefined, 4 + maximumCount * 4 + 12)
        const data = response.data
        if (response.code !== OK.code || !(data instanceof Uint8Array) || data.length < 4)
            throw new Error('Nikon vendor property enumeration failed')
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const littleEndian = this.transport.isLittleEndian()
        const count = view.getUint32(0, littleEndian)
        if (count > maximumCount || data.length !== 4 + count * 4)
            throw new Error('Nikon vendor property enumeration returned an invalid array length')
        return Array.from({ length: count }, (_, index) => view.getUint32(4 + index * 4, littleEndian))
    }

    private async freshFocusMetadata(): Promise<NikonLiveViewMetadata> {
        const frame = await this.captureLiveView({ includeInfo: false, includeData: true })
        if (!frame.nikonMetadata) throw new Error('Nikon live view returned no focus metadata')
        return frame.nikonMetadata
    }

    /** Return fresh camera focus evidence; command completion alone does not establish focus lock. */
    async autofocus(timeoutMilliseconds = 5000): Promise<NikonFocusResult> {
        if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 100 || timeoutMilliseconds > 10000)
            throw new Error('Nikon autofocus timeout must be 100–10000 milliseconds')
        const operations = this.registry.operations
        await this.requireFocusOperations([operations.AfDrive, operations.AfDriveCancel, operations.DeviceReady,
            operations.StartLiveView, operations.GetLiveViewImageEx])
        await this.enableLiveView()
        const response = await this.send(operations.AfDrive, {})
        if (response.code !== OK.code && response.code !== OutOfFocus.code)
            throw new Error(`Nikon AfDrive failed with response 0x${response.code.toString(16)}`)
        let completion: number = response.code
        try {
            if (completion === OK.code) completion = await this.pollDeviceReady(timeoutMilliseconds, [OutOfFocus.code])
        } catch (error) {
            const cancel = await this.send(operations.AfDriveCancel, {}).catch(() => undefined)
            if (!cancel || cancel.code !== OK.code)
                throw new Error('Nikon autofocus did not complete and cancellation was not confirmed', { cause: error })
            throw error
        }
        const metadata = await this.freshFocusMetadata()
        return { commandSent: true, focusAcquired: completion === OK.code && metadata.focusingJudgementResult === 2
            && metadata.focusDrivingStatus === 0, metadata }
    }

    /** Coordinates are normalized over the fresh Nikon whole-size AF plane, independent of JPEG resolution. */
    async touchFocus(x: number, y: number, options: { focus?: boolean } = {}): Promise<NikonFocusPointResult> {
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
            throw new Error('Nikon focus coordinates must be normalized between 0 and 1')
        if (options.focus !== undefined && typeof options.focus !== 'boolean')
            throw new Error('Nikon focus must be true or false')
        const operations = this.registry.operations
        await this.requireFocusOperations([operations.ChangeAfArea, operations.DeviceReady,
            operations.StartLiveView, operations.GetLiveViewImageEx,
            ...(options.focus === false ? [] : [operations.AfDrive, operations.AfDriveCancel])])
        const before = await this.freshFocusMetadata()
        const width = before.wholeSize?.horizontal, height = before.wholeSize?.vertical
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2)
            throw new Error('Nikon live view returned invalid AF coordinate dimensions')
        const deviceX = Math.round(x * (width - 1)), deviceY = Math.round(y * (height - 1))
        const response = await this.send(operations.ChangeAfArea, { X: deviceX, Y: deviceY })
        if (response.code !== OK.code)
            throw new Error(`Nikon ChangeAfArea failed with response 0x${response.code.toString(16)}`)
        await this.waitForDeviceReady()
        const focus = options.focus === false ? undefined : await this.autofocus()
        const metadata = focus?.metadata ?? await this.freshFocusMetadata()
        const tolerance = {
            x: Math.max(1, Math.floor((metadata.afFrameSize?.horizontal || 0) / 2)),
            y: Math.max(1, Math.floor((metadata.afFrameSize?.vertical || 0) / 2)),
        }
        const center = metadata.afFrameCenterCoords
        const positionVerified = metadata.wholeSize?.horizontal === width && metadata.wholeSize?.vertical === height
            && Number.isFinite(center?.horizontal) && Number.isFinite(center?.vertical)
            && Math.abs(center.horizontal - deviceX) <= tolerance.x && Math.abs(center.vertical - deviceY) <= tolerance.y
        return { commandSent: true, positionVerified, normalized: { x, y }, x: deviceX, y: deviceY,
            width, height, tolerance, metadata, ...(focus ? { focus } : {}) }
    }

    async driveFocus(direction: 'near' | 'far', steps = 1): Promise<{ commandSent: true; completed: true; metadata: NikonLiveViewMetadata }> {
        if (!['near', 'far'].includes(direction) || !Number.isInteger(steps) || steps < 1 || steps > 32767)
            throw new Error('Nikon manual focus requires near/far and 1–32767 lens steps')
        const operations = this.registry.operations
        await this.requireFocusOperations([operations.MfDrive, operations.DeviceReady,
            operations.StartLiveView, operations.GetLiveViewImageEx])
        await this.enableLiveView()
        const response = await this.send(operations.MfDrive, { Direction: direction === 'near' ? 1 : 2, Steps: steps })
        if (response.code !== OK.code)
            throw new Error(`Nikon MfDrive failed: ${this.responseDescription(response.code)}. Use AF-S focus mode for manual drive.`)
        try {
            await this.waitForDeviceReady()
        } catch (error) {
            throw new Error(`Nikon MfDrive completion failed: ${error instanceof Error ? error.message : String(error)}. Use AF-S focus mode for manual drive.`, { cause: error })
        }
        return { commandSent: true, completed: true, metadata: await this.freshFocusMetadata() }
    }

    async startRecording(): Promise<void> {
        // Setup capture

        // update live view status and mode
        await this.getLiveViewStatus()

        await this.waitForDeviceReady()

        let ownsLiveView = false, ownsApplicationMode = false, ownsRemoteMode = false, ownsVideoMode = false
        try {
            // camera's hardware dial is in video mode, great, screen will stay on
            if (this.liveViewMode === 'VIDEO') {
                ownsLiveView = this.liveViewStatus !== 'ON'
                await this.enableLiveView()
                ownsApplicationMode = this.applicationMode !== 'ON'
                await this.enableApplicationMode()

                await this.waitForImageBufferReady()

                const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
                if (prohibitionCondition !== 'none') {
                    throw new Error(`Movie recording is prohibited: ${prohibitionCondition}`)
                }

                const response = await this.send(this.registry.operations.StartMovieRecord, {})
                if (response.code !== OK.code) throw new Error(`Nikon StartMovieRecord failed with response 0x${response.code.toString(16)}`)
            }
            // camera's hardware dial is not in video mode
            // we must temporarily enable remote mode which will blank out the screen, then go back to PC Camera mode
            else if (this.liveViewMode === 'PHOTO') {
                ownsRemoteMode = this.cameraMode !== 'REMOTE'
                await this.enableRemoteMode()
                ownsVideoMode = true
                await this.enableVideoMode()
                ownsLiveView = this.liveViewStatus !== 'ON'
                await this.enableLiveView()
                ownsApplicationMode = this.applicationMode !== 'ON'
                await this.enableApplicationMode()

                await this.waitForImageBufferReady()

                const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
                if (prohibitionCondition !== 'none') {
                    throw new Error(`Movie recording is prohibited: ${prohibitionCondition}`)
                }

                const response = await this.send(this.registry.operations.StartMovieRecord, {})
                if (response.code !== OK.code) throw new Error(`Nikon StartMovieRecord failed with response 0x${response.code.toString(16)}`)
            }
        } catch (error) {
            const failures: string[] = []
            const restore = async (name: string, operation: () => Promise<void>) => {
                try { await operation() }
                catch (failure) { failures.push(`${name}: ${failure instanceof Error ? failure.message : String(failure)}`) }
            }
            if (ownsLiveView) await restore('live view', () => this.disableLiveView())
            if (ownsApplicationMode) await restore('application mode', () => this.disableApplicationMode())
            if (ownsVideoMode) await restore('photo mode', () => this.enablePhotoMode())
            if (ownsRemoteMode) await restore('camera mode', () => this.enablePcCameraMode())
            if (failures.length) throw new Error(`${error instanceof Error ? error.message : String(error)}; Nikon recording setup cleanup failed: ${failures.join('; ')}`, { cause: error })
            throw error
        }
    }

    async stopRecording(): Promise<void> {
        const response = await this.send(this.registry.operations.EndMovieRecord, {})
        if (response.code !== OK.code) throw new Error(`Nikon EndMovieRecord failed with response 0x${response.code.toString(16)}`)
        await this.waitForDeviceReady()
        const deadline=Date.now()+10000
        while((await this.get(this.registry.properties.MovieRecProhibitionCondition)).includes('alreadyRecording')){
            if(Date.now()>=deadline)throw new Error('Nikon movie stop was not confirmed within ten seconds; recording mode was preserved')
            await this.waitMs(50)
        }
        await this.waitForImageBufferReady()
        await this.disableLiveView()
        await this.disableApplicationMode()
        await this.enablePcCameraMode()
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        // Start transfer tracking
        this.logger.startTransfer(objectHandle, this.sessionId!, 0, 'GetPartialObjectEx', objectSize)

        const chunks: Uint8Array[] = []
        let offset = 0

        while (offset < objectSize) {
            const bytesToRead = Math.min(this.defaultChunkSize, objectSize - offset)

            // Split offset and size into lower/upper 32-bit values
            const offsetLower = offset & 0xffffffff
            const offsetUpper = Math.floor(offset / 0x100000000)
            const maxSizeLower = bytesToRead & 0xffffffff
            const maxSizeUpper = Math.floor(bytesToRead / 0x100000000)

            const chunkResponse = await this.send(
                this.registry.operations.GetPartialObjectEx,
                {
                    ObjectHandle: objectHandle,
                    OffsetLower: offsetLower,
                    OffsetUpper: offsetUpper,
                    MaxSizeLower: maxSizeLower,
                    MaxSizeUpper: maxSizeUpper,
                },
                undefined,
                bytesToRead + 12
            )

            if (!chunkResponse.data) {
                throw new Error('No data received from GetPartialObjectEx')
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

    private async enableRemoteMode(): Promise<void> {
        if (this.cameraMode === 'REMOTE') {
            return
        }

        const response = await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'REMOTE' })
        if (response.code !== OK.code) throw new Error(`Nikon ChangeCameraMode REMOTE failed: ${this.responseDescription(response.code)}`)
        this.cameraMode = 'REMOTE'
        await this.waitForDeviceReady()
    }

    private async enablePcCameraMode(): Promise<void> {
        if (this.cameraMode === 'PC_CAMERA') {
            return
        }

        const response = await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'PC_CAMERA' })
        if (response.code !== OK.code) throw new Error(`Nikon ChangeCameraMode PC_CAMERA failed: ${this.responseDescription(response.code)}`)
        this.cameraMode = 'PC_CAMERA'
        await this.waitForDeviceReady()
    }

    private async changeApplicationMode(mode: 'ON' | 'OFF'): Promise<void> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const response = await this.send(this.registry.operations.ChangeApplicationMode, { Mode: mode })
            if (response.code === OK.code) return
            if (response.code !== 0x200f) throw new Error(`Nikon ChangeApplicationMode ${mode} failed: ${this.responseDescription(response.code)}`)
            // A mode command can be denied when the body already has that state.
            // Accept only fresh camera telemetry, otherwise give its pending transition a bounded retry.
            const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            const observed = condition.includes('notInApplicationMode') ? 'OFF' : 'ON'
            if (observed === mode) return
            if (attempt === 2) throw new Error(`Nikon ChangeApplicationMode ${mode} failed: ${this.responseDescription(response.code)}; camera reports ${condition}`)
            await this.waitForDeviceReady()
            await this.waitMs(250)
        }
    }

    private async enableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'ON') {
            return
        }

        await this.changeApplicationMode('ON')
        this.applicationMode = 'ON'
        await this.waitForDeviceReady()
    }

    private async disableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'OFF') {
            return
        }

        await this.changeApplicationMode('OFF')
        this.applicationMode = 'OFF'
        await this.waitForDeviceReady()
    }

    private async enableLiveView(): Promise<void> {
        if (this.liveViewStatus === 'ON') {
            return
        }

        const response = await this.send(this.registry.operations.StartLiveView, {})
        if (response.code !== OK.code && response.code !== DeviceBusy.code) {
            throw new Error(`Nikon StartLiveView failed with response 0x${response.code.toString(16)}`)
        }
        this.liveViewStartPending = true
        await this.waitForDeviceReady()
        this.liveViewStatus = 'ON'
        this.liveViewStartPending = false
    }

    private async getLiveViewStatus(): Promise<void> {
        const liveViewStatus = await this.get(this.registry.properties.LiveViewStatus)
        await this.waitForDeviceReady()
        this.liveViewStatus = liveViewStatus === 'ON' ? 'ON' : 'OFF'

        const liveViewMode = await this.get(this.registry.properties.LiveViewSelector)
        await this.waitForDeviceReady()
        this.liveViewMode = liveViewMode === 'VIDEO' ? 'VIDEO' : 'PHOTO'
    }

    private async disableLiveView(): Promise<void> {
        if (this.liveViewStatus !== 'ON' && !this.liveViewStartPending) return

        const response = await this.send(this.registry.operations.EndLiveView, {})
        if (response.code !== OK.code && response.code !== NotLiveView.code) {
            throw new Error(`Nikon EndLiveView failed with response 0x${response.code.toString(16)}`)
        }
        await this.waitForDeviceReady()
        this.liveViewStatus = 'OFF'
        this.liveViewStartPending = false
    }

    private async enablePhotoMode(): Promise<void> {
        if (this.liveViewMode === 'PHOTO') {
            return
        }

        await this.set(this.registry.properties.LiveViewSelector, 'PHOTO')
        this.liveViewMode = 'PHOTO'
        await this.waitForDeviceReady()
    }

    private async enableVideoMode(): Promise<void> {
        if (this.liveViewMode === 'VIDEO') {
            return
        }

        await this.set(this.registry.properties.LiveViewSelector, 'VIDEO')
        this.liveViewMode = 'VIDEO'
        await this.waitForDeviceReady()
    }

    private responseDescription(code: number): string {
        const name = Object.values(this.registry.responses).find(response => response.code === code)?.name
        return `${name || 'UnknownResponse'} (0x${code.toString(16)})`
    }

    private async pollDeviceReady(timeoutMilliseconds = 5000, acceptedResponses: readonly number[] = []): Promise<number> {
        const deadline = Date.now() + timeoutMilliseconds
        while (Date.now() < deadline) {
            const response = await this.send(this.registry.operations.DeviceReady, {})
            if (response.code === OK.code || acceptedResponses.includes(response.code)) return response.code
            if (response.code !== DeviceBusy.code)
                throw new Error(`Nikon DeviceReady failed: ${this.responseDescription(response.code)}`)
            await this.waitMs(10)
        }
        throw new Error('Nikon DeviceReady timed out')
    }

    private async waitForDeviceReady(): Promise<void> {
        await this.pollDeviceReady()
    }

    private async waitForImageBufferReady(): Promise<void> {
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
            const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            if (!condition.includes('imagesInBuffer')) return
            await this.waitMs(10)
        }
        throw new Error('Nikon image buffer did not become ready within 5000 milliseconds')
    }
}
