import type { Camera, CardStatus } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import {
    DOWNLOAD_PROGRESS_INTERVAL_MS,
    FILES_REFRESH_DELAY_MS,
    PREVIEW_CACHE_MAX_BYTES,
    buildPreview,
    errorMessage,
    fileEntry,
    requiresReconnect,
} from '@main/camera-service/shared'
import type {
    DownloadProgress,
    DownloadRequest,
    FileEntry,
    FilePreview,
    FilesUpdate,
    PreviewProgress,
} from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The card the pill describes: the first slot with a readable card, else the first slot reported. */
function shownCard(cards: CardStatus[]): CardStatus | undefined {
    return cards.find(card => card.state === 'ready') ?? cards[0]
}

/** The camera service's card status, card browser, previews and downloads. Installed on CameraService in camera-service.ts. */
export interface MediaOperations {
    /** Reads card space through Slate. Call only from inside the queue (it does not enqueue). */
    readCardStatus(camera: Camera): Promise<void>
    /** Keeps the renderer's card list current without the user asking: debounced, never while recording. */
    scheduleFilesRefresh(delayMs?: number): void
    refreshFilesNow(): Promise<void>
    /** On demand (voice): read the card now and push the result like an automatic refresh. */
    listFiles(): Promise<FileEntry[]>
    /** Slate lists the card newest first; on Sony from the camera's own index, so live view keeps running. */
    readCardList(): Promise<FileEntry[]>
    thumbnail(entry: DownloadRequest): Promise<Uint8Array | null>
    cancelPreview(): void
    previewFile(entry: DownloadRequest): Promise<FilePreview>
    downloadFileInner(entry: DownloadRequest, position?: { index: number; count: number }): Promise<string>
    /** Downloads pause live view: a Sony body serves card bytes only in content-transfer mode. */
    downloadFile(entry: DownloadRequest): Promise<string>
    downloadAll(): Promise<string[]>
    downloadAllInner(): Promise<string[]>
    finishDownloadProgress(count: number): void
    saveToDownloadDir(filename: string, data: Uint8Array): Promise<string>
}

export const mediaOperations: MediaOperations & ThisType<CameraService> = {
    async readCardStatus(camera: Camera): Promise<void> {
        try {
            const card = shownCard(await camera.getCardStatus())
            this.card = card
                ? {
                      freeBytes: card.freeBytes ?? null,
                      remainingPhotos: card.photosRemaining ?? null,
                      remainingVideoSeconds: card.recordingSecondsRemaining ?? null,
                  }
                : null
            this.broadcastState()
        } catch (error) {
            if (requiresReconnect(error)) throw error
            // Card space is best-effort; the last reading stays until a read succeeds.
        }
    },

    /** Keeps the renderer's card list current without the user asking: debounced, never while recording. */
    scheduleFilesRefresh(delayMs = FILES_REFRESH_DELAY_MS): void {
        if (this.filesRefreshTimer) clearTimeout(this.filesRefreshTimer)
        this.filesRefreshTimer = setTimeout(() => {
            this.filesRefreshTimer = null
            void this.refreshFilesNow()
        }, delayMs)
    },

    async refreshFilesNow(): Promise<void> {
        if (!this.connected || this.recording || this.storageSessionActive || this.filesRefreshRunning) {
            if (this.connected && !this.recording) this.scheduleFilesRefresh()
            return
        }
        this.filesRefreshRunning = true
        this.broadcast(IPC_EVENTS.Files, { files: null, updating: true } satisfies FilesUpdate)
        try {
            const files = await this.readCardList()
            this.broadcast(IPC_EVENTS.Files, { files, updating: false } satisfies FilesUpdate)
        } catch (error) {
            this.broadcast(IPC_EVENTS.Files, { files: null, updating: false } satisfies FilesUpdate)
            this.log('system', `Couldn't read the card: ${errorMessage(error)}`, 'error')
        } finally {
            this.filesRefreshRunning = false
        }
    },

    /** On demand (voice): read the card now and push the result like an automatic refresh. */
    async listFiles(): Promise<FileEntry[]> {
        const files = await this.readCardList()
        this.broadcast(IPC_EVENTS.Files, { files, updating: false } satisfies FilesUpdate)
        return files
    },

    async readCardList(): Promise<FileEntry[]> {
        const camera = this.requireCamera()
        return this.enqueue(async () => {
            const items = await camera.listMedia()
            await this.readCardStatus(camera)
            return items.map(fileEntry)
        })
    },

    async thumbnail(entry: DownloadRequest): Promise<Uint8Array | null> {
        const camera = this.camera
        if (!camera || !this.connected || !entry.previews.includes('thumbnail')) return null
        const cached = this.thumbnailCache.get(entry.id)
        if (cached) return cached
        const jpeg = await this.enqueue(() => camera.getMediaPreview(entry.id, 'thumbnail'))
        this.thumbnailCache.set(entry.id, jpeg)
        return jpeg
    },

    cancelPreview(): void {
        this.previewAbort?.abort()
        this.previewAbort = null
    },

    async previewFile(entry: DownloadRequest): Promise<FilePreview> {
        const camera = this.requireCameraForControl()
        // A camera that serves a large JPEG of a photo needs no card read and no RAW download.
        if (entry.kind !== 'clip' && entry.previews.includes('preview')) {
            const jpeg = await this.enqueue(() => camera.getMediaPreview(entry.id, 'preview'))
            return { kind: 'image', mimeType: 'image/jpeg', data: jpeg }
        }
        const cached = this.previewCache.get(entry.id)
        if (cached) return cached
        const data = await this.withLiveViewPaused(async () => {
            let lastReportMs = 0
            this.previewAbort?.abort()
            const abort = new AbortController()
            this.previewAbort = abort
            abort.signal.throwIfAborted()
            return this.enqueue(() =>
                camera.downloadMedia(entry.id, {
                    onProgress: receivedBytes => {
                        const now = Date.now()
                        if (now - lastReportMs < DOWNLOAD_PROGRESS_INTERVAL_MS) return
                        lastReportMs = now
                        this.broadcast(IPC_EVENTS.PreviewProgress, {
                            receivedBytes,
                            fileBytes: entry.sizeBytes,
                        } satisfies PreviewProgress)
                    },
                    signal: abort.signal,
                })
            )
        })
        const preview = buildPreview(entry.filename, data)
        if (data.byteLength <= PREVIEW_CACHE_MAX_BYTES) this.previewCache.set(entry.id, preview)
        return preview
    },

    async downloadFileInner(
        entry: DownloadRequest,
        position: { index: number; count: number } = { index: 0, count: 1 }
    ): Promise<string> {
        const camera = this.requireCamera()
        const report = (receivedBytes: number): void =>
            this.broadcast(IPC_EVENTS.FilesProgress, {
                completed: position.index,
                total: position.count,
                currentFilename: entry.filename,
                receivedBytes,
                fileBytes: entry.sizeBytes,
            } satisfies DownloadProgress)
        report(0)
        let lastReportMs = 0
        const data = await this.enqueue(() =>
            camera.downloadMedia(entry.id, {
                onProgress: receivedBytes => {
                    const now = Date.now()
                    if (now - lastReportMs < DOWNLOAD_PROGRESS_INTERVAL_MS) return
                    lastReportMs = now
                    report(receivedBytes)
                },
            })
        )
        if (position.count === 1) this.finishDownloadProgress(1)
        const savedPath = await this.saveToDownloadDir(entry.filename, data)
        this.log('system', `Downloaded ${entry.filename} → ${savedPath}`)
        return savedPath
    },

    /** Slate finds the file again by its id, even after the camera renumbered its objects. */
    async downloadFile(entry: DownloadRequest): Promise<string> {
        return this.withLiveViewPaused(() => this.downloadFileInner(entry))
    },

    async downloadAll(): Promise<string[]> {
        return this.withLiveViewPaused(() => this.downloadAllInner())
    },

    async downloadAllInner(): Promise<string[]> {
        const camera = this.requireCamera()
        const entries = (await this.enqueue(() => camera.listMedia())).map(fileEntry)
        const savedPaths: string[] = []
        for (const [index, entry] of entries.entries()) {
            savedPaths.push(await this.downloadFileInner(entry, { index, count: entries.length }))
        }
        this.finishDownloadProgress(entries.length)
        return savedPaths
    },

    finishDownloadProgress(count: number): void {
        this.broadcast(IPC_EVENTS.FilesProgress, {
            completed: count,
            total: count,
            currentFilename: '',
            receivedBytes: 0,
            fileBytes: 0,
        } satisfies DownloadProgress)
    },

    async saveToDownloadDir(filename: string, data: Uint8Array): Promise<string> {
        if (!existsSync(this.downloadDir)) mkdirSync(this.downloadDir, { recursive: true })
        const savedPath = join(this.downloadDir, filename)
        await writeFile(savedPath, data)
        return savedPath
    },
}
