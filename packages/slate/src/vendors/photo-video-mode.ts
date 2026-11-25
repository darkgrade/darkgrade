import { CanonCamera } from '@camera/canon-camera'
import { confirmCameraValue } from '@camera/confirmation'
import {
    cameraControlDefinitions,
    unrecognizedValueLabel,
    type CameraControlState,
    type UnrecognizedValues,
} from '@camera/controls'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import type { PhotoVideoMode } from '@camera/settings/mode'
import { SonyCamera, type SonyPropertyState } from '@camera/sony-camera'
import { readCameraRecordingState } from '@camera/video-recording'
import { PTPResponseError } from '@core/ptp-errors'
import type { GenericCamera } from '@camera/generic-camera'

/**
 * photoVideoMode: whether the camera takes photos or records video, read and set through each
 * vendor's own switch.
 * - Nikon: LiveViewSelector, a single property (mapped in `@vendors/control-properties/mode`).
 * - Canon: the MovieSelectSwitchOn/Off operations, read back through FixedMovie (0xd1c2; libgphoto2
 *   eosmovieswitch, EDSDK FixedMovie). A body whose lever is at Movie keeps FixedMovie at 1.
 * - Sony: a composite view of the exposure program. Movie and S&Q programs are video; the rest are
 *   photo. A switch selects the same program in the other half (Manual ↔ Movie Manual) and only
 *   when the camera advertises it; there is no implicit fallback to another program.
 */

const exposureProgramCode = 0x500e
const fixedMovieCode = 0xd1c2

/**
 * Sony exposure programs by their low 16 bits, which identify a program on both the UINT16 and
 * the UINT32 descriptor (native PTP values; libgphoto2 config.c, see `@vendors/sony/exposure-program`).
 */
const sonyPhotoPrograms = new Set([0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x8000, 0x8001, 0x8089])
const sonyVideoPrograms = new Set([
    0x8050, 0x8051, 0x8052, 0x8053, 0x8054, 0x8088, 0x808a, 0x8090, 0x8059, 0x805a, 0x805b, 0x805c, 0x805d, 0x8091,
    0x8092, 0x8093, 0x8094, 0x8095, 0x8096, 0x8097,
])
/** The same program in the photo and video halves: Manual, Program Auto, Aperture and Shutter Priority, Still/Movie. */
const sonyCounterparts: readonly (readonly [photo: number, video: number])[] = [
    [0x0001, 0x8053],
    [0x0002, 0x8050],
    [0x0003, 0x8051],
    [0x0004, 0x8052],
    [0x8089, 0x8088],
]

const otherMode = (mode: PhotoVideoMode): PhotoVideoMode => (mode === 'photo' ? 'video' : 'photo')

function sonyProgramMode(raw: number): PhotoVideoMode | undefined {
    const program = raw & 0xffff
    return sonyPhotoPrograms.has(program) ? 'photo' : sonyVideoPrograms.has(program) ? 'video' : undefined
}

function sonyCounterpartIndex(program: SonyPropertyState): number {
    if (typeof program.rawValue !== 'number') return -1
    const current = program.rawValue & 0xffff
    const pair = sonyCounterparts.find(([photo, video]) => photo === current || video === current)
    if (!pair) return -1
    const target = pair[0] === current ? pair[1] : pair[0]
    return program.allowedRawValues?.findIndex(raw => typeof raw === 'number' && (raw & 0xffff) === target) ?? -1
}

function controlState(
    source: { name: string; code: number },
    value: PhotoVideoMode | undefined,
    raw: number | bigint | string | undefined,
    choices: PhotoVideoMode[],
    writable: boolean,
    enabled: boolean
): CameraControlState {
    const definition = cameraControlDefinitions.photoVideoMode
    const unrecognized: UnrecognizedValues | undefined =
        value === undefined && raw !== undefined ? { value: unrecognizedValueLabel(raw) } : undefined
    return {
        id: 'photoVideoMode',
        label: definition.label,
        aliases: definition.aliases,
        source: { ...source, protocol: 'ptp' },
        value: value ?? `Unrecognized (${unrecognized?.value ?? 'none'})`,
        allowedValues: value === undefined ? [] : (['photo', 'video'] as const).filter(mode => choices.includes(mode)),
        enabled,
        writable: value !== undefined && writable && enabled,
        ...(unrecognized && { unrecognized }),
    }
}

/** Sony: the composite view of ExposureProgramMode, or undefined when the body does not publish it. */
export function sonyPhotoVideoModeState(states: readonly SonyPropertyState[]): CameraControlState | undefined {
    const program = states.find(state => state.code === exposureProgramCode)
    if (!program || typeof program.rawValue !== 'number') return undefined
    const current = sonyProgramMode(program.rawValue)
    const choices: PhotoVideoMode[] = current ? [current, ...(sonyCounterpartIndex(program) >= 0 ? [otherMode(current)] : [])] : []
    return controlState(program, current, program.rawValue, choices, program.writable, program.enabled)
}

/** Canon: FixedMovie as read from the event inventory, writable when both switch operations are advertised. */
export function canonPhotoVideoModeState(camera: CanonCamera): CameraControlState | undefined {
    const fixed = camera.listUnknownPropertyStates().find(state => state.code === fixedMovieCode)
    if (fixed?.rawValue === undefined) return undefined
    const current: PhotoVideoMode | undefined = fixed.rawValue === 1 ? 'video' : fixed.rawValue === 0 ? 'photo' : undefined
    const operations = camera.registry.operations
    const switchable =
        camera.advertisesOperation(operations.CanonMovieSelectSwitchOn.code) &&
        camera.advertisesOperation(operations.CanonMovieSelectSwitchOff.code)
    const choices: PhotoVideoMode[] = current ? (switchable ? [current, otherMode(current)] : [current]) : []
    return controlState({ name: 'FixedMovie', code: fixedMovieCode }, current, fixed.rawValue, choices, switchable, true)
}

/** Sends the vendor's switch once. Confirmation is the caller's polled readback. */
async function sendPhotoVideoMode(driver: GenericCamera, state: CameraControlState, requested: PhotoVideoMode): Promise<void> {
    if (driver instanceof NikonCamera) return driver.selectPhotoVideoMode(requested === 'video' ? 'VIDEO' : 'PHOTO')
    if (driver instanceof CanonCamera) return requested === 'video' ? driver.enterMovieMode() : driver.leaveMovieMode()
    if (!(driver instanceof SonyCamera)) throw new CameraUnsupportedError('photoVideoMode', 'Photo / video is not supported by this camera')
    // The admission read just refreshed this inventory.
    const program = driver.listPropertyStates().find(candidate => candidate.code === state.source.code)
    const index = program ? sonyCounterpartIndex(program) : -1
    const target = index >= 0 ? program?.allowedValues?.[index] : undefined
    if (!program || typeof target !== 'string' || sonyProgramMode(Number(program.allowedRawValues?.[index])) !== requested)
        throw new CameraRefusedError(
            'photoVideoMode',
            `The camera advertises no ${requested} counterpart of its current exposure program (${String(program?.value)})`
        )
    await driver.set(driver.registry.properties.ExposureProgramMode, target)
}

/**
 * One photo/video switch: admitted on a fresh observation and a confirmed idle recorder, sent once,
 * and confirmed by polling reads. A refusal from the camera is CameraRefusedError; an acknowledged
 * switch the camera never shows is CameraOutcomeUnknownError (a Canon whose lever is at Movie).
 */
export async function writePhotoVideoMode(
    owner: Camera,
    driver: GenericCamera,
    requested: string,
    read: () => Promise<CameraControlState | undefined>
): Promise<CameraControlState> {
    const state = await read()
    if (!state?.enabled || !state.writable)
        throw new CameraUnsupportedError('photoVideoMode', 'Photo / video is not switchable on this camera right now')
    if (requested !== 'photo' && requested !== 'video')
        throw new CameraRefusedError('photoVideoMode', `Photo / video is 'photo' or 'video', not ${JSON.stringify(requested)}`)
    if (!state.allowedValues?.includes(requested))
        throw new CameraRefusedError('photoVideoMode', `The camera does not offer ${requested} from its current mode`)
    if (state.value === requested) return state
    // Missing recording telemetry never proves idle.
    const recording = await readCameraRecordingState(owner)
    if (recording !== 'idle')
        throw new CameraUnsupportedError('photoVideoMode', `Photo / video cannot change while recording is ${recording}`)
    try {
        await sendPhotoVideoMode(driver, state, requested)
    } catch (error) {
        if (error instanceof PTPResponseError)
            throw new CameraRefusedError('photoVideoMode', `The camera refused the ${requested} switch: ${error.message}`)
        throw error
    }
    let observed: CameraControlState | undefined
    await confirmCameraValue(
        'photoVideoMode',
        requested,
        async () => {
            observed = await read()
            return observed?.value ?? null
        },
        5000
    )
    return observed!
}
