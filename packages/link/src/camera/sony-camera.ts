import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfo } from '@ptp/datasets/storage-info-dataset'
import type { SonyDevicePropDesc } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import { parseLiveViewDataset } from '@ptp/datasets/vendors/sony/sony-live-view-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
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
const SONY_ZOOM_CONTROL_CODE = 0xd214
const SONY_ZOOM_SPEED_CONTROL_CODE = 0xd25e
const SONY_CONTROL_SETTLE_TIMEOUT_MS = 3_000
const SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS = 20

export interface SonyPropertyState {
    code: number
    codeHex: string
    name: string
    description: string
    value: number | bigint | string
    rawValue: number | bigint | string
    allowedValues?: Array<number | bigint | string>
    allowedRawValues?: Array<number | bigint | string>
    writable: boolean
    enabled: boolean
    sonyEnabledFlag: number
    sonyGetSetFlag: number
}

export interface SonyZoomResult {
    direction: 'wide' | 'tele'
    pulses: number
    beforeMillimetres: number
    afterMillimetres: number
    movementConfirmed: boolean
    method: 'speed-control' | 'incremental-position'
}

export class SonyCamera extends GenericCamera {
    private liveViewPostViewEnabled = false
    private contentTransferModeEnabled = false
    private propertyCache = new Map<number, SonyDevicePropDesc>()
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

        await this.refreshPropertyStates()

        await this.set(this.registry.properties.PositionKeySetting, 'HOST_PRIORITY')
        await this.set(this.registry.properties.StillImageSaveDestination, 'CAMERA_DEVICE')
        await this.refreshPropertyStates()
    }

    async disconnect(): Promise<void> {
        let cleanupError: unknown
        try {
            await this.disableContentTransferMode()
        } catch (error) {
            cleanupError = error
        }
        try {
            await this.stopLiveView()
        } catch (error) {
            cleanupError ??= error
        }
        await super.disconnect()
        if (cleanupError) throw cleanupError
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
        this.propertyCache.set(propInfo.devicePropertyCode, propInfo)
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

        const isMomentaryControl =
            /ShutterReleaseButton|ShutterHalfReleaseButton|S1S2Button|SetLiveViewEnable|SetPostViewEnable|MovieRecButton/i.test(
                property.name
            )

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        if (isMomentaryControl) {
            const response = await this.send(
                this.registry.operations.SDIO_ControlDevice,
                {
                    sdiControlCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
            this.assertOk(response.code, `Sony control ${property.name}`)
        } else {
            const descriptor = this.propertyCache.get(property.code) ?? (await this.readDescriptor(property.code))
            this.assertPropertyEnabled(property, descriptor)
            const targetRaw = this.decodeRawPropertyValue(descriptor, encodedValue)
            this.assertAdvertisedValue(property, descriptor, targetRaw)

            if (descriptor.sonyGetSetFlag === 0) {
                await this.setIncrementalProperty(property, targetRaw)
                return
            }

            const response = await this.send(
                this.registry.operations.SDIO_SetExtDevicePropValue,
                {
                    DevicePropCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                encodedValue
            )
            this.assertOk(response.code, `Sony property ${property.name}`)
            await this.waitForPropertyValue(property.code, targetRaw)
        }
    }

    async refreshPropertyStates(): Promise<SonyPropertyState[]> {
        await this.disableContentTransferMode()
        const response = await this.send(
            this.registry.operations.SDIO_GetAllExtDevicePropInfo,
            {
                flagOfGetOnlyDifferenceData: 0,
                flagOfDevicePropertyOption: 'ENABLE',
            },
            undefined,
            4 * 1024 * 1024
        )
        this.assertOk(response.code, 'Sony property inventory')
        if (!response.data) throw new Error('Sony property inventory returned no data')
        for (const descriptor of response.data.properties) {
            this.propertyCache.set(descriptor.devicePropertyCode, descriptor)
        }
        const dashboardProperties = [
            this.registry.properties.Aperture,
            this.registry.properties.ShutterSpeed,
            this.registry.properties.Iso,
            this.registry.properties.WhiteBalance,
            this.registry.properties.FocusMode,
            this.registry.properties.CompressionSetting,
            this.registry.properties.SonyImageSize,
            this.registry.properties.AspectRatio,
            this.registry.properties.ColorTemperature,
            this.registry.properties.ZoomPosition,
            this.registry.properties.StillFileFormat,
            this.registry.properties.JpegQuality,
            this.registry.properties.MovieFileFormat,
            this.registry.properties.MovieRecordingSetting,
            this.registry.properties.MovieRecordingState,
            this.registry.properties.ZoomEnableStatus,
            this.registry.properties.ZoomScale,
            this.registry.properties.ZoomBarInfo,
            this.registry.properties.ZoomSpeed,
            this.registry.properties.ZoomSetting,
            this.registry.properties.ZoomTypeStatus,
        ]
        for (const property of dashboardProperties) {
            if (this.propertyCache.has(property.code)) continue
            await this.readDescriptor(property.code).catch(() => undefined)
        }
        return this.listPropertyStates()
    }

    listPropertyStates(): SonyPropertyState[] {
        return [...this.propertyCache.values()]
            .map(descriptor => ({
                code: descriptor.devicePropertyCode,
                codeHex: `0x${descriptor.devicePropertyCode.toString(16).padStart(4, '0')}`,
                name: descriptor.devicePropertyName,
                description: descriptor.devicePropertyDescription,
                value: descriptor.currentValueDecoded,
                rawValue: descriptor.currentValueRaw,
                ...(descriptor.supportedValuesDecoded?.length
                    ? { allowedValues: [...descriptor.supportedValuesDecoded] }
                    : {}),
                ...(descriptor.supportedValuesRaw?.length
                    ? { allowedRawValues: [...descriptor.supportedValuesRaw] }
                    : {}),
                writable:
                    descriptor.vendorExtensions.enabled &&
                    (descriptor.getSet === 'GET_SET' || this.isIncrementalProperty(descriptor.devicePropertyCode)),
                enabled: descriptor.vendorExtensions.enabled,
                sonyEnabledFlag: descriptor.sonyEnabledFlag,
                sonyGetSetFlag: descriptor.sonyGetSetFlag,
            }))
            .sort((left, right) => left.code - right.code)
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

    async getFocusMode(): Promise<string> {
        return this.get(this.registry.properties.FocusMode)
    }

    async setFocusMode(value: string): Promise<void> {
        return this.set(
            this.registry.properties.FocusMode,
            value as CodecType<typeof this.registry.properties.FocusMode.codec>
        )
    }

    async getWhiteBalance(): Promise<string> {
        return this.get(this.registry.properties.WhiteBalance)
    }

    async setWhiteBalance(value: string): Promise<void> {
        return this.set(
            this.registry.properties.WhiteBalance,
            value as CodecType<typeof this.registry.properties.WhiteBalance.codec>
        )
    }

    async getImageFormat(): Promise<string> {
        if (this.propertyCache.has(this.registry.properties.StillFileFormat.code)) {
            return this.get(this.registry.properties.StillFileFormat)
        }
        return this.get(this.registry.properties.CompressionSetting)
    }

    async setImageFormat(value: string): Promise<void> {
        if (this.propertyCache.has(this.registry.properties.StillFileFormat.code)) {
            return this.set(
                this.registry.properties.StillFileFormat,
                value as CodecType<typeof this.registry.properties.StillFileFormat.codec>
            )
        }
        return this.set(
            this.registry.properties.CompressionSetting,
            value as CodecType<typeof this.registry.properties.CompressionSetting.codec>
        )
    }

    async getJpegQuality(): Promise<string> {
        return this.get(this.registry.properties.JpegQuality)
    }

    async setJpegQuality(value: string): Promise<void> {
        return this.set(
            this.registry.properties.JpegQuality,
            value as CodecType<typeof this.registry.properties.JpegQuality.codec>
        )
    }

    async getMovieFileFormat(): Promise<string> {
        return this.get(this.registry.properties.MovieFileFormat)
    }

    async setMovieFileFormat(value: string): Promise<void> {
        return this.set(
            this.registry.properties.MovieFileFormat,
            value as CodecType<typeof this.registry.properties.MovieFileFormat.codec>
        )
    }

    async getMovieRecordingSetting(): Promise<string> {
        return this.get(this.registry.properties.MovieRecordingSetting)
    }

    async setMovieRecordingSetting(value: string): Promise<void> {
        return this.set(
            this.registry.properties.MovieRecordingSetting,
            value as CodecType<typeof this.registry.properties.MovieRecordingSetting.codec>
        )
    }

    async getMovieRecordingState(): Promise<string> {
        return this.get(this.registry.properties.MovieRecordingState)
    }

    async getImageSize(): Promise<string> {
        return this.get(this.registry.properties.SonyImageSize)
    }

    async setImageSize(value: string): Promise<void> {
        return this.set(
            this.registry.properties.SonyImageSize,
            value as CodecType<typeof this.registry.properties.SonyImageSize.codec>
        )
    }

    async getAspectRatio(): Promise<string> {
        return this.get(this.registry.properties.AspectRatio)
    }

    async setAspectRatio(value: string): Promise<void> {
        return this.set(
            this.registry.properties.AspectRatio,
            value as CodecType<typeof this.registry.properties.AspectRatio.codec>
        )
    }

    async getColorTemperature(): Promise<number> {
        return this.get(this.registry.properties.ColorTemperature)
    }

    async setColorTemperature(value: number): Promise<void> {
        return this.set(this.registry.properties.ColorTemperature, value)
    }

    async getZoomPosition(): Promise<number> {
        return this.get(this.registry.properties.ZoomPosition)
    }

    async getZoomEnableStatus(): Promise<string> {
        return this.get(this.registry.properties.ZoomEnableStatus)
    }

    async getZoomSetting(): Promise<string> {
        return this.get(this.registry.properties.ZoomSetting)
    }

    async setZoomSetting(value: string): Promise<void> {
        return this.set(
            this.registry.properties.ZoomSetting,
            value as CodecType<typeof this.registry.properties.ZoomSetting.codec>
        )
    }

    async getZoomTypeStatus(): Promise<string> {
        return this.get(this.registry.properties.ZoomTypeStatus)
    }

    async autofocus(durationMilliseconds = 800): Promise<void> {
        if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 100 || durationMilliseconds > 5_000) {
            throw new Error('Sony autofocus duration must be between 100 and 5000 milliseconds')
        }
        await this.startLiveView()
        await this.set(this.registry.properties.ShutterHalfReleaseButton, 'DOWN')
        try {
            // A half-press is still useful when a scene cannot lock focus. Treat the
            // camera's bounded acknowledgement as success here; full capture keeps
            // requiring positive focus confirmation before it presses the shutter.
            await this.waitForFocus(durationMilliseconds, false)
        } finally {
            await this.set(this.registry.properties.ShutterHalfReleaseButton, 'UP')
        }
        const controlsReady = await this.waitForPropertyEnabled(this.registry.properties.FocusMode.code)
        if (!controlsReady) {
            throw new Error(
                `Sony released autofocus but remote controls did not become writable within ${SONY_CONTROL_SETTLE_TIMEOUT_MS} ms`
            )
        }
    }

    async powerZoom(direction: 'wide' | 'tele', pulses = 1): Promise<SonyZoomResult> {
        if (!Number.isInteger(pulses) || pulses < 1 || pulses > 30) {
            throw new Error('Sony power-zoom pulses must be an integer between 1 and 30')
        }

        const descriptor = this.propertyCache.get(SONY_ZOOM_CONTROL_CODE) ?? (await this.readDescriptor(SONY_ZOOM_CONTROL_CODE))
        this.assertPropertyEnabled(this.registry.properties.ZoomPosition, descriptor)
        const beforeMillimetres = await this.getZoomPosition()
        const directionValue = direction === 'tele' ? 0x01 : -0x01
        const speedDescriptor = this.propertyCache.get(SONY_ZOOM_SPEED_CONTROL_CODE)
        const method: SonyZoomResult['method'] = speedDescriptor?.vendorExtensions.enabled
            ? 'speed-control'
            : 'incremental-position'

        if (method === 'speed-control') {
            const signedSpeed = directionValue * Math.min(8, pulses)
            try {
                const response = await this.send(
                    this.registry.operations.SDIO_ControlDevice,
                    {
                        sdiControlCode: SONY_ZOOM_SPEED_CONTROL_CODE,
                        flagOfDevicePropertyOption: 'ENABLE',
                    },
                    this.registry.codecs.int8.encode(signedSpeed)
                )
                this.assertOk(response.code, `Sony power zoom ${direction}`)
                await this.waitMs(Math.max(250, pulses * 125))
            } finally {
                const stop = await this.send(
                    this.registry.operations.SDIO_ControlDevice,
                    {
                        sdiControlCode: SONY_ZOOM_SPEED_CONTROL_CODE,
                        flagOfDevicePropertyOption: 'ENABLE',
                    },
                    this.registry.codecs.int8.encode(0)
                )
                this.assertOk(stop.code, 'Sony power zoom stop')
            }
        } else {
            for (let index = 0; index < pulses; index++) {
                const response = await this.send(
                    this.registry.operations.SDIO_ControlDevice,
                    {
                        sdiControlCode: SONY_ZOOM_CONTROL_CODE,
                        flagOfDevicePropertyOption: 'ENABLE',
                    },
                    this.registry.codecs.int8.encode(directionValue)
                )
                this.assertOk(response.code, `Sony power zoom ${direction}`)
                await this.waitMs(125)
            }
        }

        const afterMillimetres = await this.waitForZoomMovement(beforeMillimetres)
        const result = {
            direction,
            pulses,
            beforeMillimetres,
            afterMillimetres,
            movementConfirmed: afterMillimetres !== beforeMillimetres,
            method,
        }
        if (!result.movementConfirmed) {
            throw new Error(
                `Sony accepted the ${direction} zoom command but the lens remained at ${beforeMillimetres.toFixed(3)} mm; verify that a power-zoom lens is mounted and Remote Zoom Speed is enabled on the body`
            )
        }
        return result
    }

    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        await this.disableContentTransferMode()
        await this.startLiveView()

        await this.set(this.registry.properties.S1S2Button, 'DOWN')
        try {
            await this.waitForFocus()
        } finally {
            await this.set(this.registry.properties.S1S2Button, 'UP')
        }
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
        this.logger.startTransfer(objectHandle, this.sessionId!, 0, 'SDIO_GetPartialLargeObject', objectSize)

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
        return new Promise<number>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.off(this.registry.events.SDIE_ObjectAdded, handler)
                reject(new Error('Timed out after 15 seconds waiting for the Sony captured-image handle'))
            }, 15_000)
            const handler = (event: { ObjectHandle?: number }) => {
                if (!event.ObjectHandle) return
                clearTimeout(timeout)
                this.off(this.registry.events.SDIE_ObjectAdded, handler)
                resolve(event.ObjectHandle)
            }
            this.on(this.registry.events.SDIE_ObjectAdded, handler)
        })
    }

    private async waitForFocus(timeoutMilliseconds = 3_000, requireConfirmation = true): Promise<boolean> {
        let isFocused = false
        const handler = (event: { Status?: string }) => {
            isFocused = event.Status === 'AF_C_FOCUSED' || event.Status === 'AF_S_FOCUSED'
        }
        this.on(this.registry.events.SDIE_AFStatus, handler)
        const deadline = Date.now() + timeoutMilliseconds
        try {
            while (!isFocused && Date.now() < deadline) {
                try {
                    const status = await this.get(this.registry.properties.FocusIndication)
                    isFocused = status === 'AF_C_FOCUSED' || status === 'AF_S_FOCUSED'
                } catch {}
                if (!isFocused) await this.waitMs(50)
            }
            if (!isFocused && requireConfirmation) {
                throw new Error(`Sony autofocus did not report focus within ${timeoutMilliseconds} ms`)
            }
            return isFocused
        } finally {
            this.off(this.registry.events.SDIE_AFStatus, handler)
        }
    }

    private async readDescriptor(propertyCode: number): Promise<SonyDevicePropDesc> {
        const response = await this.send(this.registry.operations.SDIO_GetExtDevicePropValue, {
            DevicePropCode: propertyCode,
        })
        this.assertOk(response.code, `Sony property 0x${propertyCode.toString(16)}`)
        if (!response.data) throw new Error(`Sony property 0x${propertyCode.toString(16)} returned no descriptor`)
        this.propertyCache.set(propertyCode, response.data)
        return response.data
    }

    private assertPropertyEnabled(property: PropertyDefinition, descriptor: SonyDevicePropDesc): void {
        if (!descriptor.vendorExtensions.enabled) {
            throw new Error(
                `${property.name} is currently disabled by the attached Sony camera (availability flag ${descriptor.sonyEnabledFlag}); another camera setting or operating mode may need to change first`
            )
        }
    }

    private assertAdvertisedValue(
        property: PropertyDefinition,
        descriptor: SonyDevicePropDesc,
        targetRaw: number | bigint | string
    ): void {
        const advertised = descriptor.supportedValuesRaw
        if (advertised?.length && !advertised.some(candidate => candidate === targetRaw)) {
            throw new Error(`${property.name} value ${String(targetRaw)} was not advertised by the attached Sony camera`)
        }
        if (
            typeof targetRaw === 'number' &&
            typeof descriptor.minimumValue === 'number' &&
            typeof descriptor.maximumValue === 'number'
        ) {
            if (targetRaw < descriptor.minimumValue || targetRaw > descriptor.maximumValue) {
                throw new Error(
                    `${property.name} value ${targetRaw} is outside the advertised range ${descriptor.minimumValue}–${descriptor.maximumValue}`
                )
            }
            if (
                typeof descriptor.stepSize === 'number' &&
                descriptor.stepSize > 0 &&
                (targetRaw - descriptor.minimumValue) % descriptor.stepSize !== 0
            ) {
                throw new Error(`${property.name} value ${targetRaw} does not align to step ${descriptor.stepSize}`)
            }
        }
    }

    private decodeRawPropertyValue(
        descriptor: SonyDevicePropDesc,
        encodedValue: Uint8Array
    ): number | bigint | string {
        const datatype = getDatatypeByCode(descriptor.dataType)
        if (!datatype?.codec) throw new Error(`Unsupported Sony datatype 0x${descriptor.dataType.toString(16)}`)
        const value = this.resolveCodec(datatype.codec).decode(encodedValue).value
        if (Array.isArray(value)) throw new Error(`Sony datatype 0x${descriptor.dataType.toString(16)} was not scalar`)
        return value
    }

    private isIncrementalProperty(code: number): boolean {
        return [
            this.registry.properties.Aperture.code,
            this.registry.properties.ShutterSpeed.code,
            this.registry.properties.Iso.code,
            this.registry.properties.ExposureCompensation.code,
            SONY_ZOOM_CONTROL_CODE,
        ].includes(code)
    }

    private async setIncrementalProperty(
        property: PropertyDefinition,
        targetRaw: number | bigint | string
    ): Promise<void> {
        for (let attempt = 0; attempt < 100; attempt++) {
            const descriptor = this.propertyCache.get(property.code) ?? (await this.readDescriptor(property.code))
            if (descriptor.currentValueRaw === targetRaw) return

            const currentIndex = descriptor.supportedValuesRaw?.findIndex(value => value === descriptor.currentValueRaw) ?? -1
            const targetIndex = descriptor.supportedValuesRaw?.findIndex(value => value === targetRaw) ?? -1
            let direction: number
            if (currentIndex >= 0 && targetIndex >= 0) {
                direction = targetIndex > currentIndex ? 1 : -1
            } else if (typeof descriptor.currentValueRaw === 'number' && typeof targetRaw === 'number') {
                direction = targetRaw > descriptor.currentValueRaw ? 1 : -1
            } else {
                throw new Error(`${property.name} cannot be incremented from the camera's current descriptor`)
            }

            const before = descriptor.currentValueRaw
            const response = await this.send(
                this.registry.operations.SDIO_ControlDevice,
                {
                    sdiControlCode: property.code,
                    flagOfDevicePropertyOption: 'ENABLE',
                },
                this.registry.codecs.int8.encode(direction)
            )
            this.assertOk(response.code, `Sony incremental property ${property.name}`)

            const changed = await this.waitForPropertyChange(property.code, before)
            if (!changed) {
                throw new Error(
                    `Sony accepted the ${property.name} command but its value did not change from ${String(before)}`
                )
            }
        }
        throw new Error(`${property.name} did not reach ${String(targetRaw)} within 100 Sony control steps`)
    }

    private async waitForPropertyChange(
        propertyCode: number,
        before: number | bigint | string
    ): Promise<SonyDevicePropDesc | undefined> {
        const deadline = Date.now() + SONY_CONTROL_SETTLE_TIMEOUT_MS
        while (Date.now() < deadline) {
            await this.refreshPropertyStates()
            const descriptor = this.propertyCache.get(propertyCode)
            if (descriptor && descriptor.currentValueRaw !== before) return descriptor
            await this.waitMs(100)
        }
        return undefined
    }

    private async waitForPropertyEnabled(propertyCode: number): Promise<boolean> {
        const deadline = Date.now() + SONY_CONTROL_SETTLE_TIMEOUT_MS
        while (Date.now() < deadline) {
            await this.refreshPropertyStates()
            if (this.propertyCache.get(propertyCode)?.vendorExtensions.enabled) return true
            await this.waitMs(100)
        }
        return false
    }

    private async waitForPropertyValue(
        propertyCode: number,
        target: number | bigint | string
    ): Promise<SonyDevicePropDesc> {
        const deadline = Date.now() + SONY_CONTROL_SETTLE_TIMEOUT_MS
        while (Date.now() < deadline) {
            await this.refreshPropertyStates()
            const descriptor = this.propertyCache.get(propertyCode)
            if (descriptor?.currentValueRaw === target) return descriptor
            await this.waitMs(100)
        }
        throw new Error(
            `Sony property 0x${propertyCode.toString(16)} did not report target ${String(target)} within ${SONY_CONTROL_SETTLE_TIMEOUT_MS} ms`
        )
    }

    private async waitForZoomMovement(beforeMillimetres: number): Promise<number> {
        const deadline = Date.now() + 3_000
        let afterMillimetres = beforeMillimetres
        await this.waitMs(500)
        while (Date.now() < deadline) {
            // Immediately after an incremental zoom pulse some Sony bodies briefly
            // return a value-only D214 payload to the targeted descriptor request.
            // The full inventory remains well formed, so use it for confirmation.
            try {
                await this.refreshPropertyStates()
            } catch {
                await this.waitMs(150)
                continue
            }
            const descriptor = this.propertyCache.get(SONY_ZOOM_CONTROL_CODE)
            if (typeof descriptor?.currentValueDecoded === 'number') {
                afterMillimetres = descriptor.currentValueDecoded
            }
            if (afterMillimetres !== beforeMillimetres) return afterMillimetres
            await this.waitMs(100)
        }
        return afterMillimetres
    }

    private assertOk(responseCode: number, action: string): void {
        if (responseCode !== OK.code) {
            throw new Error(`${action} returned PTP response 0x${responseCode.toString(16)}`)
        }
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
        for (let attempt = 1; attempt <= SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS; attempt += 1) {
            if (this.contentTransferModeEnabled) return
            await this.send(this.registry.operations.SDIO_SetContentsTransferMode, {
                ContentsSelectType: 'HOST',
                TransferMode: 'ENABLE',
                AdditionalInformation: 'NONE',
            })
            await this.waitMs(100)
            this.contentTransferModeEnabled =
                (await this.get(this.registry.properties.ContentTransferEnable)) === 'ENABLE'
        }
        throw new Error(
            `Sony content-transfer mode did not enable after ${SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS} attempts`
        )
    }

    private async disableContentTransferMode(): Promise<void> {
        for (let attempt = 1; attempt <= SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS; attempt += 1) {
            if (!this.contentTransferModeEnabled) return
            await this.send(this.registry.operations.SDIO_SetContentsTransferMode, {
                ContentsSelectType: 'HOST',
                TransferMode: 'DISABLE',
                AdditionalInformation: 'NONE',
            })
            await this.waitMs(100)
            this.contentTransferModeEnabled =
                (await this.get(this.registry.properties.ContentTransferEnable)) === 'ENABLE' // Keep enabled if still ENABLE
        }
        throw new Error(
            `Sony content-transfer mode did not disable after ${SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS} attempts`
        )
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
