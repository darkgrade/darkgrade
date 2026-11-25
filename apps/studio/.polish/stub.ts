// A stand-in for Electron's preload API (window.studio), for looking at Studio's real renderer in a browser.
// Pick a scenario with ?s=off|connecting|photo|rec|card|nolive|error. Nothing here reaches a camera.
import type {
    CameraControl,
    CameraControls,
    CameraState,
    FileEntry,
    LogEntry,
    StudioApi,
    VoiceEngineStatus,
} from '@shared/ipc'

const scenario = new URLSearchParams(location.search).get('s') ?? 'photo'
const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data })
const control = (value: string | null, options: string[], enabled = true): CameraControl => ({ value, options, enabled })

const controls: CameraControls = {
    whiteBalance: control('Auto', ['Auto', 'Daylight', 'Shade', 'Cloudy', 'Tungsten', 'Fluorescent', 'Color Temp.']),
    colorTemperature: control('5600', ['3200', '4300', '5600', '6500'], false),
    focusMode: control('AF-C', ['AF-S', 'AF-C', 'DMF', 'MF']),
    focusArea: control('Wide', ['Wide', 'Zone', 'Center', 'Spot S', 'Spot M', 'Spot L']),
    subjectDetection: control('On', ['On', 'Off']),
    detectionSubject: control('People', ['People', 'Animals', 'Birds', 'Cars and trains']),
    eyeSelection: control('Auto', ['Auto', 'Right', 'Left']),
    photoFormat: control('RAW+JPEG', ['RAW', 'RAW+JPEG', 'JPEG', 'HEIF']),
    photoSize: control('Large', ['Large', 'Medium', 'Small']),
    aspectRatio: control('3:2', ['3:2', '4:3', '16:9', '1:1']),
    jpegQuality: control('Fine', ['Extra Fine', 'Fine', 'Standard']),
    videoFormat: control('XAVC S 4K', ['XAVC HS 4K', 'XAVC S 4K', 'XAVC S HD']),
    videoQuality: control('100M 4:2:0 8-bit', ['100M 4:2:0 8-bit', '140M 4:2:2 10-bit', '200M 4:2:2 10-bit']),
    frameRate: control('24p', ['24p', '25p', '30p', '50p', '60p', '120p']),
    // Slate does not map Sony's AudioRecording yet, so a Sony body shows no audio choice.
    audioRecording: null,
    zoomMode: control('Optical Zoom Only', ['Optical Zoom Only', 'Clear Image Zoom', 'Digital Zoom'], false),
    liveViewQuality: control('HIGH', ['LOW', 'HIGH']),
    exposureProgram: control('Manual', ['Program Auto', 'Aperture Priority', 'Shutter Priority', 'Manual']),
    aperture: control('F2.8', ['F2.8', 'F3.2', 'F3.5', 'F4.0', 'F5.6', 'F8.0', 'F11', 'F16', 'F22']),
    shutterSpeed: control('1/50', ['1/25', '1/30', '1/50', '1/60', '1/100', '1/125', '1/250', '1/500', '1/1000']),
    iso: control('400', ['Auto', '100', '200', '400', '800', '1600', '3200', '6400', '12800']),
}

const connected: CameraState = {
    connected: true,
    phase: 'connected',
    vendor: 'Sony',
    model: 'ILCE-7M5',
    battery: { percent: 91, level: 'full', powerSource: 'battery', remainingMinutes: 140 },
    card: { freeBytes: null, remainingPhotos: 2184, remainingVideoSeconds: 7260 },
    lens: { name: 'FE 24-70mm F2.8 GM II', focalLengthMillimetres: 35 },
    clock: { syncedAtMs: Date.now() - 60_000, error: null },
    controls,
    osdOverlay: false,
    clickToFocus: true,
    liveView: scenario !== 'nolive',
    recording: scenario === 'rec',
    recordingState: scenario === 'rec' ? 'recording' : 'idle',
    settings: { iso: '400', shutterSpeed: '1/50', aperture: 'F2.8' },
    downloadDir: '/Users/you/Pictures/Darkgrade Studio',
    platform: 'darwin',
}
const disconnected: CameraState = {
    ...connected,
    connected: false,
    phase: scenario === 'connecting' ? 'connecting' : 'idle',
    vendor: null,
    model: null,
    battery: null,
    card: null,
    lens: null,
    clock: null,
    controls: null,
    osdOverlay: null,
    clickToFocus: false,
    liveView: false,
    recording: false,
    recordingState: 'idle',
    settings: { iso: null, shutterSpeed: null, aperture: null },
}
let state: CameraState = ['off', 'connecting'].includes(scenario) ? disconnected : connected

const PHOTOS = ['DSC02760', 'DSC02762', 'DSC02764', 'DSC02766']
const media = (name: string) => `/@fs${import.meta.env.STUDIO_POLISH_MEDIA}/${name}.jpg`
const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer())

/** The camera's own date form, as Slate reports it: 20261118T073312. */
const ptpDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15)

const files: FileEntry[] = [
    ...PHOTOS.map((name, index) => ({
        storageId: 1,
        storageDescription: 'Memory card 1',
        objectHandle: 100 + index,
        filename: `${name}.JPG`,
        sizeBytes: 11_800_000 + index * 310_000,
        format: 'JPEG',
        captureDate: ptpDate(Date.now() - (PHOTOS.length - index) * 95_000),
        sonyContent: { contentId: 10 + index, fileId: 1, slot: 1 as const },
        width: 7008,
        height: 4672,
    })),
    {
        storageId: 1,
        storageDescription: 'Memory card 1',
        objectHandle: 120,
        filename: 'C0089.MP4',
        sizeBytes: 812_000_000,
        format: 'MP4',
        captureDate: ptpDate(Date.now() - 30_000),
        width: 3840,
        height: 2160,
    },
]

const listeners = new Map<string, Set<(payload: unknown) => void>>()
const on =
    <T>(channel: string) =>
    (callback: (payload: T) => void) => {
        const set = listeners.get(channel) ?? new Set()
        set.add(callback as (payload: unknown) => void)
        listeners.set(channel, set)
        return () => set.delete(callback as (payload: unknown) => void)
    }
const emit = (channel: string, payload: unknown) => listeners.get(channel)?.forEach(listener => listener(payload))

const logs: Array<Omit<LogEntry, 'timestampMs'>> = [
    { source: 'camera', level: 'info', message: 'Connected to Sony ILCE-7M5 over USB' },
    { source: 'camera', level: 'info', message: 'Camera clock set from this Mac' },
    { source: 'camera', level: 'info', message: 'Live view started' },
    ...(scenario === 'error'
        ? [{ source: 'camera' as const, level: 'error' as const, message: 'Focus failed: the camera reported 0xa001 (busy)' }]
        : []),
    ...(scenario === 'rec' ? [{ source: 'camera' as const, level: 'info' as const, message: 'Recording started' }] : []),
]

const voiceStatus: VoiceEngineStatus = {
    phase: 'ready',
    receivedBytes: 0,
    totalBytes: 0,
    port: 8123,
    message: null,
    setupStep: null,
    speechModelBytes: 0,
}

const api: StudioApi = {
    connect: () => (scenario === 'connecting' ? new Promise(() => {}) : ok(state)),
    disconnect: () => ok((state = disconnected)),
    getState: () => ok(state),
    getSettings: () => ok(state.settings),
    setIso: value => ok((state = { ...state, settings: { ...state.settings, iso: value } }).settings),
    setShutterSpeed: value => ok((state = { ...state, settings: { ...state.settings, shutterSpeed: value } }).settings),
    setAperture: value => ok((state = { ...state, settings: { ...state.settings, aperture: value } }).settings),
    setControl: (name, value) => {
        const next = { ...controls, [name]: { ...controls[name]!, value } }
        state = { ...state, controls: next }
        emit('state', state)
        return ok(next)
    },
    zoomStart: () => ok(undefined),
    zoomStop: () => ok(undefined),
    focus: () => (scenario === 'error' ? Promise.resolve({ ok: false, error: 'The camera is busy (0xa001)' }) : ok('Focused')),
    focusAt: () => ok('Focused'),
    capture: async () => ok({ filename: 'DSC02768.JPG', savedPath: '/tmp/DSC02768.JPG', sizeBytes: 12_000_000 }),
    liveViewStart: () => ok((state = { ...state, liveView: true })),
    liveViewStop: () => ok((state = { ...state, liveView: false })),
    recordStart: () => {
        state = { ...state, recording: true, recordingState: 'recording' }
        emit('state', state)
        return ok(state)
    },
    recordStop: () => {
        state = { ...state, recording: false, recordingState: 'idle' }
        emit('state', state)
        return ok(state)
    },
    listFiles: () => {
        setTimeout(() => emit('files', { files, updating: scenario === 'card' }), 300)
        return ok(files)
    },
    downloadFile: () => ok('/tmp/file'),
    downloadAll: () => ok([]),
    previewFile: async entry => {
        const name = entry.filename.replace(/\.\w+$/, '')
        if (!PHOTOS.includes(name)) return { ok: false, error: 'Previews are for photos only' }
        return ok({ kind: 'image', mimeType: 'image/jpeg', data: await bytes(media(name)) })
    },
    cancelPreview: () => ok(undefined),
    thumbnail: async entry => {
        const name = entry.filename.replace(/\.\w+$/, '')
        return ok(PHOTOS.includes(name) ? await bytes(media(`${name}-thumb`)) : null)
    },
    killCameraDaemon: () => ok('Stopped'),
    chooseDownloadDir: () => ok(null),
    revealPath: () => ok(undefined),
    onState: on('state'),
    onLog: on('log'),
    onLiveViewFrame: on('frame'),
    onFocusFrames: on('focus'),
    onOsdFrame: on('osd'),
    setOsdOverlay: enabled => ok((state = { ...state, osdOverlay: enabled })),
    onCapture: on('capture'),
    onFilesProgress: on('progress'),
    onPreviewProgress: on('preview-progress'),
    onFiles: on('files'),
    voiceGetStatus: () => ok(voiceStatus),
    voicePrepare: () => ok(8123),
    voiceRelease: () => ok(undefined),
    voiceSaveSessionAudio: () => ok('/tmp/session.wav'),
    voiceDiagnostic: () => ok(undefined),
    onVoiceStatus: on('voice'),
    diagnosticsBenchmark: () => ok({ passed: true, checks: [] }),
    getDiagnosticsStatus: () =>
        ok({
            configured: true,
            enabled: true,
            enrolled: true,
            withdrawalPending: false,
            queuedEntries: 0,
            droppedEntries: 0,
            error: null,
            sharingEnabled: true,
            installationId: 'a1b2c3',
        }),
    changeDiagnostics: () => api.getDiagnosticsStatus(),
    diagnosticsContact: () => ok(null),
    getPreferences: () => ok({ mcpServerEnabled: true, mcpServerPort: 7420, speechModel: 'bark-3.0-plus', developerMode: /dev=1/.test(location.search) }),
    setPreferences: () => api.getPreferences(),
    onPreferences: on('preferences'),
    getMcpServerStatus: () => ok({ running: true, url: 'http://127.0.0.1:7420/mcp', error: null }),
    onMcpServerStatus: on('mcp'),
    assistantGetStatus: () => ok({ ...voiceStatus }),
    assistantProcessTranscript: () => ok(undefined),
    assistantRelease: () => ok(undefined),
    assistantPrepare: () => ok(8124),
    assistantWarmUp: () => ok(undefined),
    onAssistantStatus: on('assistant'),
    onVoiceIntent: on('intent'),
    reportViewState: () => ok(undefined),
    onViewChange: on('view'),
}

;(window as unknown as { studio: StudioApi }).studio = api

// ?s=voice-gold: only the voice glow, at a fixed level, to judge its colours without a microphone.
if (scenario === 'voice-gold') {
    document.body.innerHTML = '<div id="voice-root" style="padding:20px;background:#0a0a0b"></div><div id="root" hidden></div>'
    void import('./voice-gold')
}

// Logs arrive once the app has subscribed; live view runs at about 30 fps from real camera photos.
setTimeout(() => {
    if (state.connected) logs.forEach((entry, index) => emit('log', { ...entry, timestampMs: Date.now() - (logs.length - index) * 4000 }))
    if (state.connected) emit('files', { files, updating: scenario === 'card' })
    if (scenario === 'card')
        emit('progress', { completed: 2, total: 5, currentFilename: 'DSC02764.JPG', receivedBytes: 4_100_000, fileBytes: 12_100_000 })
}, 1500)
void (async () => {
    const frame = await bytes(media(new URLSearchParams(location.search).get('photo') ?? 'DSC02762'))
    setInterval(() => {
        if (state.connected && state.liveView) emit('frame', frame)
    }, 33)
    setInterval(() => {
        if (state.connected && state.liveView)
            emit('focus', [{ kind: 'face', focused: true, centerX: 0.52, centerY: 0.38, width: 0.12, height: 0.16 }])
    }, 500)
})()
