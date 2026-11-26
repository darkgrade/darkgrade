import type { PhotoVideoMode } from '@camera/settings/values'
import type { CameraCapabilities, CameraControlId, CameraRecordingState, OperationAvailability } from '@camera/controls'
import type {
    CameraEventHandler,
    CameraEventName,
    CameraOperationName,
    Clip,
    ConfirmedPhotoFile,
    FocusDirection,
    FocusFrame,
    FocusNudge,
    FocusPointOptions,
    FocusResult,
    FocusStepSize,
    LiveViewFrame,
    PhotoDestination,
} from '@camera/driver'
import { CameraClipNotFoundError, CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Logger } from '@core/logger'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { recognizedDescriptorValues, type DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { AccessDenied, DeviceBusy, DevicePropNotSupported, OK, OperationNotSupported } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { CodecType } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { TransportType } from '@transport/interfaces/transport-types'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import type { VideoCapability } from '@vendors/generic/capability-groups'
import { FocusPointChanges } from '@vendors/generic/focus-point-changes'
import { GenericCamera } from '@vendors/generic/generic-camera'
import { warningStatusEvidence } from '@vendors/protocol-evidence'
import {
    cardObjectFile,
    cardSteps,
    classified,
    clipFinalizationMilliseconds,
    type DriverCapture,
    operationsAdvertised,
    overlayUnsupported,
    requireImage,
    requireNudge,
    requirePoint,
    restoreAll,
    unstatedSize,
    unsupported,
} from '@vendors/generic/generic-operations'
import { encodeMediaId, mediaKind } from '@vendors/generic/media-id'
import { recordingCapability } from '@vendors/generic/recording-lifecycle'
import { afterPossibleRelease, afterShutterRelease, shutterOutcomeUnknown, shutterRefused } from '@vendors/generic/shutter-outcome'
import type { NikonLiveViewDataset } from '@vendors/nikon/datasets/nikon-live-view-dataset'
import { ISOAutoControl } from '@vendors/nikon/definitions/nikon-operation-definitions'
import { NIKON_AF_AREA_VALUES } from '@vendors/nikon/definitions/nikon-property-definitions'
import { HardwareError, InvalidStatus, MfDriveStepEnd, NotLiveView, OutOfFocus, SilentReleaseBusy } from '@vendors/nikon/definitions/nikon-response-definitions'
import type { NikonQueuedEvent } from '@vendors/nikon/event-data'
import { prepareNikonManualExposure } from '@vendors/nikon/manual-exposure'
import { withNikonRawCompression } from '@vendors/nikon/raw-capture'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
import { nikonStorageCanRecord } from '@vendors/nikon/card-storage'
import { decodeNikonVendorCodes, NIKON_VENDOR_CODES_MAXIMUM } from '@vendors/nikon/vendor-codes'
import { matchesNikonShutter, nikonShutterLabel } from '@vendors/nikon/shutter-values'
import { createNikonRegistry, type NikonRegistry } from '@vendors/registry'

/** How often Nikon's event queue is read while someone is listening. */
const NIKON_EVENT_POLL_INTERVAL_MILLISECONDS = 500
/**
 * MfDrive steps per nudge. Nikon's USB reference takes 1–32767 lens drive steps without a unit;
 * these follow the small/medium/large steps of tethering apps and are not yet bench-calibrated.
 */
const NIKON_FOCUS_STEPS: Record<FocusStepSize, number> = { small: 10, medium: 100, large: 500 }
/** How long a card capture waits for its file after the readout allowance. */
const NIKON_CARD_FILE_TIMEOUT_MS = 15_000
/** How long a RAW announced first waits for its JPEG pair, which may arrive in a later event poll. */
const NIKON_PAIR_GRACE_MS = 1_000
/**
 * How long live view waits for a Nikon that is still warming up. A Z5 II on darkgrade01 refused StartLiveView
 * and the clearing release with HardwareError (WarningStatus 1) about 50 s after a cold power-on, and worked
 * minutes later. Only StartLiveView is sent again, after 1, 2, 4 then every 8 s; the release is never repeated.
 */
const NIKON_WARM_UP_MS = 90_000
const NIKON_WARM_UP_MAX_DELAY_MS = 8_000
const NIKON_NOT_READY =
    'The camera is not ready yet: it refuses live view and the release that clears its sequence error (HardwareError, WarningStatus 1), as a Nikon does for a while after power-on; nothing was taken, try again in a few minutes'

export type NikonLiveViewMetadata = Omit<
    NikonLiveViewDataset,
    'liveViewImage' | 'reserved' | 'afFrameData' | 'autoCaptureSubjectDetection' | 'reservedEnd'
>

export interface NikonFocusResult {
    commandSent: true
    focusAcquired: boolean
    metadata: NikonLiveViewMetadata
}

export interface NikonFocusPointResult {
    commandSent: true
    positionVerified: boolean
    normalized: { x: number; y: number }
    x: number
    y: number
    width: number
    height: number
    tolerance: { x: number; y: number }
    metadata: NikonLiveViewMetadata
    focus?: NikonFocusResult
}

export class NikonCamera extends GenericCamera {
    private cameraMode: 'PC_CAMERA' | 'REMOTE' | 'UNKNOWN' = 'UNKNOWN'
    private liveViewMode: 'PHOTO' | 'VIDEO' | 'UNKNOWN' = 'UNKNOWN'
    private applicationMode: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN'
    private liveViewStatus: 'ON' | 'OFF' | 'UNKNOWN' = 'UNKNOWN'
    /** What setFocusPoint changed on this body, so resetFocusPoint and disconnect can put it back. */
    private readonly focusChanges = new FocusPointChanges()
    private liveViewStartPending = false
    private ownsLiveView = false
    private manualVideoExposureRequested = false
    private lostSessionId?: number
    /** SDRAM objects announced by any event poll (an event listener's pump or a capture), oldest first. */
    private announcedSdramObjects: number[] = []

    vendorId = VendorIDs.NIKON
    declare public registry: NikonRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createNikonRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)
    }

    /** HardwareError says to inspect WarningStatus: record its bits so the error says which warning it was. */
    protected override async explainResponse(operation: number, response: number, transactionId: number): Promise<void> {
        if (response !== HardwareError.code) return
        const warning = this.registry.properties.NikonWarningStatus
        const evidence = warningStatusEvidence(this.vendorId, warning.code, await this.get(warning), operation, transactionId)
        if (evidence) this.recordProtocol(evidence, operation)
    }

    protected async verifyRecoveryState(information: DeviceInfo): Promise<void> {
        const supported = information.operationsSupportedRaw
        if (supported.includes(this.registry.operations.DeviceReady.code)) {
            await this.pollDeviceReady()
            return
        }
        if (![0x100e, 0x90c0, 0x9201, 0x9207, 0x920a].some(code => supported.includes(code)))
            throw new CameraRefusedError('recover', 'Nikon advertises file transfer without camera controls; inspect camera power and mode')
    }

    override readonly captureOptions = { memory: true, withoutAutofocus: true, rawCompression: true }

    /** Host read/delete access is enough when the body's own movie prohibition flags clear the card. */
    override async storageCanRecord(_storageId: number, accessCapability: number) {
        return nikonStorageCanRecord(this, accessCapability)
    }

    /** @internal Closing a recording session restores Nikon's photo/application modes before Stop. */
    protected async existingRecordingSession(previousSessionId: number | null): Promise<number | undefined> {
        const status = await readNikonRecordingStatus(this)
        if (!status) throw new CameraOutcomeUnknownError('connect', 'Nikon existing session state is unreadable; its session was preserved')
        if (!status.recording) return undefined
        const existing = previousSessionId ?? this.lostSessionId
        if (existing === undefined)
            throw new CameraOutcomeUnknownError('connect', 'Nikon is recording in an unknown session; its session was preserved')
        this.lostSessionId = undefined
        return existing
    }

    async disconnect(): Promise<void> {
        this.lostSessionId = !this.transport.isConnected() ? (this.sessionId ?? this.lostSessionId) : undefined
        try {
            if (this.transport.isConnected())
                await restoreAll('disconnect', [
                    ...this.focusRestoreSteps(),
                    async () => {
                        if (this.ownsLiveView || this.liveViewStartPending) await this.disableLiveView()
                    },
                ])
        } finally {
            this.forgetModes()
            this.manualVideoExposureRequested = false
            await super.disconnect()
        }
    }

    private forgetModes(): void {
        this.forgetObservedModes()
        this.liveViewStartPending = false
        this.ownsLiveView = false
    }

    private forgetObservedModes(): void {
        this.cameraMode = 'UNKNOWN'
        this.liveViewMode = 'UNKNOWN'
        this.applicationMode = 'UNKNOWN'
        this.liveViewStatus = 'UNKNOWN'
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return (await this.propertyDescriptor(property)).currentValueDecoded as CodecType<P['codec']>
    }

    /** Read one known descriptor. Callers must discover whether the current body advertises it. */
    async propertyDescriptor(property: PropertyDefinition): Promise<DevicePropDesc> {
        if (!property.access.includes('Get')) throw new Error(`Property ${property.name} is not readable`)
        const operations = this.registry.operations
        const extended = await this.send(operations.GetDevicePropDescEx, { DevicePropCode: property.code })
        const standard = standardFallback(extended.code, property)
            ? await this.send(operations.GetDevicePropDesc, { DevicePropCode: property.code })
            : undefined
        const response = standard ?? extended
        const operationName = standard ? 'GetDevicePropDesc' : 'GetDevicePropDescEx'
        if (response.code !== OK.code) {
            throw new PTPResponseError(
                response.code,
                `Nikon ${operationName} returned 0x${response.code.toString(16)} for ${property.name} (0x${property.code.toString(16)})`,
                { operation: operationName }
            )
        }
        const descriptor = response.data
        if (!descriptor) throw new Error(`No data received from ${operationName}`)
        if (descriptor.devicePropertyCode !== property.code)
            throw new PTPDecodeError(`Nikon ${operationName} returned a descriptor for a different property`)
        return descriptor
    }

    /** A supported native shutter never falls back after busy, denial or malformed data. */
    private async shutterDescriptor() {
        try {
            const mode = await this.get(this.registry.properties.LiveViewSelector)
            if (mode !== 'PHOTO' && mode !== 'VIDEO') throw new Error('Nikon shutter selector is unknown')
            const { NikonPhotoShutterSpeed, NikonMovieShutterSpeed } = this.registry.properties
            const property = mode === 'PHOTO' ? NikonPhotoShutterSpeed : NikonMovieShutterSpeed
            const descriptor = await this.propertyDescriptor(property)
            if (descriptor.dataType !== 6 || typeof descriptor.currentValueRaw !== 'number')
                throw new Error('Invalid Nikon shutter descriptor datatype')
            return { property, descriptor, mode }
        } catch (error) {
            if (isUnsupportedProperty(error)) return undefined
            throw error
        }
    }

    async getShutterSpeed(): Promise<string> {
        const native = await this.shutterDescriptor()
        return native ? nikonShutterLabel(native.descriptor.currentValueRaw as number) : super.getShutterSpeed()
    }

    async setShutterSpeed(value: string): Promise<void> {
        const native = await this.shutterDescriptor()
        if (!native) return super.setShutterSpeed(value)
        const { property, descriptor, mode } = native
        if (mode === 'VIDEO') {
            try {
                if ((await this.get(this.registry.properties.MovieShutterMode)) !== 'SHUTTER_SPEED')
                    throw new Error('Nikon movie shutter is in angle mode; choose shutter-speed mode before setting it')
            } catch (error) {
                if (!isUnsupportedProperty(error)) throw error
            }
        }
        if (descriptor.getSet !== 'GET_SET' || descriptor.formFlag !== 2)
            throw new Error('Nikon shutter requires a writable advertised enumeration')
        const target = descriptor.supportedValuesRaw?.find(raw => typeof raw === 'number' && matchesNikonShutter(raw, value))
        if (typeof target !== 'number') throw new Error('Requested Nikon shutter speed is not advertised')
        if ((await this.get(this.registry.properties.LiveViewSelector)) !== mode)
            throw new Error('Nikon photo/video mode changed before shutter write')
        await this.set(property, target)
        const observed = await this.propertyDescriptor(property)
        if (observed.currentValueRaw !== target)
            throw new CameraOutcomeUnknownError('shutterSpeed', 'Nikon shutter readback differs from the requested value')
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) throw new Error(`Property ${property.name} is not writable`)
        const encodedValue = this.resolveCodec(property.codec).encode(value)
        const parameters = { DevicePropCode: property.code }
        const extended = await this.send(this.registry.operations.SetDevicePropValueEx, parameters, encodedValue)
        const standard = standardFallback(extended.code, property)
            ? await this.send(this.registry.operations.SetDevicePropValue, parameters, encodedValue)
            : undefined
        const response = standard ?? extended
        if (response.code !== OK.code)
            throw new PTPResponseError(response.code, `Nikon ${property.name} write failed: ${this.responseDescription(response.code)}`, {
                operation: standard ? 'SetDevicePropValue' : 'SetDevicePropValueEx',
            })
    }

    /** Photo quality remains configurable while the physical selector is in video mode. */
    async setStandardProperty(name: string | number, value: string | number): Promise<void> {
        const photoProperties = ['compressionsetting', 'imagesize', '0x5003', '0x5004', '20483', '20484']
        if (!photoProperties.includes(String(name).toLowerCase())) return super.setStandardProperty(name, value)
        await this.getLiveViewStatus()
        if (this.liveViewMode !== 'VIDEO') return super.setStandardProperty(name, value)
        const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
        if (condition.includes('alreadyRecording'))
            throw new Error('Nikon photo settings cannot interrupt an active recording')
        await this.inRemoteMode(
            async () => {
                await this.selectLiveViewMode('PHOTO')
                await super.setStandardProperty(name, value)
            },
            'VIDEO',
            (error, failure) =>
                failure
                    ? new AggregateError([failure, error], `${String(failure)}; restoring Nikon movie mode: ${String(error)}`)
                    : error
        )
    }

    /** Runs `action` in REMOTE mode, then restores the selector (when given), live view and PC-camera mode. */
    private async inRemoteMode(
        action: () => Promise<void>,
        restoreSelector: 'VIDEO' | undefined,
        restorationError: (error: unknown, failure: unknown) => unknown
    ): Promise<void> {
        const restoreLiveView = this.liveViewStatus === 'ON'
        const restoreLiveViewOwnership = this.ownsLiveView
        const restorePcMode = this.cameraMode !== 'REMOTE'
        let failure: unknown
        try {
            await this.changeCameraMode('REMOTE')
            await action()
        } catch (error) {
            failure = error
            throw error
        } finally {
            try {
                if (restoreSelector) await this.selectLiveViewMode(restoreSelector, true)
                if (restoreLiveView) await this.enableLiveView()
                this.ownsLiveView = restoreLiveViewOwnership
                if (restorePcMode) await this.changeCameraMode('PC_CAMERA')
            } catch (error) {
                throw restorationError(error, failure)
            }
        }
    }

    /** Drain one event batch explicitly; opening a camera does not start a background poll. */
    async pollEvents(): Promise<NikonQueuedEvent[]> {
        const extended = await this.send(this.registry.operations.GetEventEx, {})
        const legacy = extended.code === OperationNotSupported.code ? await this.send(this.registry.operations.GetEvent, {}) : undefined
        const response = legacy ?? extended
        const operation = legacy ? 'GetEvent' : 'GetEventEx'
        if (response.code !== OK.code) throw new PTPResponseError(response.code, undefined, { operation })
        if (!Array.isArray(response.data)) throw new Error(`Nikon ${operation} returned no event dataset`)
        const events: NikonQueuedEvent[] = legacy
            ? legacy.data.map(event => ({ code: event.code, parameters: [event.parameter] }))
            : extended.data.map(event => ({ code: event.code, parameters: [...event.parameters] }))
        const { ObjectAddedInSdram, ObjectAdded } = this.registry.events
        for (const event of events) {
            const handle = event.parameters[0]
            if (event.code === ObjectAddedInSdram.code && handle !== undefined) this.announcedSdramObjects.push(Number(handle))
            if (event.code === ObjectAdded.code && handle !== undefined) this.#announcedCardObjects?.push(Number(handle))
            this.handleEvent({ ...event, transactionId: 0 })
        }
        return events
    }

    async getIso(): Promise<string> {
        if ((await this.get(ISOAutoControl)) === 'ON') return 'ISO AUTO'
        return super.getIso()
    }

    async setIso(value: string): Promise<void> {
        if (value.toLowerCase().includes('auto')) return this.set(ISOAutoControl, 'ON')
        await this.set(ISOAutoControl, 'OFF')
        await this.set(this.registry.properties.ExposureIndex, value)
    }

    /**
     * Saves a still to the camera card by default and resolves once the card reports the new file
     * (its ObjectAdded event). Explicit memory capture waits for a new SDRAM object event and
     * retrieves that object's metadata and complete bytes. A refused release is
     * CameraRefusedError; once the release is sent, an unconfirmed file is CameraOutcomeUnknownError.
     */
    async captureImage(
        options: {
            includeInfo?: boolean
            includeData?: boolean
            autofocus?: boolean
            destination?: 'card' | 'memory'
            rawCompression?: 'lossless'
        } = {}
    ): Promise<DriverCapture> {
        const memory = options.destination === 'memory'
        if (memory && options.includeData === false)
            throw new Error('Memory capture requires transfer so the new SDRAM image can be released')
        if (this.transport.getType() === TransportType.IP) await this.changeCameraMode('REMOTE')
        const cardHandles: number[] = []
        const recordCardObject = (event: { ObjectHandle?: number }) => {
            if (event.ObjectHandle && !cardHandles.includes(event.ObjectHandle)) cardHandles.push(event.ObjectHandle)
        }
        let releaseSent = false
        const release = async () => {
            // Events queued before this release must not count as its file.
            await this.pollEvents()
            cardHandles.length = 0
            this.announcedSdramObjects = []
            const recInMedia = (await this.deviceInformation()).operationsSupportedRaw.includes(0x9207)
            // A Z5 II answers the standard InitiateCapture with GeneralError (darkgrade01, 2026-11-25), so a
            // body with InitiateCaptureRecInMedia focuses through it (AfMode 0xFFFFFFFE), which reports a
            // failed focus as OutOfFocus without releasing. Older bodies keep the standard command.
            if (!memory && options.autofocus !== false && !recInMedia) {
                releaseSent = true
                const response = await this.send(this.registry.operations.InitiateCapture, {})
                return this.assertReleaseAccepted(response.code, 'InitiateCapture')
            }
            if (!recInMedia)
                throw new CameraUnsupportedError('takePhoto', 'Nikon does not advertise the requested capture mode; no shutter command sent')
            // Z6III command reference rev 2, 6.2.4.1: normal release, save to card.
            releaseSent = true
            const response = await this.send(this.registry.operations.InitiateCaptureRecInMedia, {
                AfMode: options.autofocus === false ? 0xffffffff : 0xfffffffe,
                Target: memory ? 1 : 0,
            })
            this.assertReleaseAccepted(response.code, 'InitiateCaptureRecInMedia')
        }
        const includeInfo = options.includeInfo !== false
        const finish = async (waitForBuffer: boolean): Promise<DriverCapture> => {
            const fromMemory = memory ? await this.readCapturedMemory() : undefined
            // A 30-second exposure still needs readout: wait, never replaying the release, before restoring modes.
            await this.pollDeviceReady(60000, [], [SilentReleaseBusy.code])
            if (fromMemory) return { data: fromMemory.data, info: includeInfo ? fromMemory.info : undefined }
            if (waitForBuffer) await this.waitForImageBufferReady(30000)
            const card = await this.readCapturedCardImage(cardHandles, options.includeData === true)
            return { info: includeInfo ? card.info : undefined, data: card.data, objectHandle: card.objectHandle }
        }
        const releaseAndConfirm = (waitForBuffer: boolean) =>
            withNikonRawCompression(this, options.rawCompression, async () => {
                await this.enableLiveView()
                this.on(this.registry.events.ObjectAdded, recordCardObject)
                try {
                    try {
                        await release()
                    } catch (error) {
                        // A refusal or an unsupported mode took nothing; a lost reply to a sent release may have.
                        const definitive =
                            error instanceof CameraUnsupportedError || error instanceof CameraRefusedError
                        throw releaseSent && !definitive ? shutterOutcomeUnknown(error) : error
                    }
                    return await afterShutterRelease(() => finish(waitForBuffer))
                } finally {
                    this.off(this.registry.events.ObjectAdded, recordCardObject)
                }
            })
        const capture = (waitForBuffer = true) =>
            releaseAndConfirm(waitForBuffer).catch(error => Promise.reject(afterPossibleRelease(error, releaseSent)))

        // Older bodies return no data for the extended status properties; capture directly.
        try {
            await this.getLiveViewStatus()
        } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('No data received from GetDevicePropDescEx'))
                throw error
            return capture(false)
        }
        if (this.liveViewMode === 'PHOTO') return capture()
        if (this.liveViewMode !== 'VIDEO') throw new Error('Nikon live-view selector is unknown; capture was not sent')
        // At the video dial position, remote mode (which blanks the screen) selects photo for the capture.
        const restorePcMode = this.cameraMode !== 'REMOTE'
        const failures: unknown[] = []
        const attempt = (step: () => Promise<unknown>) => step().catch(error => void failures.push(error))
        let captured: DriverCapture = {}
        await attempt(async () => {
            await this.changeCameraMode('REMOTE')
            await this.selectLiveViewMode('PHOTO')
            captured = await capture()
        })
        await attempt(() => this.selectLiveViewMode('VIDEO', true))
        await attempt(async () => restorePcMode && (await this.changeCameraMode('PC_CAMERA')))
        if (failures.length)
            throw afterPossibleRelease(
                failures.length === 1
                    ? failures[0]
                    : new AggregateError(failures, `Nikon capture/settings restoration failed: ${failures.map(String).join('; ')}`),
                releaseSent
            )
        return captured
    }

    /** A refused release took nothing: report the camera's answer as a refusal, not an unknown outcome. */
    private assertReleaseAccepted(code: number, operation: string): void {
        if (code === OutOfFocus.code)
            throw new CameraRefusedError('takePhoto', 'The camera could not focus, so no photo was taken (Nikon OutOfFocus)')
        if (code !== OK.code) throw shutterRefused(nikonResponseError(code, operation))
    }

    /**
     * The new card file this release wrote, from the ObjectAdded events Nikon queues for it (the
     * event queue is drained before the release, so an older file never counts). Folders are
     * skipped. Of a RAW+JPEG pair the JPEG is preferred: when the first file is not a JPEG, its
     * pair may be announced in a later poll, so polling continues for a short bounded grace before
     * the first file is taken. Never deletes or rewrites card files.
     */
    private async readCapturedCardImage(handles: number[], includeData: boolean) {
        const deadline = Date.now() + NIKON_CARD_FILE_TIMEOUT_MS
        const inspected = new Map<number, ObjectInfo | null>()
        let pairDeadline: number | undefined
        while (Date.now() < deadline) {
            for (const event of await this.pollEvents()) {
                const handle = event.parameters[0]
                if (event.code === this.registry.events.ObjectAdded.code && handle && !handles.includes(handle))
                    handles.push(handle)
            }
            for (const handle of handles) {
                if (inspected.has(handle)) continue
                const response = await this.send(this.registry.operations.GetObjectInfo, { ObjectHandle: handle })
                this.assertNikonResponse(response.code, 'GetObjectInfo')
                const info = response.data
                if (!info) throw new Error('Nikon card image metadata is missing')
                const file = info.associationType === 0 && info.objectFormat !== 0x3001 && info.objectCompressedSize > 0
                inspected.set(handle, file ? info : null)
            }
            const files = cardFiles(inspected)
            const jpeg = files.find(file => /\.jpe?g$/i.test(file.info.filename))
            if (files.length && !jpeg) pairDeadline ??= Math.min(deadline, Date.now() + NIKON_PAIR_GRACE_MS)
            const chosen = jpeg ?? (pairDeadline !== undefined && Date.now() >= pairDeadline ? files[0] : undefined)
            if (chosen) return this.readCardFile(chosen.handle, chosen.info, includeData)
            await this.waitMs(100)
        }
        const [first] = cardFiles(inspected)
        if (first) return this.readCardFile(first.handle, first.info, includeData)
        throw new Error('Nikon released the shutter, but no new image file appeared on the card within 15 seconds')
    }

    private async readCardFile(objectHandle: number, info: ObjectInfo, includeData: boolean) {
        if (!Number.isSafeInteger(info.objectCompressedSize) || info.objectCompressedSize > 512 * 1024 * 1024)
            throw new Error('Nikon card image size is invalid or exceeds the transfer bound')
        if (!includeData) return { info, objectHandle }
        return { info, data: await this.transferWholeObject(objectHandle, info, 'card'), objectHandle }
    }

    private async transferWholeObject(objectHandle: number, info: ObjectInfo, location: 'card' | 'memory') {
        const data = await this.getObject(objectHandle, info.objectCompressedSize)
        if (data.length !== info.objectCompressedSize)
            throw new Error(`Nikon ${location} image transfer length differs from its metadata`)
        return data
    }

    /** Transfer the new SDRAM object identified by Nikon's event queue; never reads or deletes card images. */
    private async readCapturedMemory(): Promise<{ info: ObjectInfo; data: Uint8Array }> {
        const deadline = Date.now() + 15000
        while (Date.now() < deadline) {
            const ready = await this.send(this.registry.operations.DeviceReady, {})
            if (ready.code !== OK.code && ready.code !== DeviceBusy.code && ready.code !== SilentReleaseBusy.code)
                this.assertNikonResponse(ready.code, 'DeviceReady during memory capture')
            if (ready.code === SilentReleaseBusy.code) {
                await this.waitMs(10)
                continue
            }
            // Another poll (an event listener's pump) may have drained the queue first; its
            // announcements are kept, so a capture never loses its object.
            await this.pollEvents()
            const handle = this.announcedSdramObjects.shift()
            if (handle !== undefined) {
                const response = await this.send(this.registry.operations.GetObjectInfo, { ObjectHandle: handle })
                this.assertNikonResponse(response.code, 'GetObjectInfo')
                const info = response.data
                const size = info?.objectCompressedSize ?? 0
                if (!info || !Number.isSafeInteger(size) || size <= 0 || size > 128 * 1024 * 1024)
                    throw new Error('Nikon memory image metadata is missing or exceeds the transfer bound')
                return { info, data: await this.transferWholeObject(handle, info, 'memory') }
            }
            await this.waitMs(100)
        }
        throw new Error('Nikon did not report a new SDRAM image within 15 seconds')
    }

    /** Live view carries no ObjectInfo on Nikon; `includeInfo` is accepted for the shared capture options. */
    async captureLiveView({ includeData = true }: { includeInfo?: boolean; includeData?: boolean } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
        nikonMetadata?: NikonLiveViewMetadata
    }> {
        if (this.transport.getType() === TransportType.IP) await this.changeCameraMode('REMOTE')
        await this.enableLiveView()
        if (!includeData) return { data: undefined }
        const operation = this.registry.operations.GetLiveViewImageEx
        let response: Awaited<ReturnType<typeof this.send<typeof operation>>> | undefined
        for (let attempt = 0; attempt < 20; attempt += 1) {
            response = await this.send(operation, {}, undefined, this.liveViewBufferSize + this.bufferPadding)
            if (response.code === NotLiveView.code) {
                this.liveViewStatus = 'OFF'
                await this.enableLiveView()
                continue
            }
            if (response.code !== DeviceBusy.code) break
            await this.waitMs(10)
        }
        if (!response || response.code !== OK.code || !response.data?.liveViewImage)
            throw new Error(`Nikon GetLiveViewImageEx failed with response ${response ? `0x${response.code.toString(16)}` : 'unknown'}`)
        const { liveViewImage, reserved, afFrameData, autoCaptureSubjectDetection, reservedEnd, ...metadata } = response.data
        return { data: liveViewImage, nikonMetadata: metadata }
    }

    private async deviceInformation(): Promise<DeviceInfo> {
        const response = await this.send(this.registry.operations.GetDeviceInfo, {})
        if (response.code !== OK.code || !Array.isArray(response.data?.operationsSupportedRaw))
            throw new PTPResponseError(response.code, 'Nikon operation capabilities could not be read', {
                operation: 'GetDeviceInfo',
            })
        return response.data
    }

    private async requireFocusOperations(operations: readonly OperationDefinition[]): Promise<void> {
        const supported = (await this.deviceInformation()).operationsSupportedRaw
        const missing = operations.find(operation => !supported.includes(operation.code))
        if (missing) throw new CameraUnsupportedError(missing.name, `The Nikon does not advertise ${missing.name}`)
    }

    /** Read the advertised extended-property IDs; this does not read or write their values. */
    async getVendorPropertyCodes(): Promise<number[]> {
        const operation = this.registry.operations.GetVendorCodes
        await this.requireFocusOperations([operation])
        const response = await this.send(operation, { Kind: 13 }, undefined, 4 + NIKON_VENDOR_CODES_MAXIMUM * 4 + 12)
        const data = response.data
        if (response.code !== OK.code || !(data instanceof Uint8Array) || data.length < 4)
            throw new Error('Nikon vendor property enumeration failed')
        const codes = decodeNikonVendorCodes(data, this.transport.isLittleEndian())
        if (!codes) throw new Error('Nikon vendor property enumeration returned an invalid array length')
        return codes
    }

    /** The advertised operations each focus action needs, live view included. */
    private focusOperations(action: 'autofocus' | 'focusPoint' | 'nudge') {
        const operations = this.registry.operations
        const liveView = [operations.DeviceReady, operations.StartLiveView, operations.GetLiveViewImageEx]
        const drive = { autofocus: [operations.AfDrive, operations.AfDriveCancel], focusPoint: [operations.ChangeAfArea], nudge: [operations.MfDrive] }
        return [...drive[action], ...liveView]
    }

    private async freshFocusMetadata(): Promise<NikonLiveViewMetadata> {
        const frame = await this.captureLiveView({ includeInfo: false, includeData: true })
        if (!frame.nikonMetadata) throw new Error('Nikon live view returned no focus metadata')
        return frame.nikonMetadata
    }

    /** Return fresh camera focus evidence; command completion alone does not establish focus lock. */
    async performAutofocus(timeoutMilliseconds = 5000): Promise<NikonFocusResult> {
        if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 100 || timeoutMilliseconds > 10000)
            throw new Error('Nikon autofocus timeout must be 100–10000 milliseconds')
        const operations = this.registry.operations
        await this.requireFocusOperations(this.focusOperations('autofocus'))
        await this.enableLiveView()
        const response = await this.send(operations.AfDrive, {})
        if (response.code !== OK.code && response.code !== OutOfFocus.code)
            throw new CameraRefusedError('autofocus', `Nikon AfDrive failed with response 0x${response.code.toString(16)}`)
        let completion: number = response.code
        try {
            if (completion === OK.code) completion = await this.pollDeviceReady(timeoutMilliseconds, [OutOfFocus.code])
        } catch (error) {
            const cancel = await this.send(operations.AfDriveCancel, {}).catch(() => undefined)
            const cancelled = cancel?.code === OK.code
            throw new CameraOutcomeUnknownError('autofocus', cancelled
                ? `Nikon autofocus did not complete and was cancelled: ${errorMessage(error)}`
                : 'Nikon autofocus did not complete and cancellation was not confirmed')
        }
        const metadata = await this.freshFocusMetadata()
        const focusAcquired = completion === OK.code && metadata.focusingJudgementResult === 2 && metadata.focusDrivingStatus === 0
        return { commandSent: true, focusAcquired, metadata }
    }

    /** Coordinates are normalized over the fresh Nikon whole-size AF plane, independent of JPEG resolution. */
    async touchFocus(x: number, y: number, options: { focus?: boolean } = {}): Promise<NikonFocusPointResult> {
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
            throw new Error('Nikon focus coordinates must be normalized between 0 and 1')
        if (options.focus !== undefined && typeof options.focus !== 'boolean')
            throw new Error('Nikon focus must be true or false')
        const operations = this.registry.operations
        await this.requireFocusOperations([
            ...this.focusOperations('focusPoint'),
            ...(options.focus === false ? [] : [operations.AfDrive, operations.AfDriveCancel]),
        ])
        const before = await this.freshFocusMetadata()
        const width = before.wholeSize?.horizontal,
            height = before.wholeSize?.vertical
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2)
            throw new Error('Nikon live view returned invalid AF coordinate dimensions')
        const deviceX = Math.round(x * (width - 1)),
            deviceY = Math.round(y * (height - 1))
        const response = await this.send(operations.ChangeAfArea, { X: deviceX, Y: deviceY })
        if (response.code !== OK.code)
            throw new CameraRefusedError('setFocusPoint', `Nikon ChangeAfArea failed with response 0x${response.code.toString(16)}`)
        await this.pollDeviceReady()
        const focus = options.focus === false ? undefined : await this.performAutofocus()
        const metadata = focus?.metadata ?? (await this.freshFocusMetadata())
        const halfFrame = (size: number | undefined) => Math.max(1, Math.floor((size || 0) / 2))
        const tolerance = { x: halfFrame(metadata.afFrameSize?.horizontal), y: halfFrame(metadata.afFrameSize?.vertical) }
        const center = metadata.afFrameCenterCoords
        const positionVerified =
            metadata.wholeSize?.horizontal === width &&
            metadata.wholeSize?.vertical === height &&
            Number.isFinite(center?.horizontal) &&
            Number.isFinite(center?.vertical) &&
            Math.abs(center.horizontal - deviceX) <= tolerance.x &&
            Math.abs(center.vertical - deviceY) <= tolerance.y
        return {
            commandSent: true,
            positionVerified,
            normalized: { x, y },
            x: deviceX,
            y: deviceY,
            width,
            height,
            tolerance,
            metadata,
            ...(focus ? { focus } : {}),
        }
    }

    /**
     * One MfDrive, confirmed by DeviceReady. MfDriveStepEnd, at the start (the lens is already at
     * that end, nothing moved) or on completion (it moved until its end stop), is a completed drive
     * at the lens travel limit, not a failure.
     */
    async driveFocus(
        direction: 'near' | 'far',
        steps = 1
    ): Promise<{ commandSent: true; completed: true; atLimit: boolean; metadata: NikonLiveViewMetadata }> {
        if (!['near', 'far'].includes(direction) || !Number.isInteger(steps) || steps < 1 || steps > 32767)
            throw new Error('Nikon manual focus requires near/far and 1–32767 lens steps')
        const operations = this.registry.operations
        await this.requireFocusOperations(this.focusOperations('nudge'))
        await this.enableLiveView()
        const response = await this.send(operations.MfDrive, { Direction: direction === 'near' ? 1 : 2, Steps: steps })
        // Only InvalidStatus says the body's state forbids a drive; the bench Z6 III refuses one in MF.
        const advice = (code: number) => (code === InvalidStatus.code ? '. Manual focus drive needs an autofocus mode such as AF-S, not MF' : '')
        let atLimit = response.code === MfDriveStepEnd.code
        if (response.code !== OK.code && !atLimit)
            throw new CameraRefusedError('nudgeFocus', `Nikon MfDrive failed: ${this.responseDescription(response.code)}${advice(response.code)}`)
        if (!atLimit) {
            const completion = await this.pollDeviceReady(5000, [MfDriveStepEnd.code]).catch(error => {
                const code = error instanceof PTPResponseError ? error.code : undefined
                throw new CameraOutcomeUnknownError('nudgeFocus', `Nikon MfDrive completion failed: ${errorMessage(error)}${code === undefined ? '' : advice(code)}`)
            })
            atLimit = completion === MfDriveStepEnd.code
        }
        return { commandSent: true, completed: true, atLimit, metadata: await this.freshFocusMetadata() }
    }

    /** Retain remote Manual exposure across this session's movie-start renewal.
     * Explicit opt-in: ordinary recordings continue to follow the body dial.
     */
    async prepareManualVideoExposure() {
        if ((await this.get(this.registry.properties.LiveViewSelector)) !== 'VIDEO')
            throw new Error('Nikon remote Manual video exposure requires video mode')
        const result = await prepareNikonManualExposure(this)
        this.cameraMode = 'REMOTE'
        this.manualVideoExposureRequested = true
        return result
    }

    /** Checks the current prohibition bitfield and command result; a successful command still needs recording readback by its caller. */
    async sendStartRecording(): Promise<void> {
        const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
        if (condition.includes('alreadyRecording'))
            throw new Error('Nikon is already recording; its session was preserved')
        // USB card inspection can leave the body refusing application mode in this session: renew it while idle.
        // Wi-Fi keeps its authenticated session.
        if (this.transport.getType() !== TransportType.IP && this.applicationMode !== 'ON' && this.sessionId !== null) {
            await this.waitForImageBufferReady()
            const takeSession = this.takeSession()
            const nextSession = (this.sessionId + 1) >>> 0 || 1
            const closed = await this.send(this.registry.operations.CloseSession, {})
            if (closed.code !== OK.code)
                throw new Error(`Nikon movie session close failed: ${this.responseDescription(closed.code)}`)
            this.sessionId = null
            const opened = await this.send(this.registry.operations.OpenSession, { SessionID: nextSession })
            if (opened.code !== OK.code)
                throw new Error(`Nikon movie session open failed: ${this.responseDescription(opened.code)}`)
            this.sessionId = nextSession
            this.#movieSessionRenewal = { renewed: nextSession, original: takeSession }
            this.forgetObservedModes()
        }
        if (this.transport.getType() === TransportType.IP) await this.changeCameraMode('REMOTE')
        if (this.manualVideoExposureRequested) await this.prepareManualVideoExposure()
        await this.getLiveViewStatus()
        await this.pollDeviceReady()

        let ownsLiveView = false,
            ownsApplicationMode = false,
            ownsRemoteMode = false,
            ownsVideoMode = false
        try {
            if (this.liveViewMode === 'PHOTO') {
                ownsRemoteMode = this.cameraMode !== 'REMOTE'
                await this.changeCameraMode('REMOTE')
                ownsVideoMode = true
                await this.selectLiveViewMode('VIDEO')
            } else if (this.liveViewMode !== 'VIDEO')
                throw new Error('Nikon live-view selector is unknown; recording was not started')
            ownsLiveView = this.liveViewStatus !== 'ON'
            await this.enableLiveView()
            ownsApplicationMode = this.applicationMode !== 'ON'
            await this.changeApplicationMode('ON')
            await this.waitForImageBufferReady()
            const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            if (prohibitionCondition !== 'none') throw new Error(`Movie recording is prohibited: ${prohibitionCondition}`)
            const response = await this.send(this.registry.operations.StartMovieRecord, {})
            if (response.code !== OK.code) throw failedWithResponse(response.code, 'StartMovieRecord')
        } catch (error) {
            // A refused Start can still leave the body recording; only a fresh idle observation permits restoration.
            const observed = await this.get(this.registry.properties.MovieRecProhibitionCondition).catch(() => undefined)
            if (observed === undefined || observed.includes('alreadyRecording')) throw error
            const failures: string[] = []
            const restore = (name: string, operation: () => Promise<void>) =>
                operation().catch(failure => void failures.push(`${name}: ${errorMessage(failure)}`))
            if (ownsLiveView) await restore('live view', () => this.disableLiveView())
            if (ownsApplicationMode) await restore('application mode', () => this.changeApplicationMode('OFF'))
            if (ownsVideoMode) await restore('photo mode', () => this.selectLiveViewMode('PHOTO'))
            if (ownsRemoteMode) await restore('camera mode', () => this.changeCameraMode('PC_CAMERA'))
            if (failures.length)
                throw new Error(`${errorMessage(error)}; Nikon recording setup cleanup failed: ${failures.join('; ')}`, {
                    cause: error,
                })
            throw error
        }
    }

    async sendStopRecording(): Promise<void> {
        const response = await this.send(this.registry.operations.EndMovieRecord, {})
        if (response.code !== OK.code) throw failedWithResponse(response.code, 'EndMovieRecord')
        await this.pollDeviceReady()
        const unconfirmed = 'Nikon movie stop was not confirmed within ten seconds; recording mode was preserved'
        await this.waitUntilProhibitionClears('alreadyRecording', 10000, 50, unconfirmed)
        await this.waitForImageBufferReady()
        await this.disableLiveView()
        await this.changeApplicationMode('OFF')
        await this.changeCameraMode('PC_CAMERA')
    }

    /** Downloads an object in chunks; onProgress reports bytes received after each chunk. */
    async getObject(
        objectHandle: number,
        objectSize: number,
        onProgress?: (receivedBytes: number, totalBytes: number) => void,
        signal?: AbortSignal
    ): Promise<Uint8Array> {
        if (!Number.isSafeInteger(objectSize) || objectSize < 0)
            throw new Error('Nikon object size must be a nonnegative safe integer')
        return this.downloadObjectChunks(
            objectHandle,
            objectSize,
            'GetPartialObjectEx',
            async (offset, bytesToRead) => {
                const [OffsetLower, OffsetUpper] = split64(offset)
                const [MaxSizeLower, MaxSizeUpper] = split64(bytesToRead)
                const parameters = { ObjectHandle: objectHandle, OffsetLower, OffsetUpper, MaxSizeLower, MaxSizeUpper }
                const chunk = await this.send(this.registry.operations.GetPartialObjectEx, parameters, undefined, bytesToRead + 12)
                this.assertNikonResponse(chunk.code, 'GetPartialObjectEx')
                return chunk.data
            },
            onProgress,
            signal
        )
    }

    private async changeCameraMode(mode: 'REMOTE' | 'PC_CAMERA'): Promise<void> {
        if (this.cameraMode === mode) return
        this.cameraMode = 'UNKNOWN'
        const response = await this.send(this.registry.operations.ChangeCameraMode, { Mode: mode })
        const failure = `Nikon ChangeCameraMode ${mode} failed: ${this.responseDescription(response.code)}`
        if (response.code !== OK.code) throw new PTPResponseError(response.code, failure, { operation: 'ChangeCameraMode' })
        this.cameraMode = mode
        await this.pollDeviceReady()
    }

    private async changeApplicationMode(mode: 'ON' | 'OFF'): Promise<void> {
        if (this.applicationMode === mode) return
        await this.sendApplicationMode(mode)
        this.applicationMode = mode
        await this.pollDeviceReady()
    }

    private async sendApplicationMode(mode: 'ON' | 'OFF'): Promise<void> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const response = await this.send(this.registry.operations.ChangeApplicationMode, { Mode: mode })
            if (response.code === OK.code) return
            const failure = `Nikon ChangeApplicationMode ${mode} failed: ${this.responseDescription(response.code)}`
            if (response.code !== AccessDenied.code) throw new Error(failure)
            // A denial may mean the body already has that state: accept only a fresh observation, else retry briefly.
            const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            const observed = condition.includes('notInApplicationMode') ? 'OFF' : 'ON'
            if (observed === mode) return
            if (attempt === 2) throw new Error(`${failure}; camera reports ${condition}`)
            await this.pollDeviceReady()
            await this.waitMs(250)
        }
    }

    private async enableLiveView(): Promise<void> {
        if (this.liveViewStatus === 'UNKNOWN') {
            try {
                const status = await this.get(this.registry.properties.LiveViewStatus)
                if (status !== 'ON' && status !== 'OFF') throw new Error('Nikon live-view status is unknown')
                this.liveViewStatus = status
            } catch (error) {
                const legacyEmpty = error instanceof Error && error.message === 'No data received from GetDevicePropDescEx'
                if (!isUnsupportedProperty(error) && !legacyEmpty) throw error
            }
        }
        if (this.liveViewStatus === 'ON') return
        let response: { code: number } = await this.send(this.registry.operations.StartLiveView, {})
        if (response.code === HardwareError.code) response = await this.startLiveViewAfterHardwareError(response.code)
        if (response.code !== OK.code && response.code !== DeviceBusy.code)
            throw new PTPResponseError(response.code, `Nikon StartLiveView failed with response 0x${response.code.toString(16)}`)
        this.ownsLiveView = true
        this.liveViewStartPending = true
        await this.pollDeviceReady()
        this.liveViewStatus = 'ON'
        this.liveViewStartPending = false
    }

    /**
     * StartLiveView answered HardwareError: clear a sequence error once (one release, never repeated), then
     * start again. A body still warming up refuses that release too; then only StartLiveView is sent again,
     * with growing pauses, until it is accepted or NIKON_WARM_UP_MS has passed, which ends in the same
     * not-ready refusal. Nothing that can take a photo is repeated.
     */
    private async startLiveViewAfterHardwareError(code: number): Promise<{ code: number }> {
        let notReady: PTPResponseError
        try {
            if (!(await this.recoverSequenceError())) return { code }
            return await this.send(this.registry.operations.StartLiveView, {})
        } catch (error) {
            if (!(error instanceof PTPResponseError) || error.message !== NIKON_NOT_READY) throw error
            notReady = error
        }
        const deadline = Date.now() + NIKON_WARM_UP_MS
        for (let delay = 1000; Date.now() < deadline; delay = Math.min(delay * 2, NIKON_WARM_UP_MAX_DELAY_MS)) {
            await this.waitMs(Math.min(delay, Math.max(0, deadline - Date.now())))
            const response = await this.send(this.registry.operations.StartLiveView, {})
            if (response.code !== HardwareError.code) return response
        }
        throw notReady
    }

    /**
     * Nikon Z5_2 USB/MTP §11.7.5: a release command clears a recoverable sequence
     * error without starting an exposure. Never use it for an unspecified hardware
     * error, other warning bits, an active movie/buffer, or an unadvertised command.
     * A physical user may clear the warning concurrently, so a caller requesting
     * this recovery must allow a shutter release. No command is retried.
     */
    async recoverSequenceError(): Promise<boolean> {
        if (this.transport.getType() !== TransportType.USB) return false
        const information = await this.deviceInformation()
        if (!information.operationsSupportedRaw.includes(0x9207)) return false
        const warning = this.registry.properties.NikonWarningStatus
        if (!information.devicePropertiesSupported.includes(warning.code)) {
            if (!information.operationsSupportedRaw.includes(this.registry.operations.GetVendorCodes.code)) return false
            if (!(await this.getVendorPropertyCodes()).includes(warning.code)) return false
        }
        if ((await this.get(warning)) !== 1) return false
        const movie = await this.get(this.registry.properties.MovieRecProhibitionCondition)
        if (movie.includes('alreadyRecording') || movie.includes('imagesInBuffer')) return false
        // Refresh immediately before the release: an old cache or another fault cannot authorize it.
        if ((await this.get(warning)) !== 1) return false
        const released = await this.send(this.registry.operations.InitiateCaptureRecInMedia, { AfMode: 0xffffffff, Target: 0 })
        // Right after power-on a Z5 II refused live view and this release alike with HardwareError while
        // WarningStatus stayed 1, and worked minutes later: the camera is not ready, and nothing was taken.
        // Live view waits for it (startLiveViewAfterHardwareError); this release is never sent again.
        if (released.code === HardwareError.code) throw new PTPResponseError(released.code, NIKON_NOT_READY)
        this.assertNikonResponse(released.code, 'sequence-error shutter release')
        await this.pollDeviceReady()
        const observed = await this.get(warning)
        if (observed !== 0)
            throw new Error(`Nikon sequence-error recovery did not clear WarningStatus (0x${observed.toString(16)})`)
        return true
    }

    private async getLiveViewStatus(): Promise<void> {
        const liveViewStatus = await this.get(this.registry.properties.LiveViewStatus)
        await this.pollDeviceReady()
        if (liveViewStatus !== 'ON' && liveViewStatus !== 'OFF') throw new Error('Nikon live-view status is unknown')
        this.liveViewStatus = liveViewStatus
        const liveViewMode = await this.get(this.registry.properties.LiveViewSelector)
        await this.pollDeviceReady()
        if (liveViewMode !== 'VIDEO' && liveViewMode !== 'PHOTO') throw new Error('Nikon live-view selector is unknown')
        this.liveViewMode = liveViewMode
    }

    private async disableLiveView(): Promise<void> {
        if (this.liveViewStatus !== 'ON' && !this.liveViewStartPending) return
        const response = await this.send(this.registry.operations.EndLiveView, {})
        if (response.code !== OK.code && response.code !== NotLiveView.code)
            throw new PTPResponseError(response.code, `Nikon EndLiveView failed with response 0x${response.code.toString(16)}`)
        await this.pollDeviceReady()
        this.liveViewStatus = 'OFF'
        this.liveViewStartPending = false
        this.ownsLiveView = false
    }

    private responseDescription(code: number): string {
        const name = Object.values(this.registry.responses).find(response => response.code === code)?.name
        return `${name || 'UnknownResponse'} (0x${code.toString(16)})`
    }

    /** Nikon activation commands may return DeviceBusy while pending; other refusals are terminal. */
    private async pollDeviceReady(
        timeoutMilliseconds = 5000,
        acceptedResponses: readonly number[] = [],
        pendingResponses: readonly number[] = []
    ): Promise<number> {
        const deadline = Date.now() + timeoutMilliseconds
        while (Date.now() < deadline) {
            const response = await this.send(this.registry.operations.DeviceReady, {})
            if (response.code === OK.code || acceptedResponses.includes(response.code)) return response.code
            if (response.code !== DeviceBusy.code && !pendingResponses.includes(response.code))
                throw new PTPResponseError(response.code, `Nikon DeviceReady failed: ${this.responseDescription(response.code)}`, {
                    operation: 'DeviceReady',
                })
            await this.waitMs(10)
        }
        throw new Error('Nikon DeviceReady timed out')
    }

    /**
     * @internal Switch photo/video (LiveViewSelector) for the generic photoVideoMode setting, the
     * way every other selector change in this driver does (see `setStandardProperty`): in REMOTE
     * mode, after ending an active live view, waiting for DeviceReady. The previous live view and
     * PC-camera mode are restored afterwards, whether or not the camera took the selector. The
     * caller confirms the readback; the selector is sent once.
     */
    override async sendPhotoVideoMode(requested: PhotoVideoMode): Promise<void> {
        return this.selectPhotoVideoMode(requested === 'video' ? 'VIDEO' : 'PHOTO')
    }

    async selectPhotoVideoMode(mode: 'PHOTO' | 'VIDEO'): Promise<void> {
        await this.getLiveViewStatus()
        // A failed restoration leaves the body's mode unknown, whatever the selector did.
        await this.inRemoteMode(
            () => this.selectLiveViewMode(mode, true),
            undefined,
            (error, failure) => {
                const restoration = new CameraOutcomeUnknownError(
                    'photoVideoMode',
                    `Restoring Nikon live view and camera mode after the photo/video switch failed: ${String(error)}` +
                        (failure ? `; the switch itself failed: ${String(failure)}` : '')
                )
                restoration.cause = failure ? new AggregateError([failure, error]) : error
                return restoration
            }
        )
    }

    /** A failed activation may still have changed the selector; forced restoration sends the original value despite stale caches. */
    private async selectLiveViewMode(mode: 'PHOTO' | 'VIDEO', force = false): Promise<void> {
        if (!force && this.liveViewMode === mode) return
        await this.disableLiveView()
        this.liveViewMode = 'UNKNOWN'
        await this.set(this.registry.properties.LiveViewSelector, mode)
        await this.pollDeviceReady()
        this.liveViewMode = mode
    }

    private waitForImageBufferReady(timeoutMilliseconds = 5000): Promise<void> {
        const failure = `Nikon image buffer did not become ready within ${timeoutMilliseconds} milliseconds`
        return this.waitUntilProhibitionClears('imagesInBuffer', timeoutMilliseconds, 100, failure)
    }

    /** Polls fresh prohibition reads only; the command that should clear the flag is never resent. */
    private async waitUntilProhibitionClears(flag: string, timeoutMilliseconds: number, intervalMilliseconds: number, failure: string) {
        const deadline = Date.now() + timeoutMilliseconds
        while ((await this.get(this.registry.properties.MovieRecProhibitionCondition)).includes(flag)) {
            if (Date.now() >= deadline) throw new Error(failure)
            await this.waitMs(intervalMilliseconds)
        }
    }

    private assertNikonResponse(code: number, operation: string): void {
        if (code !== OK.code) throw nikonResponseError(code, operation)
    }

    #eventListeners = 0
    #eventTimer?: ReturnType<typeof setTimeout>
    #recording?: VideoCapability
    /** Card objects announced while a recording waits for its clip; undefined when none waits. */
    #announcedCardObjects?: number[]
    /** Sending Record may renew an idle USB session; the take still belongs to the session it started in. */
    #movieSessionRenewal?: { renewed: number; original: number | null }

    /**
     * Nikon queues events until GetEventEx reads them, and opening a camera starts no background
     * poll. The pump runs only while at least one listener exists, so a camera nobody listens to
     * keeps its queue for the operations that read it; a capture keeps its own announcements either way.
     */
    override subscribe(event: CameraEventName, handler: CameraEventHandler): () => void {
        const stopEmitted = super.subscribe(event, handler)
        if (++this.#eventListeners === 1 && !this.#eventTimer) this.scheduleEventPoll()
        let attached = true
        return () => {
            if (!attached) return
            attached = false
            stopEmitted()
            if (--this.#eventListeners > 0) return
            clearTimeout(this.#eventTimer)
            this.#eventTimer = undefined
        }
    }

    private scheduleEventPoll(): void {
        this.#eventTimer = setTimeout(async () => {
            this.#eventTimer = undefined
            if (this.#eventListeners === 0) return
            if (this.sessionId !== null) await this.pollEvents().catch(() => undefined)
            if (this.#eventListeners > 0 && !this.#eventTimer) this.scheduleEventPoll()
        }, NIKON_EVENT_POLL_INTERVAL_MILLISECONDS)
    }

    async autofocus(): Promise<FocusResult> {
        return publicOutcome('autofocus', async () => ((await this.performAutofocus()).focusAcquired ? 'acquired' : 'not-acquired'))
    }

    async setFocusPoint(x: number, y: number, options: FocusPointOptions): Promise<void> {
        requirePoint(x, y)
        await publicOutcome('setFocusPoint', () => this.usePositionedFocusArea())
        const placed = await publicOutcome('setFocusPoint', () => this.touchFocus(x, y, { focus: options.autofocus }))
        if (!placed.positionVerified)
            throw new CameraOutcomeUnknownError(
                'setFocusPoint',
                `The Nikon accepted the focus point but its live view reports the AF frame elsewhere (${placed.metadata.afFrameCenterCoords?.horizontal}, ${placed.metadata.afFrameCenterCoords?.vertical})`
            )
    }

    async resetFocusPoint(): Promise<void> {
        await this.focusPointChanges()
        await publicOutcome('resetFocusPoint', () =>
            restoreAll('resetFocusPoint', [
                async () => void (await this.touchFocus(0.5, 0.5, { focus: false })),
                ...this.focusRestoreSteps(),
            ])
        )
    }

    /**
     * Auto-area AF picks its own point: a bench Z5 II in auto-area accepted ChangeAfArea and then
     * showed its AF frame at (0, 0). So a focus point first switches the AF-area mode (FocusMeteringMode,
     * where the body advertises it) to an advertised Single-point or Pinpoint and remembers the area,
     * as Canon does. A body in auto-area that cannot be switched is refused before any focus command.
     */
    private async usePositionedFocusArea(): Promise<void> {
        const property = this.registry.properties.FocusMeteringMode
        if ((await this.deviceInformation()).devicePropertiesSupported.includes(property.code)) {
            const descriptor = await this.propertyDescriptor(property)
            const area = String(descriptor.currentValueDecoded)
            if (area !== NIKON_AUTO_AREA) return
            const offered = (recognizedDescriptorValues(descriptor).allowedValues ?? []).map(String)
            const point = NIKON_FOCUS_POINT_AREAS.find(candidate => offered.includes(candidate))
            if (descriptor.getSet !== 'GET_SET' || !point) throw new CameraUnsupportedError('setFocusPoint', nikonAutoAreaReason)
            const changes = await this.focusPointChanges()
            await this.set(property, point)
            changes.changed(property.name, area, point)
            return
        }
        await this.requireFocusOperations(this.focusOperations('focusPoint'))
        if (await this.liveViewInAutoArea()) throw new CameraUnsupportedError('setFocusPoint', nikonLiveViewAutoAreaReason)
    }

    /**
     * A body without FocusMeteringMode (the bench Z5 II, which also uses auto-area in AF-A) shows its
     * AF-area mode only in live view: LiveViewObject afModeState 2 is auto-area AF.
     */
    private async liveViewInAutoArea(): Promise<boolean> {
        return (await this.freshFocusMetadata()).afModeState === NIKON_AUTO_AREA_STATE
    }

    /**
     * Whether live view is running, read from LiveViewStatus when this session has not seen it. A
     * body without that property is not known to be in live view.
     */
    private async liveViewRunning(): Promise<boolean> {
        if (this.liveViewStatus === 'UNKNOWN') {
            const status = await this.get(this.registry.properties.LiveViewStatus).catch(() => undefined)
            if (status === 'ON' || status === 'OFF') this.liveViewStatus = status
        }
        return this.liveViewStatus === 'ON'
    }

    /** The AF-area mode a focus point replaced, put back where the body still shows the one it chose. */
    private focusRestoreSteps(): (() => Promise<void>)[] {
        const property = this.registry.properties.FocusMeteringMode
        return this.focusChanges.restoreSteps(
            async () => String(await this.get(property)),
            async (_name, value) => {
                const area = NIKON_FOCUS_AREAS.find(candidate => candidate === value)
                if (area) await this.set(property, area)
            }
        )
    }

    /** This body's focus-point record, joined by its serial number once the body has been identified. */
    private async focusPointChanges(): Promise<FocusPointChanges> {
        const info = await this.getInfo().catch(() => undefined)
        if (info) this.focusChanges.identify(info)
        return this.focusChanges
    }

    settingWritten(id: CameraControlId): void {
        if (id === 'focusArea') this.focusChanges.forget(this.registry.properties.FocusMeteringMode.name)
    }

    async nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<FocusNudge> {
        requireNudge(direction, size)
        const { atLimit } = await publicOutcome('nudgeFocus', () => this.driveFocus(direction, NIKON_FOCUS_STEPS[size]))
        return { atLimit }
    }

    /**
     * The photo is confirmed by the card's ObjectAdded event after the bounded readout allowance,
     * and for 'computer' read back from the card.
     */
    async takePhoto({ autofocus, destination }: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile> {
        return classified(async confirmed => {
            const wantsData = destination === 'computer'
            const capture = await this.captureImage({ autofocus, includeInfo: true, includeData: wantsData, destination: 'card' })
            confirmed()
            return cardObjectFile(capture, wantsData)
        })
    }

    async getLiveViewFrame({ overlay }: { overlay: boolean }): Promise<LiveViewFrame> {
        if (overlay) throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
        return publicOutcome('getLiveViewFrame', async () => {
            const frame = await this.captureLiveView({ includeInfo: false })
            return { jpeg: requireImage(frame.data), focusFrames: nikonFocusFrames(frame.nikonMetadata) }
        })
    }

    async getRecordingState(): Promise<CameraRecordingState> {
        return this.recording().getRecordingState()
    }

    async startRecording(): Promise<void> {
        return this.recording().startRecording()
    }

    async stopRecording(): Promise<Clip> {
        return this.recording().stopRecording()
    }

    /**
     * Nikon's own Record prepares video mode, live view and application mode, checks the card
     * through its prohibition flags, and its Stop restores them once the movie is no longer
     * recording. The clip is the movie the camera announces with ObjectAdded; the card is not scanned.
     */
    private recording(): VideoCapability {
        return (this.#recording ??= recordingCapability({
            readState: async () => {
                const status = await readNikonRecordingStatus(this)
                return !status ? 'unknown' : status.recording ? 'recording' : status.bufferedImages ? 'stopping' : 'idle'
            },
            listHandles: async () => {
                // Announcements queued before this take must not count as its clip.
                await this.pollEvents()
                this.#announcedCardObjects = []
                return new Set()
            },
            findClip: () => this.announcedClip(),
            handleSession: () => this.takeSession(),
            sendStart: () => this.sendStartRecording(),
            sendStop: () => this.sendStopRecording(),
            serialize: cardSteps(this, this.requireOwner()).serialize,
        }))
    }

    /** The session a take belongs to, across Record's renewal of an idle USB session. */
    private takeSession(): number | null {
        return this.sessionId !== null && this.sessionId === this.#movieSessionRenewal?.renewed
            ? this.#movieSessionRenewal.original
            : this.sessionId
    }

    /** The finished movie among the objects announced since Record; a folder or photo is skipped. */
    private async announcedClip(): Promise<Clip> {
        const deadline = Date.now() + clipFinalizationMilliseconds
        const skipped = new Set<number>()
        try {
            for (;;) {
                await this.pollEvents()
                for (const objectHandle of this.#announcedCardObjects ?? []) {
                    if (skipped.has(objectHandle)) continue
                    const response = await this.send(this.registry.operations.GetObjectInfo, { ObjectHandle: objectHandle })
                    const info = response.data
                    if (response.code !== OK.code || !info) continue
                    if (info.associationType !== 0 || mediaKind(info.filename) !== 'clip') {
                        skipped.add(objectHandle)
                        continue
                    }
                    if (info.objectCompressedSize > 0) return this.clipFile(objectHandle, info)
                }
                if (Date.now() >= deadline)
                    throw new CameraClipNotFoundError(
                        'stopRecording',
                        `Recording stopped, but the camera announced no finished movie within ${clipFinalizationMilliseconds / 1000} seconds`
                    )
                await this.waitMs(250)
            }
        } finally {
            this.#announcedCardObjects = undefined
        }
    }

    /** A clip named with the id `listMedia()` gives the same card object. */
    private async clipFile(objectHandle: number, info: ObjectInfo): Promise<Clip> {
        const { objectCompressedSize: reported, filename: name, storageID: storageId } = info
        const mediaId = encodeMediaId({ source: 'object', storageId, objectHandle, name, ...(reported !== unstatedSize && { sizeBytes: reported }) })
        return { mediaId, name, sizeBytes: await this.fullObjectSize(objectHandle, reported, 'stopRecording') }
    }

    /** A card object's full size: ObjectInfo's 0xffffffff means Nikon's 64-bit GetObjectSize holds it. */
    async fullObjectSize(objectHandle: number, reportedBytes: number, operation = 'downloadMedia'): Promise<number> {
        if (reportedBytes !== unstatedSize) return reportedBytes
        const response = await this.send(this.registry.operations.GetObjectSize, { ObjectHandle: objectHandle })
        const value = response.data
        const size = typeof value === 'bigint' || typeof value === 'number' ? Number(value) : NaN
        if (response.code !== OK.code || !Number.isSafeInteger(size) || size < reportedBytes)
            throw new CameraRefusedError(operation, 'Nikon did not confirm the full 64-bit original size; transfer refused')
        return size
    }

    override async availability(
        operation: CameraOperationName,
        capabilities: CameraCapabilities
    ): Promise<OperationAvailability | undefined> {
        switch (operation) {
            case 'autofocus':
                return operationsAdvertised(capabilities, this.focusOperations('autofocus'))
            case 'setFocusPoint':
                return this.focusPointAvailability(capabilities)
            case 'resetFocusPoint':
                return operationsAdvertised(capabilities, this.focusOperations('focusPoint'))
            case 'nudgeFocus':
                return operationsAdvertised(capabilities, this.focusOperations('nudge'))
            case 'getLiveViewFrame':
                return { supported: true, options: { overlay: { supported: false, reason: overlayUnsupported } } }
            default:
                return super.availability(operation, capabilities)
        }
    }

    /**
     * The decision setFocusPoint makes, without changing anything: an advertised AF-area mode is judged
     * from its reading; otherwise from a live view that is already running. A body whose AF-area mode
     * shows only in live view, with live view off, is left unreported rather than called supported:
     * live view is not started to find out.
     */
    private async focusPointAvailability(capabilities: CameraCapabilities): Promise<OperationAvailability> {
        const advertised = operationsAdvertised(capabilities, this.focusOperations('focusPoint'))
        if (!advertised.supported) return advertised
        const area = capabilities.controls.focusArea
        if (area) {
            const switchable = area.writable && NIKON_FOCUS_POINT_CHOICES.some(choice => area.allowedValues?.includes(choice))
            return area.value === NIKON_AUTO_AREA_CHOICE && !switchable ? unsupported(nikonAutoAreaReason) : advertised
        }
        if (!(await this.liveViewRunning())) throw new Error('This Nikon shows its AF-area mode only in live view, which is off')
        return (await this.liveViewInAutoArea()) ? unsupported(nikonLiveViewAutoAreaReason) : advertised
    }
}

const cardFiles = (inspected: Map<number, ObjectInfo | null>) =>
    [...inspected.entries()].flatMap(([handle, info]) => (info ? [{ handle, info }] : []))

/** A 64-bit byte count as Nikon's lower and upper UINT32 parameter words. */
const split64 = (value: number) => [value & 0xffffffff, Math.floor(value / 0x100000000)] as const

/** The AF-area mode without a host position, and the ones a focus point switches to, in preference order. */
const NIKON_AUTO_AREA = 'Auto-area AF'
const NIKON_FOCUS_POINT_AREAS = ['Single-point AF', 'Pinpoint AF'] as const
const NIKON_FOCUS_AREAS = NIKON_AF_AREA_VALUES.map(entry => entry.name)
/** The same areas by their canonical names, as getCapabilities shows them. */
const NIKON_AUTO_AREA_CHOICE = 'Auto Area'
const NIKON_FOCUS_POINT_CHOICES = ['Single Point', 'Pinpoint']
/** LiveViewObject afModeState: 2 is auto-area AF (Nikon PTP reference §9.7.1). */
const NIKON_AUTO_AREA_STATE = 2
const nikonAutoAreaReason =
    'The camera is in auto-area AF, which picks its own focus point, and offers no single-point AF-area mode Slate can switch to; choose another AF-area mode on the camera'
const nikonLiveViewAutoAreaReason =
    'The camera is in auto-area AF, which picks its own focus point (AF-A uses it too), and does not let Slate change its AF-area mode; choose another AF-area mode or focus mode on the camera'

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const failedWithResponse = (code: number, operation: string) =>
    new PTPResponseError(code, `Nikon ${operation} failed with response 0x${code.toString(16)}`, { operation })

const nikonResponseError = (code: number, operation: string) =>
    new PTPResponseError(code, `Nikon ${operation} returned 0x${code.toString(16)}`, { operation })

/** Only OperationNotSupported permits the standard fallback; a refused property is not a missing operation. */
const standardFallback = (code: number, property: PropertyDefinition) =>
    code === OperationNotSupported.code && property.code >= 0 && property.code <= 0xffff

const isUnsupportedProperty = (error: unknown) =>
    error instanceof PTPResponseError && (error.code === OperationNotSupported.code || error.code === DevicePropNotSupported.code)

/**
 * Reports a failure of a Nikon operation that is not one of the three public errors: a refused
 * PTP response as CameraRefusedError, anything else as CameraOutcomeUnknownError, since a command
 * may already have moved the lens, the AF point or live view.
 */
async function publicOutcome<Result>(operation: string, action: () => Promise<Result>): Promise<Result> {
    try {
        return await action()
    } catch (error) {
        if (
            error instanceof CameraUnsupportedError ||
            error instanceof CameraRefusedError ||
            error instanceof CameraOutcomeUnknownError
        )
            throw error
        if (error instanceof PTPResponseError) throw new CameraRefusedError(operation, error.message, { cause: error })
        throw new CameraOutcomeUnknownError(operation, errorMessage(error), { cause: error })
    }
}

/** Nikon's AF frame, normalized over the displayed area so it lines up with the picture when magnified. */
function nikonFocusFrames(metadata: NikonLiveViewMetadata | undefined): FocusFrame[] {
    if (!metadata) return []
    const { afFrameCenterCoords: center, afFrameSize: size, displayAreaSize, displayCenterCoords, wholeSize } = metadata
    const display =
        displayAreaSize?.horizontal > 0 && displayAreaSize.vertical > 0 && displayCenterCoords
            ? {
                  left: displayCenterCoords.horizontal - displayAreaSize.horizontal / 2,
                  top: displayCenterCoords.vertical - displayAreaSize.vertical / 2,
                  width: displayAreaSize.horizontal,
                  height: displayAreaSize.vertical,
              }
            : wholeSize?.horizontal > 0 && wholeSize.vertical > 0
              ? { left: 0, top: 0, width: wholeSize.horizontal, height: wholeSize.vertical }
              : undefined
    if (!display || !center || !size || size.horizontal <= 0 || size.vertical <= 0) return []
    return [
        {
            kind: 'focus',
            // Nikon focusing judgement: 0 no information, 1 not focused, 2 focused.
            focused: metadata.focusingJudgementResult === 2,
            centerX: (center.horizontal - display.left) / display.width,
            centerY: (center.vertical - display.top) / display.height,
            width: size.horizontal / display.width,
            height: size.vertical / display.height,
        },
    ]
}
