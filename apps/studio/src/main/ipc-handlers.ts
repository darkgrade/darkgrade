import { cameraService } from '@main/camera-service'
import { killMacCameraDaemons } from '@main/macos-camera-daemon'
import type { FileEntry, IpcResult } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function handle<T>(channel: string, operation: (...args: never[]) => Promise<T> | T): void {
    ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
        try {
            const data = await operation(...(args as never[]))
            return { ok: true, data }
        } catch (error) {
            return { ok: false, error: errorMessage(error) }
        }
    })
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
    cameraService.setBroadcast((channel, payload) => {
        const window = getWindow()
        if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
    })

    handle(IPC.Connect, () => cameraService.connect())
    handle(IPC.Disconnect, () => cameraService.disconnect())
    handle(IPC.GetState, () => cameraService.getState())
    handle(IPC.GetSettings, () => cameraService.refreshSettings())
    handle(IPC.SetIso, (value: string) => cameraService.setIso(value))
    handle(IPC.SetShutterSpeed, (value: string) => cameraService.setShutterSpeed(value))
    handle(IPC.SetAperture, (value: string) => cameraService.setAperture(value))
    handle(IPC.Focus, () => cameraService.focus())
    handle(IPC.Capture, () => cameraService.capture())
    handle(IPC.LiveViewStart, () => cameraService.startLiveView())
    handle(IPC.LiveViewStop, () => cameraService.stopLiveView())
    handle(IPC.RecordStart, () => cameraService.startRecording())
    handle(IPC.RecordStop, () => cameraService.stopRecording())
    handle(IPC.ListFiles, () => cameraService.listFiles())
    handle(IPC.DownloadFile, (entry: Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename'>) =>
        cameraService.downloadFile(entry)
    )
    handle(IPC.DownloadAll, () => cameraService.downloadAll())

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
