import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfo } from '@ptp/datasets/storage-info-dataset'
import { parseLiveViewDataset } from '@ptp/datasets/vendors/sony/sony-live-view-dataset'
import { SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { randomSessionId } from '@ptp/definitions/session'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { createSonyRegistry, type SonyRegistry } from '@ptp/registry'
import type { CodecType } from '@ptp/types/codec'
import { EventDefinition } from '@ptp/types/event'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { GenericCamera } from './generic-camera'

const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002

export class SonyCamera extends GenericCamera {
    private liveViewPostViewEnabled = false
    private contentTransferModeEnabled = false
    vendorId = VendorIDs.SONY
    declare public registry: SonyRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createSonyRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (!this.transport.isConnected()) {
            await this.transport.connect({ ...device, ...(this.vendorId && { vendorId: this.vendorId }) })
        }

        this.sessionId = randomSessionId()

        const openResult = await this.send(this.registry.operations.SDIO_OpenSession, {
            SessionId: this.sessionId,
            FunctionMode: 'REMOTE_AND_CONTENT_TRANSFER',
        })

        if (openResult.code === SessionAlreadyOpen.code) {
            await this.send(this.registry.operations.CloseSession, {})
            await this.send(this.registry.operations.SDIO_OpenSession, {
                SessionId: this.sessionId,
                FunctionMode: 'REMOTE_AND_CONTENT_TRANSFER',
            })
        }

        // probably not needed in recent testing
        // small delay required before authentication
        // await this.waitMs(100)

        await this.authenticate()

        await this.set(this.registry.properties.PositionKeySetting, 'HOST_PRIORITY')
        await this.set(this.registry.properties.StillImageSaveDestination, 'CAMERA_DEVICE')
    }

    async disconnect(): Promise<void> {
        await this.disableContentTransferMode()
        await this.stopLiveView()
        await super.disconnect()
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        // Don't disable content transfer mode when checking ContentTransferEnable itself (prevents recursion)
        if (property.code !== this.registry.properties.ContentTransferEnable.code) {
            await this.disableContentTransferMode()
        }
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        const response = await this.send(this.registry.operations.SDIO_GetExtDevicePropValue, {
            DevicePropCode: property.code,
        })

        if (!response.data) {
            throw new Error(
                `No data received from SDIO_GetExtDevicePropValue for ${property.name} (response code: 0x${response.code.toString(16)})`
            )
        }

        const propInfo = response.data
        return propInfo.currentValueDecoded as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        // Don't disable content transfer mode when setting ContentTransferEnable itself (prevents recursion)
        if (property.code !== this.registry.properties.ContentTransferEnable.code) {
            await this.disableContentTransferMode()
        }
        if (!property.access.includes('Set')) {
            throw new Error(`Property ${property.name} is not writable`)
        }

        const isControlProperty =
            /ShutterReleaseButton|ShutterHalfReleaseButton|S1S2Button|SetLiveViewEnable|SetPostViewEnable|MovieRecButton/i.test(
                property.name
            )

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        if (isControlProperty) {
            await this.send(
                this.registry.operations.SDIO_ControlDevice,
                {
                    sdiControlCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
        } else {
            await this.send(
                this.registry.operations.SDIO_SetExtDevicePropValue,
                {
                    DevicePropCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
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
        return this.get(this.registry.properties.Aperture)
    }

    async setAperture(value: string): Promise<void> {
        return this.set(this.registry.properties.Aperture, value)
    }

    async getShutterSpeed(): Promise<string> {
        return this.get(this.registry.properties.ShutterSpeed)
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.set(this.registry.properties.ShutterSpeed, value)
    }

    async getIso(): Promise<string> {
        return this.get(this.registry.properties.Iso)
    }

    async setIso(value: string): Promise<void> {
        return this.set(this.registry.properties.Iso, value)
    }

    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        await this.disableContentTransferMode()
        await this.startLiveView()

        await this.set(this.registry.properties.S1S2Button, 'DOWN')
        await this.waitForFocus()
        await this.set(this.registry.properties.S1S2Button, 'UP')
        const capturedImageObjectHandle = await this.waitForCapturedImageObjectHandle()

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
                (info?.objectCompressedSize || this.captureBufferSize) + this.bufferPadding
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
        await this.disableContentTransferMode()
        await this.startLiveView()

        let info: ObjectInfo | undefined = undefined
        let data: Uint8Array | undefined = undefined

        if (includeInfo) {
            const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
            })
            info = objectInfoResponse.data
        }
        if (includeData) {
            const objectResponse = await this.send(this.registry.operations.GetObject, {
                ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
            })
            const liveViewData = parseLiveViewDataset(objectResponse.data, this.registry)
            data = liveViewData.liveViewImage
        }

        return { info: info, data: data }
    }

    async startRecording(): Promise<void> {
        await this.disableContentTransferMode()
        await this.set(this.registry.properties.MovieRecButton, 'DOWN')
    }

    async stopRecording(): Promise<void> {
        await this.disableContentTransferMode()
        await this.set(this.registry.properties.MovieRecButton, 'UP')
    }

    async listObjects(): Promise<{
        [storageId: number]: {
            info: StorageInfo
            objects: { [objectHandle: number]: ObjectInfo }
        }
    }> {
        await this.enableContentTransferMode()
        const objects = await super.listObjects()

        return objects
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        await this.enableContentTransferMode()

        // Start transfer tracking
        this.logger.startTransfer(objectHandle, this.sessionId, 0, 'SDIO_GetPartialLargeObject', objectSize)

        const chunks: Uint8Array[] = []
        let offset = 0

        while (offset < objectSize) {
            const bytesToRead = Math.min(this.defaultChunkSize, objectSize - offset)

            // Split 64-bit offset into two 32-bit values
            const offsetLower = offset & 0xffffffff
            const offsetUpper = Math.floor(offset / 0x100000000)

            const chunkResponse = await this.send(
                this.registry.operations.SDIO_GetPartialLargeObject,
                {
                    ObjectHandle: objectHandle,
                    OffsetLower: offsetLower,
                    OffsetUpper: offsetUpper,
                    MaxBytes: bytesToRead,
                },
                undefined,
                bytesToRead + 12
            )

            if (!chunkResponse.data) {
                throw new Error('No data received from SDIO_GetPartialLargeObject')
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

    protected async waitForCapturedImageObjectHandle(): Promise<number> {
        let capturedImageObjectHandle: number | null = null
        this.on(this.registry.events.SDIE_ObjectAdded, event => {
            if (event.ObjectHandle) {
                capturedImageObjectHandle = event.ObjectHandle
            }
        })
        while (!capturedImageObjectHandle) {
            console.log('Waiting for captured image object handle...')
            await this.waitMs(10)
        }
        this.off(this.registry.events.CaptureComplete)

        return capturedImageObjectHandle
    }

    private async waitForFocus(): Promise<void> {
        let isFocused = false
        this.on(this.registry.events.SDIE_AFStatus, event => {
            if (event.Status === 'AF_C_FOCUSED' || event.Status === 'AF_S_FOCUSED') {
                isFocused = true
            }
        })
        while (!isFocused) {
            console.log('Waiting for focus...')
            await this.waitMs(10)
        }
        this.off(this.registry.events.SDIE_AFStatus)
    }

    private async startLiveView(): Promise<void> {
        // NOTE from Sony documentation:
        // When using Get Image File and Live View while connected in “Remote Control with Transfer Mode,”
        // it is necessary to enable the features using Set PostView Enable and Set LiveView Enable, respectively.
        if (!this.liveViewPostViewEnabled) {
            await this.set(this.registry.properties.SetLiveViewEnable, 'ENABLE')
            await this.set(this.registry.properties.SetPostViewEnable, 'ENABLE')
            this.liveViewPostViewEnabled = true
        }
    }

    private async stopLiveView(): Promise<void> {
        if (this.liveViewPostViewEnabled) {
            await this.set(this.registry.properties.SetLiveViewEnable, 'DISABLE')
            await this.set(this.registry.properties.SetPostViewEnable, 'DISABLE')
            this.liveViewPostViewEnabled = false
        }
    }

    private async enableContentTransferMode(): Promise<void> {
        while (!this.contentTransferModeEnabled) {
            await this.send(this.registry.operations.SDIO_SetContentsTransferMode, {
                ContentsSelectType: 'HOST',
                TransferMode: 'ENABLE',
                AdditionalInformation: 'NONE',
            })
            await this.waitMs(100)
            this.contentTransferModeEnabled =
                (await this.get(this.registry.properties.ContentTransferEnable)) === 'ENABLE'
        }
    }

    private async disableContentTransferMode(): Promise<void> {
        while (this.contentTransferModeEnabled) {
            await this.send(this.registry.operations.SDIO_SetContentsTransferMode, {
                ContentsSelectType: 'HOST',
                TransferMode: 'DISABLE',
                AdditionalInformation: 'NONE',
            })
            await this.waitMs(100)
            this.contentTransferModeEnabled =
                (await this.get(this.registry.properties.ContentTransferEnable)) === 'ENABLE' // Keep enabled if still ENABLE
        }
    }

    private async authenticate(): Promise<void> {
        await this.send(this.registry.operations.SDIO_Connect, {
            phaseType: 'PHASE_1',
            keyCode1: 'DEFAULT',
            keyCode2: 'DEFAULT',
        })

        await this.send(this.registry.operations.SDIO_Connect, {
            phaseType: 'PHASE_2',
            keyCode1: 'DEFAULT',
            keyCode2: 'DEFAULT',
        })

        await this.send(this.registry.operations.SDIO_GetExtDeviceInfo, {
            initiatorVersion: '3.00',
            flagOfDevicePropertyOption: 'ENABLE',
        })

        await this.send(this.registry.operations.SDIO_Connect, {
            phaseType: 'PHASE_3',
            keyCode1: 'DEFAULT',
            keyCode2: 'DEFAULT',
        })
    }
}
