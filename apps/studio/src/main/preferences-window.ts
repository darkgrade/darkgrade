import { preferences } from '@main/preferences'
import { app, BrowserWindow, Menu, screen, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = fileURLToPath(new URL('.', import.meta.url))
let preferencesWindow: BrowserWindow | null = null
/** Settings opens at this size, or the display's working area if that's smaller; it can be resized. */
const SETTINGS_WIDTH = 760
const SETTINGS_HEIGHT = 940

/** Opens the Preferences window, or brings it forward if it's already open. */
export function openPreferences(): void {
    if (preferencesWindow) {
        preferencesWindow.show()
        preferencesWindow.focus()
        return
    }
    // Open centred on the display Studio is on (macOS otherwise picks the display with the menu bar's focus).
    const studio = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const area = screen.getDisplayMatching(studio?.getBounds() ?? screen.getPrimaryDisplay().bounds).workArea
    const width = Math.min(SETTINGS_WIDTH, area.width)
    const height = Math.min(SETTINGS_HEIGHT, area.height)
    preferencesWindow = new BrowserWindow({
        width,
        height,
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        minWidth: 560,
        minHeight: 420,
        minimizable: false,
        fullscreenable: false,
        title: 'Settings',
        // The same material and dimming as Studio's main window, so the page's tint reads the same over it.
        ...(process.platform === 'darwin'
            ? {
                  vibrancy: preferences.get().windowMaterial,
                  visualEffectState: preferences.get().dimWhenInactive
                      ? ('followWindow' as const)
                      : ('active' as const),
                  backgroundColor: '#00000000',
              }
            : { backgroundColor: '#07090b' }),
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
        webPreferences: {
            preload: join(currentDir, '../preload/index.mjs'),
            contextIsolation: true,
            sandbox: false,
        },
    })
    preferencesWindow.once('ready-to-show', () => preferencesWindow?.show())
    let material = preferences.get().windowMaterial
    const stopFollowingMaterial = preferences.onChange(current => {
        if (process.platform !== 'darwin' || current.windowMaterial === material) return
        material = current.windowMaterial
        preferencesWindow?.setVibrancy(material, { animationDuration: 200 })
    })
    preferencesWindow.on('closed', () => {
        stopFollowingMaterial()
        preferencesWindow = null
    })
    if (process.env.ELECTRON_RENDERER_URL)
        void preferencesWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#preferences`)
    else void preferencesWindow.loadFile(join(currentDir, '../renderer/index.html'), { hash: 'preferences' })
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
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        { role: 'windowMenu' },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
