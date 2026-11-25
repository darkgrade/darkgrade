import { cameraContext, type CameraDriverInstance } from '@camera/camera-context'
import type { CameraCapabilities, OperationAvailability } from '@camera/controls'
import type { Battery, CameraInfo, Clip, ConfirmedPhotoFile, FocusDirection, FocusStepSize } from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { PTPDecodeError } from '@core/ptp-errors'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { GetDeviceInfo } from '@ptp/definitions/operation-definitions'
import { OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { OperationDefinition } from '@ptp/types/operation'
import { TransportType } from '@transport/interfaces/transport-types'
import { SonyRemoteSdkTransport } from '@transport/sony-remote/sony-remote-sdk-transport'
import { readCameraPower } from '@vendors/camera-power'
import { CanonCamera } from '@vendors/canon/canon-camera'
import type { BodyCapability, ConnectionCapability, PhotoCapability } from '@vendors/generic/capability-groups'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import { encodeMediaId, type MediaReference } from '@vendors/generic/media-id'
import { reportingRefusals } from '@vendors/generic/ptp-object-index'
import { photoOutcome } from '@vendors/generic/shutter-outcome'
import { setStandardClock, standardClockUnavailable } from '@vendors/generic/standard-clock'
import { readCameraObjectHandles, waitForNewCameraMovie } from '@vendors/generic/storage'
import { SonyCamera } from '@vendors/sony/sony-camera'
import type { CameraPower } from '@workflows/camera-power'

/*
 * TRANSITIONAL (consolidation setup). Standard PTP behaviour and the helpers each brand's
 * operations share, moved verbatim from the per-area capability modules. GenericCamera's methods
 * call these; fold them into GenericCamera (or the brand driver they belong to) and delete them.
 */

/** The make people use for each USB vendor; another vendor keeps the name its DeviceInfo gives. */
export const MAKES: Record<number, string> = {
    [VendorIDs.SONY]: 'Sony',
    [VendorIDs.CANON]: 'Canon',
    [VendorIDs.NIKON]: 'Nikon',
    [VendorIDs.FUJIFILM]: 'Fujifilm',
    [VendorIDs.PANASONIC]: 'Panasonic',
    [VendorIDs.OLYMPUS]: 'Olympus',
    [VendorIDs.OM_DIGITAL]: 'OM System',
    [VendorIDs.LEICA]: 'Leica',
    [VendorIDs.SIGMA]: 'Sigma',
}

/**
 * The lens mount for model families whose mount follows from the name: Sony ILCE/ILME bodies are
 * E-mount and ILCA bodies A-mount, Nikon Z bodies Z-mount and Nikon D bodies F-mount, Canon EOS R
 * bodies RF-mount. Any other model reports no mount rather than a guess.
 */
export function lensMountForModel(vendorId: number | null, model: string): string | undefined {
    const name = model.trim()
    if (vendorId === VendorIDs.SONY) {
        if (/^IL(CE|ME)-/i.test(name)) return 'E'
        if (/^ILCA-/i.test(name)) return 'A'
    }
    if (vendorId === VendorIDs.NIKON) {
        if (/^Z\s?[0-9fc]/i.test(name)) return 'Z'
        if (/^D\d/i.test(name)) return 'F'
    }
    if (vendorId === VendorIDs.CANON && /\bEOS R(\d|P\b|\b)/i.test(name)) return 'RF'
    return undefined
}

/**
 * Each vendor's connection capability. Every driver opens a PTP session and answers GetDeviceInfo;
 * what differs is what the session prepares. Sony's remote session writes two host preferences
 * (PC Remote position-key priority and the saved image destination) unless observeOnly asks it
 * not to. Canon's remote and event modes and the generic OpenSession change no saved setting, so
 * observeOnly opens them unchanged. Make, model and firmware are read once per session.
 */
export function connectionCapability(driver: CameraDriverInstance, owner: Camera): ConnectionCapability {
    let cached: { sessionId: number | null; info: CameraInfo } | undefined
    return {
        async openSession(device, { observeOnly }) {
            if (driver instanceof SonyCamera) return driver.connect(device, { configure: !observeOnly })
            return driver.connect(device)
        },

        getInfo: () =>
            reportingRefusals('getInfo', async () => {
                if (cached && cached.sessionId === driver.sessionId) return { ...cached.info }
                const response = await driver.send(GetDeviceInfo, {})
                if (response.code !== OK.code)
                    throw new CameraRefusedError(
                        'getInfo',
                        `The camera refused GetDeviceInfo (0x${response.code.toString(16).padStart(4, '0')})`
                    )
                if (!response.data) throw new PTPDecodeError('GetDeviceInfo returned no device dataset')
                const { manufacturer, model, deviceVersion, serialNumber } = response.data
                const lensMount = lensMountForModel(driver.vendorId, model)
                const info: CameraInfo = {
                    manufacturer: (driver.vendorId !== null && MAKES[driver.vendorId]) || manufacturer.trim(),
                    model: model.trim(),
                    firmware: deviceVersion.trim(),
                    ...(serialNumber && { serialNumber }),
                    ...(lensMount && { lensMount }),
                    connection: connectionKind(owner),
                }
                cached = { sessionId: driver.sessionId, info }
                return { ...info }
            }),
    }
}

export function connectionKind(owner: Camera): CameraInfo['connection'] {
    const { transport } = cameraContext(owner)
    // Sony's authenticated SDK channel is carried over Wi-Fi IP, but it is not PTP/IP.
    if (transport instanceof SonyRemoteSdkTransport) return 'wifi'
    return transport.getType() === TransportType.USB ? 'usb' : 'ip'
}

/** The public battery reading; telemetry provenance (`source`, `raw`) stays in CameraPower. */
export function batteryFromPower(power: CameraPower | undefined): Battery {
    const battery: Battery = {
        powerSource: power?.powerSource ?? 'unknown',
        ...(power?.percent !== undefined && { percent: power.percent }),
        ...(power?.level !== undefined && { level: power.level }),
        ...(power?.remainingMinutes !== undefined && { minutesRemaining: power.remainingMinutes }),
        ...(power?.batteryPresent !== undefined && { batteryPresent: power.batteryPresent }),
    }
    if (Object.keys(battery).length === 1 && battery.powerSource === 'unknown')
        throw new CameraUnsupportedError('getBattery', 'This camera does not report its battery')
    return battery
}

/**
 * Each vendor's battery and clock. Battery: Sony's property snapshot, Canon's EOS level after the
 * standard BatteryLevel, the standard BatteryLevel elsewhere (`readCameraPower`). Clock: Sony's
 * Date/Time Setting with its confirmation event, the standard DateTime property elsewhere.
 */
export function bodyCapability(driver: CameraDriverInstance, owner: Camera): BodyCapability {
    let clockCheck: { sessionId: number | null; reason: string | undefined } | undefined
    const vendor = driver instanceof SonyCamera ? 'sony' : driver instanceof CanonCamera ? 'canon' : 'standard'
    return {
        getBattery: () =>
            reportingRefusals('getBattery', async () => batteryFromPower(await readCameraPower(owner, vendor))),
        setClock: moment =>
            reportingRefusals('setClock', async () => {
                if (driver instanceof SonyCamera) await driver.setDateTime(moment)
                else await setStandardClock(driver, moment)
            }),
        async availability() {
            if (driver instanceof SonyCamera) return {}
            if (clockCheck?.sessionId !== driver.sessionId)
                clockCheck = {
                    sessionId: driver.sessionId,
                    reason: await reportingRefusals('setClock', () => standardClockUnavailable(driver)),
                }
            return clockCheck.reason ? { setClock: { supported: false, reason: clockCheck.reason } } : {}
        },
    }
}

export type DriverCapture = { info?: ObjectInfo; data?: Uint8Array; objectHandle?: number }

/** The driver's answer for one release, checked: a file Slate cannot name is not a confirmed photo. */
export function describedFile(capture: DriverCapture, wantsData: boolean): { info: ObjectInfo; data?: Uint8Array } {
    const info = capture.info
    if (!info?.filename || !Number.isSafeInteger(info.objectCompressedSize) || info.objectCompressedSize <= 0)
        throw new CameraOutcomeUnknownError(
            'takePhoto',
            'The shutter was released, but the camera described no new photo file'
        )
    if (wantsData && capture.data?.length !== info.objectCompressedSize)
        throw new CameraOutcomeUnknownError(
            'takePhoto',
            'The photo was taken, but its transfer did not match the size the camera reported'
        )
    return { info, ...(wantsData && capture.data ? { data: capture.data } : {}) }
}

/** A card object found through standard PTP handles, named with the id `listMedia()` gives it. */
export function cardObjectFile(capture: DriverCapture, wantsData: boolean): ConfirmedPhotoFile {
    const { info, data } = describedFile(capture, wantsData)
    if (capture.objectHandle === undefined)
        throw new CameraOutcomeUnknownError(
            'takePhoto',
            `The photo ${info.filename} was taken, but the camera did not name its card object`
        )
    const sizeBytes = info.objectCompressedSize
    const reference: MediaReference = {
        source: 'object',
        storageId: info.storageID,
        objectHandle: capture.objectHandle,
        name: info.filename,
        sizeBytes,
    }
    return { mediaId: encodeMediaId(reference), name: info.filename, sizeBytes, ...(data && { data }) }
}

/**
 * Runs one capture and reports a failure as one of the three outcomes. `confirmed` is called once
 * the driver has confirmed the photo, so a mode restoration that fails after it is never a refusal.
 */
export async function classified(
    capture: (confirmed: () => void) => Promise<ConfirmedPhotoFile>
): Promise<ConfirmedPhotoFile> {
    let photoConfirmed = false
    try {
        return await capture(() => (photoConfirmed = true))
    } catch (error) {
        throw photoOutcome(error, photoConfirmed)
    }
}

/** Standard PTP: InitiateCapture confirmed by ObjectAdded. These bodies save to their card first. */
export function standardPhotoCapability(driver: CameraDriverInstance): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async confirmed => {
                if (!autofocus)
                    throw new CameraUnsupportedError(
                        'takePhoto',
                        'This camera has no documented release without autofocus over standard PTP; nothing was sent'
                    )
                const wantsData = destination === 'computer'
                const capture = await driver.captureImage({ includeInfo: true, includeData: wantsData })
                confirmed()
                return cardObjectFile(capture, wantsData)
            }),
    }
}

export const supported: OperationAvailability = { supported: true }
export const unsupported = (reason: string): OperationAvailability => ({ supported: false, reason })

/** 0–1 from the top-left, or CameraRefusedError before anything is sent. */
export function requirePoint(x: number, y: number): void {
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
        throw new CameraRefusedError('setFocusPoint', 'A focus point is 0–1 from the top-left of the picture')
}

export function requireNudge(direction: FocusDirection, size: FocusStepSize): void {
    if (direction !== 'near' && direction !== 'far')
        throw new CameraRefusedError('nudgeFocus', 'Focus moves near or far')
    if (size !== 'small' && size !== 'medium' && size !== 'large')
        throw new CameraRefusedError('nudgeFocus', 'A focus step is small, medium or large')
}

/** Runs every restoration step even when one fails; reports all failures together. */
export async function restoreAll(operation: string, steps: (() => Promise<void>)[]): Promise<void> {
    const failures: unknown[] = []
    for (const step of steps) {
        try {
            await step()
        } catch (error) {
            failures.push(error)
        }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length)
        throw new CameraOutcomeUnknownError(
            operation,
            failures.map(failure => (failure instanceof Error ? failure.message : String(failure))).join('; ')
        )
}

export function operationsAdvertised(
    capabilities: CameraCapabilities,
    operations: readonly OperationDefinition[]
): OperationAvailability {
    const advertised = capabilities.advertisedOperations
    if (!advertised) return supported
    const missing = operations.filter(operation => !advertised.includes(operation.code))
    return missing.length
        ? unsupported(`The camera does not advertise ${missing.map(operation => operation.name).join(', ')}`)
        : supported
}

export const overlayUnsupported = 'This camera does not send its on-screen display'

export function requireImage(data: Uint8Array | undefined): Uint8Array {
    if (!data?.length) throw new Error('The camera returned no live-view image')
    return data
}

export const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Sony movies can take a while to close on the card after a long 4K take. */
export const clipFinalizationMilliseconds = 30000
/** PTP ObjectInfo's size when the real one needs a 64-bit query. */
export const unstatedSize = 0xffffffff

/** The protocol surface the shared storage helpers read, taken from the driver itself. */
export function storageHost(driver: GenericCamera) {
    return {
        driver,
        send: driver.send.bind(driver),
        get: driver.get.bind(driver),
    }
}

export function clipFrom(handle: number, name: unknown, sizeBytes: number | undefined): Clip {
    return {
        mediaId: String(handle),
        name: String(name),
        ...(sizeBytes !== undefined && Number.isSafeInteger(sizeBytes) && sizeBytes !== unstatedSize
            ? { sizeBytes }
            : {}),
    }
}

/** What every PTP driver shares: the card's handles and the new finished movie. */
export function cardSteps(driver: GenericCamera, owner: Camera) {
    const host = storageHost(driver)
    return {
        listHandles: () => readCameraObjectHandles(host),
        async findClip(baseline: Set<number>): Promise<Clip> {
            const movie = await waitForNewCameraMovie(host, baseline, clipFinalizationMilliseconds)
            return clipFrom(movie.handle, movie.filename, Number(movie.objectCompressedSize))
        },
        handleSession: () => driver.sessionId,
        serialize: <T>(work: () => Promise<T>) => cameraContext(owner).controlsQueue.run('camera', work),
    }
}
