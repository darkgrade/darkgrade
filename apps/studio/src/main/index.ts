import { cameraService } from '@main/camera-service'
import { registerIpcHandlers } from '@main/ipc-handlers'
import { startCameraDaemonKillerLoop, stopCameraDaemonKillerLoop } from '@main/macos-camera-daemon'
import { app, BrowserWindow, powerMonitor, session, shell, systemPreferences } from 'electron'
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
        // Centered in the 52px header: macOS traffic lights are 14px tall
        trafficLightPosition: { x: 20, y: 19 },
        webPreferences: {
            preload: join(currentDir, '../preload/index.mjs'),
            contextIsolation: true,
            sandbox: false,
        },
    })

    // A desktop app doesn't zoom its own chrome with Cmd +/-.
    void mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if ((input.meta || input.control) && ['=', '+', '-', '0'].includes(input.key)) event.preventDefault()
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

app.setName('Darkgrade Studio')

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

    void app.whenReady().then(async () => {
        if (process.platform === 'darwin' && !app.isPackaged) {
            app.dock?.setIcon(join(currentDir, '../../build/icon.png'))
        }
        // macOS respawns its PTP daemon continuously and it will clobber our
        // camera access — kill it every second for the entire app lifetime.
        // launchd respawns the daemon constantly; say so once, not every time it is stopped.
        let daemonStopReported = false
        startCameraDaemonKillerLoop(() => {
            if (daemonStopReported) return
            daemonStopReported = true
            cameraService.logSystem('Keeping macOS from taking over the camera')
        })

        // The computer's clock is the source of truth; after sleep, set the camera's again.
        powerMonitor.on('resume', () => void cameraService.syncClock())

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

/** Longest a quit waits for the camera to finish its transfer and close the session. */
const QUIT_DISCONNECT_TIMEOUT_MS = 5000
let cameraReleased = false

// Quitting with a transfer in flight leaves the camera mid-transaction (it stops answering until
// replugged) and crashes Electron in libusb_close. Release the camera first, then exit.
app.on('before-quit', event => {
    if (cameraReleased) return
    event.preventDefault()
    stopCameraDaemonKillerLoop()
    const timeout = new Promise<void>(resolve => setTimeout(resolve, QUIT_DISCONNECT_TIMEOUT_MS))
    void Promise.race([cameraService.dispose(), timeout]).finally(() => {
        cameraReleased = true
        app.quit()
    })
})
