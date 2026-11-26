import type { StudioApi } from '@shared/ipc'
import { DECODED_FRAMES, IPC, IPC_EVENTS } from '@shared/ipc'
import { contextBridge, ipcRenderer, sharedTexture } from 'electron'

/** Each event channel's traffic and handler time since the last take, for Developer Mode's performance monitor. */
const ipcStats = new Map<string, { count: number; milliseconds: number; bytes: number }>()

function payloadBytes(payload: unknown): number {
    if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) return payload.byteLength
    return 0
}

function subscribe<T>(channel: string) {
    return (callback: (payload: T) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
            const started = performance.now()
            callback(payload)
            const stats = ipcStats.get(channel) ?? { count: 0, milliseconds: 0, bytes: 0 }
            stats.count++
            stats.milliseconds += performance.now() - started
            stats.bytes += payloadBytes(payload)
            ipcStats.set(channel, stats)
        }
        ipcRenderer.on(channel, listener)
        return () => ipcRenderer.removeListener(channel, listener)
    }
}

const studioApi: StudioApi = {
    connect: () => ipcRenderer.invoke(IPC.Connect),
    disconnect: () => ipcRenderer.invoke(IPC.Disconnect),
    getState: () => ipcRenderer.invoke(IPC.GetState),
    getSettings: () => ipcRenderer.invoke(IPC.GetSettings),
    setControl: (name, value) => ipcRenderer.invoke(IPC.SetControl, name, value),
    zoomStart: direction => ipcRenderer.invoke(IPC.ZoomStart, direction),
    zoomStop: () => ipcRenderer.invoke(IPC.ZoomStop),
    focus: () => ipcRenderer.invoke(IPC.Focus),
    focusAt: (x, y) => ipcRenderer.invoke(IPC.FocusAt, x, y),
    capture: options => ipcRenderer.invoke(IPC.Capture, options),
    liveViewStart: () => ipcRenderer.invoke(IPC.LiveViewStart),
    liveViewStop: () => ipcRenderer.invoke(IPC.LiveViewStop),
    recordStart: () => ipcRenderer.invoke(IPC.RecordStart),
    recordStop: () => ipcRenderer.invoke(IPC.RecordStop),
    listFiles: () => ipcRenderer.invoke(IPC.ListFiles),
    downloadFile: entry => ipcRenderer.invoke(IPC.DownloadFile, entry),
    downloadAll: () => ipcRenderer.invoke(IPC.DownloadAll),
    previewFile: entry => ipcRenderer.invoke(IPC.PreviewFile, entry),
    cancelPreview: () => ipcRenderer.invoke(IPC.CancelPreview),
    thumbnail: entry => ipcRenderer.invoke(IPC.Thumbnail, entry),
    killCameraDaemon: () => ipcRenderer.invoke(IPC.KillCameraDaemon),
    chooseDownloadDir: () => ipcRenderer.invoke(IPC.ChooseDownloadDir),
    revealPath: path => ipcRenderer.invoke(IPC.RevealPath, path),
    onState: subscribe(IPC_EVENTS.State),
    onLog: subscribe(IPC_EVENTS.Log),
    onLiveViewFrame: subscribe(IPC_EVENTS.LiveViewFrame),
    onFocusFrames: subscribe(IPC_EVENTS.FocusFrames),
    onOsdFrame: subscribe(IPC_EVENTS.OsdFrame),
    voiceGetStatus: () => ipcRenderer.invoke(IPC.VoiceGetStatus),
    voicePrepare: () => ipcRenderer.invoke(IPC.VoicePrepare),
    voiceRelease: () => ipcRenderer.invoke(IPC.VoiceRelease),
    voiceSaveSessionAudio: pcm => ipcRenderer.invoke(IPC.VoiceSaveSessionAudio, pcm),
    voiceDiagnostic: message => ipcRenderer.invoke(IPC.VoiceDiagnostic, message),
    onVoiceStatus: subscribe(IPC_EVENTS.VoiceStatus),
    visionGetStatus: () => ipcRenderer.invoke(IPC.VisionGetStatus),
    onVisionStatus: subscribe(IPC_EVENTS.VisionStatus),
    visionOverlay: (model, jpeg, prompt) => ipcRenderer.invoke(IPC.VisionOverlay, model, jpeg, prompt),
    getDiagnosticsStatus: () => ipcRenderer.invoke(IPC.DiagnosticsStatus),
    changeDiagnostics: (action, value) => ipcRenderer.invoke(IPC.DiagnosticsChange, action, value),
    diagnosticsBenchmark: () => ipcRenderer.invoke(IPC.DiagnosticsBenchmark),
    diagnosticsContact: (action, email, name) => ipcRenderer.invoke(IPC.DiagnosticsContact, action, email, name),
    getPreferences: () => ipcRenderer.invoke(IPC.PreferencesGet),
    setPreferences: change => ipcRenderer.invoke(IPC.PreferencesSet, change),
    onPreferences: subscribe(IPC_EVENTS.Preferences),
    getMcpServerStatus: () => ipcRenderer.invoke(IPC.McpServerGetStatus),
    perfSampleProcesses: () => ipcRenderer.invoke(IPC.PerfSampleProcesses),
    onDecodedFrame: callback => {
        let consecutiveFailures = 0
        sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }) => {
            try {
                await callback(importedSharedTexture)
                consecutiveFailures = 0
            } catch {
                consecutiveFailures++
                if (consecutiveFailures === DECODED_FRAMES.failuresBeforeJpeg)
                    ipcRenderer.send(DECODED_FRAMES.Unavailable)
            } finally {
                // Released after the page's GPU work on it is queued; Electron waits for that work to finish.
                importedSharedTexture.release()
            }
        })
        ipcRenderer.send(DECODED_FRAMES.Ready)
    },
    perfTakeIpc: () => {
        const taken = [...ipcStats].map(([channel, stats]) => ({ channel, ...stats }))
        ipcStats.clear()
        return taken
    },
    perfOpen: () => ipcRenderer.invoke(IPC.PerfOpen),
    perfTrace: seconds => ipcRenderer.invoke(IPC.PerfTrace, seconds),
    perfIsOpen: () => ipcRenderer.invoke(IPC.PerfIsOpen),
    perfReport: report => ipcRenderer.invoke(IPC.PerfReport, report),
    onPerfReport: subscribe(IPC_EVENTS.PerfReport),
    onPerfEnabled: subscribe(IPC_EVENTS.PerfEnabled),
    onMcpServerStatus: subscribe(IPC_EVENTS.McpServerStatus),
    assistantGetStatus: () => ipcRenderer.invoke(IPC.AssistantGetStatus),
    assistantProcessTranscript: segment => ipcRenderer.invoke(IPC.AssistantProcessTranscript, segment),
    assistantRelease: () => ipcRenderer.invoke(IPC.AssistantRelease),
    assistantPrepare: () => ipcRenderer.invoke(IPC.AssistantPrepare),
    assistantWarmUp: preview => ipcRenderer.invoke(IPC.AssistantWarmUp, preview),
    onAssistantStatus: subscribe(IPC_EVENTS.AssistantStatus),
    onVoiceIntent: subscribe(IPC_EVENTS.VoiceIntent),
    reportViewState: state => ipcRenderer.invoke(IPC.ViewReportState, state),
    onViewChange: subscribe(IPC_EVENTS.ViewChange),
    setOsdOverlay: enabled => ipcRenderer.invoke(IPC.SetOsdOverlay, enabled),
    onCapture: subscribe(IPC_EVENTS.Capture),
    onFilesProgress: subscribe(IPC_EVENTS.FilesProgress),
    onPreviewProgress: subscribe(IPC_EVENTS.PreviewProgress),
    onFiles: subscribe(IPC_EVENTS.Files),
}

contextBridge.exposeInMainWorld('studio', studioApi)
