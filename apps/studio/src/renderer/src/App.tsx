import { toast, Toaster, TooltipProvider } from '@kevinschaich/components'
import { AppearanceTuner } from '@renderer/components/AppearanceTuner'
import { CameraPill } from '@renderer/components/CameraPill'
import { EventLog } from '@renderer/components/EventLog'
import { FilesPanel } from '@renderer/components/FilesPanel'
import { FocusPanel } from '@renderer/components/FocusPanel'
import { LensPanel } from '@renderer/components/LensPanel'
import { LiveViewPanel } from '@renderer/components/LiveViewPanel'
import { PerfCard } from '@renderer/components/PerfMonitor'
import { PreviewDialog, type PreviewState } from '@renderer/components/PreviewDialog'
import { RecordingPanel } from '@renderer/components/RecordingPanel'
import { Resizer } from '@renderer/components/Resizer'
import { chooseScope, scopeChoice, ScopesPanel } from '@renderer/components/ScopesPanel'
import { SettingsPanel } from '@renderer/components/SettingsPanel'
import { VoicePanel } from '@renderer/components/VoicePanel'
import { DEFAULT_PREVIEW_ASSISTS, type PreviewAssistSettings } from '@renderer/gpu/assists'
import { publishOsdFrame } from '@renderer/gpu/device'
import { appendLog, downloadProgress } from '@renderer/lib/activity-store'
import { chooseLiveFeed, publishFocusFrames, publishLiveFrame } from '@renderer/lib/live-frame-store'
import { useResizable } from '@renderer/lib/use-resizable'
import { overlaysEnabled, useVisionOverlayLoops } from '@renderer/lib/vision-overlays'
import { startWebcamFeed, stopWebcamFeed, webcamFeedStatus } from '@renderer/lib/webcam-feed'
import { usesWebcamFeed, type CameraState, type FileEntry, type LiveFeedChoice, type LogEntry } from '@shared/ipc'
import { useLiveTranscription } from '@voice/use-live-transcription'
import { Unplug } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/** The camera controls sidebar: 320px to start, dragged between these, never more than 45% of the window. */
const SIDEBAR_WIDTH = 320
const SIDEBAR_MIN = 260
const sidebarMax = (): number => Math.min(560, window.innerWidth * 0.45)
const VOICE_RELEASE_DELAY_MS = 60_000

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
    recordingState: 'idle',
    settings: { iso: null, shutterSpeed: null, aperture: null },
    downloadDir: '',
    platform: '',
}

export function App(): React.JSX.Element {
    const api = window.studio
    const sidebar = useResizable('studio.sidebar-width', SIDEBAR_WIDTH, SIDEBAR_MIN, sidebarMax, 'right')

    const [cameraState, setCameraState] = useState<CameraState>(INITIAL_STATE)
    const [files, setFiles] = useState<FileEntry[] | null>(null)
    const [filesUpdating, setFilesUpdating] = useState(false)
    // Only whether a download runs: its progress re-renders the Card panel alone.
    const downloading = downloadProgress.useSelect(progress => progress !== null)
    const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null)
    // A slow card read can finish after its preview closed or another opened: only the open one may show.
    const previewEntryRef = useRef<FileEntry | null>(null)
    previewEntryRef.current = previewEntry
    const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' })
    const [previewAssists, setPreviewAssists] = useState<PreviewAssistSettings>(DEFAULT_PREVIEW_ASSISTS)
    const [busy, setBusy] = useState(false)
    const [capturing, setCapturing] = useState(false)
    const [logExpanded, setLogExpanded] = useState(false)
    // The Activity log is a developer tool, shown only with Developer Mode on in the app menu.
    const [developerMode, setDeveloperMode] = useState(false)
    // Developer Mode › Live Feed can put this Mac's webcam in the camera's place.
    const [chosenFeed, setChosenFeed] = useState<LiveFeedChoice>('camera')
    useEffect(() => {
        const apply = (current: { developerMode: boolean; liveFeed: LiveFeedChoice }): void => {
            setDeveloperMode(current.developerMode)
            setChosenFeed(current.liveFeed)
        }
        void api.getPreferences().then(result => result.ok && apply(result.data))
        return api.onPreferences(apply)
    }, [])
    const webcamFeed = usesWebcamFeed({ developerMode, liveFeed: chosenFeed })
    const webcamStatus = webcamFeedStatus.use()
    useEffect(() => {
        chooseLiveFeed(webcamFeed ? 'webcam' : 'camera')
        if (!webcamFeed) return
        void startWebcamFeed()
        return stopWebcamFeed
    }, [webcamFeed])
    // The overlays are Developer Mode's alone: leaving it switches them off, so they don't return unasked.
    useEffect(() => {
        if (!developerMode) overlaysEnabled.set({ 'depth-pro-2': false, sam3: false })
    }, [developerMode])

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
        // Frames go straight to their store (and the GPU); they never re-render the app.
        const unsubscribeFrame = api.onLiveViewFrame(publishLiveFrame)
        const unsubscribeFocusFrames = api.onFocusFrames(publishFocusFrames)
        // The camera's own display goes straight to the GPU; it never re-renders the app.
        const unsubscribeOsd = api.onOsdFrame(png => void publishOsdFrame(png))
        const unsubscribeProgress = api.onFilesProgress(progress => {
            downloadProgress.set(progress.total > 0 && progress.completed < progress.total ? progress : null)
        })
        return () => {
            unsubscribeState()
            unsubscribeLog()
            unsubscribeCapture()
            unsubscribeFrame()
            unsubscribeProgress()
            unsubscribeFocusFrames()
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
        downloadProgress.set(null)
        setPreviewEntry(null)
    }, [cameraState.connected])

    // The picture the scopes and overlays read: the webcam's while it is the feed, otherwise the camera's live view.
    const pictureLive = webcamFeed ? webcamStatus.phase === 'live' : cameraState.connected && cameraState.liveView
    useVisionOverlayLoops(developerMode && pictureLive)
    const scopesPanel = (
        <ScopesPanel
            active={pictureLive}
            inactiveMessage={
                webcamFeed
                    ? (webcamStatus.message ?? 'Scopes appear once the webcam starts.')
                    : cameraState.connected
                      ? 'Scopes appear while live view runs.'
                      : 'Connect a camera to see its scopes.'
            }
            developerMode={developerMode}
            assists={previewAssists}
            onAssistsChange={setPreviewAssists}
        />
    )

    const previewLoading = previewEntry !== null && previewState.status === 'loading'
    const cardBusy = filesUpdating || downloading || previewLoading

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

    // ------------------------------------------------------------- studio view

    // Tools (the assistant, MCP clients) can switch the scope and the preview assists.
    const scope = scopeChoice.use()
    useEffect(
        () =>
            api.onViewChange(change => {
                if (change.scope) chooseScope(change.scope)
                const { scope: _scope, ...assists } = change
                if (Object.keys(assists).length) setPreviewAssists(previous => ({ ...previous, ...assists }))
            }),
        [api]
    )
    useEffect(() => {
        void api.reportViewState({ scope, ...previewAssists })
    }, [api, scope, previewAssists])

    // ------------------------------------------------------------------- voice

    const voice = useLiveTranscription()
    const [voiceExpanded, setVoiceExpanded] = useState(false)
    const voiceIdle = !voiceExpanded && voice.listening === 'off'
    // The speech engine holds several GB; give it back a while after voice is put away.
    useEffect(() => {
        if (!voiceIdle) return
        const timer = setTimeout(() => {
            void api.voiceRelease()
            void api.assistantRelease()
        }, VOICE_RELEASE_DELAY_MS)
        return () => clearTimeout(timer)
    }, [api, voiceIdle])

    // --------------------------------------------------------------------- UI

    return (
        <TooltipProvider delay={400}>
            <Toaster>
                {/* The window is macOS's own material (vibrancy) with a tint over it; the inspector sits on it full height at
                    the left, and the rest is one dark card 6px from the window's top, right and bottom edges. The picture sits
                    6px inside the card, its corners concentric with the card's (14px - 6px = 8px), with the camera pill
                    and toolbar floating over it. */}
                <div className="relative flex h-full">
                    <aside
                        className="relative flex shrink-0 flex-col"
                        style={{ width: sidebar.size }}
                        aria-label="Camera controls"
                    >
                        <Resizer
                            edge="right"
                            label="Resize the camera controls"
                            size={sidebar.size}
                            min={SIDEBAR_MIN}
                            max={sidebarMax()}
                            dragging={sidebar.dragging}
                            onPointerDown={sidebar.startDrag}
                            onKeyDown={sidebar.onKeyDown}
                        />
                        {/* The traffic lights sit here, on a strip that drags the window. */}
                        <div className="titlebar-drag h-11 shrink-0" />
                        {/* The controls scroll and fade at an edge they run past. */}
                        <div className="flex min-h-0 flex-1 scroll-fade-y flex-col overflow-y-auto">
                            {developerMode && <AppearanceTuner />}
                            {/* With no camera there is nothing to set: one line for the whole sidebar, not one per section. */}
                            {/* The webcam feed needs no camera, so its scopes show above the line asking for one. */}
                            {!cameraState.connected && webcamFeed && scopesPanel}
                            {!cameraState.connected ? (
                                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-16 text-center">
                                    <Unplug className="size-5 text-foreground/30" aria-hidden />
                                    <p className="text-muted-foreground">Connect a camera to see its settings.</p>
                                </div>
                            ) : (
                                <>
                                    {scopesPanel}
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
                                        previewing={previewEntry}
                                        onPreview={entry => void openPreview(entry)}
                                        onDownload={entry => void run(() => api.downloadFile(entry))}
                                        onDownloadAll={() =>
                                            void run(() => api.downloadAll()).finally(() => downloadProgress.set(null))
                                        }
                                        onChooseDir={() => void run(() => api.chooseDownloadDir())}
                                        onRevealDir={() => void api.revealPath(cameraState.downloadDir)}
                                    />
                                </>
                            )}
                        </div>
                        {developerMode && <PerfCard />}
                    </aside>
                    <main className="my-1.5 mr-1.5 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-(--card-surface)">
                        <LiveViewPanel
                            header={
                                <CameraPill
                                    cameraState={cameraState}
                                    busy={busy}
                                    onConnect={() => void run(() => api.connect())}
                                    onDisconnect={() => void run(() => api.disconnect())}
                                    onOsdOverlayChange={enabled => void run(() => api.setOsdOverlay(enabled))}
                                />
                            }
                            cameraState={cameraState}
                            webcam={webcamFeed ? webcamStatus : null}
                            visionOverlays={developerMode}
                            previewAssists={previewAssists}
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
                            voiceOpen={voiceExpanded}
                            voiceListening={voice.listening === 'listening'}
                            onToggleVoice={() => setVoiceExpanded(previous => !previous)}
                            preview={{
                                live: cameraState.liveView,
                                quality: cameraState.controls?.liveViewQuality ?? null,
                                disabled: busy,
                                onQualityChange: value => void run(() => api.setControl('liveViewQuality', value)),
                            }}
                        />
                        <VoicePanel voice={voice} expanded={voiceExpanded} />
                        {developerMode && (
                            <EventLog expanded={logExpanded} onToggle={() => setLogExpanded(previous => !previous)} />
                        )}
                    </main>
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
