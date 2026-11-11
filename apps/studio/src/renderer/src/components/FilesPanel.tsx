import { Button, Progress, Spinner } from '@kevinschaich/components'
import { CardThumbnail } from '@renderer/components/CardThumbnail'
import { InspectorSection } from '@renderer/components/InspectorSection'
import type { CameraState, DownloadProgress, FileEntry } from '@shared/ipc'
import { Download, FolderOpen } from 'lucide-react'

function formatBytes(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`
    if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
    return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

/** PTP dates arrive as "YYYYMMDDThhmmss"; show them the way Finder would. */
export function formatCaptureDate(raw: string): string {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(raw)
    if (!match) return raw
    const [, year, month, day, hour, minute] = match
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Overall progress: finished files plus the share of the current one received. */
function downloadPercent(progress: DownloadProgress): number {
    const currentShare = progress.fileBytes > 0 ? progress.receivedBytes / progress.fileBytes : 0
    return ((progress.completed + currentShare) / Math.max(1, progress.total)) * 100
}

function shortenHomePath(path: string): string {
    return path.replace(/^\/Users\/[^/]+/, '~')
}

function isVideo(entry: FileEntry): boolean {
    return /\.(mp4|mov|m4v|mts)$/i.test(entry.filename)
}

interface FilesPanelProps {
    cameraState: CameraState
    files: FileEntry[] | null
    updating: boolean
    downloadProgress: DownloadProgress | null
    previewing: FileEntry | null
    onPreview: (entry: FileEntry) => void
    onDownload: (entry: FileEntry) => void
    onDownloadAll: () => void
    onChooseDir: () => void
    onRevealDir: () => void
}

function CardStatus(props: FilesPanelProps): React.JSX.Element {
    if (!props.cameraState.connected) return <p className="text-muted-foreground">Connect a camera to see its card.</p>
    if (props.files === null) {
        return (
            <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3" /> Reading the card…
            </p>
        )
    }
    return <p className="text-muted-foreground">The card is empty. New photos and clips appear here.</p>
}

export function FilesPanel(props: FilesPanelProps): React.JSX.Element {
    const connected = props.cameraState.connected
    const progress = props.downloadProgress
    const files = props.files ?? []

    return (
        <InspectorSection title="Card" collapsible>
            {connected && files.length > 0 && (
                <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                        {props.updating && <Spinner className="size-3" />}
                        {files.length === 1 ? '1 file' : `${files.length} files`}
                        {props.updating && ' · Updating'}
                    </span>
                    <Button variant="ghost" size="xs" disabled={progress !== null} onClick={props.onDownloadAll}>
                        Download All
                    </Button>
                </div>
            )}

            {progress && (
                <div className="flex flex-col gap-1.5">
                    <Progress value={downloadPercent(progress)} />
                    <span className="truncate text-[11px] text-muted-foreground tabular-nums">
                        {progress.total > 1 ? `${progress.completed + 1} of ${progress.total} — ` : 'Downloading '}
                        {progress.currentFilename}
                        {progress.fileBytes > 0 &&
                            ` · ${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.fileBytes)}`}
                    </span>
                </div>
            )}

            {!connected || files.length === 0 ? (
                <CardStatus {...props} />
            ) : (
                <ul className="-mx-2 flex max-h-80 flex-col overflow-y-auto" aria-label="Files on the card">
                    {files.map(entry => {
                        const selected = props.previewing?.objectHandle === entry.objectHandle
                        return (
                            <li key={`${entry.storageId}-${entry.objectHandle}`} className="group relative">
                                <button
                                    type="button"
                                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'bg-primary/15' : 'hover:bg-foreground/6'}`}
                                    onClick={() => props.onPreview(entry)}
                                    aria-label={`Preview ${entry.filename}`}
                                >
                                    <CardThumbnail entry={entry} video={isVideo(entry)} />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate font-medium">{entry.filename}</span>
                                        <span className="truncate text-[11px] text-muted-foreground">
                                            {formatCaptureDate(entry.captureDate)}
                                        </span>
                                    </span>
                                    <span className="text-[11px] text-muted-foreground tabular-nums group-hover:invisible">
                                        {formatBytes(entry.sizeBytes)}
                                    </span>
                                </button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="invisible absolute top-1/2 right-2 -translate-y-1/2 group-hover:visible"
                                    disabled={progress !== null}
                                    onClick={() => props.onDownload(entry)}
                                    aria-label={`Download ${entry.filename}`}
                                >
                                    <Download />
                                </Button>
                            </li>
                        )
                    })}
                </ul>
            )}

            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={props.cameraState.downloadDir}>
                    Downloads to {shortenHomePath(props.cameraState.downloadDir)}
                </span>
                <Button variant="ghost" size="xs" onClick={props.onChooseDir}>
                    Change…
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={props.onRevealDir} aria-label="Show in Finder">
                    <FolderOpen />
                </Button>
            </div>
        </InspectorSection>
    )
}
