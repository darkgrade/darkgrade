import type { PhotoVideoMode } from '@camera/settings/values'
import type { CameraCapabilities, CameraControlId, CameraRecordingState, OperationAvailability } from '@camera/controls'
import { unrecognizedValueLabel, type UnrecognizedValues } from '@camera/controls'
import type {
    CameraEventHandler,
    CameraEventName,
    CameraOperationName,
    Clip,
    ConfirmedPhotoFile,
    FocusPointOptions,
    FocusResult,
    LiveViewFrame,
    PhotoDestination,
} from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { StatePhase } from '@contribute/protocol'
import { Logger } from '@core/logger'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { DeviceBusy, OK, OperationNotSupported, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { CodecType } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { assertCanonCaptureResult } from '@vendors/canon/capture-result'
import type { CanonAddedObject, CanonEventRecord } from '@vendors/canon/datasets/canon-event-data-dataset'
import type { CanonExtendedDeviceInfo } from '@vendors/canon/datasets/canon-extended-device-info-dataset'
import { canonImageFormatFromPacked } from '@vendors/canon/datasets/canon-image-format-dataset'
import { canonLiveViewPosition, type CanonLiveViewFrame, type CanonLiveViewPosition } from '@vendors/canon/datasets/canon-live-view-dataset'
import { CANON_PROPERTY_NAMES } from '@vendors/canon/definitions/canon-property-names'
import { canonControlProperties } from '@vendors/canon/control-properties'
import { FocusPointChanges } from '@vendors/generic/focus-point-changes'
import { standardClockUnavailable } from '@vendors/generic/standard-clock'
import { GenericCamera, type CameraRecoveryOptions, type CameraRecoveryReport } from '@vendors/generic/generic-camera'
import { normalizeCameraPower, readStandardPower } from '@vendors/power-reading'
import { observeCanonControls, writeCanonControl } from '@vendors/canon/controls'
import type { ControlWrite } from '@vendors/generic/control-observation'
import {
    cardObjectFile,
    cardSteps,
    classified,
    clipFinalizationMilliseconds,
    operationsAdvertised,
    overlayUnsupported,
    requireImage,
    requirePoint,
    restoreAll,
    supported,
    unsupported,
    wait,
} from '@vendors/generic/generic-operations'
import { encodeMediaId, mediaKind } from '@vendors/generic/media-id'
import { recordingCapability, type VendorRecording } from '@vendors/generic/recording-lifecycle'
import { afterShutterRelease, shutterOutcomeUnknown, shutterRefused } from '@vendors/generic/shutter-outcome'
import { readCameraStorages } from '@vendors/generic/storage'
import { CanonRegistry, createCanonRegistry } from '@vendors/registry'
import { OBJECT_SIZE_UNREPORTED } from '@ptp/datasets/object-info-dataset'

const MAXIMUM_INITIAL_EVENT_ROUNDS = 64
/** EDSDK shutter result for a half-press whose autofocus failed (EDSDKErrors.h TAKE_PICTURE_AF_NG). */
const CANON_RELEASE_RESULT_FOCUS_FAILED = 1
const canonClockUnpublished = 'This camera does not publish its clock (EOS UTCTime) over USB'
const CANON_FOCUS_DURATION_MILLISECONDS = 800
/** FixedMovie: 1 while the body is in movie mode (libgphoto2 PTP_DPC_CANON_EOS_FixedMovie). */
const FIXED_MOVIE = 0xd1c2
const MODE_SETTLE_MILLISECONDS = 700
const MANUAL_EXPOSURE_MODE = 3
const CANON_STILL_FILE = /\.(jpe?g|heif|heic|cr2|cr3)$/i
/** The manual settings a movie-select transition can reset. */
const exposureProperties = ['CanonIso', 'CanonAperture', 'CanonShutterSpeed', 'CanonWhiteBalance'] as const
type ExposureProperty = (typeof exposureProperties)[number]
type ExposureSnapshot = { mode: number; values: Map<ExposureProperty, string> }
type PropertyValue = CodecType<PropertyDefinition['codec']>
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

/** `objectHandle` is the new card object's handle, when info or data was requested. */
type CanonCapture = { info?: ObjectInfo; data?: Uint8Array; objectHandle?: number }
/** An announced card object, named by its ObjectInfo. */
type AddedFile = { handle: number; info: ObjectInfo }

/** EOS live-view AF areas whose frame the host positions: one point, spot or an expanded point. */
const CANON_POSITIONED_AF_AREAS: readonly string[] = [
    'live',
    'one-point-without-tracking',
    'spot',
    'spot-without-tracking',
    'expand-cross',
    'expand-around',
    'expand-cross-without-tracking',
    'expand-around-without-tracking',
]
/** The point a focus point switches a self-placing area (Wide, Zone, Face, Tracking) to, in preference order. */
const CANON_FOCUS_POINT_AREAS = ['live', 'one-point-without-tracking', 'spot', 'spot-without-tracking'] as const
/** The properties behind Slate's controls, plus FixedMovie for photo/video mode: their changes are `settingsChanged`. */
const CANON_SETTING_CODES = new Set([
    ...Object.values(canonControlProperties).flatMap(properties => properties.map(property => property.code)),
    FIXED_MOVIE,
])

export interface CanonRawEvent {
    code: number
    /** Owned copy of the complete EOS GetEvent record body, excluding its size/code header. */
    data: Uint8Array
}

/** A refused focus-frame write took nothing; any other failure leaves its outcome unknown. */
function focusFailure(operation: 'setFocusPoint' | 'resetFocusPoint', error: unknown): never {
    if (error instanceof PTPResponseError) throw new CameraRefusedError(operation, error.message)
    throw new CameraOutcomeUnknownError(operation, error instanceof Error ? error.message : String(error))
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
 * Canon publishes its PTP implementation only under NDA. Thanks to Julian Schroden's reverse engineering:
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
    private settingsListeners = new Set<CameraEventHandler>()
    /** The last value and choices bytes of each setting property, so only a real change is `settingsChanged`. */
    private settingSignatures = new Map<string, string>()
    /** What setFocusPoint changed on this body, so resetFocusPoint and disconnect can put it back. */
    private readonly focusChanges = new FocusPointChanges()
    private addedObjectWatchers = new Set<(object: CanonAddedObject) => void>()
    private pollingLoop?: Promise<void>
    private liveViewEnabled = false
    private liveViewOriginalOutput?: CodecType<CanonRegistry['properties']['CanonLiveViewMode']['codec']>
    private supportedOperations?: Set<number>
    private advertisedPropertyData = new Map<PropertyDefinition, Uint8Array[]>()
    private propertyCache = new Map<
        PropertyDefinition,
        { current?: PropertyValue; allowed?: PropertyValue[]; unrecognized?: UnrecognizedValues }
    >()
    private unknownPropertyCache = new Map<number, Omit<CanonUnknownPropertyState, 'code' | 'codeHex' | 'name'>>()
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
        const response = await this.getEvents()
        if (response.code !== OK.code || !Array.isArray(response.data)) throw new Error('No Canon event inventory')
        this.processEvents(response.data)
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
        await this.setSessionMode('remote', true)
        await this.setSessionMode('event', true)
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
            () => restoreAll('disconnect', this.focusRestoreSteps()),
            () => this.disableLiveView(),
            () => this.setSessionMode('remote', false),
            () => this.setSessionMode('event', false),
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

    /** EOS control sessions use the same id during connect and recovery. */
    protected override createSessionId(): number {
        return 1
    }

    override async recover(
        device?: DeviceDescriptor,
        options: CameraRecoveryOptions = {}
    ): Promise<CameraRecoveryReport> {
        if (this.propertyCache.get(this.registry.properties.CanonRecordStatus)?.current === 'CARD')
            throw new CameraUnsupportedError('recover', 'Stop the Canon recording before recovering its session')
        await this.stopPolling()
        await this.disconnect().catch(() => {})
        try {
            return await super.recover(device, options)
        } finally {
            this.clearCachedState()
        }
    }

    protected override async verifyRecoveryState(_information: DeviceInfo): Promise<void> {
        // GetDeviceInfo can answer while EOS controls still report SessionNotOpen.
        try {
            await this.setSessionMode('remote', true)
            await this.setSessionMode('event', true)
            await this.refreshEventProperties()
        } finally {
            await this.setSessionMode('remote', false)
            await this.setSessionMode('event', false)
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
        this.settingSignatures.clear()
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) throw new Error(`Property ${property.name} is not readable`)
        const current = () => this.propertyCache.get(property)?.current
        if (current() === undefined && this.transport.isConnected?.()) {
            await this.withoutPolling(async () => {
                for (let attempt = 0; attempt < 10 && current() === undefined; attempt++) {
                    if (attempt > 0) await wait(50)
                    await this.refreshEventProperties()
                }
            })
        }
        const value = current()
        if (value === undefined)
            throw new Error(
                `Property ${property.name} (0x${property.code.toString(16)}) not found in cache. The camera may not support this property or event mode is not enabled.`
            )
        return value as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        return this.withoutPolling(async () => {
            if (!property.access.includes('Set')) throw new Error(`Property ${property.name} is not writable`)
            const codec = this.resolveCodec(property.codec)
            const requestedValue = codec.encode(value)
            const isRequested = (encoded?: Uint8Array) =>
                encoded?.length === requestedValue.length &&
                encoded.every((byte, index) => byte === requestedValue[index])
            const encodedValue =
                this.advertisedPropertyData.get(property)?.find(encoded => {
                    try {
                        return isRequested(codec.encode(codec.decode(encoded).value))
                    } catch {
                        return false
                    }
                }) ?? requestedValue
            // Record is a command/state property: stop (0) may report standby (3).
            const verifyReadback =
                this.propertyCache.get(property)?.current !== undefined &&
                property.code !== this.registry.properties.CanonRecordStatus.code
            await this.sendPropertyValue(property, encodedValue)
            await wait(100)

            const deadline = Date.now() + 2000
            do {
                const events = await this.readEvents('property event readback')
                const current = this.propertyCache.get(property)?.current
                if (isRequested(current === undefined ? undefined : codec.encode(current))) return
                if (!verifyReadback && !events.length) return
                await wait(50)
            } while (Date.now() < deadline)
            // Acknowledged but never observed: report it unconfirmed, never resend it.
            throw new CameraOutcomeUnknownError(
                property.name,
                `Canon ${property.name} did not publish the requested value within 2 seconds`
            )
        })
    }

    /** One CanonSetPropValue; DeviceBusy means nothing was applied, so only that is sent again, briefly. */
    private async sendPropertyValue(property: PropertyDefinition, encodedValue: Uint8Array): Promise<void> {
        const data = new Uint8Array(Math.max(12, 8 + encodedValue.length))
        data.set(this.registry.codecs.uint32.encode(data.length), 0)
        data.set(this.registry.codecs.uint32.encode(property.code), 4)
        data.set(encodedValue, 8)
        for (let attempt = 1; ; attempt++) {
            try {
                const response = await this.send(this.registry.operations.CanonSetDevicePropValue, {}, data)
                this.assertResponseOk(response.code, `${property.name} write`)
                return
            } catch (error) {
                if ((error as { code?: number }).code !== DeviceBusy.code || attempt >= 5) throw error
                await wait(100)
            }
        }
    }

    /**
     * The standard DateTime where the body advertises it; otherwise EOS UTCTime (0xD17C, seconds since
     * 1970, UTC), which libgphoto2 writes for
     * "datetimeutc" (camlibs/ptp2/config.c `_put_UINT32_as_time`, 6d5c61ef). Only a body that publishes
     * UTCTime is tried; the write is sent once and confirmed from the clock it publishes next, which keeps
     * ticking. Not yet run on hardware (the R8 Mark II publishes 0xD113, 0xD17C and 0xD17D): a bench
     * safe-probe of UTCTime must confirm it before Canon clock support is claimed.
     */
    override async setClock(moment: Date): Promise<void> {
        if (!(await standardClockUnavailable(this))) return super.setClock(moment)
        const property = this.registry.properties.CanonUtcTime
        await this.withoutPolling(() => this.refreshEventProperties())
        if (this.propertyCache.get(property)?.current === undefined)
            throw new CameraUnsupportedError('setClock', canonClockUnpublished)
        const seconds = Math.floor(moment.getTime() / 1000)
        if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 0xffffffff)
            throw new CameraRefusedError('setClock', 'Canon keeps its clock in seconds from 1970 to 2106')
        await this.withoutPolling(async () => {
            const startedAt = Date.now()
            try {
                await this.sendPropertyValue(property, this.registry.codecs.uint32.encode(seconds))
            } catch (error) {
                throw new CameraRefusedError('setClock', `The camera refused the new date and time: ${error instanceof Error ? error.message : String(error)}`)
            }
            const deadline = Date.now() + 2000
            do {
                await this.readEvents('clock readback')
                const shown = Number(this.propertyCache.get(property)?.current)
                const elapsedSeconds = (Date.now() - startedAt) / 1000
                if (shown >= seconds - 1 && shown <= seconds + 2 + elapsedSeconds) return
                await wait(50)
            } while (Date.now() < deadline)
            throw new CameraOutcomeUnknownError('setClock', 'The camera accepted the date and time but did not publish its new clock')
        })
    }

    /** Writes a named enum value; the codec rejects a name it does not define. */
    private setNamed<P extends PropertyDefinition>(property: P, value: string): Promise<void> {
        return this.set(property, value as CodecType<P['codec']>)
    }

    async setImageFormat(packed: number): Promise<void> {
        const { CanonImageFormatSd, CanonImageFormat } = this.registry.properties
        const property = [CanonImageFormatSd, CanonImageFormat].find(
            candidate => this.propertyCache.get(candidate)?.current !== undefined
        )
        if (!property) throw new Error('The attached Canon camera did not report a writable still-image format property')
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
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
            throw new Error(`Canon network communication mode must be a uint32, received ${value}`)
        const property = this.registry.properties.CanonNetworkCommunicationMode
        const advertised = this.getPropertyAllowedValues(property)
        if (!allowUnadvertised && advertised && !advertised.includes(value))
            throw new Error(`Canon network communication mode ${value} was not advertised by the attached camera`)
        await this.set(property, value)
    }

    /** Enable manual exposure using the EOS remote AE property and verify its event readback. */
    async setManualExposureMode(): Promise<void> {
        const property = this.registry.properties.CanonAutoExposureMode
        if ((await this.get(property)) === MANUAL_EXPOSURE_MODE) return
        await this.set(property, MANUAL_EXPOSURE_MODE)
        if ((await this.get(property)) !== MANUAL_EXPOSURE_MODE) throw new Error('Canon did not confirm Manual exposure mode')
    }

    /** @internal Whether this session's DeviceInfo advertised an operation; unknown before connect. */
    advertisesOperation(code: number): boolean {
        return this.supportedOperations?.has(code) === true
    }

    override async observeControlStates(requested?: CameraControlId) {
        return observeCanonControls(this, requested)
    }

    override async writeControlValue(write: ControlWrite): Promise<void> {
        return writeCanonControl(this, write)
    }

    override async sendPhotoVideoMode(requested: PhotoVideoMode): Promise<void> {
        return requested === 'video' ? this.enterMovieMode() : this.leaveMovieMode()
    }

    async enterMovieMode(): Promise<void> {
        await this.selectMovieMode(this.registry.operations.CanonMovieSelectSwitchOn, 'movie-mode switch')
    }

    async leaveMovieMode(): Promise<void> {
        await this.selectMovieMode(this.registry.operations.CanonMovieSelectSwitchOff, 'movie-mode release')
    }

    /** Live-view/AF shutdown can briefly occupy the body; only this idempotent mode request is retried. */
    private async selectMovieMode(
        operation: CanonRegistry['operations']['CanonMovieSelectSwitchOn' | 'CanonMovieSelectSwitchOff'],
        action: string
    ): Promise<void> {
        if (this.supportedOperations) this.assertOperationSupported(operation.code)
        await this.withoutPolling(async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
                const response = await this.send(operation, {})
                if (response.code === OK.code) return
                if (response.code !== DeviceBusy.code || attempt === 3) this.assertResponseOk(response.code, action)
                await wait(500)
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
                    await wait(durationMilliseconds)
                } finally {
                    await this.send(this.registry.operations.CanonCancelAutofocus, {})
                }
                return 'unknown'
            }
            // EOS DSLRs such as the 80D accept DoAf only in live view; a remote half-press is the AF-ON equivalent.
            const halfPress = await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'FOCUS', AFMode: 'AF' })
            if (halfPress.code !== OK.code)
                throw new CameraRefusedError(
                    'autofocus',
                    `Canon autofocus returned 0x${response.code.toString(16)} and half-press returned 0x${halfPress.code.toString(16)}`
                )
            try {
                if (halfPress.parameters?.[0] === CANON_RELEASE_RESULT_FOCUS_FAILED) return 'not-acquired'
                try {
                    assertCanonCaptureResult(halfPress.parameters, 'autofocus half press')
                } catch (error) {
                    throw new CameraRefusedError('autofocus', error instanceof Error ? error.message : String(error))
                }
                await wait(durationMilliseconds)
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
        if (!this.keepAliveEnabled || this.keepAliveUnavailable || !this.advertises(this.registry.operations.CanonKeepDeviceOn))
            return
        const now = performance.now()
        // libgphoto2 config.c camera_keep_device_on: the EOS R8 needs KeepDeviceOn about every 10 s besides GetEvent.
        if (this.lastKeepAliveAttempt !== undefined && now - this.lastKeepAliveAttempt < 10_000) return
        this.lastKeepAliveAttempt = now
        const response = await this.send(this.registry.operations.CanonKeepDeviceOn, {})
        if (response.code === OperationNotSupported.code) this.keepAliveUnavailable = true
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
    }: { includeInfo?: boolean; includeData?: boolean; autofocus?: boolean } = {}): Promise<CanonCapture> {
        if (typeof autofocus !== 'boolean') throw new Error('Canon capture autofocus must be true or false')
        let shutterSent = false
        let shutterRefusal: unknown
        const release = async (afMode: 'AF' | 'MF') => {
            const pressed = { FOCUS: false, SHUTTER: false }
            const attempted = { FOCUS: false, SHUTTER: false }
            let failure: unknown
            try {
                attempted.FOCUS = true
                const operation = this.registry.operations.CanonRemoteReleaseOn
                const focus = await this.send(operation, { ReleaseMode: 'FOCUS', AFMode: afMode })
                this.assertResponseOk(focus.code, `${afMode} focus press`)
                pressed.FOCUS = true
                assertCanonCaptureResult(focus.parameters, `${afMode} focus press`)
                await wait(afMode === 'AF' ? 1000 : 250)

                attempted.SHUTTER = shutterSent = true
                const shutter = await this.send(operation, { ReleaseMode: 'SHUTTER', AFMode: afMode })
                if (shutter.code !== OK.code) {
                    const answer = `Canon ${afMode} shutter press returned 0x${shutter.code.toString(16)}`
                    // DeviceBusy at an AF full press generally means the body could not lock focus.
                    shutterRefusal =
                        afMode === 'AF' && shutter.code === DeviceBusy.code
                            ? shutterRefused(
                                  new PTPResponseError(
                                      shutter.code,
                                      `The camera could not lock focus, so nothing was taken (${answer}); ` +
                                          'take the photo with autofocus false to release without focusing'
                                  )
                              )
                            : new PTPResponseError(shutter.code, answer)
                    throw shutterRefusal
                }
                pressed.SHUTTER = true
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
                for (const ReleaseMode of ['SHUTTER', 'FOCUS'] as const) {
                    if (!pressed[ReleaseMode] && !(afMode === 'MF' && attempted[ReleaseMode])) continue
                    try {
                        const response = await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode })
                        this.assertResponseOk(response.code, `${ReleaseMode.toLowerCase()} release`)
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
        const capture = () => this.withoutPolling(() => release(autofocus ? 'AF' : 'MF'))
        const pressShutter = async () => {
            try {
                await capture()
            } catch (error) {
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
        await this.withoutPolling(() => this.refreshEventProperties())
        const watch = this.watchAddedObjects(name => CANON_STILL_FILE.test(name))
        try {
            await pressShutter()
            // The shutter was accepted: an unconfirmed or untransferred still is an unknown outcome, never a retry.
            return await afterShutterRelease(async () => {
                const added = await watch.next(8000, 'still image')
                const image = added.find(file => /\.jpe?g$/i.test(file.info.filename)) ?? added[0]!
                const info = image.info
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
        await this.set(this.registry.properties.CanonRecordStatus, 'CARD')
    }

    /**
     * EDSDK 13.20.21 MultiCamCui CameraModel::RecStart prepares SaveTo_Camera.
     * PTP card IDs are body-specific (libgphoto2 camera_canon_eos_update_capture_target).
     * Only replace host routing with an advertised card value, and restore after recording.
     */
    async prepareRecordingDestination(): Promise<() => Promise<void>> {
        const property = this.registry.properties.CanonCaptureDestination
        const original = this.propertyCache.get(property)?.current
        if (original !== 4) return async () => {}
        const choices = this.getPropertyAllowedValues(property)
        // Prefer the card value physically verified on the R8/R6; otherwise libgphoto2's advertised-choice fallback.
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
                throw new AggregateError([error, cleanup], 'Canon card preparation failed and its destination could not be restored')
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
                if (response.code !== DeviceBusy.code && response.code !== this.registry.responses.ObjectNotReady.code)
                    this.assertResponseOk(response.code, 'viewfinder read')
                await wait(100)
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
            const response = await this.send(this.registry.operations.CanonViewfinderZoom, { Magnification: magnification })
            this.assertResponseOk(response.code, 'live-view zoom')
            for (let attempt = 0; attempt < 10; attempt++) {
                const zoomState = (await this.captureViewfinderFrame()).segments.find(segment => segment.type === 4)?.data
                const view = zoomState?.length === 4 && new DataView(zoomState.buffer, zoomState.byteOffset, 4)
                if (view && view.getUint32(0, true) === magnification) return
                await wait(100)
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
                // The R6 III rounds small requests (2786 -> 2788); a stale or ignored 200-pixel pan cannot match.
                if (Math.abs(position.x - x) <= 4 && Math.abs(position.y - y) <= 4) return position
                await wait(100)
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

    /** Whether this session's DeviceInfo advertised the operation. */
    advertises(operation: { code: number }): boolean {
        return this.supportedOperations?.has(operation.code) ?? false
    }

    private assertOperationSupported(code: number): void {
        if (!this.supportedOperations?.has(code))
            throw new Error(`Canon operation 0x${code.toString(16)} was not advertised by the attached camera`)
    }

    private getEvents() {
        return this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
    }

    private async readEvents(action: string): Promise<CanonEventRecord[]> {
        const response = await this.getEvents()
        this.assertResponseOk(response.code, action)
        const events = Array.isArray(response.data) ? response.data : []
        this.processEvents(events)
        return events
    }

    private assertResponseOk(code: number, action: string): void {
        if (code !== OK.code) throw new PTPResponseError(code, `Canon ${action} returned 0x${code.toString(16)}`)
    }

    async sendStopRecording(): Promise<void> {
        const property = this.registry.properties.CanonRecordStatus
        const deadline = Date.now() + 5000
        let stopRequested = false
        for (;;) {
            // Reconnecting can find an already finalized movie; a missing property is never idle proof.
            await this.readEvents('recording state readback')
            const current = this.propertyCache.get(property)?.current
            // EOS reports 3 (legacy label SDRAM) in movie standby after reconnect; only NONE/standby prove Record ended.
            if (current === 'NONE' || current === 'SDRAM') return
            if (Date.now() >= deadline) throw new Error('Canon did not confirm recording stopped within 5 seconds')
            if (!stopRequested) {
                try {
                    await this.set(property, 'NONE')
                    stopRequested = true
                } catch (error) {
                    if ((error as { code?: number }).code !== DeviceBusy.code) throw error
                }
            }
            await wait(250)
        }
    }

    getPropertyAllowedValues<P extends PropertyDefinition>(property: P): CodecType<P['codec']>[] | undefined {
        return this.propertyCache.get(property)?.allowed as CodecType<P['codec']>[] | undefined
    }

    /** EOS bodies report a level (0xd111) where the standard BatteryLevel gives no percentage. */
    override async readPower() {
        const standard = await readStandardPower(this)
        if (standard?.percent !== undefined) return standard
        return normalizeCameraPower('canon', [...this.listPropertyStates(), ...this.listUnknownPropertyStates()])
    }

    listPropertyStates(): CanonPropertyState[] {
        return [...this.propertyCache.entries()]
            .filter(([, state]) => state.current !== undefined || state.unrecognized?.value !== undefined)
            .map(([{ code, name, description, access }, state]) => ({
                code,
                name,
                description,
                access,
                value: state.current,
                ...(state.allowed ? { allowedValues: [...state.allowed] } : {}),
                ...(state.unrecognized && { unrecognized: { ...state.unrecognized } }),
            }))
            .sort((left, right) => left.code - right.code)
    }

    listUnknownPropertyStates(): CanonUnknownPropertyState[] {
        return [...this.unknownPropertyCache.entries()]
            .map(([code, state]) => {
                const codeHex = `0x${code.toString(16).padStart(4, '0')}`
                return { code, codeHex, name: CANON_PROPERTY_NAMES[code], ...state }
            })
            .sort((left, right) => left.code - right.code)
    }

    private cachedOptionalNumber(property: PropertyDefinition): number | undefined {
        const value = this.propertyCache.get(property)?.current
        return typeof value === 'number' ? value : undefined
    }

    /** Enabling checks the answer; disabling is best effort. */
    private async setSessionMode(mode: 'remote' | 'event', enabled: boolean): Promise<void> {
        const value = enabled ? 'ENABLE' : 'DISABLE'
        const response =
            mode === 'remote'
                ? await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: value })
                : await this.send(this.registry.operations.CanonSetEventMode, { EventMode: value })
        if (enabled) this.assertResponseOk(response.code, `${mode}-mode initialization`)
    }

    /** Shares a value Slate could not name with its raw number; never fails event processing. */
    private recordUnrecognizedValue(property: number, raw: number, choice: boolean): void {
        this.recordProtocol({ type: 'unrecognized-value', vendorId: VendorIDs.CANON, property, dataType: 6, raw, choice })
    }

    private processEvents(events: CanonEventRecord[], emitGenericEvents = true): void {
        let settingsChanged = false
        for (const event of events) {
            if (event.object) for (const watcher of this.addedObjectWatchers) watcher(event.object)
            if (event.rawData)
                for (const listener of this.rawEventListeners) listener({ code: event.code, data: event.rawData.slice() })
            const parameters = event.parameters.map(Number)
            if (emitGenericEvents) this.handleEvent({ code: event.code, parameters, transactionId: 0 })
            const [propertyCode, rawValue] = parameters
            if (event.code === 0xc189 && propertyCode !== undefined && rawValue !== undefined)
                this.recordValue(event, propertyCode, rawValue)
            const announcesChoices = event.allowedValueData !== undefined || event.allowedValues !== undefined
            if (event.code === 0xc18a && propertyCode !== undefined && announcesChoices)
                this.recordChoices(event, propertyCode)
            if (propertyCode !== undefined && this.settingRecordChanged(event, propertyCode)) settingsChanged = true
        }
        if (settingsChanged && emitGenericEvents) for (const listener of this.settingsListeners) listener()
    }

    /**
     * EOS repeats value and choice records it has already sent, so a setting counts as changed only
     * when its bytes differ from the last ones seen. The first observation after connect is a baseline.
     */
    private settingRecordChanged(event: CanonEventRecord, code: number): boolean {
        if (!CANON_SETTING_CODES.has(code) || (event.code !== 0xc189 && event.code !== 0xc18a)) return false
        const bytes =
            event.code === 0xc189
                ? event.valueData && bytesToHex(event.valueData)
                : (event.allowedValueData?.map(bytesToHex) ?? event.allowedValues?.map(String))?.join(',')
        if (bytes === undefined) return false
        const key = `${event.code}:${code}`
        const previous = this.settingSignatures.get(key)
        this.settingSignatures.set(key, bytes)
        return previous !== undefined && previous !== bytes
    }

    private findProperty(code: number): PropertyDefinition | undefined {
        return Object.values(this.registry.properties).find(property => property.code === code)
    }

    private recordValue(event: CanonEventRecord, code: number, rawValue: number): void {
        const property = this.findProperty(code)
        const rememberRaw = (encoded?: Uint8Array) =>
            this.unknownPropertyCache.set(code, {
                ...this.unknownPropertyCache.get(code),
                rawValue,
                valueDataHex: encoded && bytesToHex(encoded),
            })
        if (!property) return void rememberRaw(event.valueData)
        const codec = this.resolveCodec(property.codec)
        const encoded = event.valueData || this.registry.codecs.uint32.encode(rawValue)
        const existing = this.propertyCache.get(property)
        const choices = existing?.unrecognized?.choices
        let current: PropertyValue
        try {
            current = codec.decode(encoded).value
        } catch {
            // A value outside an older enum table stays visible with its raw value, read-only, without a decoded current.
            const unrecognized = { ...(choices && { choices }), value: canonRawLabel(encoded) }
            this.propertyCache.set(property, { allowed: existing?.allowed, unrecognized })
            rememberRaw(encoded)
            if (encoded.length === 4) this.recordUnrecognizedValue(code, rawValue, false)
            return
        }
        this.propertyCache.set(property, { current, allowed: existing?.allowed, ...(choices && { unrecognized: { choices } }) })
    }

    private recordChoices(event: CanonEventRecord, code: number): void {
        const property = this.findProperty(code)
        if (!property) {
            this.unknownPropertyCache.set(code, {
                ...this.unknownPropertyCache.get(code),
                allowedValues: event.allowedValues ? [...event.allowedValues] : undefined,
                allowedValueDataHex: event.allowedValueData?.map(bytesToHex),
            })
            return
        }
        const codec = this.resolveCodec(property.codec)
        const uint32 = this.registry.codecs.uint32
        const encodedAllowed = event.allowedValueData ?? event.allowedValues!.map(raw => uint32.encode(raw))
        this.advertisedPropertyData.set(property, encodedAllowed.map(encoded => encoded.slice()))
        const rejected: string[] = []
        const allowed = encodedAllowed.flatMap(encoded => {
            try {
                return [codec.decode(encoded).value]
            } catch {
                rejected.push(canonRawLabel(encoded))
                if (encoded.length === 4) this.recordUnrecognizedValue(code, uint32.decode(encoded).value, true)
                return []
            }
        })
        const existing = this.propertyCache.get(property)
        const value = existing?.unrecognized?.value
        const unrecognized = { ...(value !== undefined && { value }), ...(rejected.length > 0 && { choices: rejected }) }
        const hasUnrecognized = Object.keys(unrecognized).length > 0
        this.propertyCache.set(property, { current: existing?.current, allowed, ...(hasUnrecognized && { unrecognized }) })
    }

    /**
     * Each poll is scheduled only after the previous one finishes: setInterval does not wait for an async
     * callback, so slow polls would stack up faster than the bus drains them and starve other operations.
     */
    private startPolling(intervalMilliseconds = 200): void {
        if (this.pollingSuspensions) {
            this.resumePolling = true
            return
        }
        if (this.polling) return
        this.polling = true
        this.pollingLoop = this.runPollingLoop(intervalMilliseconds)
    }

    private async runPollingLoop(intervalMilliseconds: number): Promise<void> {
        while (this.polling) {
            try {
                await this.maintainKeepAlive()
                if (!this.polling) return
                // GetEvent is destructive: a response already read is always processed, even when a
                // pause or stopPolling began during it (both wait for this loop, so it precedes them).
                const response = await this.getEvents()
                if (Array.isArray(response.data) && response.data.length > 0) this.processEvents(response.data)
            } catch {}
            if (!this.polling) return
            await wait(intervalMilliseconds)
        }
    }

    private async stopPolling(): Promise<void> {
        this.resumePolling = false
        this.polling = false
        await this.pollingLoop
        this.pollingLoop = undefined
    }

    /** The initial dump takes a few rounds; a camera that never drains its queue must not stall connect(). */
    private async flushInitialEvents(): Promise<void> {
        let emptyRounds = 0
        for (let round = 0; round < MAXIMUM_INITIAL_EVENT_ROUNDS; round++) {
            const response = await this.getEvents()
            this.assertResponseOk(response.code, 'initial event readback')
            if (Array.isArray(response.data) && response.data.length > 0) {
                this.processEvents(response.data, false)
                continue
            }
            if (this.propertyCache.size > 0 || ++emptyRounds >= 6) break
            await wait(100)
        }
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
        if (this.liveViewOriginalOutput !== undefined)
            await this.set(this.registry.properties.CanonLiveViewMode, this.liveViewOriginalOutput)
        this.liveViewOriginalOutput = undefined
        this.liveViewEnabled = false
    }

    #video?: ReturnType<typeof recordingCapability>

    /** EOS GetEvent records: a setting's value or choices changed, or a new file reached the card. */
    override subscribe(event: CameraEventName, handler: CameraEventHandler): () => void {
        const listeners = event === 'settingsChanged' ? this.settingsListeners : this.addedObjectWatchers
        const listener = () => handler()
        listeners.add(listener)
        return () => listeners.delete(listener)
    }

    /**
     * Collects the files the camera announces from now on (ObjectAddedEx/Ex64/Ex64LFN), so a capture
     * or a clip is confirmed by the camera's own event rather than by diffing the card. Each
     * announced handle is named by its ObjectInfo, since the record layouts differ between bodies.
     */
    private watchAddedObjects(accept: (filename: string) => boolean) {
        const announced: CanonAddedObject[] = []
        const watcher = (object: CanonAddedObject) => announced.push(object)
        const recordsSeen = new Set<number>()
        const recordWatcher = (event: CanonRawEvent) => {
            if (event.code !== 0xc189 && event.code !== 0xc18a) recordsSeen.add(event.code)
        }
        this.addedObjectWatchers.add(watcher)
        this.onRawEvent(recordWatcher)
        const stop = () => {
            this.addedObjectWatchers.delete(watcher)
            this.offRawEvent(recordWatcher)
        }
        const matched: AddedFile[] = []
        const unreadable: string[] = []
        const named = new Set<number>()
        const nameAnnounced = async () => {
            for (const object of announced) {
                if (named.has(object.handle)) continue
                named.add(object.handle)
                try {
                    const info = await this.addedObjectInfo(object)
                    if (accept(info.filename)) matched.push({ handle: object.handle, info })
                } catch (error) {
                    unreadable.push(`0x${object.handle.toString(16)}: ${error instanceof Error ? error.message : String(error)}`)
                }
            }
        }
        const evidence = () => {
            const records = [...recordsSeen].map(code => `0x${code.toString(16)}`).join(', ') || 'none'
            return `other event records seen: ${records}${unreadable.length ? `; unreadable objects ${unreadable.join('; ')}` : ''}`
        }
        /** Polls GetEvent (reads only) until a matching file is announced; never repeats a command. */
        const next = async (timeoutMilliseconds: number, description: string): Promise<AddedFile[]> => {
            const deadline = Date.now() + timeoutMilliseconds
            for (;;) {
                await nameAnnounced()
                if (matched.length) return [...matched]
                if (Date.now() >= deadline)
                    throw new Error(
                        `The camera announced no new ${description} within ${timeoutMilliseconds / 1000} seconds (${evidence()})`
                    )
                await this.withoutPolling(() => this.refreshEventProperties())
                await nameAnnounced()
                if (!matched.length) await wait(Math.min(250, Math.max(0, deadline - Date.now())))
            }
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
        await this.usePositionedFocusArea()
        await this.placeFocusFrame('setFocusPoint', x, y)
        if (options.autofocus) await this.performAutofocus(CANON_FOCUS_DURATION_MILLISECONDS)
    }

    /**
     * Wide, Zone, Face and Tracking areas place their own frame and ignore a host position, so a
     * focus point first switches to an advertised single point (or spot) and remembers the area.
     */
    private async usePositionedFocusArea(): Promise<void> {
        const property = this.registry.properties.CanonLiveViewAutofocusMode
        if (!this.propertyCache.has(property)) return
        const area = String(await this.get(property))
        if (CANON_POSITIONED_AF_AREAS.includes(area)) return
        const offered = (this.getPropertyAllowedValues(property) ?? []).map(String)
        const point = CANON_FOCUS_POINT_AREAS.find(candidate => offered.includes(candidate))
        if (!point) throw new CameraUnsupportedError('setFocusPoint', `The camera offers no single-point focus area from ${area}`)
        const changes = await this.focusPointChanges()
        await this.set(property, point).catch(error => focusFailure('setFocusPoint', error))
        changes.changed(property.name, area, point)
    }

    /** Recentres a host-positioned frame (also right while magnified), then puts back the area a focus point replaced. */
    async resetFocusPoint(): Promise<void> {
        const property = this.registry.properties.CanonLiveViewAutofocusMode
        await this.focusPointChanges()
        await restoreAll('resetFocusPoint', [
            async () => {
                const area = this.propertyCache.has(property) ? String(await this.get(property)) : undefined
                if (area === undefined || CANON_POSITIONED_AF_AREAS.includes(area))
                    await this.placeFocusFrame('resetFocusPoint', 0.5, 0.5)
            },
            ...this.focusRestoreSteps(),
        ])
    }

    /** The AF area a focus point replaced, put back where the body still shows the one it chose. */
    private focusRestoreSteps(): (() => Promise<void>)[] {
        const property = this.registry.properties.CanonLiveViewAutofocusMode
        return this.focusChanges.restoreSteps(
            async () => String(await this.get(property)),
            (_name, value) => this.setNamed(property, value)
        )
    }

    /** This body's focus-point record, joined by its serial number once the body has been identified. */
    private async focusPointChanges(): Promise<FocusPointChanges> {
        const info = await this.getInfo().catch(() => undefined)
        if (info) this.focusChanges.identify(info)
        return this.focusChanges
    }

    settingWritten(id: CameraControlId): void {
        if (id === 'focusArea') this.focusChanges.forget(this.registry.properties.CanonLiveViewAutofocusMode.name)
    }

    private async placeFocusFrame(operation: 'setFocusPoint' | 'resetFocusPoint', x: number, y: number) {
        const { CanonGetViewfinderData, CanonViewfinderPosition } = this.registry.operations
        const missing = [CanonGetViewfinderData, CanonViewfinderPosition].filter(definition => !this.advertises(definition))
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
        await this.setLiveViewPosition(originX, originY).catch(error => focusFailure(operation, error))
    }

    /** Still mode for a body in movie mode, then a release confirmed by the camera's object-added event. */
    async takePhoto({ autofocus, destination }: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile> {
        return classified(async confirmed => {
            const wantsData = destination === 'computer'
            const capture = await this.withStillMode(async () => {
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
                const state = this.listPropertyStates().find(state => state.name === 'CanonRecordStatus')?.value
                return state === 'CARD' ? 'recording' : state === 'NONE' || state === 'SDRAM' ? 'idle' : 'unknown'
            },
            checkCard: async () => {
                const cards = await readCameraStorages(this)
                if (!cards.some(card => card.writable && card.freeBytes > 0))
                    throw new CameraRefusedError('startRecording', 'Insert a writable memory card with free space before recording')
            },
            prepare: () => this.openMovieMode(),
            listHandles: async () => {
                clipWatch?.stop()
                clipWatch = this.watchAddedObjects(name => mediaKind(name) === 'clip')
                return new Set<number>()
            },
            findClip: async () => {
                const watch = clipWatch
                if (!watch) throw new Error('No Canon recording was watched for its clip')
                try {
                    const [movie] = await watch.next(clipFinalizationMilliseconds, 'movie')
                    const info = movie!.info
                    const sizeBytes = info.objectCompressedSize === OBJECT_SIZE_UNREPORTED ? undefined : info.objectCompressedSize
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
        const value = this.unknownPropertyCache.get(FIXED_MOVIE)?.rawValue
        return value === 0 || value === 1 ? value : undefined
    }

    private exposureSnapshot(): ExposureSnapshot {
        const states = this.listPropertyStates()
        const read = (name: string) => states.find(state => state.name === name)?.value
        const values = new Map<ExposureProperty, string>()
        for (const name of exposureProperties) if (read(name) !== undefined) values.set(name, String(read(name)))
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
            await this.setNamed(this.registry.properties[name], value)
            if (String(find()?.value) !== value) throw new Error(`Canon ${name} readback changed during the movie-mode transition`)
        }
    }

    /**
     * Mode selection can be acknowledged before it takes effect. When the body reports FixedMovie,
     * its fresh event readback is polled until it shows the mode, before a release, Record or
     * restoration proceeds; only a body without it waits the fixed settle time for movie mode.
     */
    private async settleMovieMode(expected: 0 | 1, requiresReadback: boolean): Promise<void> {
        if (!requiresReadback) {
            if (expected === 1) await wait(MODE_SETTLE_MILLISECONDS)
            return
        }
        // As patient as the fixed settle and the readback it was followed by together.
        const deadline = Date.now() + MODE_SETTLE_MILLISECONDS + 2000
        do {
            await this.withoutPolling(() => this.refreshEventProperties())
            if (this.fixedMovie() === expected) return
            await wait(100)
        } while (Date.now() < deadline)
        throw new Error(`Canon did not confirm ${expected === 1 ? 'Movie' : 'Photo'} mode after selection`)
    }

    override readonly captureOptions = { memory: false, withoutAutofocus: true, rawCompression: false }

    /**
     * Holds still mode across one capture and its transfer, then puts the operator's movie mode and
     * manual exposure back. A body whose physical selector holds movie mode cannot take a photo: that
     * is reported as unsupported before any shutter command is sent. @internal
     */
    override async withStillMode<Result>(capture: () => Promise<Result>): Promise<Result> {
        if (this.fixedMovie() !== 1) return capture()
        const before = this.exposureSnapshot()
        let failure: unknown
        try {
            await this.leaveMovieMode()
            await this.settleMovieMode(0, true).catch(() => {
                throw new CameraUnsupportedError(
                    'takePhoto',
                    'Set the Canon body’s physical still/movie selector to Photo; it retained movie mode after the remote Photo command'
                )
            })
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
        if (operation === 'setClock' && this.propertyCache.get(this.registry.properties.CanonUtcTime)?.current !== undefined)
            return supported
        if (operation === 'setFocusPoint' || operation === 'resetFocusPoint')
            return operationsAdvertised(capabilities, [operations.CanonGetViewfinderData, operations.CanonViewfinderPosition])
        if (operation === 'autofocus') {
            const advertised = capabilities.advertisedOperations
            const focusOperations = [operations.CanonDoAutofocus.code, operations.CanonRemoteReleaseOn.code]
            return !advertised || focusOperations.some(code => advertised.includes(code))
                ? supported
                : unsupported('The camera advertises neither DoAf nor a remote half-press')
        }
        if (operation === 'getLiveViewFrame')
            return { supported: true, options: { overlay: { supported: false, reason: overlayUnsupported } } }
        return super.availability(operation, capabilities)
    }
}
