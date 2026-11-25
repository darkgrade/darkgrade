import { CameraConfirmationError } from '@camera/confirmation'
import type {
    CameraCapabilities,
    CameraControlId,
    CameraControlInputs,
    CameraControlState,
    CameraRecordingState,
    OperationAvailability,
    UnrecognizedValues,
} from '@camera/controls'
import {
    ZOOM_SAFETY_STOP_MILLISECONDS,
    type CameraEventHandler,
    type CameraEventName,
    type Clip,
    type ConfirmedPhotoFile,
    type FocusFrame,
    type FocusPointOptions,
    type FocusResult,
    type LiveViewFrame,
    type MediaItem,
    type PhotoDestination,
    type ZoomDirection,
    type ZoomOptions,
    type ZoomSpeed,
    type CameraOperationName,
} from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { ExposureContext } from '@camera/exposure-time'
import { Logger } from '@core/logger'
import {
    PTPDecodeError,
    PTPDisconnectedError,
    PTPProtocolError,
    PTPRecoveryRequiredError,
    PTPResponseError,
    PTPTimeoutError,
} from '@core/ptp-errors'
import { recognizedDescriptorValues } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { randomSessionId } from '@ptp/definitions/session'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { CodecType } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import type { EventDefinition } from '@ptp/types/event'
import type { EventParams } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { controlValueNames } from '@vendors/control-properties'
import type { MediaCapability, VideoCapability } from '@vendors/generic/capability-groups'
import { GenericCamera } from '@vendors/generic/generic-camera'
import {
    cardSteps,
    classified,
    clipFinalizationMilliseconds,
    describedFile,
    overlayUnsupported,
    requireImage,
    requirePoint,
    restoreAll,
    supported,
    unsupported,
} from '@vendors/generic/generic-operations'
import { recordingCapability, type VendorRecording } from '@vendors/generic/recording-lifecycle'
import { afterPossibleRelease, afterShutterRelease, shutterOutcomeUnknown, shutterRefused } from '@vendors/generic/shutter-outcome'
import { createSonyRegistry, type SonyRegistry } from '@vendors/registry'
import { parseSonyContentInfoList, type SonyContentInfoList } from '@vendors/sony/content-info-list'
import type { SonyExtendedDeviceInfo } from '@vendors/sony/datasets/sdi-ext-device-info-dataset'
import type { SonyDevicePropDesc } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import { parseLiveViewDataset } from '@vendors/sony/datasets/sony-live-view-dataset'
import { parseOsdImageDataset, type OsdImageMetaInfo } from '@vendors/sony/datasets/sony-osd-image-dataset'
import { SonyExposureProgramCodec } from '@vendors/sony/exposure-program'
import { parseSonyFocalFrameInfo, type SonyFocalFrame } from '@vendors/sony/focal-frame-info'
import { sonyFocalLengthMillimetres } from '@vendors/sony/lens'
import { findSonyCardItem, sonyMediaCapability } from '@vendors/sony/media'
import { openSonyRecordingMode, sonyPhotoModeDriver, withSonyPhotoMode } from '@vendors/sony/photo-mode'
import { readSonyPtpRecordingState } from '@vendors/sony/ptp-video-recording'

/** Card-index event type for a new file (bench, α7 V, 2026-11-24); other types are not mapped. */
const SONY_CONTENT_ADDED_EVENT_TYPE = 1
/** How long Sony's card index may take to list a photo its camera already announced. */
const SONY_CARD_INDEX_TIMEOUT_MS = 10_000
const SONY_FOCUS_DURATION_MILLISECONDS = 800
const SONY_DEFAULT_SPOT = 'Flexible Spot M'
/** Lock-on AF areas on current bodies (0x02xx), Tracking Flexible Spot on older ones (0x03xx); Slate's canonical names say Tracking too. */
const SONY_TRACKING_PREFIXES = ['Lock on AF ', 'Tracking '] as const
/** After this long without an overlay request, the next frame switches the camera's overlay output off. */
const OVERLAY_IDLE_MILLISECONDS = 2_000
const ZOOM_SPEEDS: readonly ZoomSpeed[] = ['slow', 'medium', 'fast']
/** A landing within this distance of the requested focal length counts as arrived. */
const ZOOM_ARRIVAL_TOLERANCE_MILLIMETRES = 0.5
/** Between focal-length reads while the lens moves. */
const ZOOM_POLL_MILLISECONDS = 60
/** No focal-length change for this long means the lens reached the end of its range. */
const ZOOM_STALL_MILLISECONDS = 800
/** After stopping, the reading must hold still for two reads, within this long. */
const ZOOM_SETTLE_MILLISECONDS = 1500
/** Beyond this distance the first pass runs at medium speed; closer, slow. */
const ZOOM_MEDIUM_SPEED_DISTANCE_MILLIMETRES = 10
const zoomUnavailableReason = 'The camera reports remote zoom unavailable with this lens and mode'
const focusAreaLockedReason = 'The camera reports its focus area unavailable in its current mode, so no focus point can be placed'
const noFocalLengthReason = 'The lens does not report its focal length, so zoomTo cannot confirm where it lands'
const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002
/** Zoom Position (0xD214): an incremental property, so its state reports it writable. */
const SONY_ZOOM_CONTROL_CODE = 0xd214
/** Properties whose state carries the descriptor's numeric range (Zoom Speed Range bounds the zoom speed). */
const rangedPropertyNames: ReadonlySet<string> = new Set(['ColorTemperature', 'ZoomSpeed'])
const SONY_DATE_TIME_RESULT_TIMEOUT_MS = 5_000
const SONY_CONTENT_LIST_LIMIT = 1000
const SONY_CONTENT_LIST_MAX_BYTES = 64 * 1024 * 1024
const SONY_CONTENT_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const SONY_DATE_TIME_RESULTS: Record<number, string> = {
    0: 'invalid',
    2: 'parameter error',
    3: 'exclusion error (the camera is busy)',
    4: 'system error',
}

/** "20261111T001530.0-0700": local wall time with tenths of a second and the UTC offset. */
export function sonyDateTimeString(moment: Date): string {
    const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
    const offsetMinutes = -moment.getTimezoneOffset()
    const sign = offsetMinutes >= 0 ? '+' : '-'
    const absolute = Math.abs(offsetMinutes)
    return (
        `${moment.getFullYear()}${pad(moment.getMonth() + 1)}${pad(moment.getDate())}` +
        `T${pad(moment.getHours())}${pad(moment.getMinutes())}${pad(moment.getSeconds())}` +
        `.${Math.floor(moment.getMilliseconds() / 100)}` +
        `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`
    )
}
// SDIO_ControlDevice (0x9207) codes captured from the Camera Remote SDK on the ILCE-6700 (bench).
/** Zoom Operation: int8 signed speed, positive tele, negative wide, 0 stops. */
const SONY_ZOOM_OPERATION_CODE = 0xd2dd
/** AF area position: uint32 (x << 16 | y) on a 640x480 grid. */
const SONY_AF_AREA_POSITION_CODE = 0xd2dc
const SONY_AF_AREA_X_MAX = 639
const SONY_AF_AREA_Y_MAX = 479
/** CameraButtonFunction: uint32 (button << 16 | action), press 2 and release 1; the body rejects RemoteKey codes. */
const SONY_CAMERA_BUTTON_FUNCTION_CODE = 0xd309
const SONY_CAMERA_BUTTON_PRESS = 0x0002
const SONY_CAMERA_BUTTON_RELEASE = 0x0001
/** Upper 16 bits of the CameraButtonFunction payload (Camera Remote SDK CrCameraButtonFunction). */
export const SONY_CAMERA_BUTTONS = {
    up: 0x01,
    down: 0x02,
    left: 0x03,
    right: 0x04,
    enter: 0x05,
    menu: 0x06,
    multiSelectorUp: 0x07,
    multiSelectorDown: 0x08,
    multiSelectorLeft: 0x09,
    multiSelectorRight: 0x0a,
    multiSelectorEnter: 0x0b,
    fn: 0x10,
    playback: 0x11,
    delete: 0x12,
    mode: 0x13,
    c1: 0x14,
    c2: 0x15,
    c3: 0x16,
    c4: 0x17,
    c5: 0x18,
    c6: 0x19,
    movie: 0x1a,
    ael: 0x1b,
    afOn: 0x1c,
    home: 0x1d,
    display: 0x20,
    c7: 0x21,
    back: 0x22,
    thumbnail: 0x23,
} as const
export type SonyCameraButton = keyof typeof SONY_CAMERA_BUTTONS
/** The first OSD frame after enabling OsdImageMode (0xd207) arrives within ~0.4 s. */
const SONY_OSD_ENABLE_SETTLE_MS = 500
/** Access Denied: for live view, "no new frame yet, ask again". */
const SONY_ACCESS_DENIED = 0x200f
/** Live view runs at up to 30 fps: wait up to a few frame times for the next before giving up. */
const SONY_LIVE_VIEW_NEXT_FRAME_TIMEOUT_MS = 150
/** Ask for the next frame this long before it's due, so a frame never waits for us. */
const SONY_LIVE_VIEW_EARLY_MS = 1.5
/** Between "not ready" answers; keeps a camera that refuses instantly from being asked in a tight loop. */
const SONY_LIVE_VIEW_RETRY_MS = 2
const SONY_LIVE_VIEW_MAX_RETRY_MS = 8
/** Frame intervals averaged to predict the next frame (about a third of a second at 30 fps). */
const SONY_LIVE_VIEW_INTERVAL_SAMPLES = 9
/** Intervals outside this range (pauses, focus moves) say nothing about the camera's frame rate. */
const SONY_LIVE_VIEW_INTERVAL_MIN_MS = 15
const SONY_LIVE_VIEW_INTERVAL_MAX_MS = 70
const SONY_CONTROL_SETTLE_TIMEOUT_MS = 3_000
const SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS = 20
/** The α6700 can acknowledge but ignore a movie-button transition sooner than this after the last. */
const SONY_MOVIE_BUTTON_INTERVAL_MS = 1_500
const SONY_MOMENTARY_CONTROLS =
    /ShutterReleaseButton|ShutterHalfReleaseButton|S1S2Button|SetLiveViewEnable|SetPostViewEnable|MovieRecButton/i
/** Initiator versions announced in SDIO_GetExtDeviceInfo, newest first; 2.00 is the ILCE-7M2 generation. */
const SONY_INITIATOR_VERSIONS = ['3.00', '2.00'] as const
type SonyInitiatorVersion = (typeof SONY_INITIATOR_VERSIONS)[number]

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
    range?: { minimum: number; maximum: number; step: number }
    unrecognized?: UnrecognizedValues
}

type RawValue = number | bigint | string

interface SonyImage {
    info?: ObjectInfo
    data?: Uint8Array
}

interface SonyLiveViewImage extends SonyImage {
    /** The frames the camera draws over this picture: its focus area, faces and tracked subjects. */
    sonyFocalFrames?: SonyFocalFrame[]
}

export interface SonyOsdImage {
    /** RGBA PNG of the camera's on-screen display (640x480 on the ILCE-6700). */
    image: Uint8Array
    metaInfo: OsdImageMetaInfo | null
}

export class SonyCamera extends GenericCamera {
    private liveViewPostViewEnabled = false
    private contentTransferModeEnabled = false
    /** Set by Slate's own media downloads, which leave the body in Playback; the next live-view frame returns it. */
    private mediaReadSinceShooting = false
    /** Set after a shot or a stopped recording, which can leave review up; the next live-view frame re-arms shooting. */
    private shootingResumeNeeded = false
    /**
     * Set when a caller reads object handles to compare against later (a recording or capture
     * baseline). Sony numbers handles per session, so this session is never reopened until the
     * next connect: a reopen would renumber them and the comparison could report an old file as new.
     */
    private objectHandleBaselineHeld = false
    /** When the full property inventory was last read (performance.now()), for reusing a fresh snapshot. */
    private propertyStatesReadAtMs?: number
    private sessionDevice?: DeviceDescriptor
    private sessionOptions: { mode?: 'remote' | 'menus'; configure?: boolean } = {}
    private osdImageModeEnabled = false
    private propertyCache = new Map<number, SonyDevicePropDesc>()
    private manualIsoChoices?: SonyPropertyState['allowedValues']
    private movieButtonAttemptedAt?: number
    private negotiatedProtocolVersion?: number
    vendorId = VendorIDs.SONY
    declare public registry: SonyRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createSonyRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)
    }

    /**
     * The SDIO protocol version the camera returned from SDIO_GetExtDeviceInfo in hundredths
     * (300 is 3.00), or undefined before authentication, after disconnect or when unreadable.
     */
    get sdioProtocolVersion(): number | undefined {
        return this.negotiatedProtocolVersion
    }

    async connect(
        device?: DeviceDescriptor,
        options: { mode?: 'remote' | 'menus'; configure?: boolean } = {}
    ): Promise<void> {
        this.manualIsoChoices = undefined
        this.negotiatedProtocolVersion = undefined
        this.sessionDevice = device
        this.sessionOptions = options
        this.mediaReadSinceShooting = false
        this.shootingResumeNeeded = false
        this.objectHandleBaselineHeld = false
        this.propertyStatesReadAtMs = undefined
        const functionMode = options.mode === 'menus' ? 'CONTENT_TRANSFER' : 'REMOTE_AND_CONTENT_TRANSFER'
        await this.connectTransport({ ...device, ...(this.vendorId && { vendorId: this.vendorId }) })

        const sessionId = (this.sessionId = randomSessionId())
        const open = () =>
            this.send(this.registry.operations.SDIO_OpenSession, { SessionId: sessionId, FunctionMode: functionMode })
        let openResult = await open()
        if (openResult.code === SessionAlreadyOpen.code) {
            this.assertOk((await this.send(this.registry.operations.CloseSession, {})).code, 'Sony CloseSession')
            openResult = await open()
        }
        this.assertOk(openResult.code, 'Sony OpenSession')
        await this.authenticate()
        // Before the first property read, so that inventory is attributed and not re-sent each connection.
        await this.readIdentityForDiagnostics()
        await this.refreshPropertyStates()

        if (options.mode === 'menus' || options.configure === false) return

        await this.configureSessionSetting(this.registry.properties.PositionKeySetting, 'HOST_PRIORITY')
        await this.configureSessionSetting(this.registry.properties.StillImageSaveDestination, 'CAMERA_DEVICE')
        await this.refreshPropertyStates()
    }

    /** A body that refuses a host-preference write is still usable; transport failures still end connect. */
    private async configureSessionSetting<P extends PropertyDefinition>(
        property: P,
        value: CodecType<P['codec']>
    ): Promise<void> {
        try {
            await this.set(property, value)
        } catch (error) {
            if (isTransportFailure(error)) throw error
            this.logWarning(`Sony ${property.name} not set during connect: ${errorText(error)}`)
        }
    }

    async disconnect(): Promise<void> {
        this.manualIsoChoices = undefined
        this.negotiatedProtocolVersion = undefined
        if (!this.transport.isConnected()) return super.disconnect()
        let cleanupError: unknown
        const steps = [
            () => this.disableContentTransferMode(),
            () => this.stopLiveView(),
            async () => this.osdImageModeEnabled && (await this.setOsdImageMode(false)),
        ]
        for (const step of steps) {
            try {
                await step()
            } catch (error) {
                cleanupError ??= error
            }
        }
        await super.disconnect()
        if (cleanupError) throw cleanupError
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) throw new Error(`Property ${property.name} is not readable`)
        // Alpha protocol 3 bodies expose fresh values through 0x9209. Sending the
        // unadvertised 0x9251 variant stalled FX2 media setup and profile capture.
        return (await this.readDescriptor(property.code)).currentValueDecoded as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        // ContentTransferEnable is written while leaving transfer mode itself.
        if (property.code !== this.registry.properties.ContentTransferEnable.code) await this.disableContentTransferMode()
        if (!property.access.includes('Set')) throw new Error(`Property ${property.name} is not writable`)

        if (SONY_MOMENTARY_CONTROLS.test(property.name)) {
            const encodedValue = this.resolveCodec(property.codec).encode(value)
            return this.controlDevice(property.code, encodedValue, `Sony control ${property.name}`)
        }
        const descriptor = this.propertyCache.get(property.code) ?? (await this.readDescriptor(property.code))
        this.assertPropertyEnabled(property, descriptor)
        const exposureProgram = property.code === 0x500e
        const codec = exposureProgram
            ? new SonyExposureProgramCodec(this.registry, descriptor.dataType)
            : this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)
        const targetRaw = this.decodeRawPropertyValue(descriptor, encodedValue)
        this.assertAdvertisedValue(property, descriptor, targetRaw)
        if (descriptor.sonyGetSetFlag === 0) return this.setIncrementalProperty(property, targetRaw)

        const response = await this.send(
            this.registry.operations.SDIO_SetExtDevicePropValue,
            { DevicePropCode: property.code, flagOfDevicePropertyOption: 'ENABLE' },
            encodedValue
        )
        this.assertOk(response.code, `Sony property ${property.name}`)
        await this.waitForPropertyValue(property.code, targetRaw, exposureProgram ? String(value) : undefined)
    }

    /** One SDIO_ControlDevice command: a momentary button, an incremental step or a vendor control code. */
    private async controlDevice(code: number, payload: Uint8Array, action: string): Promise<void> {
        const response = await this.send(
            this.registry.operations.SDIO_ControlDevice,
            { sdiControlCode: code, flagOfDevicePropertyOption: 'ENABLE' },
            payload
        )
        this.assertOk(response.code, action)
    }

    async refreshPropertyStates(options: { preserveTransferMode?: boolean } = {}): Promise<SonyPropertyState[]> {
        if (!options.preserveTransferMode) await this.disableContentTransferMode()
        const response = await this.send(
            this.registry.operations.SDIO_GetAllExtDevicePropInfo,
            { flagOfGetOnlyDifferenceData: 0, flagOfDevicePropertyOption: 'ENABLE' },
            undefined,
            4 * 1024 * 1024
        )
        this.assertOk(response.code, 'Sony property inventory')
        if (!response.data) throw new Error('Sony property inventory returned no data')
        this.propertyCache.clear()
        for (const descriptor of response.data.properties) {
            this.propertyCache.set(descriptor.devicePropertyCode, descriptor)
        }
        this.propertyStatesReadAtMs = performance.now()
        // The inventory is authoritative. Probing absent legacy properties can
        // stall newer bodies (FX2 hangs on unadvertised CompressionSetting).
        const states = this.listPropertyStates()
        const iso = states.find(state => state.name === 'Iso')
        const gain = states.find(state => state.name === 'GainControlSetting')
        if (iso?.writable && iso.enabled && gain?.value !== 'Auto')
            this.manualIsoChoices = iso.allowedValues ? [...iso.allowedValues] : undefined
        return states
    }

    /**
     * The property snapshot read within the last `maximumAgeMs`, or a fresh one. For read-only
     * reports (card space) that follow a full refresh in the same operation; never for admitting a write.
     */
    async recentPropertyStates(maximumAgeMs: number): Promise<SonyPropertyState[]> {
        const readAtMs = this.propertyStatesReadAtMs
        if (readAtMs !== undefined && performance.now() - readAtMs <= maximumAgeMs && !this.contentTransferModeEnabled)
            return this.listPropertyStates()
        return this.refreshPropertyStates()
    }

    /** Application ISO includes the advertised gain-mode switch. Raw descriptors stay unchanged.
     * Retained manual choices belong to this session only; setIso revalidates after switching mode.
     */
    isoControlState(states: SonyPropertyState[]): SonyPropertyState | undefined {
        const iso = states.find(state => state.name === 'Iso')
        if (!iso) return undefined
        const gain = states.find(state => state.name === 'GainControlSetting')
        const automatic = gain?.enabled && gain.value === 'Auto'
        const choices = iso.allowedValues?.length ? iso.allowedValues : automatic ? this.manualIsoChoices : undefined
        const switchable =
            gain?.enabled &&
            gain.writable &&
            gain.allowedValues?.includes('Manual') &&
            gain.allowedValues.includes('Auto')
        if (!switchable || !choices?.length || (!automatic && (!iso.enabled || !iso.writable)))
            return automatic ? { ...iso, value: 'ISO AUTO' } : iso
        return {
            ...iso,
            value: automatic ? 'ISO AUTO' : iso.value,
            enabled: true,
            writable: true,
            allowedValues: choices.includes('ISO AUTO') ? [...choices] : ['ISO AUTO', ...choices],
        }
    }

    listPropertyStates(): SonyPropertyState[] {
        return [...this.propertyCache.values()]
            .map(descriptor => ({ descriptor, ...recognizedDescriptorValues(descriptor) }))
            .map(({ descriptor, allowedValues, allowedRawValues, unrecognized }) => ({
                code: descriptor.devicePropertyCode,
                codeHex: `0x${descriptor.devicePropertyCode.toString(16).padStart(4, '0')}`,
                name: descriptor.devicePropertyName,
                description: descriptor.devicePropertyDescription,
                value: descriptor.currentValueDecoded,
                rawValue: descriptor.currentValueRaw,
                ...(allowedValues?.length ? { allowedValues } : {}),
                ...(allowedRawValues?.length ? { allowedRawValues } : {}),
                ...(unrecognized && { unrecognized }),
                writable:
                    descriptor.vendorExtensions.enabled &&
                    (descriptor.getSet === 'GET_SET' || this.isIncrementalProperty(descriptor.devicePropertyCode)),
                enabled: descriptor.vendorExtensions.enabled,
                sonyEnabledFlag: descriptor.sonyEnabledFlag,
                sonyGetSetFlag: descriptor.sonyGetSetFlag,
                ...(rangedPropertyNames.has(descriptor.devicePropertyName) &&
                    typeof descriptor.minimumValue === 'number' &&
                    typeof descriptor.maximumValue === 'number' &&
                    typeof descriptor.stepSize === 'number' && {
                        range: { minimum: descriptor.minimumValue, maximum: descriptor.maximumValue, step: descriptor.stepSize },
                    }),
            }))
            .sort((left, right) => left.code - right.code)
    }

    async getIso(): Promise<string> {
        await this.refreshPropertyStates()
        const mode = this.propertyCache.get(this.registry.properties.GainControlSetting.code)
        if (mode?.vendorExtensions.enabled && mode.currentValueRaw === 1) return 'ISO AUTO'
        return this.get(this.registry.properties.Iso)
    }

    async setIso(value: string): Promise<void> {
        await this.refreshPropertyStates()
        const modeProperty = this.registry.properties.GainControlSetting
        const mode = this.propertyCache.get(modeProperty.code)
        if (!mode?.vendorExtensions.enabled) return this.set(this.registry.properties.Iso, value)

        const automatic = /^(?:iso\s*)?auto$/i.test(value.trim())
        const targetMode = automatic ? 1 : 2
        const originalMode = mode.currentValueRaw
        if (![1, 2].includes(Number(originalMode))) throw new Error('Sony reported an unknown ISO control mode')
        if (!automatic && !/^(?:iso\s*)?\d+(?:\s+\((?:extended|extension 0x[0-9a-f])\))?$/i.test(value.trim()))
            throw new Error('Choose Auto or a camera-advertised ISO sensitivity')
        if (originalMode !== targetMode) await this.set(modeProperty, automatic ? 'Auto' : 'Manual')
        if (automatic) return
        try {
            await this.set(this.registry.properties.Iso, value)
        } catch (error) {
            if (originalMode !== targetMode) {
                try {
                    await this.set(modeProperty, originalMode === 1 ? 'Auto' : 'Manual')
                } catch (restorationError) {
                    throw new AggregateError([error, restorationError], 'Sony ISO write and mode restoration failed')
                }
            }
            throw error
        }
    }

    /**
     * Half-presses for at most `durationMilliseconds` and reports what the body said: acquired,
     * not-acquired (it reported it could not focus), or unknown (no focus status, as in movie mode).
     */
    async performAutofocus(durationMilliseconds = 800): Promise<FocusResult> {
        if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 100 || durationMilliseconds > 5_000)
            throw new Error('Sony autofocus duration must be between 100 and 5000 milliseconds')
        await this.startLiveView()
        try {
            await this.set(this.registry.properties.ShutterHalfReleaseButton, 'DOWN')
        } catch (error) {
            if (error instanceof PTPResponseError)
                throw new CameraRefusedError('autofocus', `Sony refused the half-press: ${errorText(error)}`)
            throw error
        }
        let result: FocusResult
        try {
            // A half-press is still useful when a scene cannot lock focus. Report what the camera
            // said rather than failing; full capture keeps requiring positive focus confirmation.
            result = await this.waitForFocus(durationMilliseconds, false)
        } finally {
            await this.set(this.registry.properties.ShutterHalfReleaseButton, 'UP')
        }
        const controlsReady = await this.waitForPropertyEnabled(this.registry.properties.FocusMode.code)
        if (!controlsReady) {
            throw new CameraOutcomeUnknownError(
                'autofocus',
                `Sony released autofocus but remote controls did not become writable within ${SONY_CONTROL_SETTLE_TIMEOUT_MS} ms`
            )
        }
        return result
    }

    /**
     * Moves the autofocus area to a point on the frame. Coordinates use the Sony
     * 640x480 AF grid: x in [0, 639] (left→right) and y in [0, 479] (top→bottom).
     * The body must be in a Flexible Spot focus area for the point to be honoured;
     * `setFocusPoint` sets that up.
     */
    async setAfAreaPosition(x: number, y: number): Promise<void> {
        if (!Number.isInteger(x) || x < 0 || x > SONY_AF_AREA_X_MAX)
            throw new Error(`Sony AF-area X must be an integer between 0 and ${SONY_AF_AREA_X_MAX}`)
        if (!Number.isInteger(y) || y < 0 || y > SONY_AF_AREA_Y_MAX)
            throw new Error(`Sony AF-area Y must be an integer between 0 and ${SONY_AF_AREA_Y_MAX}`)
        const packed = ((x << 16) | y) >>> 0
        const response = await this.send(
            this.registry.operations.SDIO_ControlDevice,
            { sdiControlCode: SONY_AF_AREA_POSITION_CODE, flagOfDevicePropertyOption: 'ENABLE' },
            this.registry.codecs.uint32.encode(packed)
        )
        if (response.code !== OK.code)
            throw new CameraRefusedError(
                'setFocusPoint',
                `Sony refused the AF-area position (0x${response.code.toString(16)})`
            )
    }

    /**
     * Presses one of the camera body's own buttons, exactly as a finger would: the
     * camera reacts to MENU, the control wheel (up/down/left/right/enter), Fn,
     * playback and so on. `click` sends press, waits `holdMilliseconds`, then release.
     */
    async pressButton(
        button: SonyCameraButton,
        options: { action?: 'click' | 'press' | 'release'; holdMilliseconds?: number } = {}
    ): Promise<void> {
        const buttonCode = SONY_CAMERA_BUTTONS[button]
        if (buttonCode === undefined) throw new Error(`Unknown Sony camera button: ${String(button)}`)
        const action = options.action ?? 'click'
        const send = (state: number) =>
            this.controlDevice(
                SONY_CAMERA_BUTTON_FUNCTION_CODE,
                this.registry.codecs.uint32.encode(((buttonCode << 16) | state) >>> 0),
                'Sony camera button'
            )
        if (action === 'click' || action === 'press') await send(SONY_CAMERA_BUTTON_PRESS)
        if (action === 'click') await this.waitMs(options.holdMilliseconds ?? 150)
        if (action === 'click' || action === 'release') await send(SONY_CAMERA_BUTTON_RELEASE)
    }

    async setOsdImageMode(enabled: boolean): Promise<void> {
        await this.set(this.registry.properties.OsdImageMode, enabled ? 'ON' : 'OFF')
        this.osdImageModeEnabled = enabled
    }

    /**
     * Reads the camera's current on-screen display (menus, dialogs, shooting info) as an
     * RGBA PNG, so a host can show what the body's monitor shows without HDMI. Enables
     * OsdImageMode on first use; it is switched off again on disconnect.
     */
    async captureOsdImage(): Promise<SonyOsdImage> {
        if (!this.osdImageModeEnabled) {
            await this.setOsdImageMode(true)
            await new Promise(resolve => setTimeout(resolve, SONY_OSD_ENABLE_SETTLE_MS))
        }
        const response = await this.send(this.registry.operations.SDIO_GetOsdImage, {})
        this.assertOk(response.code, 'Sony OSD image')
        if (!response.data?.length) throw new Error('Sony OSD image returned no data')
        const dataset = parseOsdImageDataset(response.data, this.registry)
        if (!dataset.image.length) throw new Error('Sony OSD image dataset did not contain an image')
        return { image: dataset.image, metaInfo: dataset.metaInfo }
    }

    /**
     * The card's contents as the camera indexes them (Remote Control with Transfer Mode). This
     * does not enter content-transfer mode, so live view keeps running.
     */
    async listContents(
        options: { slot?: 1 | 2; limit?: number; sinceUtcMs?: number } = {}
    ): Promise<SonyContentInfoList> {
        const since = BigInt(Math.max(0, Math.floor(options.sinceUtcMs ?? 0)))
        const response = await this.send(
            this.registry.operations.SDIO_GetContentInfoList,
            {
                CreateTimeLower: Number(since & 0xffffffffn),
                CreateTimeUpper: Number(since >> 32n),
                ContentLimit: options.limit ?? SONY_CONTENT_LIST_LIMIT,
                Extra1: options.slot ?? 1,
                Extra2: 0,
            },
            undefined,
            SONY_CONTENT_LIST_MAX_BYTES
        )
        this.assertOk(response.code, 'Sony content list')
        if (!(response.data instanceof Uint8Array) || response.data.length === 0) {
            return { version: 0, listCreatedUtcMs: 0, slot: options.slot ?? 1, contents: [] }
        }
        return parseSonyContentInfoList(response.data)
    }

    /** A content's JPEG thumbnail (small) or screennail (larger), for photos and videos alike. */
    async getContentPreview(
        contentId: number,
        fileId: number,
        options: { slot?: 1 | 2; size?: 'thumbnail' | 'screennail' } = {}
    ): Promise<Uint8Array> {
        const slot = options.slot ?? 1
        const response = await this.send(
            this.registry.operations.SDIO_GetContentCompressedData,
            {
                ContentID: contentId,
                SlotAndFileID: ((slot & 0xff) << 24) | (fileId & 0xffff),
                Type: options.size === 'screennail' ? 2 : 1,
            },
            undefined,
            SONY_CONTENT_PREVIEW_MAX_BYTES
        )
        this.assertOk(response.code, 'Sony content preview')
        if (!(response.data instanceof Uint8Array) || response.data.length === 0)
            throw new Error('The camera returned no preview')
        return response.data
    }

    /**
     * Sets the camera clock to the given moment in the host's local time and offset, and waits for
     * the camera to confirm. Date/Time Setting (0xD223) is write-only, so this writes it directly
     * rather than through set(), which reads values back.
     */
    async setDateTime(moment: Date = new Date()): Promise<string> {
        // Card-index creation times follow the camera clock: the next lookup reads every content.
        this.#newestContent = undefined
        await this.disableContentTransferMode()
        const value = sonyDateTimeString(moment)
        const result = await this.awaitEvent(
            this.registry.events.SDIE_DateTimeSettingResult,
            params => Number(params['Setting Result']),
            async () => {
                const response = await this.send(
                    this.registry.operations.SDIO_SetExtDevicePropValue,
                    { DevicePropCode: this.registry.properties.DateTimeSetting.code, flagOfDevicePropertyOption: 'ENABLE' },
                    this.registry.codecs.string.encode(value)
                )
                if (response.code !== OK.code)
                    throw new CameraRefusedError(
                        'setClock',
                        `The camera refused the date and time (0x${response.code.toString(16)})`
                    )
            },
            SONY_DATE_TIME_RESULT_TIMEOUT_MS
        )
        if (result === undefined)
            throw new CameraOutcomeUnknownError('setClock', 'The camera did not confirm the new date and time')
        if (result !== 1)
            throw new CameraRefusedError(
                'setClock',
                `The camera refused the date and time: ${SONY_DATE_TIME_RESULTS[result] ?? `result ${result}`}`
            )
        return value
    }

    async captureImage(
        options: {
            includeInfo?: boolean
            includeData?: boolean
            autofocus?: boolean
            destination?: 'card' | 'memory'
        } = {}
    ): Promise<SonyImage> {
        if (options.destination === 'memory' && options.includeData === false)
            throw new Error('Sony memory capture requires transfer of the captured image')
        const destination = this.registry.properties.StillImageSaveDestination
        const focus = this.registry.properties.FocusMode
        const needsHostImage = options.includeInfo !== false || options.includeData !== false
        const requestedDestination =
            options.destination === 'memory' ? 'HOST_DEVICE' : needsHostImage ? 'BOTH_DEVICES' : undefined
        const originalDestination = requestedDestination ? await this.get(destination) : undefined
        const originalFocus = options.autofocus === false ? await this.get(focus) : undefined
        let failure: unknown
        const shutter = { sent: false }
        try {
            if (requestedDestination && originalDestination !== requestedDestination)
                await this.set(destination, requestedDestination)
            if (originalFocus !== undefined && originalFocus !== 'Manual') await this.set(focus, 'Manual')
            return await this.captureWithCurrentDestination(options, shutter)
        } catch (error) {
            failure = error
            throw error
        } finally {
            this.shootingResumeNeeded = true
            const restorationErrors: unknown[] = []
            const restore = (step: () => Promise<void>) => step().catch(error => void restorationErrors.push(error))
            if (originalFocus !== undefined && originalFocus !== 'Manual')
                await restore(async () => {
                    if (!(await this.waitForPropertyEnabled(focus.code)))
                        throw new Error('Sony focus control remained busy after releasing the shutter')
                    await this.set(focus, originalFocus)
                })
            if (originalDestination !== undefined && originalDestination !== requestedDestination)
                await restore(async () => {
                    // The body disables the destination control while it writes the image to the card.
                    // Wait for it, then restore either way and let the camera's answer decide.
                    await this.waitForPropertyEnabled(destination.code)
                    await this.set(destination, originalDestination)
                })
            if (restorationErrors.length) {
                const errors = [...(failure ? [failure] : []), ...restorationErrors]
                const restoration = new AggregateError(
                    errors,
                    `Sony capture/settings restoration failed: ${errors.map(String).join('; ')}`
                )
                // After S2 a photo may exist, so a failed restoration never reads as a refusal.
                throw afterPossibleRelease(restoration, shutter.sent)
            }
        }
    }

    private async captureWithCurrentDestination(
        { includeInfo = true, includeData = true, autofocus = true } = {},
        shutter = { sent: false }
    ): Promise<SonyImage> {
        await this.disableContentTransferMode()
        // Card-only callers do not consume the host post-view object. Enabling it
        // leaves an unread image pending and can keep the camera's controls busy.
        if (includeInfo || includeData) await this.startLiveView()
        else {
            await this.stopLiveView()
            await this.set(this.registry.properties.SetPostViewEnable, 'DISABLE')
        }

        const release = async () => {
            // Sony requires S1 to remain held through S2, including manual focus.
            // libgphoto2 camera_sony_capture uses the same two-stage release.
            try {
                await this.set(this.registry.properties.ShutterHalfReleaseButton, 'DOWN')
                if (autofocus) {
                    try {
                        await this.waitForFocus()
                    } catch (error) {
                        // The body could not focus and S2 was never pressed: nothing was taken.
                        throw shutterRefused(error)
                    }
                } else await this.waitMs(500)
                shutter.sent = true
                await this.set(this.registry.properties.ShutterReleaseButton, 'DOWN')
                await this.waitMs(35)
            } finally {
                try {
                    await this.set(this.registry.properties.ShutterReleaseButton, 'UP')
                } finally {
                    await this.set(this.registry.properties.ShutterHalfReleaseButton, 'UP')
                }
            }
        }
        // Once S2 was sent, a photo may exist: any later failure is an unknown outcome, never a retry.
        const confirm = async <Result>(work: () => Promise<Result>): Promise<Result> => {
            try {
                return await work()
            } catch (error) {
                throw shutter.sent ? shutterOutcomeUnknown(error) : error
            }
        }
        // A card workflow verifies the newly indexed object itself. It must not
        // require the separate host-delivery event when no host image was requested.
        if (!includeInfo && !includeData) {
            await confirm(() => this.waitForCapturedImageObjectHandle(release, false))
            return {}
        }
        return confirm(async () =>
            this.transferCapturedImage(await this.waitForCapturedImageObjectHandle(release), includeInfo, includeData)
        )
    }

    private async transferCapturedImage(handle: number, includeInfo: boolean, includeData: boolean): Promise<SonyImage> {
        const infoResponse = await this.send(this.registry.operations.GetObjectInfo, { ObjectHandle: handle })
        this.assertOk(infoResponse.code, 'Sony captured-image information')
        const info = infoResponse.data
        const size = info?.objectCompressedSize ?? 0
        if (!info || !Number.isSafeInteger(size) || size <= 0 || size > this.captureBufferSize)
            throw new Error('Sony captured-image metadata is missing or exceeds the transfer bound')
        if (!includeData) return { info: includeInfo ? info : undefined, data: undefined }
        const objectResponse = await this.send(
            this.registry.operations.GetObject,
            { ObjectHandle: handle },
            undefined,
            info.objectCompressedSize + this.bufferPadding
        )
        this.assertOk(objectResponse.code, 'Sony captured-image transfer')
        const data = objectResponse.data
        if (!data || data.length !== info.objectCompressedSize)
            throw new Error('Sony captured-image transfer length differs from its metadata')
        return { info: includeInfo ? info : undefined, data }
    }

    async captureLiveView({ includeInfo = true, includeData = true } = {}): Promise<SonyLiveViewImage> {
        if (this.mediaReadSinceShooting) await this.returnToShooting()
        else if (this.shootingResumeNeeded) await this.resumeShooting()
        else await this.disableContentTransferMode()
        await this.startLiveView()
        try {
            return await this.readLiveViewFrame(includeInfo, includeData)
        } catch (error) {
            if (!(error instanceof PTPResponseError) || error.code !== SONY_ACCESS_DENIED) throw error
            // Still refused after the frame deadline: the body is showing its card or a shot review.
            // Return it to shooting once (reads only; no capture or record command), then ask again.
            await this.returnToShooting()
            await this.startLiveView()
            return this.readLiveViewFrame(includeInfo, includeData)
        }
    }

    private async readLiveViewFrame(includeInfo: boolean, includeData: boolean): Promise<SonyLiveViewImage> {
        let info: ObjectInfo | undefined
        if (includeInfo) {
            const infoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
            })
            this.assertOk(infoResponse.code, 'Sony live-view object information')
            info = infoResponse.data
        }
        if (!includeData) return { info, data: undefined, sonyFocalFrames: undefined }
        const objectResponse = await this.nextLiveViewObject()
        this.assertOk(objectResponse.code, 'Sony live-view image')
        if (!objectResponse.data?.length) throw new Error('Sony live-view response contained no dataset')
        const { liveViewImage, focalFrameInfo } = parseLiveViewDataset(objectResponse.data, this.registry)
        if (!liveViewImage.length) throw new Error('Sony live-view dataset contained no image')
        this.recordLiveViewFrame(objectResponse.requestStartedMs)
        const sonyFocalFrames = focalFrameInfo ? parseSonyFocalFrameInfo(focalFrameInfo).frames : []
        return { info, data: liveViewImage, sonyFocalFrames }
    }

    private liveViewLastFrameRequestMs = 0
    private liveViewIntervalsMs: number[] = []

    /** The camera's measured frame interval: the median of recent ones, or null until there are enough. */
    private liveViewFrameIntervalMs(): number | null {
        if (this.liveViewIntervalsMs.length < 3) return null
        const sorted = [...this.liveViewIntervalsMs].sort((a, b) => a - b)
        return sorted[Math.floor(sorted.length / 2)]
    }

    /**
     * Milliseconds until the next live-view frame is due (0 when it may already be). Callers that
     * share the camera with other commands can wait this out first, so the wait never blocks them.
     */
    millisecondsUntilNextLiveViewFrame(): number {
        const intervalMs = this.liveViewFrameIntervalMs()
        if (intervalMs === null) return 0
        const dueMs = this.liveViewLastFrameRequestMs + intervalMs - SONY_LIVE_VIEW_EARLY_MS
        return Math.max(0, dueMs - performance.now())
    }

    /**
     * The camera makes a new live-view frame every frame interval (33 ms at 30 fps) and answers
     * Access Denied (0x200F) when asked before it's ready: wait until just before the next frame is
     * due, then ask again with a short bounded backoff, never in a tight loop.
     */
    private async nextLiveViewObject(): Promise<{ code: number; data?: Uint8Array; requestStartedMs: number }> {
        const waitMs = this.millisecondsUntilNextLiveViewFrame()
        if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
        const deadline = Date.now() + SONY_LIVE_VIEW_NEXT_FRAME_TIMEOUT_MS
        let retryMs = SONY_LIVE_VIEW_RETRY_MS
        for (;;) {
            const requestStartedMs = performance.now()
            const response = await this.send(this.registry.operations.GetObject, {
                ObjectHandle: SONY_LIVE_VIEW_OBJECT_HANDLE,
            })
            if (response.code !== SONY_ACCESS_DENIED) return { ...response, requestStartedMs }
            const remainingMs = deadline - Date.now()
            if (remainingMs <= 0) return { ...response, requestStartedMs }
            await new Promise(resolve => setTimeout(resolve, Math.min(retryMs, remainingMs)))
            if (Date.now() >= deadline) return { ...response, requestStartedMs }
            retryMs = Math.min(retryMs * 2, SONY_LIVE_VIEW_MAX_RETRY_MS)
        }
    }

    private recordLiveViewFrame(requestStartedMs: number): void {
        const intervalMs = requestStartedMs - this.liveViewLastFrameRequestMs
        this.liveViewLastFrameRequestMs = requestStartedMs
        if (intervalMs < SONY_LIVE_VIEW_INTERVAL_MIN_MS || intervalMs > SONY_LIVE_VIEW_INTERVAL_MAX_MS) return
        this.liveViewIntervalsMs.push(intervalMs)
        if (this.liveViewIntervalsMs.length > SONY_LIVE_VIEW_INTERVAL_SAMPLES) this.liveViewIntervalsMs.shift()
    }

    async sendStartRecording(): Promise<void> {
        await this.disableContentTransferMode()
        await this.setMovieButton('DOWN')
    }

    async sendStopRecording(): Promise<void> {
        await this.disableContentTransferMode()
        try {
            await this.setMovieButton('UP')
        } finally {
            this.shootingResumeNeeded = true
        }
    }

    private async setMovieButton(value: 'DOWN' | 'UP'): Promise<void> {
        if (this.movieButtonAttemptedAt !== undefined) {
            const remaining = SONY_MOVIE_BUTTON_INTERVAL_MS - (performance.now() - this.movieButtonAttemptedAt)
            if (remaining > 0) await this.waitMs(Math.ceil(remaining))
        }
        // An acknowledgement can be lost after the body receives DOWN. Its
        // cleanup release needs the same interval even when the write throws.
        try {
            await this.set(this.registry.properties.MovieRecButton, value)
        } finally {
            // Include time spent transmitting the command, rather than counting
            // it toward the body's interval before the next press or release.
            this.movieButtonAttemptedAt = performance.now()
        }
    }

    /**
     * Card enumeration requires Sony content-transfer mode, even before any download. Callers read
     * object handles here to compare against later, so this session keeps its handle numbering
     * (it is not reopened) until the next connect.
     */
    async prepareStorageRead(): Promise<void> {
        this.objectHandleBaselineHeld = true
        await this.enableContentTransferMode()
    }

    /**
     * Content-transfer mode for one of Slate's own media downloads, which finds its file by name and
     * holds no handle baseline. The body is left in Playback, so the next live-view frame returns it
     * to shooting.
     */
    async prepareMediaDownload(): Promise<void> {
        this.mediaReadSinceShooting = true
        await this.enableContentTransferMode()
    }

    /** Downloads an object in chunks; onProgress reports bytes received after each chunk. */
    async getObject(
        objectHandle: number,
        objectSize: number,
        onProgress?: (receivedBytes: number, totalBytes: number) => void,
        signal?: AbortSignal
    ): Promise<Uint8Array> {
        if (!Number.isSafeInteger(objectSize) || objectSize < 0)
            throw new Error('Sony object size must be a non-negative safe integer')
        await this.enableContentTransferMode()
        return this.downloadObjectChunks(
            objectHandle,
            objectSize,
            'SDIO_GetPartialLargeObject',
            async (offset, bytesToRead) => {
                const chunkResponse = await this.send(
                    this.registry.operations.SDIO_GetPartialLargeObject,
                    {
                        ObjectHandle: objectHandle,
                        OffsetLower: offset >>> 0,
                        OffsetUpper: Math.floor(offset / 0x100000000),
                        MaxBytes: bytesToRead,
                    },
                    undefined,
                    bytesToRead + 12
                )
                this.assertOk(chunkResponse.code, 'Sony partial object download')
                return chunkResponse.data
            },
            onProgress,
            signal
        )
    }

    protected async waitForCapturedImageObjectHandle(capture: () => Promise<void>, requireObject = true): Promise<number> {
        const { SDIE_ObjectAdded, SDIE_CapturedEvent } = this.registry.events
        const handle = requireObject
            ? await this.awaitEvent(SDIE_ObjectAdded, event => event.ObjectHandle || undefined, capture, 15_000)
            : await this.awaitEvent(SDIE_CapturedEvent, () => 0, capture, 15_000)
        if (handle !== undefined) return handle
        const awaited = requireObject ? 'captured-image handle' : 'capture completion'
        throw new Error(`Timed out after 15 seconds waiting for Sony ${awaited}`)
    }

    /** Runs `action` with a listener armed, then waits up to `timeoutMs` for the first event `read` accepts. */
    private async awaitEvent<E extends EventDefinition, Result>(
        event: E,
        read: (params: EventParams<E>) => Result | undefined,
        action: () => Promise<void>,
        timeoutMs: number
    ): Promise<Result | undefined> {
        let result: Result | undefined
        const handler = (params: EventParams<E>) => {
            result ??= read(params)
        }
        this.on(event, handler)
        try {
            await action()
            const deadline = Date.now() + timeoutMs
            while (result === undefined && Date.now() < deadline) await this.waitMs(50)
            return result
        } finally {
            this.off(event, handler)
        }
    }

    private async waitForFocus(timeoutMilliseconds = 3_000, requireConfirmation = true): Promise<FocusResult> {
        let isFocused = false
        let lastStatus: string | undefined
        const observe = (status: string | undefined) => {
            lastStatus = status ?? lastStatus
            isFocused = status === 'AF_C_FOCUSED' || status === 'AF_S_FOCUSED'
        }
        const handler = (event: { Status?: string }) => observe(event.Status)
        this.on(this.registry.events.SDIE_AFStatus, handler)
        const deadline = Date.now() + timeoutMilliseconds
        try {
            while (!isFocused && Date.now() < deadline) {
                try {
                    observe(String(await this.get(this.registry.properties.FocusIndication)))
                } catch {}
                if (!isFocused) await this.waitMs(50)
            }
            if (isFocused) return 'acquired'
            const notFocused = lastStatus === 'AF_C_NOT_FOCUSED' || lastStatus === 'AF_S_NOT_FOCUSED'
            if (!requireConfirmation) return notFocused ? 'not-acquired' : 'unknown'
            // Say what the body reported: a dark or featureless scene is not a driver fault.
            const reported = notFocused
                ? 'the camera reported it could not focus (low contrast or too dark)'
                : lastStatus === 'AF_C_TRACKING'
                  ? 'the camera was still tracking the subject'
                  : lastStatus
                    ? `the camera last reported ${lastStatus}`
                    : 'the camera reported no focus status'
            throw new Error(`Sony autofocus did not report focus within ${timeoutMilliseconds} ms; ${reported}`)
        } finally {
            this.off(this.registry.events.SDIE_AFStatus, handler)
        }
    }

    private async readDescriptor(propertyCode: number): Promise<SonyDevicePropDesc> {
        await this.refreshPropertyStates({
            preserveTransferMode: propertyCode === this.registry.properties.ContentTransferEnable.code,
        })
        const descriptor = this.propertyCache.get(propertyCode)
        if (descriptor) return descriptor
        throw new Error(`Sony property 0x${propertyCode.toString(16)} is not advertised in the current property inventory`)
    }

    private assertPropertyEnabled(property: PropertyDefinition, descriptor: SonyDevicePropDesc): void {
        if (descriptor.vendorExtensions.enabled) return
        throw new Error(
            `${property.name} is currently disabled by the attached Sony camera (availability flag ${descriptor.sonyEnabledFlag}); another camera setting or operating mode may need to change first`
        )
    }

    private assertAdvertisedValue(property: PropertyDefinition, descriptor: SonyDevicePropDesc, target: RawValue): void {
        const advertised = descriptor.supportedValuesRaw
        if (advertised?.length && !advertised.includes(target))
            throw new Error(`${property.name} value ${String(target)} was not advertised by the attached Sony camera`)
        const { minimumValue: minimum, maximumValue: maximum, stepSize: step } = descriptor
        if (typeof target !== 'number' || typeof minimum !== 'number' || typeof maximum !== 'number') return
        if (target < minimum || target > maximum)
            throw new Error(`${property.name} value ${target} is outside the advertised range ${minimum}–${maximum}`)
        if (typeof step === 'number' && step > 0 && (target - minimum) % step !== 0)
            throw new Error(`${property.name} value ${target} does not align to step ${step}`)
    }

    private decodeRawPropertyValue(descriptor: SonyDevicePropDesc, encodedValue: Uint8Array): RawValue {
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

    private async setIncrementalProperty(property: PropertyDefinition, targetRaw: RawValue): Promise<void> {
        for (let attempt = 0; attempt < 100; attempt++) {
            const descriptor = this.propertyCache.get(property.code) ?? (await this.readDescriptor(property.code))
            if (descriptor.currentValueRaw === targetRaw) return
            this.assertPropertyEnabled(property, descriptor)
            this.assertAdvertisedValue(property, descriptor, targetRaw)

            const current = descriptor.currentValueRaw
            const currentIndex = descriptor.supportedValuesRaw?.indexOf(current) ?? -1
            const targetIndex = descriptor.supportedValuesRaw?.indexOf(targetRaw) ?? -1
            let direction: number
            if (currentIndex >= 0 && targetIndex >= 0) direction = targetIndex > currentIndex ? 1 : -1
            else if (typeof current === 'number' && typeof targetRaw === 'number') direction = targetRaw > current ? 1 : -1
            else throw new Error(`${property.name} cannot be incremented from the camera's current descriptor`)

            const before = descriptor.currentValueRaw
            const step = this.registry.codecs.int8.encode(direction)
            await this.controlDevice(property.code, step, `Sony incremental property ${property.name}`)

            const changed = await this.pollDescriptor(property.code, current =>
                current && current.currentValueRaw !== before ? current : undefined
            )
            if (!changed) {
                throw new Error(
                    `Sony accepted the ${property.name} command but its value did not change from ${String(before)}`
                )
            }
            if (changed.currentValueRaw === targetRaw) return
        }
        throw new Error(`${property.name} did not reach ${String(targetRaw)} within 100 Sony control steps`)
    }

    /** Rereads the inventory until `found` gives a result, or undefined once the settle timeout passes. */
    private async pollDescriptor<Result>(
        propertyCode: number,
        found: (descriptor: SonyDevicePropDesc | undefined) => Result | undefined,
        intervalMs = 100
    ): Promise<Result | undefined> {
        const deadline = Date.now() + SONY_CONTROL_SETTLE_TIMEOUT_MS
        while (Date.now() < deadline) {
            await this.refreshPropertyStates()
            const result = found(this.propertyCache.get(propertyCode))
            if (result !== undefined) return result
            await this.waitMs(intervalMs)
        }
        return undefined
    }

    private async waitForPropertyEnabled(propertyCode: number): Promise<boolean> {
        return (await this.pollDescriptor(propertyCode, descriptor => descriptor?.vendorExtensions.enabled || undefined)) ?? false
    }

    private async waitForPropertyValue(propertyCode: number, target: RawValue, requestedMode?: string): Promise<SonyDevicePropDesc> {
        const reached = await this.pollDescriptor(propertyCode, descriptor =>
            descriptor?.currentValueRaw === target ? descriptor : undefined
        )
        if (reached) return reached
        if (requestedMode !== undefined) {
            const observed = this.propertyCache.get(propertyCode)?.currentValueDecoded
            throw new CameraConfirmationError(
                'exposureProgram',
                requestedMode,
                observed === undefined ? null : String(observed)
            )
        }
        // The write was acknowledged but never observed: report it unconfirmed, never resend it.
        throw new CameraOutcomeUnknownError(
            `0x${propertyCode.toString(16)}`,
            `Sony property 0x${propertyCode.toString(16)} did not report target ${String(target)} within ${SONY_CONTROL_SETTLE_TIMEOUT_MS} ms`
        )
    }

    private assertOk(responseCode: number, action: string): void {
        if (responseCode !== OK.code) {
            throw new PTPResponseError(responseCode, `${action} returned PTP response 0x${responseCode.toString(16)}`)
        }
    }

    /** Sony's Remote Control with Transfer Mode needs Set LiveView Enable and Set PostView Enable. */
    private async startLiveView(): Promise<void> {
        if (this.liveViewPostViewEnabled) return
        await this.set(this.registry.properties.SetLiveViewEnable, 'ENABLE')
        await this.set(this.registry.properties.SetPostViewEnable, 'ENABLE')
        this.liveViewPostViewEnabled = true
        const status = this.registry.properties.LiveViewStatus.code
        if (!this.propertyCache.has(status)) return
        const reported = await this.pollDescriptor(status, found => [1, 2].find(value => value === found?.currentValueRaw), 50)
        if (reported === 2) throw new Error('Sony live view is unavailable in the current camera mode')
        if (reported === undefined) throw new Error('Sony did not report live view ready before the startup deadline')
    }

    private async stopLiveView(): Promise<void> {
        if (!this.liveViewPostViewEnabled) return
        await this.set(this.registry.properties.SetLiveViewEnable, 'DISABLE')
        await this.set(this.registry.properties.SetPostViewEnable, 'DISABLE')
        this.liveViewPostViewEnabled = false
    }

    private async enableContentTransferMode(): Promise<void> {
        if (this.contentTransferModeEnabled) return
        await this.stopLiveView()
        await this.switchContentTransferMode(true)
    }

    /**
     * Puts the body back into remote shooting regardless of what this session believes: leaves
     * content-transfer mode unconditionally, waits for the camera to confirm it, and forces the
     * next live-view frame to re-enable live view and post view. Use after card access, or when
     * live view answers AccessDenied (0x200F) because the body is still showing playback.
     */
    async resumeShooting(): Promise<void> {
        this.shootingResumeNeeded = false
        this.contentTransferModeEnabled = true
        await this.disableContentTransferMode()
        this.liveViewPostViewEnabled = false
    }

    /**
     * Returns the body to remote shooting; the next live-view frame calls this after one of Slate's
     * own media downloads, or when live view is still refused after its frame deadline. Reading the
     * card switches CameraOperatingMode to Playback, which is read-only over PTP and survives leaving
     * content-transfer mode; live view then serves the playback image. When the body still reports
     * Playback, this reopens the session (about 350 ms on an α7 V), which restores Record mode, and
     * returns true. It reopens only when the native recording state reads exactly idle (missing or
     * unknown telemetry never proves idle) and no caller holds an object-handle baseline this session.
     * The photo capability calls it before a release, under the same guards.
     * @internal
     */
    async returnToShooting(): Promise<boolean> {
        this.mediaReadSinceShooting = false
        await this.resumeShooting()
        const states = await this.refreshPropertyStates()
        const operatingMode = states.find(state => state.code === this.registry.properties.CameraOperatingMode.code)
        if (operatingMode?.value !== 'Playback') return false
        if (this.objectHandleBaselineHeld) return false
        if ((await readSonyPtpRecordingState({ getSonyPropertyStates: async () => states })) !== 0) return false
        await this.reopenSession(this.sessionDevice)
        return true
    }

    /** Reopens with the same device and session mode this session was opened with. */
    async reopenSession(device: DeviceDescriptor | undefined = this.sessionDevice): Promise<void> {
        const options = this.sessionOptions
        await this.closeSessionAndTransport()
        await this.connect(device, options)
    }

    private async disableContentTransferMode(): Promise<void> {
        await this.switchContentTransferMode(false)
    }

    private async switchContentTransferMode(enable: boolean): Promise<void> {
        for (let attempt = 1; attempt <= SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS; attempt += 1) {
            if (this.contentTransferModeEnabled === enable) return
            await this.send(this.registry.operations.SDIO_SetContentsTransferMode, {
                ContentsSelectType: 'HOST',
                TransferMode: enable ? 'ENABLE' : 'DISABLE',
                AdditionalInformation: 'NONE',
            })
            await this.waitMs(100)
            this.contentTransferModeEnabled =
                (await this.get(this.registry.properties.ContentTransferEnable)) === 'ENABLE'
        }
        if (this.contentTransferModeEnabled === enable) return
        throw new Error(
            `Sony content-transfer mode did not ${enable ? 'enable' : 'disable'} after ${SONY_TRANSFER_MODE_MAXIMUM_ATTEMPTS} attempts`
        )
    }

    /** Sony's own handshake never reads the standard DeviceInfo dataset, which left every native
     * Sony session without a model, firmware or body fingerprint in diagnostics. Read it once per
     * connection. A refusal is not a connection failure: the session is already usable. */
    private async readIdentityForDiagnostics(): Promise<void> {
        this.#announcesCardIndex = undefined
        try {
            this.noteCardIndexEvent(await this.send(this.registry.operations.GetDeviceInfo, {}))
        } catch (error) {
            this.logWarning(`Sony identity read skipped: ${errorText(error)}`)
        }
    }

    /**
     * Sony's documented sequence is SDIO_Connect phase 1, phase 2, SDIO_GetExtDeviceInfo, phase 3.
     * A body that refuses the 3.00 announcement leaves its handshake state undefined, so the whole
     * sequence is restarted from phase 1 announcing 2.00.
     */
    private async authenticate(): Promise<void> {
        const refusals: string[] = []
        let refusedCode: number = OK.code
        for (const version of SONY_INITIATOR_VERSIONS) {
            const refusal = await this.authenticateAnnouncing(version)
            if (refusal === undefined) return
            refusedCode = refusal
            refusals.push(`${version} (0x${refusal.toString(16)})`)
            this.logWarning(`Sony refused initiator version ${version} with 0x${refusal.toString(16)}`)
        }
        throw new PTPResponseError(
            refusedCode,
            `Sony extended device information refused initiator versions ${refusals.join(' and ')}`
        )
    }

    /** Runs the handshake announcing one version; returns the extended-information refusal code, if any. */
    private async authenticateAnnouncing(version: SonyInitiatorVersion): Promise<number | undefined> {
        await this.connectPhase(1)
        await this.connectPhase(2)
        const refusal = await this.readExtendedDeviceInformation(version)
        if (refusal !== undefined) return refusal
        await this.connectPhase(3)
        return undefined
    }

    private async connectPhase(phase: 1 | 2 | 3): Promise<void> {
        const response = await this.send(this.registry.operations.SDIO_Connect, {
            phaseType: `PHASE_${phase}`,
            keyCode1: 'DEFAULT',
            keyCode2: 'DEFAULT',
        })
        this.assertOk(response.code, `Sony authentication phase ${phase}`)
    }

    private async readExtendedDeviceInformation(version: SonyInitiatorVersion): Promise<number | undefined> {
        try {
            const information = await this.send(
                this.registry.operations.SDIO_GetExtDeviceInfo,
                version === '3.00'
                    ? { initiatorVersion: version, flagOfDevicePropertyOption: 'ENABLE' }
                    : { initiatorVersion: version }
            )
            if (information.code !== OK.code) return information.code
            const protocolVersion = (information.data as SonyExtendedDeviceInfo | undefined)?.protocolVersion
            this.negotiatedProtocolVersion = typeof protocolVersion === 'number' ? protocolVersion : undefined
        } catch (error) {
            // The camera accepted the announcement; only its dataset is unreadable.
            if (!(error instanceof PTPDecodeError)) throw error
            this.logWarning(`Sony extended device information unreadable: ${error.message}`)
        }
        return undefined
    }

    // Driver contract (`@camera/driver`).

    /** What setFocusPoint changed this session, so resetFocusPoint can put it back; a new session starts fresh. */
    #focus: SonyFocusSession = freshFocusSession(null)
    /** True until the camera confirms its overlay output is off. */
    #overlayOutput = false
    /** When the overlay output may next be switched off: an idle interval after the last overlay request or failed attempt. */
    #overlaySwitchOffDueMs = 0
    #zoomSafetyStop?: ReturnType<typeof setTimeout>
    /** True while a zoom this session started may still be moving. */
    #zooming = false
    /** Advanced by every stopZoom call, so a start or zoomTo in progress sends nothing more once the caller stops. */
    #zoomStops = 0
    #video?: VideoCapability
    #sonyMedia?: MediaCapability
    /** The card-index watch armed before Record, which names the clip after Stop. */
    #clipWatch?: SonyCardIndexWatch
    /** Whether this session's DeviceInfo lists the card-index event, so a new file's media id can be read once saved. */
    #announcesCardIndex?: boolean
    /** The newest card-index creation time this session read, so a lookup lists only newer contents. */
    #newestContent?: { sessionId: number | null; createdUtcMs: number }

    protected override async mediaGroup(): Promise<MediaCapability> {
        return (this.#sonyMedia ??= sonyMediaCapability(this))
    }

    override async openSession(
        device: DeviceDescriptor | undefined,
        { observeOnly }: { observeOnly: boolean }
    ): Promise<void> {
        await this.connect(device, { configure: !observeOnly })
    }

    /**
     * Refuses up front what a Sony body would only half-apply: a tracking focus area while focus is
     * AF-S (Lock-on AF needs continuous focus). Everything else is the shared write.
     */
    override async setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState> {
        if (id === 'focusArea' && sonyTrackingPrefix(String(value)) !== undefined) {
            const focusMode = (await this.refreshPropertyStates()).find(state => state.name === 'FocusMode')
            if (focusMode?.value === 'AF-S')
                throw new CameraRefusedError(
                    'focusArea',
                    `${String(value)} tracks a subject, which needs AF-C; the camera is in AF-S`
                )
        }
        return super.setControl(id, value, context)
    }

    override subscribe(event: CameraEventName, handler: CameraEventHandler): () => void {
        const stopEmitted = super.subscribe(event, handler)
        if (event !== 'mediaAdded') return stopEmitted
        const stopIndex = this.onCardIndexAddition(handler)
        return () => {
            stopEmitted()
            stopIndex()
        }
    }

    /**
     * A Sony body saving to its card announces the file in its card index rather than with
     * ObjectAdded. Event type 1 followed each new photo and clip on an α7 V (bench, 2026-11-24).
     */
    private onCardIndexAddition(handler: () => void): () => void {
        const definition = this.registry.events.SDIE_ContentInfoListChanged
        const listener = (params: EventParams<typeof definition>) => {
            if (Number(params['Event Type']) === SONY_CONTENT_ADDED_EVENT_TYPE) handler()
        }
        this.on(definition, listener)
        return () => this.off(definition, listener)
    }

    private noteCardIndexEvent(information: { data?: { eventsSupportedRaw?: unknown } }): boolean {
        const events = information.data?.eventsSupportedRaw
        return (this.#announcesCardIndex =
            Array.isArray(events) && events.includes(this.registry.events.SDIE_ContentInfoListChanged.code))
    }

    /** From the DeviceInfo connect read, or read now when that read failed. */
    private async announcesCardIndex(): Promise<boolean> {
        return this.#announcesCardIndex ?? this.noteCardIndexEvent(await this.send(this.registry.operations.GetDeviceInfo, {}))
    }

    /**
     * Listens for the card index to announce a new file. `find` waits for an announcement and then
     * reads the card index once (only contents newer than this session's last lookup) for the file
     * `matches` accepts; a further announcement reads it once more. No announcement in time is an
     * unknown outcome: the card is never scanned instead.
     */
    private watchCardIndex(operation: 'takePhoto' | 'stopRecording'): SonyCardIndexWatch {
        let announcements = 0
        const stop = this.onCardIndexAddition(() => announcements++)
        const newest = this.#newestContent?.sessionId === this.sessionId ? this.#newestContent : undefined
        // Two seconds back, as a creation time may be stored at whole-second precision.
        const sinceUtcMs = newest && newest.createdUtcMs - 2_000
        return {
            stop,
            find: async (matches, timeoutMilliseconds) => {
                const deadline = Date.now() + timeoutMilliseconds
                let handled = 0
                try {
                    for (;;) {
                        while (announcements === handled && Date.now() < deadline) await this.waitMs(50)
                        if (announcements === handled)
                            throw new CameraOutcomeUnknownError(
                                operation,
                                `The camera did not list the new file in its card index within ${timeoutMilliseconds / 1000} seconds`
                            )
                        handled = announcements
                        const found = await findSonyCardItem(this, operation, matches, sinceUtcMs)
                        if (found.newestUtcMs !== undefined)
                            this.#newestContent = { sessionId: this.sessionId, createdUtcMs: found.newestUtcMs }
                        if (found.item) return found.item
                    }
                } finally {
                    stop()
                }
            },
        }
    }

    /**
     * Still mode for a body in a movie mode, shooting mode after a card read, then one two-stage
     * release confirmed by the camera's object-added event. The photo is saved to the card and sent
     * to the computer (Sony's "both" destination), so the event names the new file; its bytes are
     * always read, which releases the camera's copy, and returned only for 'computer'. Its id and
     * size are the ones `listMedia()` gives it, from one card-index read after the camera lists it.
     */
    async takePhoto({ autofocus, destination }: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile> {
        return classified(async confirmed => {
            await this.returnToShooting()
            // A body without a card index has no media ids, so its photo has none.
            const watch = (await this.announcesCardIndex()) ? this.watchCardIndex('takePhoto') : undefined
            let capture: SonyImage
            try {
                capture = await withSonyPhotoMode(sonyPhotoModeDriver(this), async () => {
                    const captured = await this.captureImage({
                        autofocus,
                        includeInfo: true,
                        includeData: true,
                        destination: 'card',
                    })
                    confirmed()
                    return captured
                })
            } catch (error) {
                watch?.stop()
                throw error
            }
            const { info, data } = describedFile(capture, destination === 'computer')
            const item =
                watch &&
                (await afterShutterRelease(() =>
                    watch.find(candidate => candidate.name === info.filename, SONY_CARD_INDEX_TIMEOUT_MS)
                ))
            return {
                ...(item && { mediaId: item.id }),
                name: info.filename,
                sizeBytes: item?.sizeBytes ?? info.objectCompressedSize,
                ...(data && { data }),
            }
        })
    }

    private availabilityOfFocus(capabilities: CameraCapabilities): OperationAvailability {
        const area = capabilities.controls.focusArea
        const spot = area && sonyAreaLabel(area.value)
        const movable = spot !== undefined && isMovableFocusArea(spot)
        if (movable) this.focusSession().lastSpot = sonyPlainArea(spot)
        if (!area) return unsupported('The camera reports no focus area to place a point in')
        return movable || area.writable ? supported : unsupported(focusAreaLockedReason)
    }

    /** This session's focus memory. A point placed before a disconnect never changes a later session. */
    private focusSession(): SonyFocusSession {
        if (this.#focus.sessionId !== this.sessionId) this.#focus = freshFocusSession(this.sessionId)
        return this.#focus
    }

    /**
     * Face and eye frames stay out of live view unless Face/Eye Frame Display is on, so eye tracking
     * would show nothing. Turned on once per session while subject detection is on, by the operations
     * that show frames (autofocus, live view), from the property states last read; getCapabilities
     * never writes it. This is display only: a body that refuses keeps its own setting, and the
     * refusal is logged rather than raised.
     */
    private async showFaceFramesWhileDetecting(): Promise<void> {
        const current = this.focusSession()
        if (current.faceFramesChecked) return
        const properties = this.registry.properties
        const states = this.listPropertyStates()
        if (states.find(state => state.name === properties.SubjectRecognitionInAF.name)?.value !== 'On') return
        current.faceFramesChecked = true
        const display = states.find(state => state.name === properties.FaceEyeFrameDisplay.name)
        if (!display || display.value === 'ON' || !display.writable) return
        try {
            await this.set(properties.FaceEyeFrameDisplay, 'ON')
        } catch (error) {
            if (!(error instanceof PTPResponseError)) throw error
            this.logWarning(`Sony Face/Eye Frame Display stayed off: ${error.message}`)
        }
    }

    /** The spot to switch to from an area without a position, keeping tracking when it was on. */
    private async spotFor(area: string): Promise<string> {
        const states = await this.refreshPropertyStates()
        const offered = (states.find(state => state.name === 'FocusArea')?.allowedValues ?? []).map(String)
        const tracking = sonyTrackingPrefix(area) !== undefined
        const { lastSpot } = this.focusSession()
        const preferred = tracking ? SONY_TRACKING_PREFIXES.map(prefix => `${prefix}${lastSpot}`) : [lastSpot]
        const match = preferred.find(candidate => offered.includes(candidate))
        if (match) return match
        const alternative = offered.find(
            candidate => isMovableFocusArea(candidate) && (sonyTrackingPrefix(candidate) !== undefined) === tracking
        )
        if (!alternative)
            throw new CameraUnsupportedError('setFocusPoint', `The camera offers no movable focus area from ${area}`)
        return alternative
    }

    async autofocus(): Promise<FocusResult> {
        await this.showFaceFramesWhileDetecting()
        return this.performAutofocus(SONY_FOCUS_DURATION_MILLISECONDS)
    }

    async setFocusPoint(x: number, y: number, options: FocusPointOptions): Promise<void> {
        requirePoint(x, y)
        const properties = this.registry.properties
        const current = this.focusSession()
        const area = String(await this.get(properties.FocusArea))
        if (isMovableFocusArea(area)) current.lastSpot = sonyPlainArea(area)
        else {
            if (!this.propertyCache.get(properties.FocusArea.code)?.vendorExtensions.enabled)
                throw new CameraUnsupportedError('setFocusPoint', focusAreaLockedReason)
            const spot = await this.spotFor(area)
            await this.set(properties.FocusArea, spot)
            current.changes.previousArea ??= area
            current.changes.placedArea = spot
        }
        if ((await this.get(properties.SubjectRecognitionInAF)) === 'On') {
            await this.set(properties.SubjectRecognitionInAF, 'Off')
            current.changes.pausedSubjectDetection = true
        }
        await this.setAfAreaPosition(Math.round(x * SONY_AF_AREA_X_MAX), Math.round(y * SONY_AF_AREA_Y_MAX))
        if (options.autofocus) await this.performAutofocus(SONY_FOCUS_DURATION_MILLISECONDS)
    }

    async resetFocusPoint(): Promise<void> {
        const properties = this.registry.properties
        const { changes } = this.focusSession()
        await restoreAll('resetFocusPoint', [
            async () => {
                if (isMovableFocusArea(String(await this.get(properties.FocusArea))))
                    await this.setAfAreaPosition(
                        Math.floor((SONY_AF_AREA_X_MAX + 1) / 2),
                        Math.floor((SONY_AF_AREA_Y_MAX + 1) / 2)
                    )
            },
            async () => {
                const { previousArea, placedArea } = changes
                changes.previousArea = changes.placedArea = undefined
                // Only undo the switch a focus point made: an area chosen since then stays.
                if (previousArea && String(await this.get(properties.FocusArea)) === placedArea)
                    await this.set(properties.FocusArea, previousArea)
            },
            async () => {
                const paused = changes.pausedSubjectDetection
                changes.pausedSubjectDetection = undefined
                if (paused && (await this.get(properties.SubjectRecognitionInAF)) === 'Off')
                    await this.set(properties.SubjectRecognitionInAF, 'On')
            },
        ])
    }

    settingWritten(id: CameraControlId): void {
        const current = this.focusSession()
        if (id === 'focusArea') current.changes.previousArea = current.changes.placedArea = undefined
        if (id === 'subjectDetection') {
            current.changes.pausedSubjectDetection = undefined
            current.faceFramesChecked = false
        }
    }

    /**
     * Waits for the camera's next frame before asking (pacing, measured from the frames so far), so a
     * caller never polls in a tight loop, and the frame request itself is one transaction. The
     * on-screen display output is switched on by the first overlay request and off once overlays stop.
     */
    async getLiveViewFrame({ overlay }: { overlay: boolean }): Promise<LiveViewFrame> {
        await this.showFaceFramesWhileDetecting()
        const untilNextFrameMilliseconds = this.millisecondsUntilNextLiveViewFrame()
        if (untilNextFrameMilliseconds > 0) await this.waitMs(untilNextFrameMilliseconds)
        let frame: Awaited<ReturnType<SonyCamera['captureLiveView']>>
        try {
            frame = await this.captureLiveView({ includeInfo: false })
        } catch (error) {
            if (error instanceof Error && /unavailable in the current camera mode/.test(error.message))
                throw new CameraUnsupportedError('getLiveViewFrame', error.message)
            throw error
        }
        const focusFrames: FocusFrame[] = (frame.sonyFocalFrames ?? []).map(
            ({ kind, focused, centerX, centerY, width, height }) => ({ kind, focused, centerX, centerY, width, height })
        )
        const jpeg = requireImage(frame.data)
        if (overlay) return { jpeg, focusFrames, overlay: await this.readOverlay() }
        if (this.#overlayOutput && Date.now() > this.#overlaySwitchOffDueMs) await this.switchOverlayOutputOff()
        return { jpeg, focusFrames }
    }

    /**
     * The frame already read is never lost to this: a failed or unconfirmed switch-off is logged
     * and tried again on a frame one idle interval later.
     */
    private async switchOverlayOutputOff(): Promise<void> {
        try {
            await this.setOsdImageMode(false)
            this.#overlayOutput = false
        } catch (error) {
            this.#overlaySwitchOffDueMs = Date.now() + OVERLAY_IDLE_MILLISECONDS
            this.logWarning(`Switching the camera's overlay output off was not confirmed; trying again later: ${errorText(error)}`)
        }
    }

    private async readOverlay(): Promise<{ png: Uint8Array }> {
        if (!this.listPropertyStates().some(state => state.name === 'OsdImageMode'))
            throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
        this.#overlaySwitchOffDueMs = Date.now() + OVERLAY_IDLE_MILLISECONDS
        this.#overlayOutput = true
        const { image } = await this.captureOsdImage()
        return { png: image }
    }

    private logWarning(message: string): void {
        this.logger.addLog({ type: 'console', level: 'warn', consoleLevel: 'warn', args: [message] })
    }

    /**
     * Native Sony PTP: 0xd21d is 0 idle and 1 recording; 2 (failed) and 3 (interval waiting) are
     * neither. Preparation selects the advertised movie mode and checks the movie card's remaining
     * time in it. The clip is named by the card index after Stop, so ids match `listMedia()`.
     */
    private video(): VideoCapability {
        if (this.#video) return this.#video
        const owner = this.requireOwner()
        const steps = cardSteps(this, owner)
        const recording: VendorRecording = {
            ...steps,
            readState: async () => {
                const state = await readSonyPtpRecordingState({ getSonyPropertyStates: () => this.refreshPropertyStates() })
                return state === 0 ? 'idle' : state === 1 ? 'recording' : 'unknown'
            },
            prepare: async () => (await openSonyRecordingMode(owner)).restore,
            // A body without a card index names its clip by object handle, as before.
            listHandles: async () => {
                this.#clipWatch?.stop()
                this.#clipWatch = undefined
                if (!(await this.announcesCardIndex())) return steps.listHandles()
                this.#clipWatch = this.watchCardIndex('stopRecording')
                return new Set()
            },
            findClip: async baseline => {
                const watch = this.#clipWatch
                this.#clipWatch = undefined
                if (!watch) return steps.findClip(baseline)
                const item = await watch.find(candidate => candidate.kind === 'clip', clipFinalizationMilliseconds)
                return { mediaId: item.id, name: item.name, sizeBytes: item.sizeBytes }
            },
            sendStart: () => this.sendStartRecording(),
            sendStop: () => this.sendStopRecording(),
            // The movie button is a press and release; Stop releases a press the body ignored.
            releaseIgnoredStart: () => this.sendStopRecording(),
        }
        return (this.#video = recordingCapability(recording))
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

    /**
     * Press-and-hold zoom with a safety stop (SDIO_ControlDevice Zoom Operation): optical on a
     * power-zoom lens, Clear Image or digital otherwise, until stopZoom.
     */
    async startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void> {
        const stopsAtStart = this.#zoomStops
        if (direction !== 'in' && direction !== 'out')
            throw new CameraRefusedError('startZoom', 'Zoom direction must be in or out')
        if (!ZOOM_SPEEDS.includes(options?.speed))
            throw new CameraRefusedError('startZoom', 'Zoom speed must be slow, medium or fast')
        const states = await this.refreshPropertyStates()
        if (!remoteZoomAvailable(states)) throw new CameraUnsupportedError('startZoom', zoomUnavailableReason)
        await this.driveZoom('startZoom', direction, options.speed, states, stopsAtStart)
    }

    /** Always sent: a stop wins over a start or zoomTo still being prepared. */
    async stopZoom(): Promise<void> {
        this.#zoomStops++
        await this.haltZoom()
    }

    /**
     * Zooms towards a focal length and resolves to where the lens landed, read back once it settles:
     * the camera, not the request, decides. One pass, then at most one slow correction after an
     * overshoot; each is a new movement, never a resent command.
     */
    async zoomTo(focalLengthMillimetres: number): Promise<number> {
        const stopsAtStart = this.#zoomStops
        if (!Number.isFinite(focalLengthMillimetres) || focalLengthMillimetres <= 0)
            throw new CameraRefusedError('zoomTo', 'The focal length must be a positive number of millimetres')
        const states = await this.refreshPropertyStates()
        if (!remoteZoomAvailable(states)) throw new CameraUnsupportedError('zoomTo', zoomUnavailableReason)
        const start = sonyFocalLengthMillimetres(states)
        if (start === null) throw new CameraUnsupportedError('zoomTo', noFocalLengthReason)
        const arrived = (landed: number) => Math.abs(landed - focalLengthMillimetres) <= ZOOM_ARRIVAL_TOLERANCE_MILLIMETRES
        if (arrived(start)) return start

        const scaleBefore = zoomScale(states)
        const speed = Math.abs(focalLengthMillimetres - start) > ZOOM_MEDIUM_SPEED_DISTANCE_MILLIMETRES ? 'medium' : 'slow'
        const first = await this.zoomPass(start, focalLengthMillimetres, speed, states, stopsAtStart)
        if (first.sent && first.landed === start) this.reportUnmovedLens(start, scaleBefore)
        const overshot = Math.sign(first.landed - focalLengthMillimetres) !== Math.sign(start - focalLengthMillimetres)
        if (first.interrupted || !overshot || arrived(first.landed)) return first.landed
        const correction = await this.zoomPass(
            first.landed,
            focalLengthMillimetres,
            'slow',
            this.listPropertyStates(),
            stopsAtStart
        )
        return correction.landed
    }

    /**
     * The focal length never moved. With only optical zoom and no change in Zoom Scale, nothing
     * changed and the camera in effect refused; otherwise its digital zoom may have moved instead.
     */
    private reportUnmovedLens(start: number, scaleBefore: number | undefined): never {
        const states = this.listPropertyStates()
        const scaleAfter = zoomScale(states)
        const unchanged =
            scaleBefore !== undefined && scaleAfter !== undefined
                ? scaleAfter === scaleBefore
                : states.find(state => state.name === 'ZoomSetting')?.value === 'Optical Zoom Only'
        if (unchanged)
            throw new CameraRefusedError('zoomTo', `The focal length stayed at ${start} mm: zoomTo needs a power-zoom lens`)
        throw new CameraOutcomeUnknownError(
            'zoomTo',
            `The focal length read back ${start} mm, unchanged, but the camera may have moved its digital zoom instead (Clear Image or Digital Zoom is on)`
        )
    }

    /** Drives towards the target until it is reached or crossed, the lens stalls, or stopZoom is called. */
    private async zoomPass(
        from: number,
        target: number,
        speed: ZoomSpeed,
        states: readonly SonyPropertyState[],
        stopsAtStart: number
    ): Promise<{ landed: number; interrupted: boolean; sent: boolean }> {
        const direction: ZoomDirection = target > from ? 'in' : 'out'
        const sent = await this.driveZoom('zoomTo', direction, speed, states, stopsAtStart)
        // A stop came in before the start went out: the lens was not moved, and `from` was just read.
        if (!sent) return { landed: from, interrupted: true, sent }
        let last = from
        let lastChangeMs = Date.now()
        const deadline = Date.now() + ZOOM_SAFETY_STOP_MILLISECONDS
        try {
            while (Date.now() < deadline && this.#zoomStops === stopsAtStart) {
                await this.waitMs(ZOOM_POLL_MILLISECONDS)
                const current = sonyFocalLengthMillimetres(await this.refreshPropertyStates())
                if (current === null) break
                const remaining = direction === 'in' ? target - current : current - target
                if (remaining <= ZOOM_ARRIVAL_TOLERANCE_MILLIMETRES) break
                if (current !== last) {
                    last = current
                    lastChangeMs = Date.now()
                } else if (Date.now() - lastChangeMs > ZOOM_STALL_MILLISECONDS) break
            }
        } catch (error) {
            await this.haltZoom()
            throw new CameraOutcomeUnknownError('zoomTo', `The focal length could not be read while zooming: ${errorText(error)}`)
        }
        const interrupted = this.#zoomStops !== stopsAtStart
        if (!interrupted) await this.haltZoom()
        return { landed: await this.settledFocalLength(last), interrupted, sent }
    }

    /** Reads until two consecutive focal lengths agree; the camera's value, never the requested one. */
    private async settledFocalLength(fallback: number): Promise<number> {
        const deadline = Date.now() + ZOOM_SETTLE_MILLISECONDS
        let previous: number | null = null
        while (Date.now() < deadline) {
            const current = sonyFocalLengthMillimetres(await this.refreshPropertyStates())
            if (current === null)
                throw new CameraOutcomeUnknownError('zoomTo', 'The lens stopped reporting its focal length after zooming')
            if (current === previous) return current
            previous = current
            await this.waitMs(ZOOM_POLL_MILLISECONDS)
        }
        if (previous === null) return fallback
        throw new CameraOutcomeUnknownError(
            'zoomTo',
            `The focal length was still changing (${previous} mm) after the zoom stopped`
        )
    }

    /**
     * One zoom-start command, unless stopZoom was called since the operation began (then nothing is
     * sent and this resolves false). The safety stop is armed first, so even an unconfirmed start
     * stops by itself. A stopZoom during the start's transaction queues behind it and stops the lens.
     * Sony's speed is 1 (slowest) to the top of Zoom Speed Range from the inventory just read; a
     * fixed-speed body, or one that reports no range, gets 1.
     */
    private async driveZoom(
        operation: 'startZoom' | 'zoomTo',
        direction: ZoomDirection,
        speed: ZoomSpeed,
        states: readonly SonyPropertyState[],
        stopsAtStart: number
    ): Promise<boolean> {
        const reported = states.find(state => state.name === 'ZoomSpeed')?.range?.maximum
        const maximum = reported !== undefined && Number.isInteger(reported) && reported >= 1 ? reported : 1
        const level = speed === 'slow' ? 1 : speed === 'fast' ? maximum : Math.max(1, Math.round(maximum / 2))
        if (this.#zoomStops !== stopsAtStart) return false
        this.armZoomSafetyStop()
        try {
            await this.sendZoomOperation(direction === 'in' ? level : -level, `Sony zoom ${direction}`)
            this.#zooming = this.#zoomStops === stopsAtStart
            return true
        } catch (error) {
            if (error instanceof PTPResponseError) {
                this.clearZoomSafetyStop()
                throw new CameraRefusedError(operation, `The camera refused to zoom ${direction}: ${error.message}`)
            }
            this.#zooming = this.#zoomStops === stopsAtStart
            throw new CameraOutcomeUnknownError(operation, `Zooming ${direction} was not confirmed: ${errorText(error)}`)
        }
    }

    /** Sends the zoom stop. Internal stops (end of a zoomTo pass, the safety stop) do not count as stopZoom calls. */
    private async haltZoom(): Promise<void> {
        this.clearZoomSafetyStop()
        const wasZooming = this.#zooming
        this.#zooming = false
        try {
            await this.sendZoomOperation(0, 'Sony zoom stop')
        } catch (error) {
            // Nothing this session started was moving, so a refused stop changed nothing.
            if (error instanceof PTPResponseError && !wasZooming) return
            if (error instanceof PTPResponseError)
                throw new CameraRefusedError('stopZoom', `The camera refused to stop zooming: ${error.message}`)
            throw new CameraOutcomeUnknownError('stopZoom', `Stopping the zoom was not confirmed: ${errorText(error)}`)
        }
    }

    private armZoomSafetyStop(): void {
        this.clearZoomSafetyStop()
        this.#zoomSafetyStop = setTimeout(() => void this.haltZoom().catch(() => undefined), ZOOM_SAFETY_STOP_MILLISECONDS)
        // A pending safety stop never keeps a Node process alive by itself.
        if (typeof this.#zoomSafetyStop === 'object' && 'unref' in this.#zoomSafetyStop) this.#zoomSafetyStop.unref()
    }

    private clearZoomSafetyStop(): void {
        if (this.#zoomSafetyStop) clearTimeout(this.#zoomSafetyStop)
        this.#zoomSafetyStop = undefined
    }

    /** Zoom Operation's value is the signed speed: positive tele, negative wide, 0 stops. */
    private async sendZoomOperation(value: number, action: string): Promise<void> {
        await this.controlDevice(SONY_ZOOM_OPERATION_CODE, this.registry.codecs.int8.encode(value), action)
    }

    /** Date/Time Setting rather than the standard DateTime property; resolves once the camera confirms it. */
    override async setClock(moment: Date): Promise<void> {
        await this.setDateTime(moment)
    }

    override async availability(
        operation: CameraOperationName,
        capabilities: CameraCapabilities
    ): Promise<OperationAvailability | undefined> {
        if (operation === 'autofocus' || operation === 'setClock') return supported
        if (operation === 'setFocusPoint' || operation === 'resetFocusPoint') return this.availabilityOfFocus(capabilities)
        if (operation === 'getLiveViewFrame') return this.liveViewAvailability()
        const states = this.listPropertyStates()
        if (operation === 'startZoom' || operation === 'zoomTo') {
            if (!remoteZoomAvailable(states)) return unsupported(zoomUnavailableReason)
            if (operation === 'zoomTo' && sonyFocalLengthMillimetres(states) === null)
                return unsupported(noFocalLengthReason)
            return supported
        }
        return super.availability(operation, capabilities)
    }

    private liveViewAvailability(): OperationAvailability {
        const states = this.listPropertyStates()
        const overlay = states.some(state => state.name === 'OsdImageMode') ? supported : unsupported(overlayUnsupported)
        if (states.find(state => state.name === 'LiveViewStatus')?.value === 'NOT_SUPPORTED')
            return {
                supported: false,
                reason: 'The camera reports live view unavailable in its current mode',
                options: { overlay },
            }
        return { supported: true, options: { overlay } }
    }
}

interface SonyCardIndexWatch {
    find(matches: (item: MediaItem) => boolean, timeoutMilliseconds: number): Promise<MediaItem>
    stop(): void
}

/**
 * What a focus point changed on a Sony body, so `resetFocusPoint` can put it back: the focus area
 * it switched from (Wide, Zone and Center have no position) and subject detection it paused
 * (eye tracking would otherwise pull focus straight back to a face).
 */
interface SonyFocusSession {
    sessionId: number | null
    changes: { previousArea?: string; placedArea?: string; pausedSubjectDetection?: boolean }
    /** The spot size last active on the camera, without its tracking prefix. */
    lastSpot: string
    /** Face/Eye Frame Display was checked since subject detection was last seen turning on. */
    faceFramesChecked: boolean
}

function freshFocusSession(sessionId: number | null): SonyFocusSession {
    return { sessionId, changes: {}, lastSpot: SONY_DEFAULT_SPOT, faceFramesChecked: false }
}

function sonyTrackingPrefix(area: string): string | undefined {
    return SONY_TRACKING_PREFIXES.find(prefix => area.startsWith(prefix))
}

/** A spot without its tracking prefix: "Lock on AF Flexible Spot M" and "Tracking Flexible Spot M" are "Flexible Spot M". */
function sonyPlainArea(area: string): string {
    return area.slice(sonyTrackingPrefix(area)?.length ?? 0)
}

/** Sony's own label for a canonical focus area, from the vendor value names. */
function sonyAreaLabel(canonical: string): string | undefined {
    const names = controlValueNames('sony', 'focusArea')?.FocusArea ?? {}
    return Object.entries(names).find(([, name]) => name === canonical)?.[0]
}

const remoteZoomAvailable = (states: readonly SonyPropertyState[]) =>
    states.find(state => state.name === 'ZoomEnableStatus')?.value === 'Enabled'

/** Zoom Scale (thousandths): the body's digital zoom magnification, when it reports one. */
function zoomScale(states: readonly SonyPropertyState[]): number | undefined {
    const scale = states.find(state => state.name === 'ZoomScale' && state.enabled)?.rawValue
    return scale === undefined ? undefined : Number(scale)
}

function isTransportFailure(error: unknown): boolean {
    return (
        error instanceof PTPTimeoutError ||
        error instanceof PTPDisconnectedError ||
        error instanceof PTPProtocolError ||
        error instanceof PTPRecoveryRequiredError
    )
}

/** A focus area whose position can be moved: any spot, in Sony's words (Flexible Spot) or Slate's (Spot). */
export function isMovableFocusArea(area: string): boolean {
    return /spot/i.test(area)
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
