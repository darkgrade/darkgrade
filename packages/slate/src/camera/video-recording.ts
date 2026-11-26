import { protocolAccess } from '@camera/protocol-session'
import { CameraClipNotFoundError } from '@camera/errors'
import { readCameraObjectHandles, readCameraStorages } from '@vendors/generic/storage'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
import type { TakeMedia } from '@workflows/video-take'
import { mediaKind } from '@vendors/generic/media-id'

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Camera.stopRecording confirms the stop first; a clip it did not find is looked for again by the recorder. */
export async function stopCameraRecording(camera: { stopRecording(): Promise<unknown> }): Promise<void> {
    try {
        await camera.stopRecording()
    } catch (error) {
        if (!(error instanceof CameraClipNotFoundError)) throw error
    }
}

/**
 * Persistent PTP movie recording, final-file discovery and bounded-memory transfer. Camera's
 * startRecording prepares the recording mode and its stopRecording restores it.
 */
export class UsbVideoRecording {
    private baseline = new Set<number>()
    private attempted = false
    constructor(
        private readonly camera: any,
        private readonly vendor: 'canon' | 'nikon'
    ) {}
    private get operations() {
        return protocolAccess(this.camera).driver.registry.operations
    }
    private handles() {
        return readCameraObjectHandles(protocolAccess(this.camera).driver)
    }
    /** Nikon reports sizes over 4 GiB through its own object-size property. */
    private size(handle: number, reported: number) {
        return this.vendor === 'nikon' ? protocolAccess(this.camera).driver.fullObjectSize(handle, reported) : reported
    }
    async prepare() {
        const storages = await readCameraStorages(protocolAccess(this.camera).driver)
        if (!storages.some(card => card.writable && card.freeBytes > 0))
            throw new Error('Insert a writable memory card with free space before recording')
        if (this.vendor === 'canon' && (await this.camera.getRecordingState()) === 'recording')
            throw new Error('This camera is already recording')
        this.baseline = await this.handles()
    }
    async start() {
        this.attempted = true
        await this.camera.startRecording()
        const nikon = this.vendor === 'nikon'
        const confirmed = nikon
            ? (await readNikonRecordingStatus(this.camera))?.recording === true
            : (await this.camera.getRecordingState()) === 'recording'
        const reported = nikon ? 'Nikon reports active movie recording' : 'Camera reports card recording'
        return {
            recordingConfirmed: confirmed,
            evidence: confirmed ? reported : 'Movie-start command acknowledged; recording-state telemetry unavailable',
        }
    }
    getRecoveryState() {
        return { version: 1, kind: this.vendor, handles: [...this.baseline] }
    }
    async stopInterrupted(recovery?: unknown) {
        const saved = recovery as { version?: number; kind?: string; handles?: unknown[] } | undefined
        if (
            saved?.version === 1 &&
            saved.kind === this.vendor &&
            Array.isArray(saved.handles) &&
            saved.handles.length <= 100000 &&
            saved.handles.every(value => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff)
        ) {
            this.baseline = new Set(saved.handles as number[])
            this.attempted = true
            return this.stop()
        }
        await stopCameraRecording(this.camera)
        return {
            stopped: true,
            media: [] as TakeMedia[],
            warning:
                'Interrupted recording stopped. Original identity was not retained; copy unindexed footage directly from the card.',
        }
    }
    async stop() {
        if (!this.attempted) return { stopped: true, media: [] as TakeMedia[] }
        await stopCameraRecording(this.camera)
        this.attempted = false
        const deadline = Date.now() + 15000
        let media: TakeMedia[] = []
        let lastIndexError: string | undefined
        do {
            try {
                media = []
                for (const handle of await this.handles()) {
                    if (this.baseline.has(handle)) continue
                    const result = await protocolAccess(this.camera).send(this.operations.GetObjectInfo, { ObjectHandle: handle }),
                        info = result.data
                    const reported = Number(info?.objectCompressedSize)
                    const bytes = result.code === 0x2001 ? await this.size(handle, reported) : reported
                    if (
                        result.code === 0x2001 &&
                        Number.isSafeInteger(bytes) &&
                        bytes > 0 &&
                        mediaKind(info?.filename || '') === 'clip'
                    )
                        media.push({ id: String(handle), filename: String(info.filename), bytes, verified: true })
                }
                if (media.length) break
            } catch (error) {
                lastIndexError = error instanceof Error ? error.message : String(error)
            }
            await sleep(300)
        } while (Date.now() < deadline)
        const warning = 'Recording stopped, but a new card movie is not yet available. Originals remain on the card.'
        return { stopped: true, media, ...(!media.length && { warning: warning + (lastIndexError ? ' ' + lastIndexError : '') }) }
    }
    async transfer(
        file: TakeMedia,
        write: (bytes: Uint8Array) => Promise<void>,
        progress: (bytes: number, total: number) => void
    ) {
        const handle = Number(file.id),
            fresh = await protocolAccess(this.camera).send(this.operations.GetObjectInfo, { ObjectHandle: handle })
        if (
            fresh.code !== 0x2001 ||
            fresh.data?.filename !== file.filename ||
            (await this.size(handle, Number(fresh.data?.objectCompressedSize))) !== file.bytes
        )
            throw new Error('Camera file changed; transfer refused')
        if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error('Invalid camera file size')
        const extended = this.vendor === 'nikon' && this.operations.GetPartialObjectEx
        if (!extended && file.bytes > 0xffffffff)
            throw new Error('This camera transfer path cannot safely address files over 4 GiB; copy this original from its card')
        let offset = 0
        while (offset < file.bytes) {
            const count = Math.min(2 * 1024 * 1024, file.bytes - offset)
            const response = await protocolAccess(this.camera).send(
                extended || this.operations.GetPartialObject,
                extended
                    ? { ObjectHandle: handle, OffsetLower: offset >>> 0, OffsetUpper: Math.floor(offset / 0x100000000), MaxSizeLower: count, MaxSizeUpper: 0 }
                    : { ObjectHandle: handle, Offset: offset, MaxBytes: count },
                undefined,
                count + 12
            )
            const chunk = response.data
            if (response.code !== 0x2001 || !(chunk instanceof Uint8Array) || !chunk.length || chunk.length > count)
                throw new Error('Camera returned an incomplete video chunk')
            await write(response.data)
            offset += response.data.length
            progress(offset, file.bytes)
        }
    }
    async cleanup() {
        if (this.attempted) await this.stop()
    }
}
