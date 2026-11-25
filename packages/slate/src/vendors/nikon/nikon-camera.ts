import type { CameraCapabilities, CameraRecordingState, OperationAvailability } from '@camera/controls'
import type {
    CameraEventHandler,
    CameraEventName,
    Clip,
    ConfirmedPhotoFile,
    FocusDirection,
    FocusFrame,
    FocusPointOptions,
    FocusResult,
    FocusStepSize,
    LiveViewFrame,
    PhotoDestination,
} from '@camera/driver'
import {
    CameraClipNotFoundError,
    CameraOutcomeUnknownError,
    CameraRefusedError,
    CameraUnsupportedError,
} from '@camera/errors'
import type { CameraOperationName } from '@camera/driver'
import { Logger } from '@core/logger'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { DeviceBusy, OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { CodecType } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { TransportType } from '@transport/interfaces/transport-types'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import type { VideoCapability } from '@vendors/generic/capability-groups'
import { GenericCamera } from '@vendors/generic/generic-camera'
import {
    cardObjectFile,
    cardSteps,
    classified,
    clipFinalizationMilliseconds,
    operationsAdvertised,
    overlayUnsupported,
    requireImage,
    requireNudge,
    requirePoint,
    unstatedSize,
} from '@vendors/generic/generic-operations'
import { encodeMediaId, mediaKind } from '@vendors/generic/media-id'
import { recordingCapability } from '@vendors/generic/recording-lifecycle'
import {
    afterPossibleRelease,
    afterShutterRelease,
    shutterOutcomeUnknown,
    shutterRefused,
} from '@vendors/generic/shutter-outcome'
import type { NikonLiveViewDataset } from '@vendors/nikon/datasets/nikon-live-view-dataset'
import { ISOAutoControl } from '@vendors/nikon/definitions/nikon-operation-definitions'
import {
    HardwareError,
    NotLiveView,
    OutOfFocus,
    SilentReleaseBusy,
} from '@vendors/nikon/definitions/nikon-response-definitions'
import type { NikonQueuedEvent } from '@vendors/nikon/event-data'
import { prepareNikonManualExposure } from '@vendors/nikon/manual-exposure'
import { withNikonRawCompression } from '@vendors/nikon/raw-capture'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
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

    protected async verifyRecoveryState(information: DeviceInfo): Promise<void> {
        const supported = information.operationsSupportedRaw
        if (supported.includes(this.registry.operations.DeviceReady.code)) {
            await this.pollDeviceReady()
            return
        }
        if (![0x100e, 0x90c0, 0x9201, 0x9207, 0x920a].some(code => supported.includes(code)))
            throw new CameraRefusedError(
                'recover',
                'Nikon advertises file transfer without camera controls; inspect camera power and mode'
            )
    }

    /** @internal Closing a recording session restores Nikon's photo/application modes before Stop. */
    protected async existingRecordingSession(previousSessionId: number | null): Promise<number | undefined> {
        const status = await readNikonRecordingStatus(this)
        if (!status)
            throw new CameraOutcomeUnknownError(
                'connect',
                'Nikon existing session state is unreadable; its session was preserved'
            )
        if (!status.recording) return undefined
        const existing = previousSessionId ?? this.lostSessionId
        if (existing === undefined)
            throw new CameraOutcomeUnknownError('connect', 'Nikon is recording in an unknown session; its session was preserved')
        this.lostSessionId = undefined
        return existing
    }

    async disconnect(): Promise<void> {
        this.lostSessionId = !this.transport.isConnected() ? (this.sessionId ?? this.lostSessionId) : undefined
        if (!this.transport.isConnected()) {
            // A vanished transport cannot end live view; only local state is cleared.
            this.liveViewStatus = 'UNKNOWN'
            this.liveViewStartPending = false
            this.ownsLiveView = false
        }
        try {
            if (this.ownsLiveView || this.liveViewStartPending) await this.disableLiveView()
        } finally {
            this.cameraMode = 'UNKNOWN'
            this.liveViewMode = 'UNKNOWN'
            this.applicationMode = 'UNKNOWN'
            this.liveViewStatus = 'UNKNOWN'
            this.liveViewStartPending = false
            this.ownsLiveView = false
            this.manualVideoExposureRequested = false
            await super.disconnect()
        }
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return (await this.propertyDescriptor(property)).currentValueDecoded as CodecType<P['codec']>
    }

    /** Read one known descriptor. Callers must discover whether the current body advertises it. */
    async propertyDescriptor(property: PropertyDefinition): Promise<DevicePropDesc> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        let operationName = 'GetDevicePropDescEx'
        let response = await this.send(this.registry.operations.GetDevicePropDescEx, {
            DevicePropCode: property.code,
        })
        // Older Nikon bodies lack the four-byte extension but still implement standard PTP properties.
        // Only OperationNotSupported permits this fallback; a refused property is not a missing operation.
        if (response.code === 0x2005 && property.code >= 0 && property.code <= 0xffff) {
            operationName = 'GetDevicePropDesc'
            response = await this.send(this.registry.operations.GetDevicePropDesc, { DevicePropCode: property.code })
        }
        if (response.code !== OK.code) {
            throw new PTPResponseError(
                response.code,
                `Nikon ${operationName} returned 0x${response.code.toString(16)} for ${property.name} (0x${property.code.toString(16)})`,
                { operation: operationName }
            )
        }
        if (!response.data) {
            throw new Error(`No data received from ${operationName}`)
        }

        const descriptor = response.data

        if (!descriptor || typeof descriptor !== 'object' || !('currentValueDecoded' in descriptor)) {
            throw new Error('Invalid property descriptor structure')
        }
        if (descriptor.devicePropertyCode !== property.code)
            throw new PTPDecodeError(`Nikon ${operationName} returned a descriptor for a different property`)

        // Cast needed: TypeScript knows data exists but can't narrow to specific property's codec type
        return descriptor as DevicePropDesc
    }

    private async shutterDescriptor() {
        let mode: string
        try {
            mode = await this.get(this.registry.properties.LiveViewSelector)
        } catch (error) {
            if (error instanceof PTPResponseError && [0x2005, 0x200a].includes(error.code)) return undefined
            throw error
        }
        if (mode !== 'PHOTO' && mode !== 'VIDEO') throw new Error('Nikon shutter selector is unknown')
        const property =
            mode === 'PHOTO'
                ? this.registry.properties.NikonPhotoShutterSpeed
                : this.registry.properties.NikonMovieShutterSpeed
        try {
            const descriptor = await this.propertyDescriptor(property)
            if (descriptor.dataType !== 6 || typeof descriptor.currentValueRaw !== 'number')
                throw new Error('Invalid Nikon shutter descriptor datatype')
            return { property, descriptor, mode }
        } catch (error) {
            // A supported native property must never fall back after busy, denial or malformed data.
            if (error instanceof PTPResponseError && [0x2005, 0x200a].includes(error.code)) return undefined
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
                if (!(error instanceof PTPResponseError) || ![0x2005, 0x200a].includes(error.code)) throw error
            }
        }
        if (descriptor.getSet !== 'GET_SET' || descriptor.formFlag !== 2)
            throw new Error('Nikon shutter requires a writable advertised enumeration')
        const target = descriptor.supportedValuesRaw?.find(
            raw => typeof raw === 'number' && matchesNikonShutter(raw, value)
        )
        if (typeof target !== 'number') throw new Error('Requested Nikon shutter speed is not advertised')
        if ((await this.get(this.registry.properties.LiveViewSelector)) !== mode)
            throw new Error('Nikon photo/video mode changed before shutter write')
        await this.set(property, target)
        const observed = await this.propertyDescriptor(property)
        if (observed.currentValueRaw !== target)
            throw new CameraOutcomeUnknownError(
                'shutterSpeed',
                'Nikon shutter readback differs from the requested value'
            )
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) {
            throw new Error(`Property ${property.name} is not writable`)
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        let operationName = 'SetDevicePropValueEx'
        let response = await this.send(
            this.registry.operations.SetDevicePropValueEx,
            {
                DevicePropCode: property.code,
            },
            encodedValue
        )
        if (response.code === 0x2005 && property.code >= 0 && property.code <= 0xffff) {
            operationName = 'SetDevicePropValue'
            response = await this.send(
                this.registry.operations.SetDevicePropValue,
                { DevicePropCode: property.code },
                encodedValue
            )
        }
        if (response.code !== OK.code)
            throw new PTPResponseError(
                response.code,
                `Nikon ${property.name} write failed: ${this.responseDescription(response.code)}`,
                { operation: operationName }
            )
    }

    /** Photo quality remains configurable while the physical selector is in video mode. */
    async setStandardProperty(name: string | number, value: string | number): Promise<void> {
        const photoProperty = ['compressionsetting', 'imagesize', '0x5003', '0x5004', '20483', '20484'].includes(
            String(name).toLowerCase()
        )
        if (!photoProperty) return super.setStandardProperty(name, value)
        await this.getLiveViewStatus()
        if (this.liveViewMode !== 'VIDEO') return super.setStandardProperty(name, value)
        const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
        if (condition.includes('alreadyRecording'))
            throw new Error('Nikon photo settings cannot interrupt an active recording')
        const restoreLiveView = this.liveViewStatus === 'ON'
        const restoreLiveViewOwnership = this.ownsLiveView
        const restorePcMode = this.cameraMode !== 'REMOTE'
        let failure: unknown
        try {
            await this.enableRemoteMode()
            await this.selectLiveViewMode('PHOTO')
            await super.setStandardProperty(name, value)
        } catch (error) {
            failure = error
            throw error
        } finally {
            try {
                await this.selectLiveViewMode('VIDEO', true)
                if (restoreLiveView) await this.enableLiveView()
                this.ownsLiveView = restoreLiveViewOwnership
                if (restorePcMode) await this.enablePcCameraMode()
            } catch (error) {
                if (failure)
                    throw new AggregateError(
                        [failure, error],
                        `${String(failure)}; restoring Nikon movie mode: ${String(error)}`
                    )
                throw error
            }
        }
    }

    /** Drain one event batch explicitly; opening a camera does not start a background poll. */
    async pollEvents(): Promise<NikonQueuedEvent[]> {
        const extended = await this.send(this.registry.operations.GetEventEx, {})
        let events: NikonQueuedEvent[]
        if (extended.code === 0x2005) {
            const legacy = await this.send(this.registry.operations.GetEvent, {})
            if (legacy.code !== OK.code) throw new PTPResponseError(legacy.code, undefined, { operation: 'GetEvent' })
            if (!Array.isArray(legacy.data)) throw new Error('Nikon GetEvent returned no event dataset')
            events = legacy.data.map(event => ({ code: event.code, parameters: [event.parameter] }))
        } else {
            if (extended.code !== OK.code)
                throw new PTPResponseError(extended.code, undefined, { operation: 'GetEventEx' })
            if (!Array.isArray(extended.data)) throw new Error('Nikon GetEventEx returned no event dataset')
            events = extended.data.map(event => ({ code: event.code, parameters: [...event.parameters] }))
        }
        for (const event of events) {
            const handle = event.parameters[0]
            if (event.code === this.registry.events.ObjectAddedInSdram.code && handle !== undefined)
                this.announcedSdramObjects.push(Number(handle))
            if (event.code === this.registry.events.ObjectAdded.code && handle !== undefined)
                this.#announcedCardObjects?.push(Number(handle))
            this.handleEvent({ ...event, transactionId: 0 })
        }
        return events
    }

    async getIso(): Promise<string> {
        if ((await this.get(ISOAutoControl)) === 'ON') return 'ISO AUTO'
        return super.getIso()
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
    ): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
        /** The card object's handle, for a card capture. */
        objectHandle?: number
    }> {
        const memory = options.destination === 'memory'
        if (memory && options.includeData === false)
            throw new Error('Memory capture requires transfer so the new SDRAM image can be released')
        // Wi-Fi control must retain its authenticated remote session, as live view does.
        if (this.transport.getType() === TransportType.IP) await this.enableRemoteMode()
        let info: ObjectInfo | undefined
        let data: Uint8Array | undefined
        let objectHandle: number | undefined
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
            if (!memory && options.autofocus !== false) {
                releaseSent = true
                const response = await this.send(this.registry.operations.InitiateCapture, {})
                this.assertReleaseAccepted(response.code, 'InitiateCapture')
                return
            }
            const information = await this.send(this.registry.operations.GetDeviceInfo, {})
            this.assertNikonResponse(information.code, 'GetDeviceInfo')
            if (!information.data?.operationsSupportedRaw.includes(0x9207))
                throw new CameraUnsupportedError(
                    'takePhoto',
                    'Nikon does not advertise the requested capture mode; no shutter command sent'
                )
            // Z6III command reference rev 2, 6.2.4.1: normal release, save to card.
            releaseSent = true
            const response = await this.send(this.registry.operations.InitiateCaptureRecInMedia, {
                AfMode: options.autofocus === false ? 0xffffffff : 0xfffffffe,
                Target: memory ? 1 : 0,
            })
            this.assertReleaseAccepted(response.code, 'InitiateCaptureRecInMedia')
        }
        const finish = async (waitForBuffer = true) => {
            if (memory) {
                const captured = await this.readCapturedMemory()
                data = captured.data
                if (options.includeInfo !== false) info = captured.info
            }
            // A successful silent release may still be processing the exposure.
            // Do not restore RAW compression or the photo/video mode until it is ready.
            // A valid 30-second exposure still needs sensor readout and buffer completion.
            // Wait without replaying the release before restoring RAW or photo/movie modes.
            await this.pollDeviceReady(60000, [], [SilentReleaseBusy.code])
            if (!memory && waitForBuffer) await this.waitForImageBufferReady(30000)
            if (!memory) {
                const captured = await this.readCapturedCardImage(cardHandles, options.includeData === true)
                if (options.includeInfo !== false) info = captured.info
                data = captured.data
                objectHandle = captured.objectHandle
            }
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
                    await afterShutterRelease(() => finish(waitForBuffer))
                } finally {
                    this.off(this.registry.events.ObjectAdded, recordCardObject)
                }
            })
        // Restoring RAW compression after a sent release never reads as a refusal.
        const capture = (waitForBuffer = true) =>
            releaseAndConfirm(waitForBuffer).catch(error => Promise.reject(afterPossibleRelease(error, releaseSent)))

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
            await capture(false)
            return { info, data, objectHandle }
        }

        // camera's hardware dial is in photo mode, great, screen will stay on
        if (this.liveViewMode === 'PHOTO') {
            await capture()
        }

        // camera's hardware dial is not in photo mode
        // we must temporarily enable remote mode which will blank out the screen, then go back to PC Camera mode
        else if (this.liveViewMode === 'VIDEO') {
            const restorePcMode = this.cameraMode !== 'REMOTE'
            const failures: unknown[] = []
            try {
                await this.enableRemoteMode()
                await this.selectLiveViewMode('PHOTO')
                await capture()
            } catch (error) {
                failures.push(error)
            } finally {
                try {
                    await this.selectLiveViewMode('VIDEO', true)
                } catch (error) {
                    failures.push(error)
                } finally {
                    try {
                        if (restorePcMode) await this.enablePcCameraMode()
                    } catch (error) {
                        failures.push(error)
                    }
                }
            }
            // After a sent release a photo may exist, so a failed restoration never reads as a refusal.
            if (failures.length === 1) throw afterPossibleRelease(failures[0], releaseSent)
            if (failures.length > 1)
                throw afterPossibleRelease(
                    new AggregateError(
                        failures,
                        `Nikon capture/settings restoration failed: ${failures.map(String).join('; ')}`
                    ),
                    releaseSent
                )
        } else throw new Error('Nikon live-view selector is unknown; capture was not sent')

        return { info, data, objectHandle }
    }

    /** A refused release took nothing: report the camera's answer as a refusal, not an unknown outcome. */
    private assertReleaseAccepted(code: number, operation: string): void {
        if (code !== OK.code)
            throw shutterRefused(
                new PTPResponseError(code, `Nikon ${operation} returned 0x${code.toString(16)}`, { operation })
            )
    }

    /**
     * The new card file this release wrote, from the ObjectAdded events Nikon queues for it (the
     * event queue is drained before the release, so an older file never counts). Folders are
     * skipped. Of a RAW+JPEG pair the JPEG is preferred: when the first file is not a JPEG, its
     * pair may be announced in a later poll, so polling continues for a short bounded grace before
     * the first file is taken. Never deletes or rewrites card files.
     */
    private async readCapturedCardImage(
        handles: number[],
        includeData: boolean
    ): Promise<{ info: ObjectInfo; data?: Uint8Array; objectHandle: number }> {
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
            const files = [...inspected.entries()].flatMap(([handle, info]) => (info ? [{ handle, info }] : []))
            const jpeg = files.find(file => /\.jpe?g$/i.test(file.info.filename))
            if (files.length && !jpeg) pairDeadline ??= Math.min(deadline, Date.now() + NIKON_PAIR_GRACE_MS)
            const chosen = jpeg ?? (pairDeadline !== undefined && Date.now() >= pairDeadline ? files[0] : undefined)
            if (chosen) return this.readCardFile(chosen.handle, chosen.info, includeData)
            await this.waitMs(100)
        }
        const [first] = [...inspected.entries()].flatMap(([handle, info]) => (info ? [{ handle, info }] : []))
        if (first) return this.readCardFile(first.handle, first.info, includeData)
        throw new Error('Nikon released the shutter, but no new image file appeared on the card within 15 seconds')
    }

    private async readCardFile(
        objectHandle: number,
        info: ObjectInfo,
        includeData: boolean
    ): Promise<{ info: ObjectInfo; data?: Uint8Array; objectHandle: number }> {
        if (!Number.isSafeInteger(info.objectCompressedSize) || info.objectCompressedSize > 512 * 1024 * 1024)
            throw new Error('Nikon card image size is invalid or exceeds the transfer bound')
        if (!includeData) return { info, objectHandle }
        const data = await this.getObject(objectHandle, info.objectCompressedSize)
        if (data.length !== info.objectCompressedSize)
            throw new Error('Nikon card image transfer length differs from its metadata')
        return { info, data, objectHandle }
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
                if (
                    !info ||
                    !Number.isSafeInteger(info.objectCompressedSize) ||
                    info.objectCompressedSize <= 0 ||
                    info.objectCompressedSize > 128 * 1024 * 1024
                )
                    throw new Error('Nikon memory image metadata is missing or exceeds the transfer bound')
                const data = await this.getObject(handle, info.objectCompressedSize)
                if (data.length !== info.objectCompressedSize)
                    throw new Error('Nikon memory image transfer length differs from its metadata')
                return { info, data }
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
        if (this.transport.getType() === TransportType.IP) await this.enableRemoteMode()
        await this.enableLiveView()

        let data: Uint8Array | undefined = undefined
        let nikonMetadata: NikonLiveViewMetadata | undefined
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
            const { liveViewImage, reserved, afFrameData, autoCaptureSubjectDetection, reservedEnd, ...metadata } =
                response.data
            data = liveViewImage
            nikonMetadata = metadata
        }

        return { data, ...(nikonMetadata ? { nikonMetadata } : {}) }
    }

    private async requireFocusOperations(operations: readonly OperationDefinition[]): Promise<void> {
        const response = await this.send(this.registry.operations.GetDeviceInfo, {})
        const supported = response.data?.operationsSupportedRaw
        if (response.code !== OK.code || !Array.isArray(supported))
            throw new PTPResponseError(response.code, 'Nikon operation capabilities could not be read', {
                operation: 'GetDeviceInfo',
            })
        for (const operation of operations) {
            if (!supported.includes(operation.code))
                throw new CameraUnsupportedError(operation.name, `The Nikon does not advertise ${operation.name}`)
        }
    }

    /** Read the advertised extended-property IDs; this does not read or write their values. */
    async getVendorPropertyCodes(): Promise<number[]> {
        const operation = this.registry.operations.GetVendorCodes
        await this.requireFocusOperations([operation])
        const maximumCount = 4096
        const response = await this.send(operation, { Kind: 13 }, undefined, 4 + maximumCount * 4 + 12)
        const data = response.data
        if (response.code !== OK.code || !(data instanceof Uint8Array) || data.length < 4)
            throw new Error('Nikon vendor property enumeration failed')
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const littleEndian = this.transport.isLittleEndian()
        const count = view.getUint32(0, littleEndian)
        if (count > maximumCount || data.length !== 4 + count * 4)
            throw new Error('Nikon vendor property enumeration returned an invalid array length')
        return Array.from({ length: count }, (_, index) => view.getUint32(4 + index * 4, littleEndian))
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
        await this.requireFocusOperations([
            operations.AfDrive,
            operations.AfDriveCancel,
            operations.DeviceReady,
            operations.StartLiveView,
            operations.GetLiveViewImageEx,
        ])
        await this.enableLiveView()
        const response = await this.send(operations.AfDrive, {})
        if (response.code !== OK.code && response.code !== OutOfFocus.code)
            throw new CameraRefusedError(
                'autofocus',
                `Nikon AfDrive failed with response 0x${response.code.toString(16)}`
            )
        let completion: number = response.code
        try {
            if (completion === OK.code) completion = await this.pollDeviceReady(timeoutMilliseconds, [OutOfFocus.code])
        } catch (error) {
            const cancel = await this.send(operations.AfDriveCancel, {}).catch(() => undefined)
            if (!cancel || cancel.code !== OK.code)
                throw new CameraOutcomeUnknownError(
                    'autofocus',
                    'Nikon autofocus did not complete and cancellation was not confirmed'
                )
            throw new CameraOutcomeUnknownError(
                'autofocus',
                `Nikon autofocus did not complete and was cancelled: ${error instanceof Error ? error.message : String(error)}`
            )
        }
        const metadata = await this.freshFocusMetadata()
        return {
            commandSent: true,
            focusAcquired:
                completion === OK.code && metadata.focusingJudgementResult === 2 && metadata.focusDrivingStatus === 0,
            metadata,
        }
    }

    /** Coordinates are normalized over the fresh Nikon whole-size AF plane, independent of JPEG resolution. */
    async touchFocus(x: number, y: number, options: { focus?: boolean } = {}): Promise<NikonFocusPointResult> {
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
            throw new Error('Nikon focus coordinates must be normalized between 0 and 1')
        if (options.focus !== undefined && typeof options.focus !== 'boolean')
            throw new Error('Nikon focus must be true or false')
        const operations = this.registry.operations
        await this.requireFocusOperations([
            operations.ChangeAfArea,
            operations.DeviceReady,
            operations.StartLiveView,
            operations.GetLiveViewImageEx,
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
            throw new CameraRefusedError(
                'setFocusPoint',
                `Nikon ChangeAfArea failed with response 0x${response.code.toString(16)}`
            )
        await this.pollDeviceReady()
        const focus = options.focus === false ? undefined : await this.performAutofocus()
        const metadata = focus?.metadata ?? (await this.freshFocusMetadata())
        const tolerance = {
            x: Math.max(1, Math.floor((metadata.afFrameSize?.horizontal || 0) / 2)),
            y: Math.max(1, Math.floor((metadata.afFrameSize?.vertical || 0) / 2)),
        }
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

    async driveFocus(
        direction: 'near' | 'far',
        steps = 1
    ): Promise<{ commandSent: true; completed: true; metadata: NikonLiveViewMetadata }> {
        if (!['near', 'far'].includes(direction) || !Number.isInteger(steps) || steps < 1 || steps > 32767)
            throw new Error('Nikon manual focus requires near/far and 1–32767 lens steps')
        const operations = this.registry.operations
        await this.requireFocusOperations([
            operations.MfDrive,
            operations.DeviceReady,
            operations.StartLiveView,
            operations.GetLiveViewImageEx,
        ])
        await this.enableLiveView()
        const response = await this.send(operations.MfDrive, { Direction: direction === 'near' ? 1 : 2, Steps: steps })
        if (response.code !== OK.code)
            throw new CameraRefusedError(
                'nudgeFocus',
                `Nikon MfDrive failed: ${this.responseDescription(response.code)}. Use AF-S focus mode for manual drive.`
            )
        try {
            await this.pollDeviceReady()
        } catch (error) {
            throw new CameraOutcomeUnknownError(
                'nudgeFocus',
                `Nikon MfDrive completion failed: ${error instanceof Error ? error.message : String(error)}. Use AF-S focus mode for manual drive.`
            )
        }
        return { commandSent: true, completed: true, metadata: await this.freshFocusMetadata() }
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
        // USB card inspection can leave this body refusing application mode within
        // the same PTP session. Renew the idle session before preparing a movie;
        // this keeps USB connected and adds no power cycle or fixed sleep.
        // Wi-Fi must retain its authenticated session rather than applying the USB workaround.
        if (this.transport.getType() !== TransportType.IP && this.applicationMode !== 'ON' && this.sessionId !== null) {
            await this.waitForImageBufferReady()
            const takeSession = this.sessionId === this.#movieSessionRenewal?.renewed ? this.#movieSessionRenewal.original : this.sessionId
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
            this.cameraMode = 'UNKNOWN'
            this.liveViewMode = 'UNKNOWN'
            this.applicationMode = 'UNKNOWN'
            this.liveViewStatus = 'UNKNOWN'
        }
        if (this.transport.getType() === TransportType.IP) await this.enableRemoteMode()
        if (this.manualVideoExposureRequested) await this.prepareManualVideoExposure()
        // Setup capture

        // update live view status and mode
        await this.getLiveViewStatus()

        await this.pollDeviceReady()

        let ownsLiveView = false,
            ownsApplicationMode = false,
            ownsRemoteMode = false,
            ownsVideoMode = false
        try {
            // With the hardware dial at photo, remote mode (which blanks the screen) selects video;
            // at video the screen stays on.
            if (this.liveViewMode === 'PHOTO') {
                ownsRemoteMode = this.cameraMode !== 'REMOTE'
                await this.enableRemoteMode()
                ownsVideoMode = true
                await this.enableVideoMode()
            } else if (this.liveViewMode !== 'VIDEO')
                throw new Error('Nikon live-view selector is unknown; recording was not started')
            ownsLiveView = this.liveViewStatus !== 'ON'
            await this.enableLiveView()
            ownsApplicationMode = this.applicationMode !== 'ON'
            await this.enableApplicationMode()
            await this.waitForImageBufferReady()
            const prohibitionCondition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            if (prohibitionCondition !== 'none') throw new Error(`Movie recording is prohibited: ${prohibitionCondition}`)
            const response = await this.send(this.registry.operations.StartMovieRecord, {})
            if (response.code !== OK.code)
                throw new PTPResponseError(
                    response.code,
                    `Nikon StartMovieRecord failed with response 0x${response.code.toString(16)}`,
                    { operation: 'StartMovieRecord' }
                )
        } catch (error) {
            // A refused Start can still leave the body recording. Preserve its
            // setup until a fresh observation permits restoration and explicit Stop.
            let observed: string | undefined
            try {
                observed = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            } catch {
                /* An unreadable state cannot authorize mode changes. */
            }
            if (observed === undefined || observed.includes('alreadyRecording')) throw error
            const failures: string[] = []
            const restore = async (name: string, operation: () => Promise<void>) => {
                try {
                    await operation()
                } catch (failure) {
                    failures.push(`${name}: ${failure instanceof Error ? failure.message : String(failure)}`)
                }
            }
            if (ownsLiveView) await restore('live view', () => this.disableLiveView())
            if (ownsApplicationMode) await restore('application mode', () => this.disableApplicationMode())
            if (ownsVideoMode) await restore('photo mode', () => this.enablePhotoMode())
            if (ownsRemoteMode) await restore('camera mode', () => this.enablePcCameraMode())
            if (failures.length)
                throw new Error(
                    `${error instanceof Error ? error.message : String(error)}; Nikon recording setup cleanup failed: ${failures.join('; ')}`,
                    { cause: error }
                )
            throw error
        }
    }

    async sendStopRecording(): Promise<void> {
        const response = await this.send(this.registry.operations.EndMovieRecord, {})
        if (response.code !== OK.code)
            throw new PTPResponseError(
                response.code,
                `Nikon EndMovieRecord failed with response 0x${response.code.toString(16)}`,
                { operation: 'EndMovieRecord' }
            )
        await this.pollDeviceReady()
        const deadline = Date.now() + 10000
        while ((await this.get(this.registry.properties.MovieRecProhibitionCondition)).includes('alreadyRecording')) {
            if (Date.now() >= deadline)
                throw new Error('Nikon movie stop was not confirmed within ten seconds; recording mode was preserved')
            await this.waitMs(50)
        }
        await this.waitForImageBufferReady()
        await this.disableLiveView()
        await this.disableApplicationMode()
        await this.enablePcCameraMode()
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
                return chunkResponse.data
            },
            onProgress,
            signal
        )
    }

    private async enableRemoteMode(): Promise<void> {
        if (this.cameraMode === 'REMOTE') {
            return
        }

        this.cameraMode = 'UNKNOWN'
        const response = await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'REMOTE' })
        if (response.code !== OK.code)
            throw new PTPResponseError(
                response.code,
                `Nikon ChangeCameraMode REMOTE failed: ${this.responseDescription(response.code)}`,
                { operation: 'ChangeCameraMode' }
            )
        this.cameraMode = 'REMOTE'
        await this.pollDeviceReady()
    }

    private async enablePcCameraMode(): Promise<void> {
        if (this.cameraMode === 'PC_CAMERA') {
            return
        }

        this.cameraMode = 'UNKNOWN'
        const response = await this.send(this.registry.operations.ChangeCameraMode, { Mode: 'PC_CAMERA' })
        if (response.code !== OK.code)
            throw new PTPResponseError(
                response.code,
                `Nikon ChangeCameraMode PC_CAMERA failed: ${this.responseDescription(response.code)}`,
                { operation: 'ChangeCameraMode' }
            )
        this.cameraMode = 'PC_CAMERA'
        await this.pollDeviceReady()
    }

    private async changeApplicationMode(mode: 'ON' | 'OFF'): Promise<void> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const response = await this.send(this.registry.operations.ChangeApplicationMode, { Mode: mode })
            if (response.code === OK.code) return
            if (response.code !== 0x200f)
                throw new Error(
                    `Nikon ChangeApplicationMode ${mode} failed: ${this.responseDescription(response.code)}`
                )
            // A mode command can be denied when the body already has that state.
            // Accept only fresh camera telemetry, otherwise give its pending transition a bounded retry.
            const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            const observed = condition.includes('notInApplicationMode') ? 'OFF' : 'ON'
            if (observed === mode) return
            if (attempt === 2)
                throw new Error(
                    `Nikon ChangeApplicationMode ${mode} failed: ${this.responseDescription(response.code)}; camera reports ${condition}`
                )
            await this.pollDeviceReady()
            await this.waitMs(250)
        }
    }

    private async enableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'ON') {
            return
        }

        await this.changeApplicationMode('ON')
        this.applicationMode = 'ON'
        await this.pollDeviceReady()
    }

    private async disableApplicationMode(): Promise<void> {
        if (this.applicationMode === 'OFF') {
            return
        }

        await this.changeApplicationMode('OFF')
        this.applicationMode = 'OFF'
        await this.pollDeviceReady()
    }

    private async enableLiveView(): Promise<void> {
        if (this.liveViewStatus === 'UNKNOWN') {
            try {
                const status = await this.get(this.registry.properties.LiveViewStatus)
                if (status !== 'ON' && status !== 'OFF') throw new Error('Nikon live-view status is unknown')
                this.liveViewStatus = status
            } catch (error) {
                const unsupported = error instanceof PTPResponseError && [0x2005, 0x200a].includes(error.code)
                const legacyEmpty =
                    error instanceof Error && error.message === 'No data received from GetDevicePropDescEx'
                if (!unsupported && !legacyEmpty) throw error
            }
        }
        if (this.liveViewStatus === 'ON') {
            return
        }

        let response = await this.send(this.registry.operations.StartLiveView, {})
        if (response.code === HardwareError.code && (await this.recoverSequenceError())) {
            response = await this.send(this.registry.operations.StartLiveView, {})
        }
        if (response.code !== OK.code && response.code !== DeviceBusy.code) {
            throw new PTPResponseError(
                response.code,
                `Nikon StartLiveView failed with response 0x${response.code.toString(16)}`
            )
        }
        this.ownsLiveView = true
        this.liveViewStartPending = true
        await this.pollDeviceReady()
        this.liveViewStatus = 'ON'
        this.liveViewStartPending = false
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
        const information = await this.send(this.registry.operations.GetDeviceInfo, {})
        this.assertNikonResponse(information.code, 'GetDeviceInfo for shutter recovery')
        if (!information.data?.operationsSupportedRaw.includes(0x9207)) return false
        const warning = this.registry.properties.NikonWarningStatus
        if (!information.data.devicePropertiesSupported.includes(warning.code)) {
            if (!information.data.operationsSupportedRaw.includes(this.registry.operations.GetVendorCodes.code))
                return false
            if (!(await this.getVendorPropertyCodes()).includes(warning.code)) return false
        }
        if ((await this.get(warning)) !== 1) return false
        const movie = await this.get(this.registry.properties.MovieRecProhibitionCondition)
        if (movie.includes('alreadyRecording') || movie.includes('imagesInBuffer')) return false
        // Refresh immediately before the release: an old cache or another fault cannot authorize it.
        if ((await this.get(warning)) !== 1) return false
        const released = await this.send(this.registry.operations.InitiateCaptureRecInMedia, {
            AfMode: 0xffffffff,
            Target: 0,
        })
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
        if (response.code !== OK.code && response.code !== NotLiveView.code) {
            throw new PTPResponseError(
                response.code,
                `Nikon EndLiveView failed with response 0x${response.code.toString(16)}`
            )
        }
        await this.pollDeviceReady()
        this.liveViewStatus = 'OFF'
        this.liveViewStartPending = false
        this.ownsLiveView = false
    }

    private async enablePhotoMode(): Promise<void> {
        await this.selectLiveViewMode('PHOTO')
    }

    private async enableVideoMode(): Promise<void> {
        await this.selectLiveViewMode('VIDEO')
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
                throw new PTPResponseError(
                    response.code,
                    `Nikon DeviceReady failed: ${this.responseDescription(response.code)}`,
                    { operation: 'DeviceReady' }
                )
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
    async selectPhotoVideoMode(mode: 'PHOTO' | 'VIDEO'): Promise<void> {
        await this.getLiveViewStatus()
        const restoreLiveView = this.liveViewStatus === 'ON'
        const restoreLiveViewOwnership = this.ownsLiveView
        const restorePcMode = this.cameraMode !== 'REMOTE'
        let failure: unknown
        try {
            await this.enableRemoteMode()
            await this.selectLiveViewMode(mode, true)
        } catch (error) {
            failure = error
            throw error
        } finally {
            try {
                if (restoreLiveView) await this.enableLiveView()
                this.ownsLiveView = restoreLiveViewOwnership
                if (restorePcMode) await this.enablePcCameraMode()
            } catch (error) {
                // A failed restoration leaves the body's mode unknown, whatever the selector did.
                const restoration = new CameraOutcomeUnknownError(
                    'photoVideoMode',
                    `Restoring Nikon live view and camera mode after the photo/video switch failed: ${String(error)}` +
                        (failure ? `; the switch itself failed: ${String(failure)}` : '')
                )
                restoration.cause = failure ? new AggregateError([failure, error]) : error
                throw restoration
            }
        }
    }

    /** A failed activation may still have changed the selector; forced restoration sends the original value despite stale caches. */
    private async selectLiveViewMode(mode: 'PHOTO' | 'VIDEO', force = false): Promise<void> {
        if (!force && this.liveViewMode === mode) return
        // An active video pipeline must end before starting still live view.
        await this.disableLiveView()
        this.liveViewMode = 'UNKNOWN'
        await this.set(this.registry.properties.LiveViewSelector, mode)
        await this.pollDeviceReady()
        this.liveViewMode = mode
    }

    private async waitForImageBufferReady(timeoutMilliseconds = 5000): Promise<void> {
        const deadline = Date.now() + timeoutMilliseconds
        while (Date.now() < deadline) {
            const condition = await this.get(this.registry.properties.MovieRecProhibitionCondition)
            if (!condition.includes('imagesInBuffer')) return
            await this.waitMs(100)
        }
        throw new Error(`Nikon image buffer did not become ready within ${timeoutMilliseconds} milliseconds`)
    }

    private assertNikonResponse(code: number, operation: string): void {
        if (code !== OK.code)
            throw new PTPResponseError(code, `Nikon ${operation} returned 0x${code.toString(16)}`, { operation })
    }

    // Driver contract (`@camera/driver`).
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
        return publicOutcome('autofocus', async () =>
            (await this.performAutofocus()).focusAcquired ? 'acquired' : 'not-acquired'
        )
    }

    async setFocusPoint(x: number, y: number, options: FocusPointOptions): Promise<void> {
        requirePoint(x, y)
        const placed = await publicOutcome('setFocusPoint', () => this.touchFocus(x, y, { focus: options.autofocus }))
        if (!placed.positionVerified)
            throw new CameraOutcomeUnknownError(
                'setFocusPoint',
                `The Nikon accepted the focus point but its live view reports the AF frame elsewhere (${placed.metadata.afFrameCenterCoords?.horizontal}, ${placed.metadata.afFrameCenterCoords?.vertical})`
            )
    }

    async resetFocusPoint(): Promise<void> {
        await publicOutcome('resetFocusPoint', () => this.touchFocus(0.5, 0.5, { focus: false }))
    }

    async nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void> {
        requireNudge(direction, size)
        await publicOutcome('nudgeFocus', () => this.driveFocus(direction, NIKON_FOCUS_STEPS[size]))
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
                if (!status) return 'unknown'
                return status.recording ? 'recording' : status.bufferedImages ? 'stopping' : 'idle'
            },
            listHandles: async () => {
                // Announcements queued before this take must not count as its clip.
                await this.pollEvents()
                this.#announcedCardObjects = []
                return new Set()
            },
            findClip: () => this.announcedClip(),
            handleSession: () =>
                this.sessionId !== null && this.sessionId === this.#movieSessionRenewal?.renewed
                    ? this.#movieSessionRenewal.original
                    : this.sessionId,
            sendStart: () => this.sendStartRecording(),
            sendStop: () => this.sendStopRecording(),
            serialize: cardSteps(this, this.requireOwner()).serialize,
        }))
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
                    // A movie still being written reports no size yet.
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
        const reported = info.objectCompressedSize
        const name = info.filename
        const mediaId = encodeMediaId({
            source: 'object',
            storageId: info.storageID,
            objectHandle,
            name,
            ...(reported !== unstatedSize && { sizeBytes: reported }),
        })
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
        const operations = this.registry.operations
        const liveView = [operations.DeviceReady, operations.StartLiveView, operations.GetLiveViewImageEx]
        switch (operation) {
            case 'autofocus':
                return operationsAdvertised(capabilities, [operations.AfDrive, operations.AfDriveCancel, ...liveView])
            case 'setFocusPoint':
            case 'resetFocusPoint':
                return operationsAdvertised(capabilities, [operations.ChangeAfArea, ...liveView])
            case 'nudgeFocus':
                return operationsAdvertised(capabilities, [operations.MfDrive, ...liveView])
            case 'getLiveViewFrame':
                return { supported: true, options: { overlay: { supported: false, reason: overlayUnsupported } } }
            default:
                return super.availability(operation, capabilities)
        }
    }
}

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
        throw new CameraOutcomeUnknownError(operation, error instanceof Error ? error.message : String(error), {
            cause: error,
        })
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
