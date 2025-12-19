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
    private liveViewEnabled = false
    vendorId = VendorIDs.NIKON
    declare public registry: NikonRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createNikonRegistry(transport.isLittleEndian())
    }

    async disconnect(): Promise<void> {
        await this.stopLiveView()
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

    async captureLiveView({
        includeInfo = true,
        includeData = true,
    }): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
        await this.startLiveView()

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

    async startLiveView(): Promise<void> {
        if (!this.liveViewEnabled) {
            await this.send(this.registry.operations.StartLiveView, {})
            await this.waitForLiveViewReady()
            this.liveViewEnabled = true
        }
    }

    async stopLiveView(): Promise<void> {
        await this.send(this.registry.operations.EndLiveView, {})
        this.liveViewEnabled = false
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

    private async waitForLiveViewReady(): Promise<void> {
        let isReady = false
        while (!isReady) {
            const response = await this.send(this.registry.operations.DeviceReady, {})
            if (response.code === OK.code) {
                isReady = true
            }
            await this.waitMs(10)
        }
    }
}
