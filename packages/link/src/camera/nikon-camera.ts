import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { ISOAutoControl } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import { createNikonRegistry, type NikonRegistry } from '@ptp/registry'
import type { CodecType } from '@ptp/types/codec'
import { EventDefinition } from '@ptp/types/event'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams } from '@ptp/types/type-helpers'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { GenericCamera } from './generic-camera'

export class NikonCamera extends GenericCamera {
    private cameraMode: 'PC_CAMERA' | 'REMOTE' | 'UNKNOWN' = 'UNKNOWN'
    private liveViewMode: 'PHOTO' | 'VIDEO' | 'UNKNOWN' = 'UNKNOWN'
    private applicationMode: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN'
    private liveViewStatus: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN'

    vendorId = VendorIDs.NIKON
    declare public registry: NikonRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createNikonRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)
    }

    async disconnect(): Promise<void> {
        await this.disableLiveView()
        await super.disconnect()
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

        await this.send(
            this.registry.operations.SetDevicePropValueEx,
            {
                DevicePropCode: property.code,
            },
            encodedValue
        )
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

        // update live view status and mode
        await this.getLiveViewStatus()

        // camera's hardware dial is in photo mode, great, screen will stay on
        if (this.liveViewMode === 'PHOTO') {
            await this.enableLiveView()
            const response = await this.send(this.registry.operations.InitiateCapture, {})
        }

        // camera's hardware dial is not in photo mode
        // we must temporarily enable remote mode which will blank out the screen, then go back to PC Camera mode
        else if (this.liveViewMode === 'VIDEO') {
            await this.enableRemoteMode()
            await this.enablePhotoMode()
            await this.enableLiveView()
            const response = await this.send(this.registry.operations.InitiateCapture, {})
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
    }> {
        await this.enableLiveView()

        let info: ObjectInfo | undefined = undefined
        let data: Uint8Array | undefined = undefined

        if (includeInfo) {
            // Nikon does not support this for live view images
        }
        if (includeData) {
            const response = await this.send(
                this.registry.operations.GetLiveViewImageEx,
                {},
                undefined,
                this.liveViewBufferSize + this.bufferPadding
            )
            data = response.data.liveViewImage
        }

        return { info: info, data: data }
    }

    async startRecording(): Promise<void> {
        // Setup capture

        // update live view status and mode
        await this.getLiveViewStatus()

        await this.waitForDeviceReady()

        // camera's hardware dial is in video mode, great, screen will stay on
        if (this.liveViewMode === 'VIDEO') {
            await this.enableLiveView()
            await this.enableApplicationMode()

            await this.waitForImageBufferReady()

            const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            if (prohibitionCondition !== 'none') {
                console.error(`Movie recording is prohibited: ${prohibitionCondition}`)
            }

            const response = await this.send(this.registry.operations.StartMovieRecord, {})
        }
        // camera's hardware dial is not in video mode
        // we must temporarily enable remote mode which will blank out the screen, then go back to PC Camera mode
        else if (this.liveViewMode === 'PHOTO') {
            await this.enableRemoteMode()
            await this.enableVideoMode()
            await this.enableLiveView()
            await this.enableApplicationMode()

            await this.waitForImageBufferReady()

            const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            if (prohibitionCondition !== 'none') {
                console.error(`Movie recording is prohibited: ${prohibitionCondition}`)
            }

            // this will often fail with 0xa004 (Invalid Status) but it actually works
            const response = await this.send(this.registry.operations.StartMovieRecord, {})
        }
    }

    async stopRecording(): Promise<void> {
        await this.send(this.registry.operations.EndMovieRecord, {})
        await this.waitForDeviceReady()
        await this.waitForImageBufferReady()
        await this.disableLiveView()
        await this.disableApplicationMode()
        await this.enablePcCameraMode()
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        // Start transfer tracking
        this.logger.startTransfer(objectHandle, this.sessionId, 0, 'GetPartialObjectEx', objectSize)

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

        await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'REMOTE' })
        await this.waitForDeviceReady()
        this.cameraMode = 'REMOTE'
    }

    private async enablePcCameraMode(): Promise<void> {
        if (this.cameraMode === 'PC_CAMERA') {
            return
        }

        await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'PC_CAMERA' })
        await this.waitForDeviceReady()
        this.cameraMode = 'PC_CAMERA'
    }

    private async enableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'ON') {
            return
        }

        await this.send(this.registry.operations.ChangeApplicationMode, { Mode: 'ON' })
        await this.waitForDeviceReady()
        this.applicationMode = 'ON'
    }

    private async disableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'OFF') {
            return
        }

        await this.send(this.registry.operations.ChangeApplicationMode, { Mode: 'OFF' })
        await this.waitForDeviceReady()
        this.applicationMode = 'OFF'
    }

    private async enableLiveView(): Promise<void> {
        if (this.liveViewStatus === 'ON') {
            return
        }

        await this.send(this.registry.operations.StartLiveView, {})
        await this.waitForDeviceReady()
        this.liveViewStatus = 'ON'
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
        if (this.liveViewStatus === 'OFF') {
            return
        }

        await this.send(this.registry.operations.EndLiveView, {})
        await this.waitForDeviceReady()
        this.liveViewStatus = 'OFF'
    }

    private async enablePhotoMode(): Promise<void> {
        if (this.liveViewMode === 'PHOTO') {
            return
        }

        await this.set(this.registry.properties.LiveViewSelector, 'PHOTO')
        await this.waitForDeviceReady()
        this.liveViewMode = 'PHOTO'
    }

    private async enableVideoMode(): Promise<void> {
        if (this.liveViewMode === 'VIDEO') {
            return
        }

        await this.set(this.registry.properties.LiveViewSelector, 'VIDEO')
        await this.waitForDeviceReady()
        this.liveViewMode = 'VIDEO'
    }

    private async waitForDeviceReady(): Promise<void> {
        let isReady = false
        while (!isReady) {
            const response = await this.send(this.registry.operations.DeviceReady, {})
            if (response.code === OK.code) {
                isReady = true
            }
            await this.waitMs(10)
        }
    }

    private async waitForImageBufferReady(): Promise<void> {
        let isReady = false
        while (!isReady) {
            const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)

            if (!prohibitionCondition.includes('imagesInBuffer')) {
                isReady = true
            }
            await this.waitMs(10)
        }
    }
}
