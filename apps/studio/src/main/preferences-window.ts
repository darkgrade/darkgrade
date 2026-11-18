import { preferences } from '@main/preferences'
import { WINDOW_MATERIALS } from '@shared/ipc'
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
    if (process.env.ELECTRON_RENDERER_URL)
        void preferencesWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#preferences`)
    else void preferencesWindow.loadFile(join(currentDir, '../renderer/index.html'), { hash: 'preferences' })
}

/**
 * View › Window Material: the macOS vibrancy behind the main window, switched live with a short fade and saved;
 * and Dim When Inactive, which macOS only lets a window take when it opens, so it applies from the next launch.
 */
function windowMaterialItems(): MenuItemConstructorOptions[] {
    const saved = preferences.get()
    return [
        { type: 'separator' },
        {
            label: 'Window Material',
            submenu: [
                ...WINDOW_MATERIALS.map(([material, label]): MenuItemConstructorOptions => ({
                    label,
                    type: 'radio',
                    checked: saved.windowMaterial === material,
                    click: () => {
                        preferences.set({ windowMaterial: material })
                        for (const window of BrowserWindow.getAllWindows())
                            if (window !== preferencesWindow) window.setVibrancy(material, { animationDuration: 200 })
                    },
                })),
                { type: 'separator' },
                {
                    label: 'Dim When Inactive',
                    sublabel: 'From the next launch',
                    type: 'checkbox',
                    checked: saved.dimWhenInactive,
                    click: item => preferences.set({ dimWhenInactive: item.checked }),
                },
            ],
        },
    ]
}

/** The standard macOS menus, with Settings… (⌘,) and Developer Mode in the app menu, and zoom (⌘ = / ⌘ − / ⌘ 0). */
export function installApplicationMenu(): void {
    const template: MenuItemConstructorOptions[] = [
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openPreferences() },
                {
                    label: 'Developer Mode',
                    type: 'checkbox',
                    checked: preferences.get().developerMode,
                    click: item => preferences.set({ developerMode: item.checked }),
                },
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
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                // Cmd = as well as Cmd +, as macOS apps do: Electron's own zoom-in needs Shift.
                { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
                { role: 'zoomIn', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true },
                { role: 'zoomOut' },
                ...(process.platform === 'darwin' ? windowMaterialItems() : []),
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        { role: 'windowMenu' },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
