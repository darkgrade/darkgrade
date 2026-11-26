import { assistantService } from '@main/assistant/assistant-service'
import { cameraService } from '@main/camera-service'
import { changeDiagnostics, diagnosticsContact, diagnosticsStatus } from '@main/diagnostics'
import { killMacCameraDaemons } from '@main/macos-camera-daemon'
import { studioMcpServer } from '@main/mcp/mcp-server'
import { sendDecodedSurface, sendLiveFrame } from '@main/metal-frames'
import { openPerfWindow, perfMonitorOpen, receivePerfReport, sampleProcesses, tracePerf } from '@main/perf-monitor'
import { preferences } from '@main/preferences'
import { isTrustedRendererFrame } from '@main/renderer-security'
import { studioRendererUrl } from '@main/studio-window'
import { studioView } from '@main/studio-view'
import { SWIFT_LIVE_VIEW_SURFACE, swiftLiveViewJpeg, type DecodedSurface } from '@main/usb-experiments'
import { visionService } from '@main/vision/vision-service'
import { voiceService } from '@main/voice/voice-service'
import type {
    CameraControlName,
    CaptureOptions,
    DownloadRequest,
    IpcResult,
    PerfReport,
    Preferences,
    StudioViewState,
    TranscriptSegment,
} from '@shared/ipc'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import type { VisionModelId } from '@shared/vision-models'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { errorMessage } from '@shared/format'



function handle<T>(channel: string, operation: (...args: never[]) => Promise<T> | T): void {
    ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
        try {
            if (!isTrustedRendererFrame(event.senderFrame, studioRendererUrl)) throw new Error('Untrusted renderer frame')
            const data = await operation(...(args as never[]))
            return { ok: true, data }
        } catch (error) {
            return { ok: false, error: errorMessage(error) }
        }
    })
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
    const broadcast = (channel: string, payload: unknown): void => {
        const window = getWindow()
        if (!window || window.isDestroyed()) return
        const contents = window.webContents
        // EXPERIMENT(usb-transport): a frame the Swift live-view loop decoded goes to the window as a texture.
        if (channel === SWIFT_LIVE_VIEW_SURFACE)
            return sendDecodedSurface(contents, payload as DecodedSurface, () => {
                const jpeg = swiftLiveViewJpeg()
                if (jpeg) contents.send(IPC_EVENTS.LiveViewFrame, jpeg)
            })
        if (channel !== IPC_EVENTS.LiveViewFrame) return contents.send(channel, payload)
        sendLiveFrame(contents, payload as Uint8Array, jpeg => contents.send(channel, jpeg))
    }
    /** Settings are shown in more than one window, so their updates go to all of them. */
    const broadcastToAll = (channel: string, payload: unknown): void => {
        for (const window of BrowserWindow.getAllWindows())
            if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
    preferences.onChange(current => {
        broadcastToAll(IPC_EVENTS.Preferences, current)
        void studioMcpServer.apply(current.mcpServerEnabled, current.mcpServerPort)
    })
    studioMcpServer.onStatus(status => broadcastToAll(IPC_EVENTS.McpServerStatus, status))
    handle(IPC.DiagnosticsStatus, diagnosticsStatus)
    handle(IPC.DiagnosticsBenchmark, () => cameraService.benchmarkDiagnostics())
    handle(IPC.DiagnosticsChange, changeDiagnostics)
    handle(IPC.DiagnosticsContact, diagnosticsContact)
    handle(IPC.PreferencesGet, () => preferences.get())
    handle(IPC.PreferencesSet, (change: Partial<Preferences>) => preferences.set(change))
    handle(IPC.McpServerGetStatus, () => studioMcpServer.getStatus())
    handle(IPC.PerfSampleProcesses, sampleProcesses)
    handle(IPC.PerfOpen, openPerfWindow)
    handle(IPC.PerfIsOpen, perfMonitorOpen)
    handle(IPC.PerfTrace, (seconds: number) => tracePerf(Math.min(10, Math.max(1, seconds))))
    handle(IPC.PerfReport, (report: PerfReport) => receivePerfReport(report))
    assistantService.setBroadcast(broadcast)
    studioView.setBroadcast(broadcast)
    handle(IPC.ViewReportState, (state: StudioViewState) => studioView.report(state))
    handle(IPC.AssistantGetStatus, () => assistantService.getStatus())
    handle(IPC.AssistantProcessTranscript, (segment: TranscriptSegment) => assistantService.processTranscript(segment))
    handle(IPC.AssistantRelease, () => assistantService.release())
    handle(IPC.AssistantPrepare, () => assistantService.prepare())
    handle(IPC.AssistantWarmUp, (preview: { text: string; context: string }) => assistantService.warmUp(preview))
    const startup = preferences.get()
    void studioMcpServer.apply(startup.mcpServerEnabled, startup.mcpServerPort)
    cameraService.setBroadcast(broadcast)
    voiceService.setBroadcast(broadcast)
    visionService.setBroadcast(broadcast)
    handle(IPC.VisionGetStatus, () => visionService.getStatus())
    handle(IPC.VisionOverlay, (model: VisionModelId, jpeg: Uint8Array | null, prompt: string) => {
        const picture = jpeg ?? cameraService.latestLiveViewFrame
        if (!picture) throw new Error('No live picture yet')
        return visionService.overlay(model, picture, prompt)
    })
    handle(IPC.VoiceGetStatus, () => voiceService.getStatus())
    handle(IPC.VoicePrepare, () => voiceService.prepare())
    handle(IPC.VoiceRelease, () => voiceService.release())
    handle(IPC.VoiceSaveSessionAudio, (pcm: Uint8Array) => voiceService.saveSessionAudio(pcm))
    handle(IPC.VoiceDiagnostic, (message: string) => voiceService.writeEngineLog(`[studio] ${message}`))

    handle(IPC.Connect, () => cameraService.connect())
    handle(IPC.Disconnect, () => cameraService.disconnect())
    handle(IPC.GetState, () => cameraService.getState())
    handle(IPC.GetSettings, () => cameraService.refreshSettings())
    handle(IPC.ZoomStart, (direction: 'wide' | 'tele') => cameraService.zoomStart(direction))
    handle(IPC.ZoomStop, () => cameraService.zoomStop())
    handle(IPC.SetControl, (name: CameraControlName, value: string) => cameraService.setControl(name, value))
    handle(IPC.Focus, () => cameraService.focus())
    handle(IPC.FocusAt, (x: number, y: number) => cameraService.focusAt(x, y))
    handle(IPC.Capture, (options?: CaptureOptions) => cameraService.capture(options))
    handle(IPC.LiveViewStart, () => cameraService.startLiveView())
    handle(IPC.LiveViewStop, () => cameraService.stopLiveView())
    handle(IPC.RecordStart, () => cameraService.startRecording())
    handle(IPC.RecordStop, () => cameraService.stopRecording())
    handle(IPC.ListFiles, () => cameraService.listFiles())
    handle(IPC.DownloadFile, (entry: DownloadRequest) => cameraService.downloadFile(entry))
    handle(IPC.DownloadAll, () => cameraService.downloadAll())
    handle(IPC.SetOsdOverlay, (enabled: boolean) => cameraService.setOsdOverlay(enabled))
    handle(IPC.Thumbnail, (entry: DownloadRequest) => cameraService.thumbnail(entry))
    handle(IPC.PreviewFile, (entry: DownloadRequest) => cameraService.previewFile(entry))
    handle(IPC.CancelPreview, () => cameraService.cancelPreview())

    handle(IPC.KillCameraDaemon, async () => {
        const killed = await killMacCameraDaemons()
        return killed.length > 0 ? `Killed: ${killed.join(', ')}` : 'No camera daemons were running'
    })

    handle(IPC.ChooseDownloadDir, async () => {
        const window = getWindow()
        if (!window) return null
        const result = await dialog.showOpenDialog(window, {
            title: 'Choose download folder',
            properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) return null
        cameraService.setDownloadDir(result.filePaths[0])
        return result.filePaths[0]
    })

    handle(IPC.RevealPath, (path: string) => {
        shell.showItemInFolder(path)
    })
}
