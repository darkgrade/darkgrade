import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { DeviceBusy, OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { ISOAutoControl } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import { NotLiveView } from '@ptp/definitions/vendors/nikon/nikon-response-definitions'
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
        try {
            if (this.liveViewStatus === 'ON') await this.disableLiveView()
        } finally {
            await super.disconnect()
        }
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
        this.assertNikonResponse(response.code, 'SetDevicePropValueEx')
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

    /** Command-only release is available; this implementation does not retrieve the new still object or its metadata. */
    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        if (includeInfo || includeData)
            throw new Error(
                'Nikon still-image retrieval is not implemented; command acceptance alone does not provide image media'
            )
        const info: ObjectInfo | undefined = undefined
        const data: Uint8Array | undefined = undefined

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
            const response = await this.send(this.registry.operations.InitiateCapture, {})
            this.assertNikonResponse(response.code, 'InitiateCapture')
            await this.waitForDeviceReady()
            return { info, data }
        }

        // camera's hardware dial is in photo mode, great, screen will stay on
        if (this.liveViewMode === 'PHOTO') {
            await this.enableLiveView()
            const response = await this.send(this.registry.operations.InitiateCapture, {})
            this.assertNikonResponse(response.code, 'InitiateCapture')
            await this.waitForDeviceReady()
        }

        // camera's hardware dial is not in photo mode
        // we must temporarily enable remote mode which will blank out the screen, then go back to PC Camera mode
        else if (this.liveViewMode === 'VIDEO') {
            try {
                await this.enableRemoteMode()
                await this.selectLiveViewMode('PHOTO')
                await this.enableLiveView()
                const response = await this.send(this.registry.operations.InitiateCapture, {})
                this.assertNikonResponse(response.code, 'InitiateCapture')
                await this.waitForDeviceReady()
                await this.waitForImageBufferReady()
            } finally {
                try {
                    await this.selectLiveViewMode('VIDEO', true)
                } finally {
                    await this.enablePcCameraMode()
                }
            }
        } else throw new Error('Nikon live-view selector is unknown; capture was not sent')

        return { info: info, data: data }
    }

    async captureLiveView({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        await this.enableLiveView()

        const info: ObjectInfo | undefined = undefined
        let data: Uint8Array | undefined = undefined

        if (includeInfo) {
            // Nikon does not support this for live view images
        }
        if (includeData) {
            let response:
                Awaited<ReturnType<typeof this.send<typeof this.registry.operations.GetLiveViewImageEx>>> | undefined
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
            data = response.data.liveViewImage
        }

        return { info: info, data: data }
    }

    /** Checks the current prohibition bitfield and command result; a successful command still needs recording readback by its caller. */
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
                throw new Error(`Nikon movie recording is prohibited: ${prohibitionCondition}`)
            }

            const response = await this.send(this.registry.operations.StartMovieRecord, {})
            this.assertNikonResponse(response.code, 'StartMovieRecord')
        }
        // camera's hardware dial is not in video mode
        // we must temporarily enable remote mode which will blank out the screen, then go back to PC Camera mode
        else if (this.liveViewMode === 'PHOTO') {
            await this.enableRemoteMode()
            await this.selectLiveViewMode('VIDEO')
            await this.enableLiveView()
            await this.enableApplicationMode()

            await this.waitForImageBufferReady()

            const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            if (prohibitionCondition !== 'none') {
                throw new Error(`Nikon movie recording is prohibited: ${prohibitionCondition}`)
            }

            const response = await this.send(this.registry.operations.StartMovieRecord, {})
            this.assertNikonResponse(response.code, 'StartMovieRecord')
        } else throw new Error('Nikon live-view selector is unknown; recording was not started')
    }

    async stopRecording(): Promise<void> {
        const response = await this.send(this.registry.operations.EndMovieRecord, {})
        this.assertNikonResponse(response.code, 'EndMovieRecord')
        await this.waitForDeviceReady()
        await this.waitForImageBufferReady()
        await this.disableLiveView()
        await this.disableApplicationMode()
        await this.enablePcCameraMode()
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        if (!Number.isSafeInteger(objectSize) || objectSize < 0)
            throw new Error('Nikon object size must be a nonnegative safe integer')
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

            this.assertNikonResponse(chunkResponse.code, 'GetPartialObjectEx')
            if (!chunkResponse.data?.length || chunkResponse.data.length > bytesToRead) {
                throw new Error('GetPartialObjectEx returned an empty or oversized chunk')
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

        this.cameraMode = 'UNKNOWN'
        const response = await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'REMOTE' })
        this.assertNikonResponse(response.code, 'ChangeCameraMode')
        await this.waitForDeviceReady()
        this.cameraMode = 'REMOTE'
    }

    private async enablePcCameraMode(): Promise<void> {
        if (this.cameraMode === 'PC_CAMERA') {
            return
        }

        this.cameraMode = 'UNKNOWN'
        const response = await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'PC_CAMERA' })
        this.assertNikonResponse(response.code, 'ChangeCameraMode')
        await this.waitForDeviceReady()
        this.cameraMode = 'PC_CAMERA'
    }

    private async enableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'ON') {
            return
        }

        const response = await this.send(this.registry.operations.ChangeApplicationMode, { Mode: 'ON' })
        this.assertNikonResponse(response.code, 'ChangeApplicationMode')
        await this.waitForDeviceReady()
        this.applicationMode = 'ON'
    }

    private async disableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'OFF') {
            return
        }

        const response = await this.send(this.registry.operations.ChangeApplicationMode, { Mode: 'OFF' })
        this.assertNikonResponse(response.code, 'ChangeApplicationMode')
        await this.waitForDeviceReady()
        this.applicationMode = 'OFF'
    }

    private async enableLiveView(): Promise<void> {
        if (this.liveViewStatus === 'ON') {
            return
        }

        const response = await this.send(this.registry.operations.StartLiveView, {})
        if (response.code !== OK.code && response.code !== DeviceBusy.code) {
            throw new Error(`Nikon StartLiveView failed with response 0x${response.code.toString(16)}`)
        }
        await this.waitForDeviceReady()
        this.liveViewStatus = 'ON'
    }

    private async getLiveViewStatus(): Promise<void> {
        const liveViewStatus = await this.get(this.registry.properties.LiveViewStatus)
        await this.waitForDeviceReady()
        if (liveViewStatus !== 'ON' && liveViewStatus !== 'OFF') throw new Error('Nikon live-view status is unknown')
        this.liveViewStatus = liveViewStatus

        const liveViewMode = await this.get(this.registry.properties.LiveViewSelector)
        await this.waitForDeviceReady()
        if (liveViewMode !== 'VIDEO' && liveViewMode !== 'PHOTO') throw new Error('Nikon live-view selector is unknown')
        this.liveViewMode = liveViewMode
    }

    private async disableLiveView(): Promise<void> {
        if (this.liveViewStatus !== 'ON') return

        const response = await this.send(this.registry.operations.EndLiveView, {})
        if (response.code !== OK.code && response.code !== NotLiveView.code) {
            throw new Error(`Nikon EndLiveView failed with response 0x${response.code.toString(16)}`)
        }
        await this.waitForDeviceReady()
        this.liveViewStatus = 'OFF'
    }

    /** A failed activation may still have changed the selector; forced restoration sends the original value despite stale caches. */
    private async selectLiveViewMode(mode: 'PHOTO' | 'VIDEO', force = false): Promise<void> {
        if (!force && this.liveViewMode === mode) return
        this.liveViewMode = 'UNKNOWN'
        await this.set(this.registry.properties.LiveViewSelector, mode)
        await this.waitForDeviceReady()
        this.liveViewMode = mode
    }

    /** Nikon activation commands may return DeviceBusy while pending; other refusals are terminal. */
    private async waitForDeviceReady(): Promise<void> {
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
            const response = await this.send(this.registry.operations.DeviceReady, {})
            if (response.code === OK.code) {
                return
            }
            if (response.code !== DeviceBusy.code) this.assertNikonResponse(response.code, 'DeviceReady')
            await this.waitMs(10)
        }
        throw new Error('Nikon DeviceReady remained busy after 15000 ms')
    }

    private async waitForImageBufferReady(): Promise<void> {
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
            const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)

            if (!prohibitionCondition.includes('imagesInBuffer')) {
                return
            }
            await this.waitMs(10)
        }
        throw new Error('Nikon image buffer remained busy after 15000 ms')
    }

    private assertNikonResponse(code: number, operation: string): void {
        if (code !== OK.code) throw new Error(`Nikon ${operation} returned 0x${code.toString(16)}`)
    }
}
