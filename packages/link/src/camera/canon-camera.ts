import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import {
    canonImageFormatFromPacked,
    type CanonImageFormat,
} from '@ptp/datasets/vendors/canon/canon-image-format-dataset'
import type { CanonMovieFormat } from '@ptp/datasets/vendors/canon/canon-movie-format-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { OK } from '@ptp/definitions/response-definitions'
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
        await this.enableRemoteMode()
        await this.enableEventMode()

        // Flush initial property dump from camera and cache all properties
        await this.flushInitialEvents()

        this.startPolling()
    }

    async disconnect(): Promise<void> {
        await this.stopPolling()
        await this.disableLiveView()
        await this.disableRemoteMode()
        await this.disableEventMode()
        await super.disconnect()
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
            const encodedValue = codec.encode(value)

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
                    await this.send(this.registry.operations.CanonSetDevicePropValue, {}, data)
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

            while (true) {
                try {
                    const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                        break
                    }
                    this.processEvents(response.data, true)
                } catch (error) {
                    break
                }
            }
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
        if (!property) throw new Error('The attached Canon camera did not report a writable still-image format property')
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
                        await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'SHUTTER' }).catch(
                            () => undefined
                        )
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
                if (!(error instanceof Error) || !error.message.includes('AF shutter press returned 0x2019')) throw error
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

    async stopRecording(): Promise<void> {
        await this.set(this.registry.properties.CanonRecordingDestination, 'NONE')
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
            .map(([code, state]) => ({ code, codeHex: `0x${code.toString(16).padStart(4, '0')}`, ...state }))
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
        if (!this.liveViewEnabled) {
            await this.set(this.registry.properties.CanonLiveViewMode, 'CAMERA_AND_HOST')
            this.liveViewEnabled = true
        }
    }

    private async disableLiveView(): Promise<void> {
        if (this.liveViewEnabled) {
            await this.set(this.registry.properties.CanonLiveViewMode, 'CAMERA')
            this.liveViewEnabled = false
        }
    }
}
