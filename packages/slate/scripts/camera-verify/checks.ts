import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { CameraControlId } from '@camera/controls'
import type { Camera } from '@camera/index'
import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const takeMilliseconds = 3000
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/** The card's media, or undefined when this camera offers no listing. */
async function listMediaIfSupported(camera: Camera) {
    return camera.listMedia().catch(error => (error instanceof CameraUnsupportedError ? undefined : Promise.reject(error)))
}

async function newMediaSince(camera: Camera, before: { id: string }[]) {
    const known = new Set(before.map(item => item.id))
    return ((await camera.listMedia()) ?? []).filter(item => !known.has(item.id))
}

/** One photo adds exactly one file to the card, the one takePhoto names. Adds a file; deletes nothing. */
export const photoFileCheck: SmokeArea = {
    name: 'photo-file',
    description: 'one takePhoto adds exactly one card file, the one it names',
    async run(camera, report) {
        const before = await listMediaIfSupported(camera)
        if (!before) return report.skipped('photo-file', 'the camera offers no card listing')
        const photo = await camera.takePhoto({ autofocus: false }).catch(error => {
            if (error instanceof CameraUnsupportedError || error instanceof CameraRefusedError) return error
            throw error
        })
        if (photo instanceof Error) return report.skipped('takePhoto({ autofocus: false })', photo.message)
        const added = await newMediaSince(camera, before)
        if (added.length !== 1 || added[0]!.id !== photo.mediaId)
            throw new Error(`takePhoto named ${photo.mediaId} (${photo.name}); the card gained ${JSON.stringify(added.map(item => [item.id, item.name]))}`)
        report.confirmed('one card file for one photo', { mediaId: photo.mediaId, name: photo.name, sizeBytes: photo.sizeBytes })
    },
}

/** Decodes every video frame with ffmpeg; returns the first video stream's summary or throws. */
function decodeClip(path: string) {
    const decode = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', path, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' })
    if (decode.error) throw new Error(`ffmpeg could not run: ${decode.error.message}`)
    if (decode.status !== 0 || decode.stderr.trim()) throw new Error(`ffmpeg could not decode the clip: ${decode.stderr.trim() || `exit ${decode.status}`}`)
    const probe = spawnSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', path],
        { encoding: 'utf8' }
    )
    if (probe.status !== 0) throw new Error(`ffprobe could not read the clip: ${probe.stderr.trim()}`)
    const summary = JSON.parse(probe.stdout) as { streams?: Record<string, unknown>[]; format?: { duration?: string } }
    return { ...summary.streams?.[0], durationSeconds: Number(summary.format?.duration) }
}

/** One take adds exactly one clip to the card, and ffmpeg decodes all of it. Adds a clip; deletes nothing. */
export const clipDecodeCheck: SmokeArea = {
    name: 'clip-decode',
    description: 'one take adds exactly one card clip, downloaded and decoded with ffmpeg',
    async run(camera, report) {
        const state = await camera.getRecordingState().catch(error => (error instanceof CameraUnsupportedError ? error : Promise.reject(error)))
        if (state instanceof Error) return report.skipped('clip-decode', state.message)
        if (state !== 'idle') return report.skipped('clip-decode', `the camera reports ${state}, not idle`)
        const before = await listMediaIfSupported(camera)
        if (!before) return report.skipped('clip-decode', 'the camera offers no card listing')
        await camera.startRecording()
        await sleep(takeMilliseconds)
        const clip = await camera.stopRecording()
        const added = (await newMediaSince(camera, before)).filter(item => item.kind === 'clip')
        if (added.length !== 1 || added[0]!.name !== clip.name)
            throw new Error(`stopRecording named ${clip.name}; the card gained clips ${JSON.stringify(added.map(item => item.name))}`)
        const data = await camera.downloadMedia(added[0]!.id)
        if (clip.sizeBytes !== undefined && data.byteLength !== clip.sizeBytes)
            throw new Error(`downloadMedia read ${data.byteLength} bytes of a ${clip.sizeBytes}-byte clip`)
        const directory = mkdtempSync(join(tmpdir(), 'camera-verify-'))
        try {
            const path = join(directory, clip.name)
            writeFileSync(path, data)
            report.confirmed('one card clip for one take, decoded', { name: clip.name, sizeBytes: data.byteLength, ...decodeClip(path) })
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    },
}

/** disconnect then connect on the same Camera reaches the same body. */
export const reconnectCheck: SmokeArea = {
    name: 'reconnect',
    description: 'disconnect and connect again on the same Camera',
    async run(camera, report) {
        const before = await camera.getInfo()
        await camera.disconnect()
        await camera.connect()
        const after = await camera.getInfo()
        if (after.model !== before.model || after.serialNumber !== before.serialNumber)
            throw new Error(`reconnect reached ${after.model} ${after.serialNumber ?? ''}, not ${before.model} ${before.serialNumber ?? ''}`)
        report.confirmed('disconnect, connect, getInfo', { model: after.model, serialNumber: after.serialNumber })
    },
}

export type ControlSnapshot = Partial<Record<CameraControlId, { value: string; writable: boolean }>>

/** Writes back a value as getCapabilities read it; colour temperature is read as a Kelvin label. */
function writeBack(camera: Camera, id: CameraControlId, value: string) {
    if (id === 'colorTemperature') return camera.setControl(id, Number.parseInt(value, 10))
    return camera.setControl(id, value)
}

const controlIds = (snapshot: ControlSnapshot) => Object.keys(snapshot) as CameraControlId[]

export async function snapshotControls(camera: Camera): Promise<ControlSnapshot> {
    const snapshot: ControlSnapshot = {}
    for (const control of Object.values((await camera.getCapabilities()).controls))
        if (control) snapshot[control.id] = { value: control.value, writable: control.writable }
    return snapshot
}

/**
 * Every writable setting reads as it did before the run. A changed one is written back, and the
 * check still fails, naming the area run that left it changed.
 */
export function restoreCheck(original: ControlSnapshot): SmokeArea {
    return {
        name: 'restore',
        description: 'every writable setting reads as before the run',
        async run(camera, report) {
            const current = await snapshotControls(camera)
            const changed = controlIds(original).filter(id => original[id]!.writable && current[id]?.writable && current[id]!.value !== original[id]!.value)
            if (!changed.length) return report.confirmed('settings unchanged', `${controlIds(original).length} controls compared`)
            const restored = []
            for (const id of changed) {
                const result = await writeBack(camera, id, original[id]!.value).then(
                    observation => observation.value,
                    (error: unknown) => `not restored: ${error instanceof Error ? error.message : String(error)}`
                )
                restored.push(`${id} ${current[id]!.value} → ${result}`)
            }
            throw new Error(`the run left settings changed: ${restored.join('; ')}`)
        },
    }
}
