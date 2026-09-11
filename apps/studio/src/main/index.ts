import { cameraService } from '@main/camera-service'
import { registerIpcHandlers } from '@main/ipc-handlers'
import { startCameraDaemonKillerLoop, stopCameraDaemonKillerLoop } from '@main/macos-camera-daemon'
import { app, BrowserWindow, session, shell, systemPreferences } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1080,
        minHeight: 680,
        title: 'Darkgrade Studio',
        backgroundColor: '#000000',
        titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
        // Vertically centered in the fixed 56px top bar (buttons are ~12px tall)
        trafficLightPosition: { x: 20, y: 22 },
        webPreferences: {
            preload: join(currentDir, '../preload/index.mjs'),
            contextIsolation: true,
            sandbox: false,
        },
    })

    mainWindow.on('closed', () => {
        mainWindow = null
    })

    // Open external links in the default browser, never inside the app
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url)
        return { action: 'deny' }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
        void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        void mainWindow.loadFile(join(currentDir, '../renderer/index.html'))
    }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })

    app.whenReady().then(async () => {
        // macOS respawns its PTP daemon continuously and it will clobber our
        // camera access — kill it every second for the entire app lifetime.
        startCameraDaemonKillerLoop(killed =>
            cameraService.logSystem(`Killed macOS camera daemon(s): ${killed.join(', ')}`)
        )

        // Auto-connect when a camera is plugged in, clean up when unplugged
        cameraService.startAutoDetect()

        // Microphone permission for local voice control
        if (process.platform === 'darwin') {
            void systemPreferences.askForMediaAccess('microphone')
        }
        session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
            callback(permission === 'media')
        })

        registerIpcHandlers(() => mainWindow)
        createWindow()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow()
        })
    })
}

// Quit fully on all platforms: keeping the process alive would keep the USB
// interface claimed and block other tools from reaching the camera.
app.on('window-all-closed', () => {
    app.quit()
})

app.on('before-quit', () => {
    stopCameraDaemonKillerLoop()
    void cameraService.dispose()
})
