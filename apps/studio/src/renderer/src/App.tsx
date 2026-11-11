import { toast, Toaster, TooltipProvider } from '@kevinschaich/components'
import { AmbientBackdrop } from '@renderer/components/AmbientBackdrop'
import { EventLog } from '@renderer/components/EventLog'
import { FilesPanel } from '@renderer/components/FilesPanel'
import { FocusPanel } from '@renderer/components/FocusPanel'
import { LensPanel } from '@renderer/components/LensPanel'
import { LiveViewPanel } from '@renderer/components/LiveViewPanel'
import { LiveViewStats } from '@renderer/components/LiveViewStats'
import { PreviewDialog, type PreviewState } from '@renderer/components/PreviewDialog'
import { RecordingPanel } from '@renderer/components/RecordingPanel'
import { ScopesPanel } from '@renderer/components/ScopesPanel'
import { SettingsPanel } from '@renderer/components/SettingsPanel'
import { TopBar } from '@renderer/components/TopBar'
import { VoicePanel } from '@renderer/components/VoicePanel'
import { readJpegSize } from '@renderer/lib/jpeg-size'
import { DEFAULT_PREVIEW_ASSISTS, type PreviewAssistSettings } from '@renderer/scopes/PreviewAssists'
import type { CameraState, DownloadProgress, FileEntry, FocusFrame, LogEntry } from '@shared/ipc'
import { executeIntent } from '@voice/execute-intent'
import { parseIntent } from '@voice/intent-parser'
import { useVoice } from '@voice/use-voice'
import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_LOG_ENTRIES = 500

const INITIAL_STATE: CameraState = {
    connected: false,
    phase: 'idle',
    vendor: null,
    model: null,
    battery: null,
    card: null,
    lens: null,
    clock: null,
    controls: null,
    osdOverlay: null,
    liveView: false,
    recording: false,
    settings: { iso: null, shutterSpeed: null, aperture: null },
    downloadDir: '',
    platform: '',
}

/** Live view's frame rate is averaged over this window. */
const FRAME_RATE_WINDOW_MS = 10_000

export function App(): React.JSX.Element {
    const api = window.studio

    const [cameraState, setCameraState] = useState<CameraState>(INITIAL_STATE)
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [files, setFiles] = useState<FileEntry[] | null>(null)
    const [filesUpdating, setFilesUpdating] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
    const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null)
    // A slow card read can finish after its preview closed or another opened: only the open one may show.
    const previewEntryRef = useRef<FileEntry | null>(null)
    previewEntryRef.current = previewEntry
    const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' })
    const [liveFrameUrl, setLiveFrameUrl] = useState<string | null>(null)
    const [focusFrames, setFocusFrames] = useState<FocusFrame[]>([])
    const [osdFrameUrl, setOsdFrameUrl] = useState<string | null>(null)
    const [previewAssists, setPreviewAssists] = useState<PreviewAssistSettings>(DEFAULT_PREVIEW_ASSISTS)
    const liveFrameTimes = useRef<number[]>([])
    const [liveFrameSize, setLiveFrameSize] = useState<{ width: number; height: number } | null>(null)
    const [liveFramesPerSecond, setLiveFramesPerSecond] = useState<number | null>(null)
    const [busy, setBusy] = useState(false)
    const [capturing, setCapturing] = useState(false)
    const [logExpanded, setLogExpanded] = useState(false)

    const liveFrameUrlRef = useRef<string | null>(null)
    const zoomingRef = useRef(false)

    // A held zoom must stop if the window loses focus mid-press.
    useEffect(() => {
        const stopZoom = (): void => {
            if (!zoomingRef.current) return
            zoomingRef.current = false
            void api.zoomStop()
        }
        window.addEventListener('blur', stopZoom)
        return () => window.removeEventListener('blur', stopZoom)
    }, [api])

    const appendLog = useCallback((entry: LogEntry) => {
        setLogs(previous => [...previous.slice(-(MAX_LOG_ENTRIES - 1)), entry])
    }, [])

    const log = useCallback(
        (source: LogEntry['source'], message: string, level: LogEntry['level'] = 'info') => {
            appendLog({ timestampMs: Date.now(), source, level, message })
        },
        [appendLog]
    )

    // ------------------------------------------------------- main-process events

    useEffect(() => {
        const unsubscribeState = api.onState(setCameraState)
        const unsubscribeLog = api.onLog(appendLog)
        const unsubscribeCapture = api.onCapture(result => {
            toast.add({
                title: 'Photo saved',
                description: result.filename,
                actionProps: { children: 'Show in Finder', onClick: () => void api.revealPath(result.savedPath) },
            })
        })
        const unsubscribeFiles = api.onFiles(update => {
            setFilesUpdating(update.updating)
            if (update.files) setFiles([...update.files].reverse())
        })
        const unsubscribeFrame = api.onLiveViewFrame(jpeg => {
            liveFrameTimes.current.push(performance.now())
            const size = readJpegSize(jpeg)
            if (size)
                setLiveFrameSize(previous =>
                    previous?.width === size.width && previous.height === size.height ? previous : size
                )
            const url = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }))
            if (liveFrameUrlRef.current) URL.revokeObjectURL(liveFrameUrlRef.current)
            liveFrameUrlRef.current = url
            setLiveFrameUrl(url)
        })
        const unsubscribeFocusFrames = api.onFocusFrames(setFocusFrames)
        const frameRateTimer = setInterval(() => {
            const now = performance.now()
            const recent = liveFrameTimes.current.filter(time => now - time <= FRAME_RATE_WINDOW_MS)
            liveFrameTimes.current = recent
            if (recent.length < 2) return setLiveFramesPerSecond(null)
            const spanSeconds = Math.max((now - recent[0]) / 1000, 1)
            setLiveFramesPerSecond(recent.length / Math.min(spanSeconds, FRAME_RATE_WINDOW_MS / 1000))
        }, 1000)
        const unsubscribeOsd = api.onOsdFrame(png => {
            const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
            setOsdFrameUrl(previous => {
                if (previous) URL.revokeObjectURL(previous)
                return url
            })
        })
        const unsubscribeProgress = api.onFilesProgress(progress => {
            setDownloadProgress(progress.total > 0 && progress.completed < progress.total ? progress : null)
        })
        return () => {
            unsubscribeState()
            unsubscribeLog()
            unsubscribeCapture()
            unsubscribeFrame()
            unsubscribeProgress()
            unsubscribeFocusFrames()
            clearInterval(frameRateTimer)
            unsubscribeOsd()
            unsubscribeFiles()
        }
    }, [api, appendLog])

    // Initial state + auto-connect attempt on launch (non-fatal if no camera).
    // Guarded so React StrictMode's double-mounted effect can't race two connects.
    const autoConnectStartedRef = useRef(false)
    useEffect(() => {
        if (autoConnectStartedRef.current) return
        autoConnectStartedRef.current = true
        void (async () => {
            const state = await api.getState()
            if (state.ok) setCameraState(state.data)
            const connected = await api.connect()
            // A reloaded window missed the list the main process already sent; ask for it.
            if (connected.ok && connected.data.connected) void api.listFiles()
            if (!connected.ok) {
                log('system', `Auto-connect: ${connected.error} — plug in a camera and it will connect automatically`)
            }
        })()
    }, [api, log])

    // ----------------------------------------------------------------- actions

    const run = useCallback(
        async <T,>(
            operation: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>
        ): Promise<T | null> => {
            setBusy(true)
            try {
                const result = await operation()
                if (!result.ok) {
                    log('system', result.error, 'error')
                    toast.add({ title: "The camera didn't respond", description: result.error, type: 'error' })
                    return null
                }
                return result.data
            } finally {
                setBusy(false)
            }
        },
        [log]
    )

    /** Voice asks for the list on demand; the result also arrives through onFiles. */
    const refreshFiles = useCallback(async (): Promise<FileEntry[]> => {
        const result = await api.listFiles()
        if (!result.ok) throw new Error(result.error)
        return result.data
    }, [api])

    const openPreview = useCallback(
        async (entry: FileEntry) => {
            previewEntryRef.current = entry
            setPreviewEntry(entry)
            setPreviewState({ status: 'loading' })
            const result = await api.previewFile(entry)
            if (previewEntryRef.current !== entry) return
            setPreviewState(
                result.ok ? { status: 'ready', preview: result.data } : { status: 'failed', message: result.error }
            )
        },
        [api]
    )

    const capture = useCallback(async () => {
        setCapturing(true)
        try {
            await run(() => api.capture())
        } finally {
            setCapturing(false)
        }
    }, [api, run])

    const focus = useCallback(() => void run(() => api.focus()), [api, run])

    useEffect(() => {
        if (cameraState.connected) return
        setFiles(null)
        setDownloadProgress(null)
        setPreviewEntry(null)
    }, [cameraState.connected])

    const previewLoading = previewEntry !== null && previewState.status === 'loading'
    const cardBusy = filesUpdating || downloadProgress !== null || previewLoading

    // Return takes a photo and F focuses, like a tethering app; ignored while typing.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null
            const typing = target?.closest('input, textarea, select, [contenteditable="true"]')
            if (typing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
            if (!cameraState.connected || busy || cardBusy || previewEntry) return
            if (event.key === 'Enter' && target?.tagName !== 'BUTTON') {
                event.preventDefault()
                void capture()
            }
            if (event.key === 'f' || event.key === 'F') focus()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [busy, cardBusy, previewEntry, cameraState.connected, capture, focus])

    // ------------------------------------------------------------------- voice

    const handleTranscript = useCallback(
        async (transcript: string): Promise<{ reply: string; ok: boolean } | null> => {
            const parsed = parseIntent(transcript)
            if (!parsed) {
                log('voice', `Heard "${transcript}" — no matching command`)
                return null
            }
            log('voice', `"${transcript}" → ${parsed.intent}${parsed.value ? ` (${parsed.value})` : ''}`)
            try {
                const reply = await executeIntent(parsed, { api, refreshFiles })
                log('voice', reply)
                return { reply, ok: true }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                log('voice', message, 'error')
                // Full error goes to the log; keep the spoken reply short.
                return { reply: "That didn't work", ok: false }
            }
        },
        [api, log, refreshFiles]
    )

    const voice = useVoice({
        onTranscript: handleTranscript,
        onLog: (message, level) => log('voice', message, level),
    })

    // --------------------------------------------------------------------- UI

    return (
        <TooltipProvider delay={400}>
            <Toaster>
                <div className="relative flex h-full flex-col">
                    <AmbientBackdrop frameUrl={cameraState.connected ? liveFrameUrl : null} />
                    <TopBar
                        cameraState={cameraState}
                        busy={busy}
                        voiceListening={voice.mode === 'continuous' || voice.pttActive}
                        onConnect={() => void run(() => api.connect())}
                        onDisconnect={() => void run(() => api.disconnect())}
                        onOsdOverlayChange={enabled => void run(() => api.setOsdOverlay(enabled))}
                    />
                    <div className="flex min-h-0 flex-1">
                        <main className="flex min-w-0 flex-1 flex-col">
                            <LiveViewPanel
                                cameraState={cameraState}
                                liveFrameUrl={liveFrameUrl}
                                focusFrames={focusFrames}
                                previewAssists={previewAssists}
                                osdFrameUrl={cameraState.osdOverlay ? osdFrameUrl : null}
                                busy={busy}
                                capturing={capturing}
                                locked={cardBusy}
                                readingCard={cardBusy}
                                onRetryLiveView={() => void run(() => api.liveViewStart())}
                                onFocus={focus}
                                onFocusAt={
                                    cameraState.vendor === 'Sony' || cameraState.vendor === 'Nikon'
                                        ? async (x, y) => (await run(() => api.focusAt(x, y))) !== null
                                        : null
                                }
                                onCapture={() => void capture()}
                                onStartRecording={() => void run(() => api.recordStart())}
                                onStopRecording={() => void run(() => api.recordStop())}
                            />
                        </main>
                        <aside
                            className="flex w-80 shrink-0 flex-col overflow-y-auto bg-black/55"
                            aria-label="Camera controls"
                        >
                            <ScopesPanel
                                frameUrl={cameraState.connected && cameraState.liveView ? liveFrameUrl : null}
                                assists={previewAssists}
                                onAssistsChange={setPreviewAssists}
                            />
                            <SettingsPanel
                                cameraState={cameraState}
                                locked={cardBusy}
                                onSetIso={value => void run(() => api.setIso(value))}
                                onSetShutterSpeed={value => void run(() => api.setShutterSpeed(value))}
                                onSetAperture={value => void run(() => api.setAperture(value))}
                                onChangeControl={(name, value) => void run(() => api.setControl(name, value))}
                            />
                            <FocusPanel
                                cameraState={cameraState}
                                locked={cardBusy}
                                onChange={(name, value) => void run(() => api.setControl(name, value))}
                            />
                            <LensPanel
                                cameraState={cameraState}
                                locked={cardBusy}
                                onZoomStart={direction => {
                                    zoomingRef.current = true
                                    void api.zoomStart(direction)
                                }}
                                onZoomStop={() => {
                                    if (!zoomingRef.current) return
                                    zoomingRef.current = false
                                    void api.zoomStop()
                                }}
                                onChange={(name, value) => void run(() => api.setControl(name, value))}
                            />
                            <RecordingPanel
                                cameraState={cameraState}
                                locked={cardBusy}
                                onChange={(name, value) => void run(() => api.setControl(name, value))}
                            />
                            <FilesPanel
                                cameraState={cameraState}
                                files={files}
                                updating={filesUpdating}
                                downloadProgress={downloadProgress}
                                previewing={previewEntry}
                                onPreview={entry => void openPreview(entry)}
                                onDownload={entry => void run(() => api.downloadFile(entry))}
                                onDownloadAll={() =>
                                    void run(() => api.downloadAll()).finally(() => setDownloadProgress(null))
                                }
                                onChooseDir={() => void run(() => api.chooseDownloadDir())}
                                onRevealDir={() => void api.revealPath(cameraState.downloadDir)}
                            />
                            <VoicePanel voice={voice} />
                        </aside>
                    </div>
                    <EventLog
                        logs={logs}
                        expanded={logExpanded}
                        onToggle={() => setLogExpanded(previous => !previous)}
                        trailing={
                            cameraState.connected && (
                                <LiveViewStats
                                    framesPerSecond={cameraState.liveView ? liveFramesPerSecond : null}
                                    frameSize={cameraState.liveView ? liveFrameSize : null}
                                    quality={cameraState.controls?.liveViewQuality ?? null}
                                    disabled={busy}
                                    onQualityChange={value => void run(() => api.setControl('liveViewQuality', value))}
                                />
                            )
                        }
                    />
                </div>
                <PreviewDialog
                    entry={previewEntry}
                    state={previewState}
                    onDownload={entry => void run(() => api.downloadFile(entry))}
                    onClose={() => {
                        setPreviewEntry(null)
                        void api.cancelPreview()
                    }}
                />
            </Toaster>
        </TooltipProvider>
    )
}
