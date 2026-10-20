import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { CanonExtendedDeviceInfo } from '@ptp/datasets/vendors/canon/canon-extended-device-info-dataset'
import {
    canonImageFormatFromPacked,
    type CanonImageFormat,
} from '@ptp/datasets/vendors/canon/canon-image-format-dataset'
import {
    canonLiveViewPosition,
    type CanonLiveViewFrame,
    type CanonLiveViewPosition,
} from '@ptp/datasets/vendors/canon/canon-live-view-dataset'
import type { CanonMovieFormat } from '@ptp/datasets/vendors/canon/canon-movie-format-dataset'
import { OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CANON_PROPERTY_NAMES } from '@ptp/definitions/vendors/canon/canon-property-names'
import { CanonRegistry, createCanonRegistry } from '@ptp/registry'
import type { CodecType } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { GenericCamera } from './generic-camera'

export interface CanonPropertyState {
    code: number
    name: string
    description: string
    access: PropertyDefinition['access']
    value: unknown
    allowedValues?: unknown[]
}

export interface CanonUnknownPropertyState {
    code: number
    codeHex: string
    /** Diagnostic name only; the raw value and access remain unverified. */
    name?: string
    rawValue?: number
    valueDataHex?: string
    allowedValues?: number[]
    allowedValueDataHex?: string[]
}

export interface CanonNetworkState {
    communicationMode?: number
    communicationModeChoices?: number[]
    serverRegion?: number
    wftStatus?: number
}

function bytesToHex(value: Uint8Array): string {
    return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * TODO: reverse engineer EOS Utility with Wireshark
 *
 * Unlike other vendors Canon does not publish public docs on their PTP implementation
 *
 * They offer it under NDA which is not an option for an open-source project
 * Massive props to Julian Schroden for his work reverse-engineering Canon cameras
 * https://julianschroden.com/post/2023-04-23-analyzing-the-ptp-ip-protocol-with-wireshark/
 * https://julianschroden.com/post/2023-05-10-pairing-and-initializing-a-ptp-ip-connection-with-a-canon-eos-camera/
 * https://julianschroden.com/post/2023-05-28-controlling-properties-using-ptp-ip-on-canon-eos-cameras/
 * https://julianschroden.com/post/2023-06-15-capturing-images-using-ptp-ip-on-canon-eos-cameras/
 * https://julianschroden.com/post/2023-08-19-remote-live-view-using-ptp-ip-on-canon-eos-cameras/
 */
export class CanonCamera extends GenericCamera {
    private async withoutPolling<T>(fn: () => Promise<T>): Promise<T> {
        const wasPolling = this.polling
        if (wasPolling) {
            await this.stopPolling()
        }
        try {
            return await fn()
        } finally {
            if (wasPolling) {
                this.startPolling()
            }
        }
    }
    private polling = false
    private pollingLoop?: Promise<void>
    private liveViewEnabled = false
    private liveViewOriginalOutput?: CodecType<CanonRegistry['properties']['CanonLiveViewMode']['codec']>
    private supportedOperations?: Set<number>
    private advertisedPropertyData = new Map<PropertyDefinition, Uint8Array[]>()
    private propertyCache = new Map<
        PropertyDefinition,
        { current?: CodecType<PropertyDefinition['codec']>; allowed?: CodecType<PropertyDefinition['codec']>[] }
    >()
    private unknownPropertyCache = new Map<
        number,
        {
            rawValue?: number
            valueDataHex?: string
            allowedValues?: number[]
            allowedValueDataHex?: string[]
        }
    >()
    vendorId = VendorIDs.CANON
    declare public registry: CanonRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createCanonRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (!this.transport.isConnected()) {
            await this.transport.connect({ ...device, ...(this.vendorId && { vendorId: this.vendorId }) })
        }

        this.sessionId = 1
        await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
        const deviceInfo = await this.send(this.registry.operations.GetDeviceInfo, {})
        if (deviceInfo.code !== OK.code || !deviceInfo.data) throw new Error('Canon GetDeviceInfo failed')
        this.supportedOperations = new Set(deviceInfo.data.operationsSupportedRaw)
        await this.enableRemoteMode()
        await this.enableEventMode()

        // Flush initial property dump from camera and cache all properties
        await this.flushInitialEvents()

        this.startPolling()
    }

    async disconnect(): Promise<void> {
        await this.stopPolling()
        let failure: unknown
        for (const cleanup of [
            () => this.disableLiveView(),
            () => this.disableRemoteMode(),
            () => this.disableEventMode(),
            () => super.disconnect(),
        ]) {
            try {
                await cleanup()
            } catch (error) {
                failure ??= error
            }
        }
        if (failure) throw failure
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        const cached = this.propertyCache.get(property)
        if (!cached || cached.current === undefined) {
            throw new Error(
                `Property ${property.name} (0x${property.code.toString(16)}) not found in cache. The camera may not support this property or event mode is not enabled.`
            )
        }

        return cached.current as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        return this.withoutPolling(async () => {
            if (!property.access.includes('Set')) {
                throw new Error(`Property ${property.name} is not writable`)
            }

            const codec = this.resolveCodec(property.codec)
            const requestedValue = codec.encode(value)
            const advertisedValue = this.advertisedPropertyData.get(property)?.find(encoded => {
                try {
                    const canonical = codec.encode(codec.decode(encoded).value)
                    return (
                        canonical.length === requestedValue.length &&
                        canonical.every((byte, index) => byte === requestedValue[index])
                    )
                } catch {
                    return false
                }
            })
            const encodedValue = advertisedValue ?? requestedValue
            // Record is a command/state property: stop (0) may report standby (3).
            const verifyReadback =
                this.propertyCache.get(property)?.current !== undefined &&
                property.code !== this.registry.properties.CanonRecordingDestination.code

            const u32Codec = this.registry.codecs.uint32

            const totalSize = Math.max(12, 8 + encodedValue.length)
            const data = new Uint8Array(totalSize)

            const sizeBytes = u32Codec.encode(totalSize)
            data.set(sizeBytes, 0)

            const propCodeBytes = u32Codec.encode(property.code)
            data.set(propCodeBytes, 4)

            data.set(encodedValue, 8)

            let retries = 0
            const maxRetries = 5

            while (retries < maxRetries) {
                try {
                    const response = await this.send(this.registry.operations.CanonSetDevicePropValue, {}, data)
                    if (response.code !== OK.code) {
                        const error = new Error(`Canon ${property.name} write returned 0x${response.code.toString(16)}`)
                        Object.assign(error, { code: response.code })
                        throw error
                    }
                    break
                } catch (error: any) {
                    if (error.code === 0x2019) {
                        retries++
                        if (retries < maxRetries) {
                            await new Promise(resolve => setTimeout(resolve, 100))
                            continue
                        }
                    }
                    throw error
                }
            }

            await new Promise(resolve => setTimeout(resolve, 100))

            const deadline = Date.now() + 2000
            do {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                this.assertResponseOk(response.code, 'property event readback')
                if (Array.isArray(response.data)) this.processEvents(response.data, true)
                const current = this.propertyCache.get(property)?.current
                const observed = current === undefined ? undefined : codec.encode(current)
                if (
                    observed?.length === requestedValue.length &&
                    observed.every((byte, index) => byte === requestedValue[index])
                )
                    return
                if (!verifyReadback && !response.data?.length) return
                await new Promise(resolve => setTimeout(resolve, 50))
            } while (Date.now() < deadline)
            throw new Error(`Canon ${property.name} did not publish the requested value within 2 seconds`)
        })
    }

    async getAperture(): Promise<string> {
        return this.get(this.registry.properties.CanonAperture)
    }

    async setAperture(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonAperture,
            value as CodecType<typeof this.registry.properties.CanonAperture.codec>
        )
    }

    async getShutterSpeed(): Promise<string> {
        return this.get(this.registry.properties.CanonShutterSpeed)
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonShutterSpeed,
            value as CodecType<typeof this.registry.properties.CanonShutterSpeed.codec>
        )
    }

    async getIso(): Promise<string> {
        return this.get(this.registry.properties.CanonIso)
    }

    async setIso(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonIso,
            value as CodecType<typeof this.registry.properties.CanonIso.codec>
        )
    }

    async getFocusMode(): Promise<string> {
        return this.get(this.registry.properties.CanonFocusMode)
    }

    async setFocusMode(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonFocusMode,
            value as CodecType<typeof this.registry.properties.CanonFocusMode.codec>
        )
    }

    async getWhiteBalance(): Promise<string> {
        return this.get(this.registry.properties.CanonWhiteBalance)
    }

    async getColorTemperature(): Promise<number> {
        return this.get(this.registry.properties.CanonColorTemperature)
    }

    async setColorTemperature(kelvin: number): Promise<void> {
        if (!Number.isInteger(kelvin) || kelvin < 2500 || kelvin > 10000) {
            throw new Error('Canon color temperature must be an integer from 2500 to 10000 kelvin')
        }
        await this.setAdvertisedProperty(this.registry.properties.CanonColorTemperature, kelvin)
    }

    async getLiveViewAutofocusMode(): Promise<string> {
        return this.get(this.registry.properties.CanonLiveViewAutofocusMode)
    }

    async setLiveViewAutofocusMode(mode: string): Promise<void> {
        const property = this.registry.properties.CanonLiveViewAutofocusMode
        await this.setAdvertisedProperty(property, mode as CodecType<typeof property.codec>)
    }

    private async setAdvertisedProperty<P extends PropertyDefinition>(
        property: P,
        value: CodecType<P['codec']>
    ): Promise<void> {
        const choices = this.getPropertyAllowedValues(property)
        if (!choices?.includes(value))
            throw new Error(`Canon ${property.name} value ${value} was not advertised by the attached camera`)
        await this.set(property, value)
        if ((await this.get(property)) !== value)
            throw new Error(`Canon ${property.name} did not apply the requested value ${value}`)
    }

    async setWhiteBalance(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonWhiteBalance,
            value as CodecType<typeof this.registry.properties.CanonWhiteBalance.codec>
        )
    }

    async getImageFormat(): Promise<CanonImageFormat> {
        const property = this.imageFormatProperty()
        if (!property) throw new Error('The attached Canon camera did not report a still-image format property')
        return this.get(property)
    }

    async setImageFormat(packed: number): Promise<void> {
        const property = this.imageFormatProperty()
        if (!property)
            throw new Error('The attached Canon camera did not report a writable still-image format property')
        await this.set(property, canonImageFormatFromPacked(packed))
    }

    async getMovieSize(): Promise<number> {
        return this.get(this.registry.properties.CanonMovieSize)
    }

    async getMovieFormat(): Promise<CanonMovieFormat> {
        return this.get(this.registry.properties.CanonMovieFormat)
    }

    async setMovieFormat(key: string): Promise<void> {
        const property = this.registry.properties.CanonMovieFormat
        const advertised = this.getPropertyAllowedValues(property)?.find(candidate => candidate.key === key)
        if (!advertised) throw new Error(`Canon movie format ${key} was not advertised by the attached camera`)
        await this.set(property, advertised)
    }

    async getMovieServoAutofocus(): Promise<string> {
        return this.get(this.registry.properties.CanonMovieServoAutofocus)
    }

    async setMovieServoAutofocus(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonMovieServoAutofocus,
            value as CodecType<typeof this.registry.properties.CanonMovieServoAutofocus.codec>
        )
    }

    async getContinuousAutofocus(): Promise<string> {
        return this.get(this.registry.properties.CanonContinuousAutofocus)
    }

    async setContinuousAutofocus(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonContinuousAutofocus,
            value as CodecType<typeof this.registry.properties.CanonContinuousAutofocus.codec>
        )
    }

    getNetworkState(): CanonNetworkState {
        const communicationMode = this.registry.properties.CanonNetworkCommunicationMode
        return {
            communicationMode: this.cachedOptionalNumber(communicationMode),
            communicationModeChoices: this.getPropertyAllowedValues(communicationMode),
            serverRegion: this.cachedOptionalNumber(this.registry.properties.CanonNetworkServerRegion),
            wftStatus: this.cachedOptionalNumber(this.registry.properties.CanonWftStatus),
        }
    }

    async setNetworkCommunicationMode(value: number, allowUnadvertised = false): Promise<void> {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
            throw new Error(`Canon network communication mode must be a uint32, received ${value}`)
        }
        const property = this.registry.properties.CanonNetworkCommunicationMode
        const advertised = this.getPropertyAllowedValues(property)
        if (!allowUnadvertised && advertised && !advertised.includes(value)) {
            throw new Error(`Canon network communication mode ${value} was not advertised by the attached camera`)
        }
        await this.set(property, value)
    }

    /** Enable manual exposure using the EOS remote AE property and verify its event readback. */
    async setManualExposureMode(): Promise<void> {
        const property = this.registry.properties.CanonAutoExposureMode
        if (await this.get(property) === 3) return
        await this.set(property, 3)
        if (await this.get(property) !== 3) throw new Error('Canon did not confirm Manual exposure mode')
    }

    async enterMovieMode(): Promise<void> {
        await this.withoutPolling(async () => {
            const response = await this.send(this.registry.operations.CanonMovieSelectSwitchOn, {})
            if (response.code !== OK.code) {
                throw new Error(`Canon movie-mode switch returned 0x${response.code.toString(16)}`)
            }
        })
    }

    async leaveMovieMode(): Promise<void> {
        await this.withoutPolling(async () => {
            const response = await this.send(this.registry.operations.CanonMovieSelectSwitchOff, {})
            if (response.code !== OK.code) {
                throw new Error(`Canon movie-mode release returned 0x${response.code.toString(16)}`)
            }
        })
    }

    async autofocus(durationMilliseconds = 800): Promise<void> {
        await this.withoutPolling(async () => {
            const response = await this.send(this.registry.operations.CanonDoAutofocus, {})
            if (response.code === OK.code) {
                try {
                    await new Promise(resolve => setTimeout(resolve, durationMilliseconds))
                } finally {
                    await this.send(this.registry.operations.CanonCancelAutofocus, {})
                }
                return
            }

            // Several EOS DSLRs (including the EOS 80D) advertise DoAf but only
            // accept it while live view is active. A remote half-press works in
            // still-photo mode and is the closest PTP equivalent to AF-ON.
            const halfPress = await this.send(this.registry.operations.CanonRemoteReleaseOn, {
                ReleaseMode: 'FOCUS',
                AFMode: 'AF',
            })
            if (halfPress.code !== OK.code) {
                throw new Error(
                    `Canon autofocus returned 0x${response.code.toString(16)} and half-press returned 0x${halfPress.code.toString(16)}`
                )
            }
            try {
                await new Promise(resolve => setTimeout(resolve, durationMilliseconds))
            } finally {
                await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' })
            }
        })
    }

    async keepDeviceOn(): Promise<void> {
        await this.withoutPolling(async () => {
            await this.send(this.registry.operations.CanonKeepDeviceOn, {})
        })
    }

    /** Explicit capability audit; some bodies require model-specific initialization before 0x9108. */
    async getExtendedDeviceInfo(): Promise<CanonExtendedDeviceInfo> {
        this.assertOperationSupported(this.registry.operations.CanonGetExtendedDeviceInfo.code)
        return this.withoutPolling(async () => {
            const response = await this.send(this.registry.operations.CanonGetExtendedDeviceInfo, {})
            this.assertResponseOk(response.code, 'extended device information')
            if (!response.data) throw new Error('Canon extended device information contains no dataset')
            return response.data
        })
    }

    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        return this.withoutPolling(async () => {
            const release = async (afMode: 'AF' | 'MF') => {
                let focusPressed = false
                let shutterPressed = false
                try {
                    const focus = await this.send(this.registry.operations.CanonRemoteReleaseOn, {
                        ReleaseMode: 'FOCUS',
                        AFMode: afMode,
                    })
                    if (focus.code !== OK.code) {
                        throw new Error(`Canon ${afMode} focus press returned 0x${focus.code.toString(16)}`)
                    }
                    focusPressed = true
                    await new Promise(resolve => setTimeout(resolve, afMode === 'AF' ? 1000 : 250))

                    const shutter = await this.send(this.registry.operations.CanonRemoteReleaseOn, {
                        ReleaseMode: 'SHUTTER',
                        AFMode: afMode,
                    })
                    if (shutter.code !== OK.code) {
                        throw new Error(`Canon ${afMode} shutter press returned 0x${shutter.code.toString(16)}`)
                    }
                    shutterPressed = true
                } finally {
                    if (shutterPressed) {
                        await this.send(this.registry.operations.CanonRemoteReleaseOff, {
                            ReleaseMode: 'SHUTTER',
                        }).catch(() => undefined)
                    }
                    if (focusPressed) {
                        await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' }).catch(
                            () => undefined
                        )
                    }
                }
            }

            try {
                await release('AF')
            } catch (error) {
                if (!(error instanceof Error) || !error.message.includes('AF shutter press returned 0x2019'))
                    throw error
                // DeviceBusy at full press generally means the body could not lock focus.
                // Canon's second release parameter explicitly permits a no-AF fallback.
                await release('MF')
            }

            return {}
        })
    }

    async startRecording(): Promise<void> {
        await this.enableLiveView()

        await this.set(this.registry.properties.CanonRecordingDestination, 'CARD')
    }

    /** Enables host EVF output, preserving the body's existing output for stop/disconnect. */
    async startLiveView(): Promise<void> {
        this.assertOperationSupported(this.registry.operations.CanonGetViewfinderData.code)
        await this.withoutPolling(() => this.enableLiveView())
    }

    async stopLiveView(): Promise<void> {
        await this.withoutPolling(() => this.disableLiveView())
    }

    async captureViewfinderFrame(): Promise<CanonLiveViewFrame> {
        this.assertOperationSupported(this.registry.operations.CanonGetViewfinderData.code)
        return this.withoutPolling(async () => {
            await this.enableLiveView()
            for (let attempt = 0; attempt < 30; attempt++) {
                const response = await this.send(
                    this.registry.operations.CanonGetViewfinderData,
                    { Size: 0x00200000, Reserved1: 0, Reserved2: 0 },
                    undefined,
                    0x00200000
                )
                if (response.code === OK.code && response.data?.image) return response.data
                if (![0x2019, 0xa102].includes(response.code)) {
                    throw new Error(`Canon viewfinder read returned 0x${response.code.toString(16)}`)
                }
                await new Promise(resolve => setTimeout(resolve, 100))
            }
            throw new Error('Canon live-view frame was not ready after 30 attempts')
        })
    }

    async captureLiveView({ includeData = true } = {}): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
        if (!includeData) return {}
        return { data: (await this.captureViewfinderFrame()).image }
    }

    /** Preview magnification only; accepted magnifications depend on the attached body. */
    async setLiveViewZoom(magnification: 1 | 5 | 6 | 10 | 15): Promise<void> {
        if (![1, 5, 6, 10, 15].includes(magnification)) throw new Error('Invalid Canon live-view magnification')
        this.assertOperationSupported(this.registry.operations.CanonViewfinderZoom.code)
        await this.withoutPolling(async () => {
            await this.enableLiveView()
            const response = await this.send(this.registry.operations.CanonViewfinderZoom, {
                Magnification: magnification,
            })
            this.assertResponseOk(response.code, 'live-view zoom')
            for (let attempt = 0; attempt < 10; attempt++) {
                const frame = await this.captureViewfinderFrame()
                const zoomState = frame.segments.find(segment => segment.type === 4)?.data
                if (
                    zoomState?.length === 4 &&
                    new DataView(zoomState.buffer, zoomState.byteOffset, 4).getUint32(0, true) === magnification
                )
                    return
                await new Promise(resolve => setTimeout(resolve, 100))
            }
            throw new Error(`Canon did not apply live-view zoom ${magnification}`)
        })
    }

    async getLiveViewPosition(): Promise<CanonLiveViewPosition> {
        const position = canonLiveViewPosition(await this.captureViewfinderFrame())
        if (!position) throw new Error('Canon live-view position metadata is unavailable')
        return position
    }

    /** Position the live-view crop and return its observed origin, including camera rounding. */
    async setLiveViewPosition(x: number, y: number): Promise<CanonLiveViewPosition> {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0)
            throw new Error('Canon live-view coordinates must be nonnegative integers')
        this.assertOperationSupported(this.registry.operations.CanonViewfinderPosition.code)
        return this.withoutPolling(async () => {
            const before = await this.getLiveViewPosition()
            if (x < before.minimumX || y < before.minimumY || x > before.maximumX || y > before.maximumY)
                throw new Error('Canon live-view position is outside the measured crop bounds')
            const result = await this.send(this.registry.operations.CanonViewfinderPosition, { X: x, Y: y })
            this.assertResponseOk(result.code, 'live-view position')
            for (let attempt = 0; attempt < 15; attempt++) {
                const position = await this.getLiveViewPosition()
                if (this.positionMatches(position, x, y)) return position
                await new Promise(resolve => setTimeout(resolve, 100))
            }
            throw new Error(`Canon did not apply live-view position (${x}, ${y})`)
        })
    }

    /** Center a magnified live-view frame. Coordinates differ from the viewport origin. */
    async setLiveViewFramePoint(x: number, y: number, lockAfFrame = false): Promise<CanonLiveViewPosition> {
        if (!Number.isInteger(x) || !Number.isInteger(y) || typeof lockAfFrame !== 'boolean')
            throw new Error('Invalid Canon live-view frame point')
        this.assertOperationSupported(this.registry.operations.CanonTouchFramePoint.code)
        return this.withoutPolling(async () => {
            const before = await this.getLiveViewPosition()
            if (before.magnification === 1) throw new Error('Magnify Canon live view before setting a frame point')
            const originX = x - Math.floor(before.width / 2)
            const originY = y - Math.floor(before.height / 2)
            if (
                originX < before.minimumX ||
                originY < before.minimumY ||
                originX > before.maximumX ||
                originY > before.maximumY
            )
                throw new Error('Canon frame point is outside the measured crop bounds')
            const result = await this.send(this.registry.operations.CanonTouchFramePoint, {
                Type: 3,
                X: x,
                Y: y,
                Lock: lockAfFrame ? 1 : 0,
            })
            this.assertResponseOk(result.code, 'live-view frame point')
            for (let attempt = 0; attempt < 15; attempt++) {
                const position = await this.getLiveViewPosition()
                if (this.positionMatches(position, originX, originY)) return position
                await new Promise(resolve => setTimeout(resolve, 100))
            }
            throw new Error(`Canon did not apply live-view frame point (${x}, ${y})`)
        })
    }

    async panLiveView(direction: 'up' | 'down' | 'left' | 'right', step = 200): Promise<CanonLiveViewPosition> {
        if (!['up', 'down', 'left', 'right'].includes(direction) || !Number.isInteger(step) || step < 1 || step > 1000)
            throw new Error('Invalid Canon live-view pan direction or step')
        return this.withoutPolling(async () => {
            const position = await this.getLiveViewPosition()
            if (position.magnification === 1) throw new Error('Magnify Canon live view before panning')
            const x = position.x + (direction === 'left' ? -step : direction === 'right' ? step : 0)
            const y = position.y + (direction === 'up' ? -step : direction === 'down' ? step : 0)
            return this.setLiveViewPosition(
                Math.max(position.minimumX, Math.min(position.maximumX, x)),
                Math.max(position.minimumY, Math.min(position.maximumY, y))
            )
        })
    }

    private positionMatches(position: CanonLiveViewPosition, x: number, y: number): boolean {
        // The R6 III rounds small requests (2786 -> 2788, 485 -> 486).
        // Return the actual origin; a stale/ignored 200-pixel pan cannot satisfy this bound.
        return Math.abs(position.x - x) <= 4 && Math.abs(position.y - y) <= 4
    }

    private assertOperationSupported(code: number): void {
        if (!this.supportedOperations?.has(code))
            throw new Error(`Canon operation 0x${code.toString(16)} was not advertised by the attached camera`)
    }

    private assertResponseOk(code: number, action: string): void {
        if (code !== OK.code) throw new Error(`Canon ${action} returned 0x${code.toString(16)}`)
    }

    async stopRecording(): Promise<void> {
        await this.set(this.registry.properties.CanonRecordingDestination, 'NONE')
    }

    async getHdmiLiveViewMode(): Promise<string> {
        return this.get(this.registry.properties.CanonLiveViewMode)
    }

    async setHdmiLiveViewMode(value: string): Promise<void> {
        await this.set(
            this.registry.properties.CanonLiveViewMode,
            value as CodecType<typeof this.registry.properties.CanonLiveViewMode.codec>
        )
    }

    getPropertyAllowedValues<P extends PropertyDefinition>(property: P): CodecType<P['codec']>[] | undefined {
        const cached = this.propertyCache.get(property)
        if (!cached?.allowed) {
            return undefined
        }

        return cached.allowed as CodecType<P['codec']>[]
    }

    listPropertyStates(): CanonPropertyState[] {
        return [...this.propertyCache.entries()]
            .filter(([, state]) => state.current !== undefined)
            .map(([property, state]) => ({
                code: property.code,
                name: property.name,
                description: property.description,
                access: property.access,
                value: state.current,
                ...(state.allowed ? { allowedValues: [...state.allowed] } : {}),
            }))
            .sort((left, right) => left.code - right.code)
    }

    listUnknownPropertyStates(): CanonUnknownPropertyState[] {
        return [...this.unknownPropertyCache.entries()]
            .map(([code, state]) => ({
                code,
                codeHex: `0x${code.toString(16).padStart(4, '0')}`,
                name: CANON_PROPERTY_NAMES[code],
                ...state,
            }))
            .sort((left, right) => left.code - right.code)
    }

    private imageFormatProperty() {
        const sdCard = this.registry.properties.CanonImageFormatSd
        if (this.propertyCache.get(sdCard)?.current !== undefined) return sdCard
        const generic = this.registry.properties.CanonImageFormat
        if (this.propertyCache.get(generic)?.current !== undefined) return generic
        return undefined
    }

    private cachedOptionalNumber(property: PropertyDefinition): number | undefined {
        const value = this.propertyCache.get(property)?.current
        return typeof value === 'number' ? value : undefined
    }

    private async enableRemoteMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'ENABLE' })
    }

    private async disableRemoteMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'DISABLE' })
    }

    private async enableEventMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'ENABLE' })
    }

    private async disableEventMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'DISABLE' })
    }

    private processEvents(
        events: Array<{
            code: number
            parameters: Array<number | bigint>
            valueData?: Uint8Array
            allowedValues?: number[]
            allowedValueData?: Uint8Array[]
        }>,
        emitGenericEvents = true
    ): void {
        events.forEach(event => {
            if (emitGenericEvents) {
                this.handleEvent({
                    code: event.code,
                    parameters: event.parameters.map(p => (typeof p === 'bigint' ? Number(p) : p)),
                    transactionId: 0,
                })
            }

            if (event.code === 0xc189 && event.parameters && event.parameters.length >= 2) {
                const propCode =
                    typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                const rawValue =
                    typeof event.parameters[1] === 'bigint' ? Number(event.parameters[1]) : event.parameters[1]

                const property = Object.values(this.registry.properties).find(p => p.code === propCode)
                if (property) {
                    const codec = this.resolveCodec(property.codec)
                    const encoded = event.valueData || this.registry.codecs.uint32.encode(rawValue)
                    const decoded = codec.decode(encoded)

                    const existing = this.propertyCache.get(property)
                    this.propertyCache.set(property, {
                        current: decoded.value,
                        allowed: existing?.allowed,
                    })
                } else {
                    const existing = this.unknownPropertyCache.get(propCode)
                    this.unknownPropertyCache.set(propCode, {
                        ...existing,
                        rawValue,
                        valueDataHex: event.valueData ? bytesToHex(event.valueData) : undefined,
                    })
                }
            }

            if (event.code === 0xc18a) {
                if (event.parameters && event.parameters.length >= 1) {
                    const propCode =
                        typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                    if (event.allowedValueData?.length || event.allowedValues?.length) {
                        const property = Object.values(this.registry.properties).find(p => p.code === propCode)
                        if (property) {
                            const codec = this.resolveCodec(property.codec)
                            const encodedAllowed = event.allowedValueData?.length
                                ? event.allowedValueData
                                : event.allowedValues!.map(rawValue => this.registry.codecs.uint32.encode(rawValue))
                            this.advertisedPropertyData.set(
                                property,
                                encodedAllowed.map(encoded => encoded.slice())
                            )
                            const decodedAllowed = encodedAllowed.flatMap(encoded => {
                                try {
                                    return [codec.decode(encoded).value]
                                } catch {
                                    return []
                                }
                            })

                            const existing = this.propertyCache.get(property)
                            this.propertyCache.set(property, {
                                current: existing?.current,
                                allowed: decodedAllowed,
                            })
                        } else {
                            const existing = this.unknownPropertyCache.get(propCode)
                            this.unknownPropertyCache.set(propCode, {
                                ...existing,
                                allowedValues: event.allowedValues ? [...event.allowedValues] : undefined,
                                allowedValueDataHex: event.allowedValueData?.map(bytesToHex),
                            })
                        }
                    }
                }
            }
        })
    }

    /**
     * Polls the camera's event queue. Each round is scheduled only after the previous one
     * finishes: setInterval does not wait for an async callback, so when a poll takes longer than
     * the interval it stacks up requests faster than the bus can drain them and starves every
     * other operation.
     */
    private startPolling(intervalMs: number = 200): void {
        if (this.polling) {
            return
        }

        this.polling = true
        this.pollingLoop = this.runPollingLoop(intervalMs)
    }

    private async runPollingLoop(intervalMs: number): Promise<void> {
        while (this.polling) {
            try {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (this.polling && response.data && Array.isArray(response.data) && response.data.length > 0) {
                    this.processEvents(response.data, true)
                }
            } catch (error) {}

            if (!this.polling) return

            await new Promise(resolve => setTimeout(resolve, intervalMs))
        }
    }

    private async stopPolling(): Promise<void> {
        this.polling = false
        await this.pollingLoop
        this.pollingLoop = undefined
    }

    private async flushInitialEvents(): Promise<void> {
        while (true) {
            try {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                    break
                }
                this.processEvents(response.data, false)
            } catch (error) {
                break
            }
        }

        const propertiesWithAllowedValues = Array.from(this.propertyCache.values()).filter(p => p.allowed).length
        console.log(
            `Initial flush complete: ${this.propertyCache.size} properties cached, ${propertiesWithAllowedValues} properties with allowed values`
        )
    }
    private async enableLiveView(): Promise<void> {
        if (this.liveViewEnabled) return
        const original = await this.get(this.registry.properties.CanonLiveViewMode)
        if (original !== 'HOST' && original !== 'CAMERA_AND_HOST') {
            this.liveViewOriginalOutput = original
            await this.set(
                this.registry.properties.CanonLiveViewMode,
                original === 'CAMERA' ? 'CAMERA_AND_HOST' : 'HOST'
            )
        }
        this.liveViewEnabled = true
    }

    private async disableLiveView(): Promise<void> {
        if (this.liveViewEnabled || this.liveViewOriginalOutput !== undefined) {
            if (this.liveViewOriginalOutput !== undefined) {
                await this.set(this.registry.properties.CanonLiveViewMode, this.liveViewOriginalOutput)
            }
            this.liveViewOriginalOutput = undefined
            this.liveViewEnabled = false
        }
    }
}
