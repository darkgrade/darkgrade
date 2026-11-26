import { CanonCamera } from '@vendors/canon/canon-camera'
import { confirmCameraValue } from '@camera/confirmation'
import {
    cameraControlDefinitions,
    unrecognizedValueLabel,
    type CameraControlState,
    type UnrecognizedValues,
    type CameraRecordingState,
} from '@camera/controls'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { PhotoVideoMode } from '@camera/settings/values'
import { SonyCamera, type SonyPropertyState } from '@vendors/sony/sony-camera'
import { sendControlWrite } from '@vendors/control-write'
import { sonyCounterpartExposureProgram, sonyExposureProgramKind } from '@vendors/sony/exposure-program'
import type { GenericCamera } from '@vendors/generic/generic-camera'

/**
 * photoVideoMode: whether the camera takes photos or records video, read and set through each
 * vendor's own switch.
 * - Nikon: LiveViewSelector, a single property (mapped in `@vendors/nikon/control-properties`).
 * - Canon: the MovieSelectSwitchOn/Off operations, read back through FixedMovie (0xd1c2; libgphoto2
 *   eosmovieswitch, EDSDK FixedMovie). A body whose lever is at Movie keeps FixedMovie at 1.
 * - Sony: a composite view of the exposure program. Movie and S&Q programs are video; the rest are
 *   photo. A switch selects the same program in the other half (Manual ↔ Movie Manual) and only
 *   when the camera advertises it; there is no implicit fallback to another program. The halves
 *   and counterparts are `@vendors/sony/exposure-program`'s, which recording preparation shares.
 */

const exposureProgramCode = 0x500e
const fixedMovieCode = 0xd1c2

const otherMode = (mode: PhotoVideoMode): PhotoVideoMode => (mode === 'photo' ? 'video' : 'photo')

/** The other half's program when this body advertises it now; undefined otherwise. */
function sonyAdvertisedCounterpart(program: SonyPropertyState): string | undefined {
    const counterpart = sonyCounterpartExposureProgram(program.value)
    return counterpart !== undefined && program.allowedValues?.includes(counterpart) ? counterpart : undefined
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
    const current = program.unrecognized?.value === undefined ? sonyExposureProgramKind(program.value) : undefined
    const choices: PhotoVideoMode[] = current
        ? [current, ...(sonyAdvertisedCounterpart(program) !== undefined ? [otherMode(current)] : [])]
        : []
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
    const target = program && sonyAdvertisedCounterpart(program)
    if (!program || target === undefined || sonyExposureProgramKind(target) !== requested)
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
    driver: GenericCamera & { getRecordingState?(): Promise<CameraRecordingState> },
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
    if (!driver.getRecordingState)
        throw new CameraUnsupportedError('getRecordingState', 'getRecordingState is not supported by this camera')
    const recording = await driver.getRecordingState()
    if (recording !== 'idle')
        throw new CameraUnsupportedError('photoVideoMode', `Photo / video cannot change while recording is ${recording}`)
    await sendControlWrite(driver, 'photoVideoMode', () => sendPhotoVideoMode(driver, state, requested))
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
