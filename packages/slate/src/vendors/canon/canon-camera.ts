import type { CameraCapabilities, CameraRecordingState, OperationAvailability } from '@camera/controls'
import { unrecognizedValueLabel, type UnrecognizedValues } from '@camera/controls'
import type {
    CameraEventHandler,
    CameraEventName,
    Clip,
    ConfirmedPhotoFile,
    FocusPointOptions,
    FocusResult,
    LiveViewFrame,
    PhotoDestination,
} from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { CameraOperationName } from '@camera/driver'
import type { StatePhase } from '@contribute/protocol'
import { Logger } from '@core/logger'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { CodecType } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { assertCanonCaptureResult } from '@vendors/canon/capture-result'
import type { CanonAddedObject, CanonEventRecord } from '@vendors/canon/datasets/canon-event-data-dataset'
import type { CanonExtendedDeviceInfo } from '@vendors/canon/datasets/canon-extended-device-info-dataset'
import { canonImageFormatFromPacked } from '@vendors/canon/datasets/canon-image-format-dataset'
import {
    canonLiveViewPosition,
    type CanonLiveViewFrame,
    type CanonLiveViewPosition,
} from '@vendors/canon/datasets/canon-live-view-dataset'
import { CANON_PROPERTY_NAMES } from '@vendors/canon/definitions/canon-property-names'
import { GenericCamera, type CameraRecoveryOptions, type CameraRecoveryReport } from '@vendors/generic/generic-camera'
import {
    cardObjectFile,
    cardSteps,
    classified,
    clipFinalizationMilliseconds,
    operationsAdvertised,
    overlayUnsupported,
    requireImage,
    requirePoint,
    storageHost,
    supported,
    unstatedSize,
    unsupported,
    wait,
} from '@vendors/generic/generic-operations'
import { encodeMediaId } from '@vendors/generic/media-id'
import { recordingCapability, type VendorRecording } from '@vendors/generic/recording-lifecycle'
import { afterShutterRelease, shutterOutcomeUnknown, shutterRefused } from '@vendors/generic/shutter-outcome'
import { readCameraStorages } from '@vendors/generic/storage'
import { CanonRegistry, createCanonRegistry } from '@vendors/registry'

const MAXIMUM_INITIAL_EVENT_ROUNDS = 64
/** EDSDK shutter result for a half-press whose autofocus failed (EDSDKErrors.h TAKE_PICTURE_AF_NG). */
const CANON_RELEASE_RESULT_FOCUS_FAILED = 1
const CANON_DEVICE_BUSY = 0x2019
const CANON_FOCUS_DURATION_MILLISECONDS = 800
/** FixedMovie: 1 while the body is in movie mode (libgphoto2 PTP_DPC_CANON_EOS_FixedMovie). */
const FIXED_MOVIE = 0xd1c2
const MODE_SETTLE_MILLISECONDS = 700
const MANUAL_EXPOSURE_MODE = 3
const CANON_STILL_FILE = /\.(jpe?g|heif|heic|cr2|cr3)$/i
const CANON_MOVIE_FILE = /\.(mp4|mov|crm)$/i
/** The manual settings a movie-select transition can reset. */
const exposureProperties = ['CanonIso', 'CanonAperture', 'CanonShutterSpeed', 'CanonWhiteBalance'] as const
type ExposureProperty = (typeof exposureProperties)[number]
type ExposureSnapshot = { mode: number; values: Map<ExposureProperty, string> }
export interface CanonPropertyState {
    code: number
    name: string
    description: string
    access: PropertyDefinition['access']
    /** Undefined while the current value is unrecognized. */
    value: unknown
    allowedValues?: unknown[]
    unrecognized?: UnrecognizedValues
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

export interface CanonRawEvent {
    code: number
    /** Owned copy of the complete EOS GetEvent record body, excluding its size/code header. */
    data: Uint8Array
}

function bytesToHex(value: Uint8Array): string {
    return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Single-word values read as their number; longer structured records as their wire bytes. */
function canonRawLabel(encoded: Uint8Array): string {
    return encoded.length === 4
        ? unrecognizedValueLabel(new DataView(encoded.buffer, encoded.byteOffset, 4).getUint32(0, true))
        : bytesToHex(encoded)
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
        if (this.pollingSuspensions++ === 0) {
            this.resumePolling = this.polling
            this.polling = false
            this.pollingPause = this.pollingLoop
        }
        try {
            await this.pollingPause
            return await fn()
        } finally {
            if (--this.pollingSuspensions === 0) {
                this.pollingPause = undefined
                const resume = this.resumePolling
                this.resumePolling = false
                if (resume) this.startPolling()
            }
        }
    }
    private pollingSuspensions = 0
    private resumePolling = false
    private pollingPause?: Promise<void>
    private polling = false
    private keepAliveEnabled = true
    private lastKeepAliveAttempt?: number
    private keepAliveUnavailable = false
    private rawEventListeners = new Set<(event: CanonRawEvent) => void>()
    private addedObjectWatchers = new Set<(object: CanonAddedObject) => void>()
    private pollingLoop?: Promise<void>
    private liveViewEnabled = false
    private liveViewOriginalOutput?: CodecType<CanonRegistry['properties']['CanonLiveViewMode']['codec']>
    private supportedOperations?: Set<number>
    private advertisedPropertyData = new Map<PropertyDefinition, Uint8Array[]>()
    private propertyCache = new Map<
        PropertyDefinition,
        {
            current?: CodecType<PropertyDefinition['codec']>
            allowed?: CodecType<PropertyDefinition['codec']>[]
            unrecognized?: UnrecognizedValues
        }
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

    /** Observe initial and later polled events, including opaque vendor records, for capture/replay. */
    onRawEvent(listener: (event: CanonRawEvent) => void): void {
        this.rawEventListeners.add(listener)
    }

    offRawEvent(listener: (event: CanonRawEvent) => void): void {
        this.rawEventListeners.delete(listener)
    }

    /** Refresh a benchmark's event evidence while preserving the session's property cache and events. */
    async refreshEventProperties(): Promise<void> {
        const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
        if (response.code !== 0x2001 || !Array.isArray(response.data)) throw new Error('No Canon event inventory')
        this.processEvents(response.data, true)
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        await this.stopPolling()
        this.clearCachedState()
        await this.connectTransport({ ...device, ...(this.vendorId && { vendorId: this.vendorId }) })

        this.sessionId = this.createSessionId()
        try {
            let opened = await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
            if (opened.code === SessionAlreadyOpen.code) {
                const closed = await this.send(this.registry.operations.CloseSession, {})
                if (closed.code !== OK.code)
                    throw new PTPResponseError(closed.code, 'Canon stale session could not be closed')
                opened = await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
            }
            if (opened.code !== OK.code) throw new PTPResponseError(opened.code, 'Canon OpenSession failed')
        } catch (error) {
            this.sessionId = null
            throw error
        }
        const deviceInfo = await this.send(this.registry.operations.GetDeviceInfo, {})
        if (deviceInfo.code !== OK.code) throw new PTPResponseError(deviceInfo.code, 'Canon GetDeviceInfo failed')
        if (!deviceInfo.data) throw new PTPDecodeError('Canon GetDeviceInfo failed: no DeviceInfo dataset')
        this.supportedOperations = new Set(deviceInfo.data.operationsSupportedRaw)
        await this.enableRemoteMode()
        await this.enableEventMode()

        // Flush initial property dump from camera and cache all properties
        await this.flushInitialEvents()

        this.startPolling()
    }

    async disconnect(): Promise<void> {
        await this.stopPolling()
        if (!this.transport.isConnected()) {
            this.clearCachedState()
            return super.disconnect()
        }
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
        this.clearCachedState()
        if (failure) throw failure
    }

    protected override createSessionId(): number {
        // EOS control sessions must use the same convention during connect and recovery.
        return 1
    }

    override async recover(
        device?: DeviceDescriptor,
        options: CameraRecoveryOptions = {}
    ): Promise<CameraRecoveryReport> {
        if (this.propertyCache.get(this.registry.properties.CanonRecordingDestination)?.current === 'CARD')
            throw new CameraUnsupportedError('recover', 'Stop the Canon recording before recovering its session')
        await this.stopPolling()
        // Release the owned EOS mode before opening a replacement PTP session.
        // An unresponsive connection still reaches the bounded recovery steps.
        try {
            await this.disconnect()
        } catch {
            /* Recovery verifies the replacement session. */
        }
        try {
            return await super.recover(device, options)
        } finally {
            this.clearCachedState()
        }
    }

    protected override async verifyRecoveryState(_information: DeviceInfo): Promise<void> {
        // GetDeviceInfo can answer while EOS controls still report SessionNotOpen.
        try {
            await this.enableRemoteMode()
            await this.enableEventMode()
            await this.refreshEventProperties()
        } finally {
            await this.disableRemoteMode()
            await this.disableEventMode()
        }
    }

    private clearCachedState(): void {
        this.propertyCache.clear()
        this.unknownPropertyCache.clear()
        this.advertisedPropertyData.clear()
        this.supportedOperations = undefined
        this.liveViewEnabled = false
        this.liveViewOriginalOutput = undefined
        this.lastKeepAliveAttempt = undefined
        this.keepAliveUnavailable = false
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        let cached = this.propertyCache.get(property)
        if (cached?.current === undefined && this.transport.isConnected?.()) {
            // A fast reconnect may receive the initial property dump in a later poll.
            // Refresh only a missing value, never invent it or repeat a state-changing command.
            await this.withoutPolling(async () => {
                for (let attempt = 0; attempt < 10; attempt++) {
                    await this.refreshEventProperties()
                    cached = this.propertyCache.get(property)
                    if (cached?.current !== undefined) return
                    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 50))
                }
            })
        }
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
                        throw new PTPResponseError(
                            response.code,
                            `Canon ${property.name} write returned 0x${response.code.toString(16)}`
                        )
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
            // Acknowledged but never observed: report it unconfirmed, never resend it.
            throw new CameraOutcomeUnknownError(
                property.name,
                `Canon ${property.name} did not publish the requested value within 2 seconds`
            )
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

    async setFocusMode(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonFocusMode,
            value as CodecType<typeof this.registry.properties.CanonFocusMode.codec>
        )
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

    async setImageFormat(packed: number): Promise<void> {
        const property = this.imageFormatProperty()
        if (!property)
            throw new Error('The attached Canon camera did not report a writable still-image format property')
        await this.set(property, canonImageFormatFromPacked(packed))
    }

    async setMovieFormat(key: string): Promise<void> {
        const property = this.registry.properties.CanonMovieFormat
        const advertised = this.getPropertyAllowedValues(property)?.find(candidate => candidate.key === key)
        if (!advertised) throw new Error(`Canon movie format ${key} was not advertised by the attached camera`)
        await this.set(property, advertised)
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
        if ((await this.get(property)) === 3) return
        await this.set(property, 3)
        if ((await this.get(property)) !== 3) throw new Error('Canon did not confirm Manual exposure mode')
    }

    /** @internal Whether this session's DeviceInfo advertised an operation; unknown before connect. */
    advertisesOperation(code: number): boolean {
        return this.supportedOperations?.has(code) === true
    }

    async enterMovieMode(): Promise<void> {
        if (this.supportedOperations)
            this.assertOperationSupported(this.registry.operations.CanonMovieSelectSwitchOn.code)
        await this.withoutPolling(async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
                const response = await this.send(this.registry.operations.CanonMovieSelectSwitchOn, {})
                if (response.code === OK.code) return
                if (response.code !== 0x2019 || attempt === 3)
                    throw new PTPResponseError(
                        response.code,
                        `Canon movie-mode switch returned 0x${response.code.toString(16)}`
                    )
                // Live-view/AF shutdown can briefly occupy the body. Retry only
                // the idempotent mode request; never repeat Record or cut power.
                await new Promise(resolve => setTimeout(resolve, 500))
            }
        })
    }

    async leaveMovieMode(): Promise<void> {
        if (this.supportedOperations)
            this.assertOperationSupported(this.registry.operations.CanonMovieSelectSwitchOff.code)
        await this.withoutPolling(async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
                const response = await this.send(this.registry.operations.CanonMovieSelectSwitchOff, {})
                if (response.code === OK.code) return
                if (response.code !== 0x2019 || attempt === 3)
                    throw new PTPResponseError(
                        response.code,
                        `Canon movie-mode release returned 0x${response.code.toString(16)}`
                    )
                await new Promise(resolve => setTimeout(resolve, 500))
            }
        })
    }

    /**
     * A timed AF hold. EOS reports no focus status for it, so the result is `unknown`, except when a
     * half-press answers that the camera could not focus (`not-acquired`).
     */
    async performAutofocus(durationMilliseconds = 800): Promise<FocusResult> {
        return this.withoutPolling(async (): Promise<FocusResult> => {
            const response = await this.send(this.registry.operations.CanonDoAutofocus, {})
            if (response.code === OK.code) {
                try {
                    await new Promise(resolve => setTimeout(resolve, durationMilliseconds))
                } finally {
                    await this.send(this.registry.operations.CanonCancelAutofocus, {})
                }
                return 'unknown'
            }

            // Several EOS DSLRs (including the EOS 80D) advertise DoAf but only
            // accept it while live view is active. A remote half-press works in
            // still-photo mode and is the closest PTP equivalent to AF-ON.
            const halfPress = await this.send(this.registry.operations.CanonRemoteReleaseOn, {
                ReleaseMode: 'FOCUS',
                AFMode: 'AF',
            })
            if (halfPress.code !== OK.code) {
                throw new CameraRefusedError(
                    'autofocus',
                    `Canon autofocus returned 0x${response.code.toString(16)} and half-press returned 0x${halfPress.code.toString(16)}`
                )
            }
            try {
                // EDSDK shutter result 1: the camera could not focus. Any other result is a refusal with its reason.
                if (halfPress.parameters?.[0] === CANON_RELEASE_RESULT_FOCUS_FAILED) return 'not-acquired'
                try {
                    assertCanonCaptureResult(halfPress.parameters, 'autofocus half press')
                } catch (error) {
                    throw new CameraRefusedError('autofocus', error instanceof Error ? error.message : String(error))
                }
                await new Promise(resolve => setTimeout(resolve, durationMilliseconds))
                return 'unknown'
            } finally {
                await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' })
            }
        })
    }

    async keepDeviceOn(): Promise<void> {
        this.assertOperationSupported(this.registry.operations.CanonKeepDeviceOn.code)
        await this.withoutPolling(async () => {
            const response = await this.send(this.registry.operations.CanonKeepDeviceOn, {})
            this.assertResponseOk(response.code, 'keep device on')
            this.lastKeepAliveAttempt = performance.now()
        })
    }

    /** Controls the session heartbeat without changing the body's saved power settings. */
    setKeepAliveEnabled(enabled: boolean): void {
        this.keepAliveEnabled = enabled
    }

    private async maintainKeepAlive(): Promise<void> {
        if (
            !this.keepAliveEnabled ||
            this.keepAliveUnavailable ||
            !this.supportedOperations?.has(this.registry.operations.CanonKeepDeviceOn.code)
        )
            return
        const now = performance.now()
        // libgphoto2 camlibs/ptp2/config.c camera_keep_device_on: EOS R8 needs
        // KeepDeviceOn about every 10 s; GetEvent polling alone is insufficient.
        if (this.lastKeepAliveAttempt !== undefined && now - this.lastKeepAliveAttempt < 10_000) return
        this.lastKeepAliveAttempt = now
        const response = await this.send(this.registry.operations.CanonKeepDeviceOn, {})
        if (response.code === 0x2005) this.keepAliveUnavailable = true
        this.assertResponseOk(response.code, 'automatic keep device on')
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

    async captureImage({
        autofocus = true,
        includeInfo = true,
        includeData = true,
    }: { includeInfo?: boolean; includeData?: boolean; autofocus?: boolean } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
        /** The new card object's handle, when info or data was requested. */
        objectHandle?: number
    }> {
        if (typeof autofocus !== 'boolean') throw new Error('Canon capture autofocus must be true or false')
        // Once a shutter press was sent without a definitive refusal, a photo may exist.
        let shutterSent = false
        let shutterRefusal: unknown
        const capture = () =>
            this.withoutPolling(async () => {
                const release = async (afMode: 'AF' | 'MF') => {
                    let focusPressed = false
                    let shutterPressed = false
                    let focusAttempted = false
                    let shutterAttempted = false
                    let failure: unknown
                    try {
                        focusAttempted = true
                        const focus = await this.send(this.registry.operations.CanonRemoteReleaseOn, {
                            ReleaseMode: 'FOCUS',
                            AFMode: afMode,
                        })
                        if (focus.code !== OK.code) {
                            throw new PTPResponseError(
                                focus.code,
                                `Canon ${afMode} focus press returned 0x${focus.code.toString(16)}`
                            )
                        }
                        focusPressed = true
                        assertCanonCaptureResult(focus.parameters, `${afMode} focus press`)
                        await new Promise(resolve => setTimeout(resolve, afMode === 'AF' ? 1000 : 250))

                        shutterAttempted = true
                        shutterSent = true
                        const shutter = await this.send(this.registry.operations.CanonRemoteReleaseOn, {
                            ReleaseMode: 'SHUTTER',
                            AFMode: afMode,
                        })
                        if (shutter.code !== OK.code) {
                            const answer = new PTPResponseError(
                                shutter.code,
                                `Canon ${afMode} shutter press returned 0x${shutter.code.toString(16)}`
                            )
                            // DeviceBusy at an AF full press generally means the body could not lock focus.
                            shutterRefusal =
                                afMode === 'AF' && shutter.code === CANON_DEVICE_BUSY
                                    ? shutterRefused(
                                          new PTPResponseError(
                                              shutter.code,
                                              `The camera could not lock focus, so nothing was taken (${answer.message}); ` +
                                                  'take the photo with autofocus false to release without focusing'
                                          )
                                      )
                                    : answer
                            throw shutterRefusal
                        }
                        shutterPressed = true
                        try {
                            assertCanonCaptureResult(shutter.parameters, `${afMode} shutter press`)
                        } catch (error) {
                            shutterRefusal = error
                            throw error
                        }
                    } catch (error) {
                        failure = error
                        throw error
                    } finally {
                        const cleanupErrors: unknown[] = []
                        for (const [ReleaseMode, required] of [
                            ['SHUTTER', shutterPressed || (afMode === 'MF' && shutterAttempted)],
                            ['FOCUS', focusPressed || (afMode === 'MF' && focusAttempted)],
                        ] as const) {
                            if (!required) continue
                            try {
                                const response = await this.send(this.registry.operations.CanonRemoteReleaseOff, {
                                    ReleaseMode,
                                })
                                if (response.code !== OK.code)
                                    throw new PTPResponseError(
                                        response.code,
                                        `Canon ${ReleaseMode.toLowerCase()} release returned 0x${response.code.toString(16)}`
                                    )
                            } catch (error) {
                                cleanupErrors.push(error)
                            }
                        }
                        if (cleanupErrors.length)
                            throw new AggregateError(
                                failure ? [failure, ...cleanupErrors] : cleanupErrors,
                                `Canon shutter cleanup failed: ${[failure, ...cleanupErrors].filter(Boolean).map(String).join('; ')}`
                            )
                    }
                }

                // An AF release that cannot lock focus is refused, never repeated as an MF release:
                // the caller asked for a focused photo. Only autofocus false releases without focus.
                await release(autofocus ? 'AF' : 'MF')
            })
        const pressShutter = async () => {
            try {
                await capture()
            } catch (error) {
                // A press the body answered with a refusal took nothing; anything else after a sent press may have.
                const refused =
                    !shutterSent ||
                    (shutterRefusal !== undefined &&
                        (error === shutterRefusal ||
                            (error instanceof AggregateError && error.errors.includes(shutterRefusal))))
                throw refused ? shutterRefused(error) : shutterOutcomeUnknown(error)
            }
        }
        if (!includeInfo && !includeData) {
            await pressShutter()
            return {}
        }
        // Drain events already queued, then watch: only a file announced after the release counts.
        await this.withoutPolling(() => this.refreshEventProperties())
        const watch = this.watchAddedObjects(name => CANON_STILL_FILE.test(name))
        try {
            await pressShutter()
            // The shutter was accepted: an unconfirmed or untransferred still is an unknown outcome, never a retry.
            return await afterShutterRelease(async () => {
                const added = await watch.next(8000, 'still image')
                // Prefer the JPEG of a RAW+JPEG pair announced together, without changing the body format.
                const image = added.find(object => /\.jpe?g$/i.test(object.filename)) ?? added[0]!
                const info = await this.addedObjectInfo(image)
                const size = info.objectCompressedSize
                if (!Number.isSafeInteger(size) || size <= 0 || size > 100 * 1024 * 1024)
                    throw new Error('Canon captured-image size is invalid or exceeds the 100 MiB transfer bound')
                const data = includeData ? await this.getObject(image.handle, size) : undefined
                if (data && data.length !== size)
                    throw new Error('Canon captured-image transfer length does not match its metadata')
                return { ...(includeInfo && { info }), ...(data && { data }), objectHandle: image.handle }
            })
        } finally {
            watch.stop()
        }
    }

    async sendStartRecording(): Promise<void> {
        await this.enableLiveView()

        await this.set(this.registry.properties.CanonRecordingDestination, 'CARD')
    }

    /**
     * EDSDK 13.20.21 MultiCamCui CameraModel::RecStart prepares SaveTo_Camera.
     * PTP card IDs are body-specific (libgphoto2 camera_canon_eos_update_capture_target).
     * Only replace host routing with an advertised card value, and restore after recording.
     */
    async prepareRecordingDestination(): Promise<() => Promise<void>> {
        const property = this.registry.properties.CanonCaptureDestination
        const original = this.propertyCache.get(property)?.current
        if (original === undefined) return async () => {}
        if (original !== 4) return async () => {}
        const choices = this.getPropertyAllowedValues(property)
        // Prefer the card value physically verified on the R8/R6 when advertised.
        // Other body-specific values retain libgphoto2's advertised-choice fallback.
        const card = choices?.includes(2) ? 2 : choices?.find(value => value > 0 && value !== 4)
        if (card === undefined)
            throw new Error('Canon is routing captures to host memory and did not advertise a card destination')
        let restored = false
        const restore = async () => {
            if (restored) return
            await this.set(property, original)
            restored = true
        }
        try {
            await this.set(property, card)
        } catch (error) {
            try {
                await restore()
            } catch (cleanup) {
                throw new AggregateError(
                    [error, cleanup],
                    'Canon card preparation failed and its destination could not be restored'
                )
            }
            throw error
        }
        return restore
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
                    throw new PTPResponseError(
                        response.code,
                        `Canon viewfinder read returned 0x${response.code.toString(16)}`
                    )
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

    /** Whether this session's DeviceInfo advertised the operation. */
    advertises(operation: { code: number }): boolean {
        return this.supportedOperations?.has(operation.code) ?? false
    }

    private assertOperationSupported(code: number): void {
        if (!this.supportedOperations?.has(code))
            throw new Error(`Canon operation 0x${code.toString(16)} was not advertised by the attached camera`)
    }

    private assertResponseOk(code: number, action: string): void {
        if (code !== OK.code) throw new PTPResponseError(code, `Canon ${action} returned 0x${code.toString(16)}`)
    }

    async sendStopRecording(): Promise<void> {
        const property = this.registry.properties.CanonRecordingDestination
        const deadline = Date.now() + 5000
        let stopRequested = false
        for (;;) {
            // Reconnecting can find an already finalized movie. Read camera events before
            // treating an idle Stop as successful; a missing property is never idle proof.
            const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
            this.assertResponseOk(response.code, 'recording state readback')
            if (Array.isArray(response.data)) this.processEvents(response.data, true)
            const current = this.propertyCache.get(property)?.current
            // EOS reports 3 (legacy codec label SDRAM) in movie standby after
            // reconnect. Only the explicit NONE/standby states prove card Record ended.
            if (current === 'NONE' || current === 'SDRAM') return
            if (Date.now() >= deadline) throw new Error('Canon did not confirm recording stopped within 5 seconds')
            if (!stopRequested) {
                try {
                    await this.set(property, 'NONE')
                    stopRequested = true
                } catch (error) {
                    if ((error as { code?: number }).code !== 0x2019) throw error
                }
            }
            await new Promise(resolve => setTimeout(resolve, 250))
        }
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
            .filter(([, state]) => state.current !== undefined || state.unrecognized?.value !== undefined)
            .map(([property, state]) => ({
                code: property.code,
                name: property.name,
                description: property.description,
                access: property.access,
                value: state.current,
                ...(state.allowed ? { allowedValues: [...state.allowed] } : {}),
                ...(state.unrecognized && { unrecognized: { ...state.unrecognized } }),
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
        const response = await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'ENABLE' })
        this.assertResponseOk(response.code, 'remote-mode initialization')
    }

    private async disableRemoteMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'DISABLE' })
    }

    private async enableEventMode(): Promise<void> {
        const response = await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'ENABLE' })
        this.assertResponseOk(response.code, 'event-mode initialization')
    }

    private async disableEventMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'DISABLE' })
    }

    /** Shares a value Slate could not name with its raw number; never fails event processing. */
    private recordUnrecognizedValue(property: number, raw: number, choice: boolean): void {
        this.recordProtocol({
            type: 'unrecognized-value',
            vendorId: VendorIDs.CANON,
            property,
            dataType: 6,
            raw,
            choice,
        })
    }

    private processEvents(
        events: CanonEventRecord[],
        emitGenericEvents = true
    ): void {
        events.forEach(event => {
            if (event.object) for (const watcher of this.addedObjectWatchers) watcher(event.object)
            if (event.rawData) {
                for (const listener of this.rawEventListeners)
                    listener({ code: event.code, data: event.rawData.slice() })
            }
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
                    const existing = this.propertyCache.get(property)
                    const choices = existing?.unrecognized?.choices
                    let decoded
                    try {
                        decoded = codec.decode(encoded)
                    } catch {
                        // New bodies can publish values outside an older enum table: keep the
                        // property visible with its raw value, read-only, without a decoded current.
                        this.propertyCache.set(property, {
                            allowed: existing?.allowed,
                            unrecognized: { ...(choices && { choices }), value: canonRawLabel(encoded) },
                        })
                        this.unknownPropertyCache.set(propCode, {
                            ...this.unknownPropertyCache.get(propCode),
                            rawValue,
                            valueDataHex: bytesToHex(encoded),
                        })
                        if (encoded.length === 4) this.recordUnrecognizedValue(propCode, rawValue, false)
                        return
                    }

                    this.propertyCache.set(property, {
                        current: decoded.value,
                        allowed: existing?.allowed,
                        ...(choices && { unrecognized: { choices } }),
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
                    if (event.allowedValueData !== undefined || event.allowedValues !== undefined) {
                        const property = Object.values(this.registry.properties).find(p => p.code === propCode)
                        if (property) {
                            const codec = this.resolveCodec(property.codec)
                            const encodedAllowed =
                                event.allowedValueData !== undefined
                                    ? event.allowedValueData
                                    : event.allowedValues!.map(rawValue => this.registry.codecs.uint32.encode(rawValue))
                            this.advertisedPropertyData.set(
                                property,
                                encodedAllowed.map(encoded => encoded.slice())
                            )
                            const rejected: string[] = []
                            const decodedAllowed = encodedAllowed.flatMap(encoded => {
                                try {
                                    return [codec.decode(encoded).value]
                                } catch {
                                    rejected.push(canonRawLabel(encoded))
                                    if (encoded.length === 4)
                                        this.recordUnrecognizedValue(
                                            propCode,
                                            this.registry.codecs.uint32.decode(encoded).value,
                                            true
                                        )
                                    return []
                                }
                            })

                            const existing = this.propertyCache.get(property)
                            const value = existing?.unrecognized?.value
                            const unrecognized = {
                                ...(value !== undefined && { value }),
                                ...(rejected.length > 0 && { choices: rejected }),
                            }
                            this.propertyCache.set(property, {
                                current: existing?.current,
                                allowed: decodedAllowed,
                                ...(Object.keys(unrecognized).length > 0 && { unrecognized }),
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
        if (this.pollingSuspensions) {
            this.resumePolling = true
            return
        }
        if (this.polling) {
            return
        }

        this.polling = true
        this.pollingLoop = this.runPollingLoop(intervalMs)
    }

    private async runPollingLoop(intervalMs: number): Promise<void> {
        while (this.polling) {
            try {
                await this.maintainKeepAlive()
                if (!this.polling) return
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
        this.resumePolling = false
        this.polling = false
        await this.pollingLoop
        this.pollingLoop = undefined
    }

    private async flushInitialEvents(): Promise<void> {
        // The initial dump takes a few rounds; a camera that never drains its queue must not stall connect().
        let emptyRounds = 0
        for (let round = 0; round < MAXIMUM_INITIAL_EVENT_ROUNDS; round++) {
            const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
            this.assertResponseOk(response.code, 'initial event readback')
            if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                if (this.propertyCache.size === 0 && ++emptyRounds < 6) {
                    await new Promise(resolve => setTimeout(resolve, 100))
                    continue
                }
                break
            }
            this.processEvents(response.data, false)
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
            await this.set(this.registry.properties.CanonLiveViewMode, 'CAMERA_AND_HOST')
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

    // Driver contract (`@camera/driver`).
    #video?: ReturnType<typeof recordingCapability>

    /** EOS GetEvent records: a value or its choices changed, or a new file reached the card. */
    override subscribe(event: CameraEventName, handler: CameraEventHandler): () => void {
        const events = this.registry.events
        const codes: number[] =
            event === 'settingsChanged'
                ? [events.CanonValueChanged.code, events.CanonAllowedValuesChanged.code]
                : [events.CanonObjectAddedEx.code, events.CanonObjectAddedEx64.code]
        const listener = (raw: CanonRawEvent) => {
            if (codes.includes(raw.code)) handler()
        }
        this.onRawEvent(listener)
        return () => this.offRawEvent(listener)
    }

    /**
     * Collects the files the camera announces from now on (ObjectAddedEx/Ex64), so a capture or a
     * clip is confirmed by the camera's own event rather than by diffing the card.
     */
    private watchAddedObjects(accept: (filename: string) => boolean) {
        const added: CanonAddedObject[] = []
        const watcher = (object: CanonAddedObject) => {
            if (accept(object.filename)) added.push(object)
        }
        this.addedObjectWatchers.add(watcher)
        const stop = () => this.addedObjectWatchers.delete(watcher)
        /** Polls GetEvent (reads only) until a matching file is announced; never repeats a command. */
        const next = async (timeoutMilliseconds: number, description: string): Promise<CanonAddedObject[]> => {
            const deadline = Date.now() + timeoutMilliseconds
            while (!added.length) {
                if (Date.now() >= deadline)
                    throw new Error(`The camera announced no new ${description} within ${timeoutMilliseconds / 1000} seconds`)
                await this.withoutPolling(() => this.refreshEventProperties())
                if (!added.length) await wait(Math.min(250, Math.max(0, deadline - Date.now())))
            }
            return [...added]
        }
        return { stop, next }
    }

    /** One ObjectInfo lookup for an announced file: its card id, name and size. */
    private async addedObjectInfo(object: CanonAddedObject): Promise<ObjectInfo> {
        const response = await this.send(this.registry.operations.GetObjectInfo, { ObjectHandle: object.handle })
        this.assertResponseOk(response.code, 'new object information')
        if (!response.data) throw new Error('Canon new object metadata is missing')
        return response.data
    }

    async autofocus(): Promise<FocusResult> {
        return this.performAutofocus(CANON_FOCUS_DURATION_MILLISECONDS)
    }

    /**
     * EOS has one rectangle for the AF point and the magnify frame (EDSDK Evf_ZoomPosition, "the
     * focus and zoom border"). At 1x live view, moving it moves the AF point; the camera reads it back.
     */
    async setFocusPoint(x: number, y: number, options: FocusPointOptions): Promise<void> {
        requirePoint(x, y)
        await this.placeFocusFrame('setFocusPoint', x, y)
        if (options.autofocus) await this.performAutofocus(CANON_FOCUS_DURATION_MILLISECONDS)
    }

    /** Recentres the frame, which is also right while magnified. */
    async resetFocusPoint(): Promise<void> {
        await this.placeFocusFrame('resetFocusPoint', 0.5, 0.5)
    }

    private async placeFocusFrame(operation: 'setFocusPoint' | 'resetFocusPoint', x: number, y: number) {
        const operations = this.registry.operations
        const missing = [operations.CanonGetViewfinderData, operations.CanonViewfinderPosition].filter(
            definition => !this.advertises(definition)
        )
        if (missing.length)
            throw new CameraUnsupportedError(
                operation,
                `The camera does not advertise ${missing.map(definition => definition.name).join(', ')}`
            )
        const position = await this.getLiveViewPosition()
        if (operation === 'setFocusPoint' && position.magnification !== 1)
            throw new CameraUnsupportedError(operation, 'Canon places a focus point only in unmagnified live view')
        const visibleWidth = position.maximumX - position.minimumX + position.width
        const visibleHeight = position.maximumY - position.minimumY + position.height
        const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
        const originX = clamp(Math.round(position.minimumX + x * visibleWidth - position.width / 2), position.minimumX, position.maximumX)
        const originY = clamp(Math.round(position.minimumY + y * visibleHeight - position.height / 2), position.minimumY, position.maximumY)
        try {
            await this.setLiveViewPosition(originX, originY)
        } catch (error) {
            if (error instanceof PTPResponseError) throw new CameraRefusedError(operation, error.message)
            throw new CameraOutcomeUnknownError(operation, error instanceof Error ? error.message : String(error))
        }
    }

    /** Still mode for a body in movie mode, then a release confirmed by the camera's object-added event. */
    async takePhoto({ autofocus, destination }: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile> {
        return classified(async confirmed => {
            const wantsData = destination === 'computer'
            const capture = await this.withPhotoMode(async () => {
                const captured = await this.captureImage({ autofocus, includeInfo: true, includeData: wantsData })
                confirmed()
                return captured
            })
            return cardObjectFile(capture, wantsData)
        })
    }

    /** Canon's viewfinder frames carry no focus frames Slate decodes yet; none is invented. */
    async getLiveViewFrame({ overlay }: { overlay: boolean }): Promise<LiveViewFrame> {
        if (overlay) throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
        return { jpeg: requireImage((await this.captureViewfinderFrame()).image), focusFrames: [] }
    }

    private video() {
        return (this.#video ??= recordingCapability(this.recordingSteps()))
    }

    async getRecordingState(): Promise<CameraRecordingState> {
        return this.video().getRecordingState()
    }

    async startRecording(): Promise<void> {
        return this.video().startRecording()
    }

    async stopRecording(): Promise<Clip> {
        return this.video().stopRecording()
    }

    private recordingSteps(): VendorRecording {
        let clipWatch: ReturnType<CanonCamera['watchAddedObjects']> | undefined
        return {
            ...cardSteps(this, this.requireOwner()),
            readState: async () => {
                await this.refreshEventProperties()
                const state = this.listPropertyStates().find(state => state.name === 'CanonRecordingDestination')?.value
                return state === 'CARD' ? 'recording' : state === 'NONE' || state === 'SDRAM' ? 'idle' : 'unknown'
            },
            checkCard: async () => {
                const cards = await readCameraStorages(storageHost(this))
                if (!cards.some(card => card.writable && card.freeBytes > 0))
                    throw new CameraRefusedError('startRecording', 'Insert a writable memory card with free space before recording')
            },
            // Card destination, movie mode and the photo exposure copied across; movie sound is left as set.
            prepare: () => this.openMovieMode(),
            // No card scan: the clip is the movie the camera announces from here on.
            listHandles: async () => {
                clipWatch?.stop()
                clipWatch = this.watchAddedObjects(name => CANON_MOVIE_FILE.test(name))
                return new Set<number>()
            },
            findClip: async () => {
                const watch = clipWatch
                if (!watch) throw new Error('No Canon recording was watched for its clip')
                try {
                    const [movie] = await watch.next(clipFinalizationMilliseconds, 'movie')
                    const info = await this.addedObjectInfo(movie!)
                    const reported = info.objectCompressedSize
                    const sizeBytes = reported === unstatedSize ? undefined : reported
                    const reference = { source: 'object', storageId: info.storageID, objectHandle: movie!.handle, name: info.filename } as const
                    return {
                        mediaId: encodeMediaId({ ...reference, ...(sizeBytes !== undefined && { sizeBytes }) }),
                        name: info.filename,
                        ...(sizeBytes !== undefined && { sizeBytes }),
                    }
                } finally {
                    watch.stop()
                    if (clipWatch === watch) clipWatch = undefined
                }
            },
            sendStart: () => this.sendStartRecording(),
            sendStop: () => this.sendStopRecording(),
        }
    }

    private fixedMovie(): number | undefined {
        const value = this.listUnknownPropertyStates().find(state => state.code === FIXED_MOVIE)?.rawValue
        return value === 0 || value === 1 ? value : undefined
    }

    private exposureSnapshot(): ExposureSnapshot {
        const states = this.listPropertyStates()
        const read = (name: string) => states.find(state => state.name === name)?.value
        const values = new Map<ExposureProperty, string>()
        for (const name of exposureProperties) {
            const value = read(name)
            if (value !== undefined) values.set(name, String(value))
        }
        return { mode: Number(read('CanonAutoExposureMode')), values }
    }

    /** Movie-select On/Off can reset manual exposure to the dial; put back each advertised value and verify it. */
    private async restoreExposure(before: ExposureSnapshot): Promise<void> {
        if (before.mode !== MANUAL_EXPOSURE_MODE) return
        await this.setManualExposureMode()
        for (const [name, value] of before.values) {
            const find = () => this.listPropertyStates().find(state => state.name === name)
            const state = find()
            if (String(state?.value) === value) continue
            if (!state?.allowedValues?.map(String).includes(value))
                throw new Error(`Canon did not advertise the previous ${name}: ${value}`)
            const property = this.registry.properties[name]
            await this.set(property, value as CodecType<(typeof property)['codec']>)
            if (String(find()?.value) !== value) throw new Error(`Canon ${name} readback changed during the movie-mode transition`)
        }
    }

    /**
     * Mode selection can be acknowledged before it takes effect. When the body reports FixedMovie,
     * fresh event readback is required before a release, Record or restoration proceeds.
     */
    private async settleMovieMode(expected: 0 | 1, requiresReadback: boolean): Promise<void> {
        if (!requiresReadback && expected === 0) return
        await wait(MODE_SETTLE_MILLISECONDS)
        if (!requiresReadback) return
        const deadline = Date.now() + 2000
        do {
            await this.withoutPolling(() => this.refreshEventProperties())
            if (this.fixedMovie() === expected) return
            await wait(100)
        } while (Date.now() < deadline)
        throw new Error(`Canon did not confirm ${expected === 1 ? 'Movie' : 'Photo'} mode after selection`)
    }

    /**
     * Holds still mode across one capture and its transfer, then puts the operator's movie mode and
     * manual exposure back. A body whose physical selector holds movie mode cannot take a photo: that
     * is reported as unsupported before any shutter command is sent. @internal
     */
    async withPhotoMode<Result>(capture: () => Promise<Result>): Promise<Result> {
        if (this.fixedMovie() !== 1) return capture()
        const before = this.exposureSnapshot()
        let failure: unknown
        try {
            await this.leaveMovieMode()
            try {
                await this.settleMovieMode(0, true)
            } catch {
                throw new CameraUnsupportedError(
                    'takePhoto',
                    'Set the Canon body’s physical still/movie selector to Photo; it retained movie mode after the remote Photo command'
                )
            }
            return await capture()
        } catch (error) {
            failure = error
            throw error
        } finally {
            try {
                if (this.fixedMovie() !== 1) {
                    await this.enterMovieMode()
                    await this.settleMovieMode(1, true)
                }
                await this.restoreExposure(before)
            } catch (error) {
                if (failure)
                    throw new AggregateError([failure, error], `${String(failure)}; restoring movie mode: ${String(error)}`)
                throw error
            }
        }
    }

    /**
     * Holds movie mode across operator-controlled start and stop: card destination first, then movie
     * select with the photo's manual exposure copied across. Resolves to the restore, which runs
     * only after a confirmed idle. Movie sound stays as the operator or setAudioRecording left it.
     */
    private async openMovieMode(): Promise<() => Promise<void>> {
        const snapshot = (phase: StatePhase) => this.recordStateSnapshot('recording', phase)
        snapshot('before-prepare')
        const before = this.exposureSnapshot()
        const observed = this.fixedMovie()
        const requiresReadback = observed !== undefined
        let entered = false
        let restoreDestination: (() => Promise<void>) | undefined
        const restore = async () => {
            try {
                if (entered) {
                    await this.leaveMovieMode()
                    await this.settleMovieMode(0, requiresReadback)
                    await this.restoreExposure(before)
                    entered = false
                }
                await restoreDestination?.()
            } catch (error) {
                snapshot('failure')
                throw error
            } finally {
                snapshot('after-cleanup')
            }
        }
        try {
            restoreDestination = await this.prepareRecordingDestination()
            if (observed !== 1) {
                await this.enterMovieMode()
                entered = true
                await this.settleMovieMode(1, requiresReadback)
            }
            await this.restoreExposure(before)
            snapshot('after-prepare')
        } catch (error) {
            snapshot('failure')
            try {
                await restore()
            } catch (cleanup) {
                throw new AggregateError([error, cleanup], 'Canon recording preparation and restoration failed')
            }
            throw error
        }
        return restore
    }

    override async availability(
        operation: CameraOperationName,
        capabilities: CameraCapabilities
    ): Promise<OperationAvailability | undefined> {
        const operations = this.registry.operations
        if (operation === 'setFocusPoint' || operation === 'resetFocusPoint')
            return operationsAdvertised(capabilities, [operations.CanonGetViewfinderData, operations.CanonViewfinderPosition])
        if (operation === 'autofocus') {
            const advertised = capabilities.advertisedOperations
            return !advertised ||
                advertised.includes(operations.CanonDoAutofocus.code) ||
                advertised.includes(operations.CanonRemoteReleaseOn.code)
                ? supported
                : unsupported('The camera advertises neither DoAf nor a remote half-press')
        }
        if (operation === 'getLiveViewFrame')
            return { supported: true, options: { overlay: { supported: false, reason: overlayUnsupported } } }
        return super.availability(operation, capabilities)
    }
}
