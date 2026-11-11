import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
            preload: join(currentDir, '../preload/index.mjs'),
            contextIsolation: true,
            sandbox: false,
        },
    })
    preferencesWindow.once('ready-to-show', () => preferencesWindow?.show())
    preferencesWindow.on('closed', () => {
        preferencesWindow = null
    })
    if (process.env.ELECTRON_RENDERER_URL) void preferencesWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#preferences`)
    else void preferencesWindow.loadFile(join(currentDir, '../renderer/index.html'), { hash: 'preferences' })
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
