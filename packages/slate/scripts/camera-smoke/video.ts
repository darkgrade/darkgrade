import type { Clip } from '@camera/driver'
import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { readCameraMovieAudio } from '@camera/movie-audio'
import { readCameraObjectHandles } from '@vendors/generic/storage'
import type { SmokeArea, SmokeReport } from '@scripts/camera-smoke/smoke-area'
import { protocolSession } from '@camera/protocol-session'

const takeMilliseconds = 3000

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/** The settings recording may change on its way in; each must read the same after the take. */
async function recordingSetup(camera: Camera) {
    const controls = (await camera.getCapabilities()).controls
    return { exposureProgram: controls.exposureProgram?.value, audioRecording: controls.audioRecording?.value }
}

/** One short take through the public API: Record, a few seconds, Stop, the clip, the setup put back. */
async function take(camera: Camera, report: SmokeReport, label: string): Promise<Clip> {
    const before = await recordingSetup(camera)
    await camera.startRecording()
    report.confirmed(`${label}: startRecording`, await camera.getRecordingState())
    await sleep(takeMilliseconds)
    report.confirmed(`${label}: getRecordingState while recording`, await camera.getRecordingState())
    const clip = await camera.stopRecording()
    report.confirmed(`${label}: stopRecording`, clip)
    const state = await camera.getRecordingState()
    if (state !== 'idle') throw new Error(`After stopRecording the camera reports ${state}, not idle`)
    const after = await recordingSetup(camera)
    if (after.exposureProgram !== before.exposureProgram)
        throw new Error(`Exposure program ${String(after.exposureProgram)} was not put back to ${String(before.exposureProgram)}`)
    report.confirmed(`${label}: setup put back`, after)
    return clip
}

/**
 * Whether the clip's movie metadata carries a sound track (reads atom headers and the moov box
 * only, never the video). Sony serves partial reads through SDIO_GetPartialLargeObject rather
 * than the standard GetPartialObject, so reads are routed there on a Sony body.
 */
async function audioEvidence(camera: Camera, clip: Clip) {
    if (clip.sizeBytes === undefined) return { status: 'unverified', detail: 'clip size over 4 GiB' }
    const driver = protocolSession(camera).driver
    const operations = driver.registry.operations
    const sonyLargeObject = 'SDIO_GetPartialLargeObject' in operations ? operations.SDIO_GetPartialLargeObject : undefined
    const reader = sonyLargeObject
        ? {
              driver,
              send: (_operation: unknown, parameters: { ObjectHandle: number; Offset: number; MaxBytes: number }) =>
                  driver.send(sonyLargeObject, {
                      ObjectHandle: parameters.ObjectHandle,
                      OffsetLower: parameters.Offset >>> 0,
                      OffsetUpper: Math.floor(parameters.Offset / 0x100000000),
                      MaxBytes: parameters.MaxBytes,
                  }, undefined, parameters.MaxBytes + 12),
          }
        : camera
    // Listing the card puts a Sony body in content-transfer mode, which its partial reads need.
    if (!(await readCameraObjectHandles(camera)).has(Number(clip.mediaId)))
        return { status: 'unverified', detail: `clip ${clip.mediaId} is not in the card index` }
    return readCameraMovieAudio(reader, { handle: Number(clip.mediaId), filename: clip.name, objectCompressedSize: clip.sizeBytes })
}

/** With audio off for one take, the clip has no sound track; turned back on, the next one does. */
async function audioTakes(camera: Camera, report: SmokeReport) {
    let original: string | undefined
    try {
        original = await camera.getAudioRecording()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped('audio takes', error.message)
        throw error
    }
    const movieMode = await enterMovieModeForAudio(camera, report)
    try {
        const control = (await camera.getCapabilities()).controls.audioRecording
        if (!control?.writable || !control.allowedValues?.includes('Off'))
            return report.skipped('audio takes', `audio recording is not writable now (${control?.value ?? 'absent'})`)
        report.confirmed('setAudioRecording("Off")', await camera.setAudioRecording('Off'))
        const silent = await take(camera, report, 'audio off')
        report.confirmed('audio off: clip sound track', await audioEvidence(camera, silent))
        report.confirmed('setAudioRecording("On")', await camera.setAudioRecording('On'))
        const sound = await take(camera, report, 'audio on')
        report.confirmed('audio on: clip sound track', await audioEvidence(camera, sound))
    } finally {
        if ((await camera.getAudioRecording().catch(() => undefined)) !== original && original)
            report.confirmed(`restore: setControl('audioRecording', ${JSON.stringify(original)})`, (await camera.setControl('audioRecording', original)).value)
        await movieMode.restore()
    }
}

/**
 * Sony greys out audio recording outside a movie mode (a7 V, 2026-11-24). The check, as an
 * operation, may select the advertised movie mode itself and put the original back afterwards.
 */
async function enterMovieModeForAudio(camera: Camera, report: SmokeReport) {
    const mode = (await camera.getCapabilities()).controls.exposureProgram
    const movie = mode && !/^Movie /.test(mode.value) ? `Movie ${mode.value}` : undefined
    if (!mode?.writable || !movie || !mode.allowedValues?.includes(movie)) return { restore: async () => {} }
    report.confirmed(`setup: setControl('exposureProgram', ${JSON.stringify(movie)})`, (await camera.setControl('exposureProgram', movie)).value)
    await sleep(500)
    return {
        restore: async () => {
            report.confirmed(`restore: setControl('exposureProgram', ${JSON.stringify(mode.value)})`, (await camera.setControl('exposureProgram', mode.value)).value)
        },
    }
}

export const videoSmoke: SmokeArea = {
    name: 'video',
    description: 'getRecordingState, a short take with startRecording/stopRecording and its clip, and audio off/on takes',
    async run(camera, report) {
        let state
        try {
            state = await camera.getRecordingState()
        } catch (error) {
            if (error instanceof CameraUnsupportedError) return report.skipped('video', error.message)
            throw error
        }
        report.confirmed('getRecordingState', state)
        if (state !== 'idle') return report.skipped('takes', `the camera reports ${state}, not idle`)
        await take(camera, report, 'take')
        await audioTakes(camera, report)
    },
}
