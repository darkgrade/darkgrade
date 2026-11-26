import { preferences } from '@main/preferences'
import { protectRenderer } from '@main/renderer-security'
import { createStudioWindow, studioRendererUrl, studioRouteUrl } from '@main/studio-window'
import { USB_TRANSPORT_CHOICES, type Preferences } from '@shared/ipc'
import { DEPTH_MODEL_SIZES, VISION_MODELS, type VisionModelId } from '@shared/vision-models'
import { app, BrowserWindow, Menu, screen, shell, type MenuItemConstructorOptions } from 'electron'

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
    preferencesWindow = createStudioWindow({
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
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
    })
    preferencesWindow.once('ready-to-show', () => preferencesWindow?.show())
    preferencesWindow.on('closed', () => {
        preferencesWindow = null
    })
    protectRenderer(preferencesWindow.webContents, studioRendererUrl, url => shell.openExternal(url))
    void preferencesWindow.loadURL(studioRouteUrl('preferences'))
}

/** The standard macOS menus, with Settings… (⌘,) and Developer Mode in the app menu, and zoom (⌘ = / ⌘ − / ⌘ 0). */
let rebuildsWithDeveloperMode = false

/** What the menu shows that can change from elsewhere: Developer Mode, and the vision models a tool turned on. */
function menuState(current: Preferences): string {
    return JSON.stringify([current.developerMode, current.visionModels, current.depthModelSize])
}

/** Developer Mode › Vision Models: each model kept loaded in its own process, beside voice and the assistant. */
function visionModelsMenu(): MenuItemConstructorOptions {
    const current = preferences.get()
    const toggle = (id: VisionModelId, on: boolean) =>
        preferences.set({
            visionModels: on ? [...current.visionModels, id] : current.visionModels.filter(model => model !== id),
        })
    return {
        label: 'Vision Models',
        visible: current.developerMode,
        submenu: [
            ...VISION_MODELS.map(model => ({
                label: `${model.name} (${model.task})`,
                type: 'checkbox' as const,
                checked: current.visionModels.includes(model.id),
                toolTip: model.licence,
                click: (item: { checked: boolean }) => toggle(model.id, item.checked),
            })),
            {
                label: 'Depth Pro 2 Size',
                submenu: DEPTH_MODEL_SIZES.map(size => ({
                    label: size.label,
                    type: 'radio' as const,
                    checked: current.depthModelSize === size.id,
                    click: () => preferences.set({ depthModelSize: size.id }),
                })),
            },
        ],
    }
}

export function installApplicationMenu(): void {
    // Developer Mode shows and hides its own items, so the menu is rebuilt when it changes.
    if (!rebuildsWithDeveloperMode) {
        rebuildsWithDeveloperMode = true
        let shown = menuState(preferences.get())
        preferences.onChange(current => {
            if (menuState(current) === shown) return
            shown = menuState(current)
            installApplicationMenu()
        })
    }
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
                {
                    // Live frames decoded on the GPU in the main process (src/main/metal-frames.ts); applies at once.
                    label: 'Metal Live View Decoder (Experimental)',
                    type: 'checkbox',
                    visible: process.platform === 'darwin' && preferences.get().developerMode,
                    checked: preferences.get().metalLiveViewDecoder,
                    click: item => preferences.set({ metalLiveViewDecoder: item.checked }),
                },
                {
                    // EXPERIMENT(usb-transport): what carries the camera's USB connection; a connected camera reconnects.
                    label: 'USB Transport (Experimental)',
                    visible: preferences.get().developerMode,
                    submenu: USB_TRANSPORT_CHOICES.map(choice => ({
                        label: choice.label,
                        type: 'radio' as const,
                        checked: preferences.get().usbTransport === choice.id,
                        click: () => preferences.set({ usbTransport: choice.id }),
                    })),
                },
                visionModelsMenu(),
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
