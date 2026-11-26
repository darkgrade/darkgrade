import type { StudioApi } from '@shared/ipc'
import { DECODED_FRAMES, INVOKE_CHANNELS, IPC_EVENTS, type InvokeName } from '@shared/ipc'
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

/** One method per request channel, each sending its arguments as they are. */
const invokers = Object.fromEntries(
    Object.entries(INVOKE_CHANNELS).map(([name, channel]) => [name, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])
) as Pick<StudioApi, InvokeName>

const studioApi: StudioApi = {
    ...invokers,
    onState: subscribe(IPC_EVENTS.State),
    onLog: subscribe(IPC_EVENTS.Log),
    onLiveViewFrame: subscribe(IPC_EVENTS.LiveViewFrame),
    onFocusFrames: subscribe(IPC_EVENTS.FocusFrames),
    onOsdFrame: subscribe(IPC_EVENTS.OsdFrame),
    onVoiceStatus: subscribe(IPC_EVENTS.VoiceStatus),
    onVisionStatus: subscribe(IPC_EVENTS.VisionStatus),
    onPreferences: subscribe(IPC_EVENTS.Preferences),
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
    onPerfReport: subscribe(IPC_EVENTS.PerfReport),
    onPerfEnabled: subscribe(IPC_EVENTS.PerfEnabled),
    onMcpServerStatus: subscribe(IPC_EVENTS.McpServerStatus),
    onAssistantStatus: subscribe(IPC_EVENTS.AssistantStatus),
    onVoiceIntent: subscribe(IPC_EVENTS.VoiceIntent),
    onViewChange: subscribe(IPC_EVENTS.ViewChange),
    onCapture: subscribe(IPC_EVENTS.Capture),
    onFilesProgress: subscribe(IPC_EVENTS.FilesProgress),
    onPreviewProgress: subscribe(IPC_EVENTS.PreviewProgress),
    onFiles: subscribe(IPC_EVENTS.Files),
}

contextBridge.exposeInMainWorld('studio', studioApi)
