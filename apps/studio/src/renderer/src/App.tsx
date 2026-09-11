import { BrandBackground } from '@renderer/components/BrandBackground'
import { EventLog } from '@renderer/components/EventLog'
import { FilesPanel } from '@renderer/components/FilesPanel'
import { LiveViewPanel } from '@renderer/components/LiveViewPanel'
import { SettingsPanel } from '@renderer/components/SettingsPanel'
import { TopBar } from '@renderer/components/TopBar'
import { VoicePanel } from '@renderer/components/VoicePanel'
import type { CameraState, CaptureResult, DownloadProgress, FileEntry, LogEntry } from '@shared/ipc'
import { executeIntent } from '@voice/execute-intent'
import { parseIntent } from '@voice/intent-parser'
import { useVoice } from '@voice/use-voice'
import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_LOG_ENTRIES = 500

const INITIAL_STATE: CameraState = {
    connected: false,
    vendor: null,
    liveView: false,
    recording: false,
    settings: { iso: null, shutterSpeed: null, aperture: null },
    downloadDir: '',
    platform: '',
}

export function App(): React.JSX.Element {
    const api = window.studio

    const [cameraState, setCameraState] = useState<CameraState>(INITIAL_STATE)
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [files, setFiles] = useState<FileEntry[]>([])
    const [filesLoading, setFilesLoading] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
    const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null)
    const [capturePreviewUrl, setCapturePreviewUrl] = useState<string | null>(null)
    const [liveFrameUrl, setLiveFrameUrl] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const liveFrameUrlRef = useRef<string | null>(null)
    const capturePreviewUrlRef = useRef<string | null>(null)

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
            setLastCapture(result)
            if (result.previewData) {
                const url = URL.createObjectURL(new Blob([result.previewData as BlobPart], { type: 'image/jpeg' }))
                if (capturePreviewUrlRef.current) URL.revokeObjectURL(capturePreviewUrlRef.current)
                capturePreviewUrlRef.current = url
                setCapturePreviewUrl(url)
            } else {
                setCapturePreviewUrl(null)
            }
        })
        const unsubscribeFrame = api.onLiveViewFrame(jpeg => {
            const url = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }))
            if (liveFrameUrlRef.current) URL.revokeObjectURL(liveFrameUrlRef.current)
            liveFrameUrlRef.current = url
            setLiveFrameUrl(url)
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
            if (!connected.ok) {
                log('system', `Auto-connect: ${connected.error} — plug in a camera and it will connect automatically`)
            }
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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
                    return null
                }
                return result.data
            } finally {
                setBusy(false)
            }
        },
        [log]
    )

    const refreshFiles = useCallback(async (): Promise<FileEntry[]> => {
        setFilesLoading(true)
        try {
            const result = await api.listFiles()
            if (!result.ok) {
                log('system', result.error, 'error')
                return []
            }
            setFiles(result.data)
            return result.data
        } finally {
            setFilesLoading(false)
        }
    }, [api, log])

    // NOTE: deliberately no auto file-listing on connect — Sony storage access
    // flips the body into content-transfer (playback) mode, which corrupts the
    // live view stream. Files load on demand and pause live view while they do.

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
        <>
            <BrandBackground />
            <div className="app">
                <TopBar
                    cameraState={cameraState}
                    busy={busy}
                    voiceListening={voice.mode === 'continuous' || voice.pttActive}
                    onConnect={() => void run(api.connect)}
                    onDisconnect={() => void run(api.disconnect)}
                    onKillDaemon={async () => {
                        const message = await run(api.killCameraDaemon)
                        if (message) log('system', message)
                    }}
                />
                <main className="layout">
                    <section className="layout-left">
                        <LiveViewPanel
                            cameraState={cameraState}
                            liveFrameUrl={liveFrameUrl}
                            lastCapture={lastCapture}
                            capturePreviewUrl={capturePreviewUrl}
                            busy={busy}
                            onRetryLiveView={() => void run(api.liveViewStart)}
                            onFocus={() => void run(api.focus)}
                            onCapture={() => void run(api.capture)}
                            onStartRecording={() => void run(api.recordStart)}
                            onStopRecording={() => void run(api.recordStop)}
                            onRevealCapture={path => void api.revealPath(path)}
                        />
                        <EventLog logs={logs} />
                    </section>
                    <section className="layout-right">
                        <VoicePanel voice={voice} />
                        <SettingsPanel
                            cameraState={cameraState}
                            onSetIso={value => void run(() => api.setIso(value))}
                            onSetShutterSpeed={value => void run(() => api.setShutterSpeed(value))}
                            onSetAperture={value => void run(() => api.setAperture(value))}
                            onRefresh={() => void run(api.getSettings)}
                        />
                        <FilesPanel
                            cameraState={cameraState}
                            files={files}
                            loading={filesLoading}
                            downloadProgress={downloadProgress}
                            onRefresh={() => void refreshFiles()}
                            onDownload={entry => void run(() => api.downloadFile(entry))}
                            onDownloadAll={() => void run(api.downloadAll)}
                            onChooseDir={() => void run(api.chooseDownloadDir)}
                            onRevealDir={() => void api.revealPath(cameraState.downloadDir)}
                        />
                    </section>
                </main>
            </div>
        </>
    )
}
