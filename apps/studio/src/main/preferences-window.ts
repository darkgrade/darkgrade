import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { protectRenderer, rendererDocumentUrl } from '@main/renderer-security'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const currentDir = fileURLToPath(new URL('.', import.meta.url))
let preferencesWindow: BrowserWindow | null = null

/** Opens the Preferences window, or brings it forward if it's already open. */
export function openPreferences(): void {
    if (preferencesWindow) {
        preferencesWindow.show()
        preferencesWindow.focus()
        return
    }
    preferencesWindow = new BrowserWindow({
        width: 620,
        height: 460,
        resizable: false,
        minimizable: false,
        fullscreenable: false,
        title: 'Settings',
        backgroundColor: '#141414',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
        webPreferences: {
            preload: join(currentDir, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    })
    preferencesWindow.once('ready-to-show', () => preferencesWindow?.show())
    preferencesWindow.on('closed', () => {
        preferencesWindow = null
    })
    const rendererUrl = rendererDocumentUrl(pathToFileURL(join(currentDir, '../renderer/index.html')).href,
        app.isPackaged, process.env.ELECTRON_RENDERER_URL)
    protectRenderer(preferencesWindow.webContents, rendererUrl, url => shell.openExternal(url))
    const preferencesUrl = new URL(rendererUrl)
    preferencesUrl.hash = 'preferences'
    void preferencesWindow.loadURL(preferencesUrl.href)
}

/** The standard macOS menus, with Settings… (⌘,) in the app menu. */
export function installApplicationMenu(): void {
    const template: MenuItemConstructorOptions[] = [
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openPreferences() },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
