import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    Progress,
} from '@kevinschaich/components'
import { formatCaptureDate } from '@renderer/components/FilesPanel'
import type { FileEntry, FilePreview, PreviewProgress } from '@shared/ipc'
import { Download, ImageOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export type PreviewState =
    { status: 'loading' } | { status: 'ready'; preview: FilePreview } | { status: 'failed'; message: string }

interface PreviewDialogProps {
    entry: FileEntry | null
    state: PreviewState
    onDownload: (entry: FileEntry) => void
    onClose: () => void
}

function usePreviewUrl(state: PreviewState): string | null {
    const [url, setUrl] = useState<string | null>(null)
    useEffect(() => {
        if (state.status !== 'ready' || state.preview.kind === 'unsupported') {
            setUrl(null)
            return
        }
        const objectUrl = URL.createObjectURL(
            new Blob([state.preview.data as BlobPart], { type: state.preview.mimeType })
        )
        setUrl(objectUrl)
        return () => URL.revokeObjectURL(objectUrl)
    }, [state])
    return url
}

function formatMegabytes(bytes: number): string {
    return `${(bytes / 1e6).toFixed(1)} MB`
}

function ReadingProgress(): React.JSX.Element {
    const [progress, setProgress] = useState<PreviewProgress | null>(null)
    useEffect(() => window.studio.onPreviewProgress(setProgress), [])
    const percent = progress && progress.fileBytes > 0 ? (progress.receivedBytes / progress.fileBytes) * 100 : 0
    return (
        <span className="flex h-[60vh] w-[60vw] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Progress value={percent} className="w-64" />
            <span className="text-[11px] tabular-nums">
                Reading from the card…
                {progress &&
                    progress.fileBytes > 0 &&
                    ` ${formatMegabytes(progress.receivedBytes)} of ${formatMegabytes(progress.fileBytes)}`}
            </span>
        </span>
    )
}

function PreviewBody({ state, url }: { state: PreviewState; url: string | null }): React.JSX.Element {
    if (state.status === 'loading') {
        return <ReadingProgress />
    }
    if (state.status === 'failed') {
        return (
            <span
                className="flex h-[60vh] w-[60vw] flex-col items-center justify-center gap-2 text-muted-foreground"
                title={state.message}
            >
                <ImageOff className="size-6" aria-hidden />
                Studio couldn’t read this file from the card. Try again in a moment.
            </span>
        )
    }
    if (state.preview.kind === 'video' && url) {
        return <video className="block max-h-[90vh] max-w-[90vw]" src={url} controls autoPlay />
    }
    if (state.preview.kind === 'image' && url) {
        return <img className="block max-h-[90vh] max-w-[90vw]" src={url} alt="" />
    }
    return (
        <span className="flex h-[60vh] w-[60vw] flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="size-6" aria-hidden />
            Studio can’t show this file. Download it to open it in another app.
        </span>
    )
}

/** The file itself, as large as the window allows, with its name and actions floating over it. */
export function PreviewDialog({ entry, state, onDownload, onClose }: PreviewDialogProps): React.JSX.Element {
    const url = usePreviewUrl(state)
    return (
        <Dialog open={entry !== null} onOpenChange={open => !open && onClose()}>
            <DialogContent
                showCloseButton={false}
                className="block w-auto max-w-[90vw] overflow-hidden rounded-xl bg-black p-0 ring-0 sm:max-w-[90vw]"
            >
                <PreviewBody state={state} url={url} />

                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent px-5 pt-4 pb-10">
                    <DialogHeader className="gap-0.5 text-left">
                        <DialogTitle className="text-white">{entry?.filename}</DialogTitle>
                        <DialogDescription className="text-white/70">
                            {entry ? formatCaptureDate(entry.captureDate) : ''}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="pointer-events-auto flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-white hover:bg-white/15 hover:text-white"
                            disabled={!entry}
                            onClick={() => entry && onDownload(entry)}
                        >
                            <Download /> Download
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-white hover:bg-white/15 hover:text-white"
                            onClick={onClose}
                            aria-label="Close preview"
                        >
                            <X />
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
