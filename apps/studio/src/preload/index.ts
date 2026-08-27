import type { StudioApi } from '@shared/ipc'
import { IPC, IPC_EVENTS } from '@shared/ipc'
import { contextBridge, ipcRenderer } from 'electron'

function subscribe<T>(channel: string) {
    return (callback: (payload: T) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
        ipcRenderer.on(channel, listener)
        return () => ipcRenderer.removeListener(channel, listener)
    }
}

const studioApi: StudioApi = {
    connect: () => ipcRenderer.invoke(IPC.Connect),
    disconnect: () => ipcRenderer.invoke(IPC.Disconnect),
    getState: () => ipcRenderer.invoke(IPC.GetState),
    getSettings: () => ipcRenderer.invoke(IPC.GetSettings),
    setIso: value => ipcRenderer.invoke(IPC.SetIso, value),
    setShutterSpeed: value => ipcRenderer.invoke(IPC.SetShutterSpeed, value),
    setAperture: value => ipcRenderer.invoke(IPC.SetAperture, value),
    focus: () => ipcRenderer.invoke(IPC.Focus),
    capture: () => ipcRenderer.invoke(IPC.Capture),
    liveViewStart: () => ipcRenderer.invoke(IPC.LiveViewStart),
    liveViewStop: () => ipcRenderer.invoke(IPC.LiveViewStop),
    recordStart: () => ipcRenderer.invoke(IPC.RecordStart),
    recordStop: () => ipcRenderer.invoke(IPC.RecordStop),
    listFiles: () => ipcRenderer.invoke(IPC.ListFiles),
    downloadFile: entry => ipcRenderer.invoke(IPC.DownloadFile, entry),
    downloadAll: () => ipcRenderer.invoke(IPC.DownloadAll),
    killCameraDaemon: () => ipcRenderer.invoke(IPC.KillCameraDaemon),
    chooseDownloadDir: () => ipcRenderer.invoke(IPC.ChooseDownloadDir),
    revealPath: path => ipcRenderer.invoke(IPC.RevealPath, path),
    onState: subscribe(IPC_EVENTS.State),
    onLog: subscribe(IPC_EVENTS.Log),
    onLiveViewFrame: subscribe(IPC_EVENTS.LiveViewFrame),
    onCapture: subscribe(IPC_EVENTS.Capture),
    onFilesProgress: subscribe(IPC_EVENTS.FilesProgress),
}

contextBridge.exposeInMainWorld('studio', studioApi)
