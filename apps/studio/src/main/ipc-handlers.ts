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
import { INVOKE_CHANNELS, IPC_EVENTS, type InvokeData, type InvokeName, type StudioApi } from '@shared/ipc'
import type { VisionModelId } from '@shared/vision-models'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { errorMessage } from '@shared/format'



function handle<Name extends InvokeName>(
    name: Name,
    operation: (...args: Parameters<StudioApi[Name]>) => Promise<InvokeData<Name>> | InvokeData<Name>
): void {
    ipcMain.handle(INVOKE_CHANNELS[name], async (event, ...args): Promise<IpcResult<InvokeData<Name>>> => {
        try {
            if (!isTrustedRendererFrame(event.senderFrame, studioRendererUrl)) throw new Error('Untrusted renderer frame')
            const data = await operation(...(args as Parameters<StudioApi[Name]>))
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
    handle('getDiagnosticsStatus', diagnosticsStatus)
    handle('diagnosticsBenchmark', () => cameraService.benchmarkDiagnostics())
    handle('changeDiagnostics', changeDiagnostics)
    handle('diagnosticsContact', diagnosticsContact)
    handle('getPreferences', () => preferences.get())
    handle('setPreferences', (change: Partial<Preferences>) => preferences.set(change))
    handle('getMcpServerStatus', () => studioMcpServer.getStatus())
    handle('perfSampleProcesses', sampleProcesses)
    handle('perfOpen', openPerfWindow)
    handle('perfIsOpen', perfMonitorOpen)
    handle('perfTrace', (seconds: number) => tracePerf(Math.min(10, Math.max(1, seconds))))
    handle('perfReport', (report: PerfReport) => receivePerfReport(report))
    assistantService.setBroadcast(broadcast)
    studioView.setBroadcast(broadcast)
    handle('reportViewState', (state: StudioViewState) => studioView.report(state))
    handle('assistantGetStatus', () => assistantService.getStatus())
    handle('assistantProcessTranscript', (segment: TranscriptSegment) => assistantService.processTranscript(segment))
    handle('assistantRelease', () => assistantService.release())
    handle('assistantPrepare', () => assistantService.prepare())
    handle('assistantWarmUp', (preview: { text: string; context: string }) => assistantService.warmUp(preview))
    const startup = preferences.get()
    void studioMcpServer.apply(startup.mcpServerEnabled, startup.mcpServerPort)
    cameraService.setBroadcast(broadcast)
    voiceService.setBroadcast(broadcast)
    visionService.setBroadcast(broadcast)
    handle('visionGetStatus', () => visionService.getStatus())
    handle('visionOverlay', (model: VisionModelId, jpeg: Uint8Array | null, prompt: string) => {
        const picture = jpeg ?? cameraService.latestLiveViewFrame
        if (!picture) throw new Error('No live picture yet')
        return visionService.overlay(model, picture, prompt)
    })
    handle('voiceGetStatus', () => voiceService.getStatus())
    handle('voicePrepare', () => voiceService.prepare())
    handle('voiceRelease', () => voiceService.release())
    handle('voiceSaveSessionAudio', (pcm: Uint8Array) => voiceService.saveSessionAudio(pcm))
    handle('voiceDiagnostic', (message: string) => voiceService.writeEngineLog(`[studio] ${message}`))

    handle('connect', () => cameraService.connect())
    handle('disconnect', () => cameraService.disconnect())
    handle('getState', () => cameraService.getState())
    handle('getSettings', () => cameraService.refreshSettings())
    handle('zoomStart', (direction: 'wide' | 'tele') => cameraService.zoomStart(direction))
    handle('zoomStop', () => cameraService.zoomStop())
    handle('setControl', (name: CameraControlName, value: string) => cameraService.setControl(name, value))
    handle('focus', () => cameraService.focus())
    handle('focusAt', (x: number, y: number) => cameraService.focusAt(x, y))
    handle('capture', (options?: CaptureOptions) => cameraService.capture(options))
    handle('liveViewStart', () => cameraService.startLiveView())
    handle('liveViewStop', () => cameraService.stopLiveView())
    handle('recordStart', () => cameraService.startRecording())
    handle('recordStop', () => cameraService.stopRecording())
    handle('listFiles', () => cameraService.listFiles())
    handle('downloadFile', (entry: DownloadRequest) => cameraService.downloadFile(entry))
    handle('downloadAll', () => cameraService.downloadAll())
    handle('setOsdOverlay', (enabled: boolean) => cameraService.setOsdOverlay(enabled))
    handle('thumbnail', (entry: DownloadRequest) => cameraService.thumbnail(entry))
    handle('previewFile', (entry: DownloadRequest) => cameraService.previewFile(entry))
    handle('cancelPreview', () => cameraService.cancelPreview())

    handle('killCameraDaemon', async () => {
        const killed = await killMacCameraDaemons()
        return killed.length > 0 ? `Killed: ${killed.join(', ')}` : 'No camera daemons were running'
    })

    handle('chooseDownloadDir', async () => {
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

    handle('revealPath', (path: string) => {
        shell.showItemInFolder(path)
    })
}
