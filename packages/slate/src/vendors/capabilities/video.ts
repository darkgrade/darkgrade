import { CanonCamera } from '@camera/canon-camera'
import type { CameraRecordingState } from '@camera/controls'
import type { Clip, VideoCapability } from '@camera/driver/video'
import { CameraRefusedError } from '@camera/errors'
import type { GenericCamera } from '@camera/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { cameraContext, type CameraDriverInstance } from '@camera/operations/context'
import { recordingCapability, type VendorRecording } from '@camera/recording-lifecycle'
import { SonyCamera } from '@camera/sony-camera'
import { readCameraObjectHandles, readCameraStorages, waitForNewCameraMovie } from '@camera/storage'
import { openCanonRecordingMode } from '@vendors/canon/recording-mode'
import { readNikonObjectSize } from '@vendors/nikon/object-size'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
import { openSonyRecordingMode } from '@vendors/sony/photo-mode'
import { readSonyPtpRecordingState } from '@vendors/sony/ptp-video-recording'

/** Sony movies can take a while to close on the card after a long 4K take. */
const clipFinalizationMilliseconds = 30000
/** PTP ObjectInfo's size when the real one needs a 64-bit query. */
const unstatedSize = 0xffffffff

/** The protocol surface the shared storage helpers read, taken from the driver itself. */
function storageHost(driver: GenericCamera) {
    return {
        getInstance: () => driver,
        send: driver.send.bind(driver),
        get: driver.get.bind(driver),
    }
}

function sonyHost(driver: SonyCamera) {
    return {
        ...storageHost(driver),
        getSonyPropertyStates: async () => {
            await driver.refreshPropertyStates()
            return driver.listPropertyStates()
        },
    }
}

/** Canon's recording-mode helper, on the driver's own commands rather than Camera's vendor methods. */
function canonHost(driver: CanonCamera) {
    return {
        getInstance: () => driver,
        getCanonPropertyStates: async () => driver.listPropertyStates(),
        getCanonUnknownPropertyStates: async () => driver.listUnknownPropertyStates(),
        prepareCanonRecordingDestination: () => driver.prepareRecordingDestination(),
        enterMovieMode: () => driver.enterMovieMode(),
        leaveMovieMode: () => driver.leaveMovieMode(),
        setCanonManualExposureMode: () => driver.setManualExposureMode(),
        setIso: (value: string) => driver.setIso(value),
        setAperture: (value: string) => driver.setAperture(value),
        setShutterSpeed: (value: string) => driver.setShutterSpeed(value),
        setWhiteBalance: (value: string) => driver.setWhiteBalance(value),
    }
}

function clipFrom(handle: number, name: unknown, sizeBytes: number | undefined): Clip {
    return {
        mediaId: String(handle),
        name: String(name),
        ...(sizeBytes !== undefined && Number.isSafeInteger(sizeBytes) && sizeBytes !== unstatedSize ? { sizeBytes } : {}),
    }
}

/** What every PTP driver shares: the card's handles and the new finished movie. */
function cardSteps(driver: GenericCamera, owner: Camera) {
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

/** Native Sony PTP: 0xd21d is 0 idle and 1 recording; 2 (failed) and 3 (interval waiting) are neither. */
function sonyRecording(driver: SonyCamera, owner: Camera): VendorRecording {
    const host = sonyHost(driver)
    return {
        ...cardSteps(driver, owner),
        async readState(): Promise<CameraRecordingState> {
            const state = await readSonyPtpRecordingState(host)
            return state === 0 ? 'idle' : state === 1 ? 'recording' : 'unknown'
        },
        // Selects the advertised movie mode and checks the movie card's remaining time in it.
        prepare: async () => (await openSonyRecordingMode(owner)).restore,
        sendStart: () => driver.startRecording(),
        sendStop: () => driver.stopRecording(),
        // The movie button is a press and release; Stop releases a press the body ignored.
        releaseIgnoredStart: () => driver.stopRecording(),
    }
}

function canonRecording(driver: CanonCamera, owner: Camera): VendorRecording {
    const host = storageHost(driver)
    return {
        ...cardSteps(driver, owner),
        async readState(): Promise<CameraRecordingState> {
            await driver.refreshEventProperties()
            const state = driver.listPropertyStates().find(state => state.name === 'CanonRecordingDestination')?.value
            return state === 'CARD' ? 'recording' : state === 'NONE' || state === 'SDRAM' ? 'idle' : 'unknown'
        },
        async checkCard() {
            const cards = await readCameraStorages(host)
            if (!cards.some(card => card.writable && card.freeBytes > 0))
                throw new CameraRefusedError('startRecording', 'Insert a writable memory card with free space before recording')
        },
        // Card destination, movie mode and the photo exposure copied across; movie sound is left as set.
        prepare: async () => (await openCanonRecordingMode(canonHost(driver))).restore,
        sendStart: () => driver.startRecording(),
        sendStop: () => driver.stopRecording(),
    }
}

/**
 * Nikon's own Record prepares video mode, live view and application mode, checks the card through
 * its prohibition flags, and its Stop restores them once the movie is no longer recording.
 */
function nikonRecording(driver: NikonCamera, owner: Camera): VendorRecording {
    const host = storageHost(driver)
    const card = cardSteps(driver, owner)
    return {
        ...card,
        async readState(): Promise<CameraRecordingState> {
            const status = await readNikonRecordingStatus(host)
            return !status ? 'unknown' : status.recording ? 'recording' : status.bufferedImages ? 'stopping' : 'idle'
        },
        async findClip(baseline: Set<number>): Promise<Clip> {
            const movie = await waitForNewCameraMovie(host, baseline, clipFinalizationMilliseconds)
            const reported = Number(movie.objectCompressedSize)
            return clipFrom(movie.handle, movie.filename, await readNikonObjectSize(host, movie.handle, reported))
        },
        sendStart: () => driver.startRecording(),
        sendStop: () => driver.stopRecording(),
    }
}

/** Each vendor's video capability; generic PTP and other vendor extensions cannot record. */
export function videoCapability(driver: CameraDriverInstance, owner: Camera): VideoCapability | undefined {
    if (driver instanceof SonyCamera) return recordingCapability(sonyRecording(driver, owner))
    if (driver instanceof CanonCamera) return recordingCapability(canonRecording(driver, owner))
    if (driver instanceof NikonCamera) return recordingCapability(nikonRecording(driver, owner))
    return undefined
}
