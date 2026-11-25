import { VendorIDs, type GenericCamera } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import {
    DOWNLOAD_PROGRESS_INTERVAL_MS,
    FILES_REFRESH_DELAY_MS,
    PREVIEW_CACHE_MAX_BYTES,
    PTP_OK,
    VIDEO_MIME_TYPES,
    buildPreview,
    errorMessage,
    sonyContentEntry,
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

/** The camera service's the card browser, previews and downloads. Installed on CameraService in camera-service.ts. */
export interface MediaOperations {
    /** Sony reports photos and recording time left on slot 1 among its ordinary properties. */
    updateCardFromStates(
        states: Array<{
            name: string
            rawValue: unknown
        }>
    ): void
    listFilesInner(): Promise<FileEntry[]>
    /** Folders (PTP associations) come back as null: they have no bytes to show or download. */
    readObjectEntry(instance: GenericCamera, storageId: number, objectHandle: number): Promise<FileEntry | null>
    /** Keeps the renderer's card list current without the user asking: debounced, never while recording. */
    scheduleFilesRefresh(delayMs?: number): void
    refreshFilesNow(): Promise<void>
    /** On demand (voice): read the card now and push the result like an automatic refresh. */
    listFiles(): Promise<FileEntry[]>
    /**
     * Sony indexes the card itself (Remote Control with Transfer Mode): reading that index needs no
     * content-transfer mode, so live view keeps running. Other cameras list objects over PTP.
     */
    readCardList(): Promise<FileEntry[]>
    thumbnail(entry: DownloadRequest): Promise<Uint8Array | null>
    cancelPreview(): void
    previewFile(entry: DownloadRequest): Promise<FilePreview>
    /** Sony index entries carry no PTP handle; find the card object by name and size when one is needed. */
    resolveObjectHandle(entry: DownloadRequest): Promise<number>
    downloadFileInner(
        entry: Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename'>,
        position?: {
            index: number
            count: number
        }
    ): Promise<string>
    /**
     * Sony assigns new object handles each time the body re-enters content-transfer mode, which
     * happens whenever live view resumes between listing and downloading. Re-list inside the same
     * paused window and match the file by name, size and capture time.
     */
    downloadFile(entry: DownloadRequest): Promise<string>
    downloadAll(): Promise<string[]>
    downloadAllInner(): Promise<string[]>
    finishDownloadProgress(count: number): void
    saveToDownloadDir(filename: string, data: Uint8Array): Promise<string>
}

export const mediaOperations: MediaOperations & ThisType<CameraService> = {
    /** Sony reports photos and recording time left on slot 1 among its ordinary properties. */
    updateCardFromStates(states: Array<{ name: string; rawValue: unknown }>): void {
        const read = (name: string): number | null => {
            const raw = Number(states.find(state => state.name === name)?.rawValue)
            // 0xFFFFFFFF and friends mean "no card" or "not applicable".
            return Number.isFinite(raw) && raw >= 0 && raw < 0xffffff00 ? raw : null
        }
        this.card = {
            freeBytes: this.card?.freeBytes ?? null,
            remainingPhotos: read('MediaSLOT1_RemainingNumber'),
            // Sony reports 0 outside movie mode, which means "not reported", not "full".
            remainingVideoSeconds: read('MediaSLOT1_RemainingTime') || null,
        }
    },

    async listFilesInner(): Promise<FileEntry[]> {
        const instance = this.requireCamera().getInstance() as GenericCamera & {
            prepareStorageRead?: () => Promise<void>
        }
        const operations = instance.registry.operations
        return this.enqueue(async () => {
            await instance.prepareStorageRead?.()
            const storageIds = await instance.send(operations.GetStorageIDs, {})
            if (storageIds.code !== PTP_OK || !Array.isArray(storageIds.data)) throw new Error('The camera has no card')
            const seen = new Set<number>()
            const entries: FileEntry[] = []
            let freeBytes: number | null = null
            for (const storageId of storageIds.data) {
                if ((storageId & 0xffff) === 0) continue
                if (freeBytes === null) {
                    const storage = await instance.send(operations.GetStorageInfo, { StorageID: storageId })
                    // Sony reports capacity and free space as 0 over PTP; only trust a real capacity.
                    if (storage.code === PTP_OK && storage.data && Number(storage.data.maxCapacity) > 0)
                        freeBytes = Number(storage.data.freeSpaceInBytes)
                }
                const handles = await instance.send(operations.GetObjectHandles, { StorageID: storageId })
                if (handles.code !== PTP_OK || !Array.isArray(handles.data)) continue
                for (const objectHandle of handles.data) {
                    seen.add(objectHandle)
                    if (!this.knownObjects.has(objectHandle)) {
                        this.knownObjects.set(
                            objectHandle,
                            await this.readObjectEntry(instance, storageId, objectHandle)
                        )
                    }
                    const entry = this.knownObjects.get(objectHandle)
                    if (entry) entries.push(entry)
                }
            }
            for (const objectHandle of this.knownObjects.keys()) {
                if (!seen.has(objectHandle)) this.knownObjects.delete(objectHandle)
            }
            if (freeBytes !== null) {
                this.card = { remainingPhotos: null, remainingVideoSeconds: null, ...this.card, freeBytes }
                this.broadcastState()
            }
            return entries
        })
    },

    /** Folders (PTP associations) come back as null: they have no bytes to show or download. */
    async readObjectEntry(instance: GenericCamera, storageId: number, objectHandle: number): Promise<FileEntry | null> {
        const response = await instance.send(instance.registry.operations.GetObjectInfo, { ObjectHandle: objectHandle })
        if (response.code !== PTP_OK || !response.data) return null
        const info = response.data
        if (Number(info.associationType ?? 0) !== 0 || /association/i.test(String(info.objectFormatDecoded ?? '')))
            return null
        return {
            storageId,
            storageDescription: '',
            objectHandle,
            filename: String(info.filename ?? `object-${objectHandle}`),
            sizeBytes: Number(info.objectCompressedSize ?? 0),
            format: String(info.objectFormatDecoded ?? info.objectFormat ?? ''),
            captureDate: String(info.captureDate ?? ''),
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

    /**
     * Sony indexes the card itself (Remote Control with Transfer Mode): reading that index needs no
     * content-transfer mode, so live view keeps running. Other cameras list objects over PTP.
     */
    async readCardList(): Promise<FileEntry[]> {
        const camera = this.camera
        if (camera && this.detectedVendorId === VendorIDs.SONY) {
            return this.enqueue(async () => {
                const list = await camera.listSonyContents({ slot: 1 })
                return list.contents.flatMap(content =>
                    content.files.map(file => sonyContentEntry(list.slot === 2 ? 2 : 1, content, file))
                )
            })
        }
        return this.withLiveViewPaused(() => this.listFilesInner())
    },

    async thumbnail(entry: DownloadRequest): Promise<Uint8Array | null> {
        const content = entry.sonyContent
        const camera = this.camera
        if (!content || !camera || !this.connected) return null
        const key = `${content.slot}:${content.contentId}:${content.fileId}`
        const cached = this.thumbnailCache.get(key)
        if (cached) return cached
        const jpeg = await this.enqueue(() =>
            camera.getSonyContentPreview(content.contentId, content.fileId, { slot: content.slot, size: 'thumbnail' })
        )
        this.thumbnailCache.set(key, jpeg)
        return jpeg
    },

    cancelPreview(): void {
        this.previewAbort?.abort()
        this.previewAbort = null
    },

    async previewFile(entry: DownloadRequest): Promise<FilePreview> {
        const camera = this.requireCameraForControl()
        // Sony serves a large JPEG of any photo straight from its index: no card read, no RAW download.
        const content = entry.sonyContent
        if (content && !VIDEO_MIME_TYPES[entry.filename.split('.').pop()?.toLowerCase() ?? '']) {
            const jpeg = await this.enqueue(() =>
                camera.getSonyContentPreview(content.contentId, content.fileId, {
                    slot: content.slot,
                    size: 'screennail',
                })
            )
            return { kind: 'image', mimeType: 'image/jpeg', data: jpeg }
        }
        const fileHandle = await this.resolveObjectHandle(entry)
        const cached = this.previewCache.get(fileHandle)
        if (cached) return cached
        // Sony only serves objects whose handles were fetched in the current transfer session.
        const data = await this.withLiveViewPaused(async () => {
            await this.listFilesInner()
            let lastReportMs = 0
            this.previewAbort?.abort()
            const abort = new AbortController()
            this.previewAbort = abort
            abort.signal.throwIfAborted()
            return this.enqueue(() =>
                camera.getObject(
                    fileHandle,
                    entry.sizeBytes,
                    receivedBytes => {
                        const now = Date.now()
                        if (now - lastReportMs < DOWNLOAD_PROGRESS_INTERVAL_MS) return
                        lastReportMs = now
                        this.broadcast(IPC_EVENTS.PreviewProgress, {
                            receivedBytes,
                            fileBytes: entry.sizeBytes,
                        } satisfies PreviewProgress)
                    },
                    abort.signal
                )
            )
        })
        const preview = buildPreview(entry.filename, data)
        if (data.byteLength <= PREVIEW_CACHE_MAX_BYTES) this.previewCache.set(fileHandle, preview)
        return preview
    },

    /** Sony index entries carry no PTP handle; find the card object by name and size when one is needed. */
    async resolveObjectHandle(entry: DownloadRequest): Promise<number> {
        if (entry.objectHandle >= 0) return entry.objectHandle
        const objects = await this.withLiveViewPaused(() => this.listFilesInner())
        const match = objects.find(object => object.filename === entry.filename && object.sizeBytes === entry.sizeBytes)
        if (!match) throw new Error(`${entry.filename} is no longer on the card`)
        return match.objectHandle
    },

    async downloadFileInner(
        entry: Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename'>,
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
            camera.getObject(entry.objectHandle, entry.sizeBytes, receivedBytes => {
                const now = Date.now()
                if (now - lastReportMs < DOWNLOAD_PROGRESS_INTERVAL_MS) return
                lastReportMs = now
                report(receivedBytes)
            })
        )
        if (position.count === 1) this.finishDownloadProgress(1)
        const savedPath = await this.saveToDownloadDir(entry.filename, data)
        this.log('system', `Downloaded ${entry.filename} → ${savedPath}`)
        return savedPath
    },

    /**
     * Sony assigns new object handles each time the body re-enters content-transfer mode, which
     * happens whenever live view resumes between listing and downloading. Re-list inside the same
     * paused window and match the file by name, size and capture time.
     */
    async downloadFile(entry: DownloadRequest): Promise<string> {
        return this.withLiveViewPaused(async () => {
            const current = await this.listFilesInner()
            const fresh = current.find(
                candidate => candidate.filename === entry.filename && candidate.sizeBytes === entry.sizeBytes
            )
            if (!fresh) throw new Error(`${entry.filename} is no longer on the card`)
            return this.downloadFileInner(fresh)
        })
    },

    async downloadAll(): Promise<string[]> {
        return this.withLiveViewPaused(() => this.downloadAllInner())
    },

    async downloadAllInner(): Promise<string[]> {
        const entries = await this.listFilesInner()
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
