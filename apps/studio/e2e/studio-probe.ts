import type { CameraState, FileEntry, LogEntry, StudioApi } from '@shared/ipc'
import type { Page } from '@playwright/test'

/** What the walk reads back from Studio's main process: the camera's reported state, card and log. */
export interface StudioProbe {
    readonly description: string
    state(): Promise<CameraState>
    files(): Promise<FileEntry[]>
    /** Error entries logged by the camera since the walk started. */
    cameraErrors(): Promise<LogEntry[]>
}

declare global {
    interface Window {
        studio: StudioApi
        e2eLog?: LogEntry[]
    }
}

/** Reads through the preload's `window.studio`, the same IPC the UI uses, so values come from the camera. */
export async function pageProbe(page: Page): Promise<StudioProbe> {
    await page.waitForFunction(() => 'studio' in window)
    await page.evaluate(() => {
        window.e2eLog = []
        window.studio.onLog(entry => window.e2eLog?.push(entry))
    })
    return {
        description: 'Studio',
        state: () =>
            page.evaluate(async () => {
                const result = await window.studio.getState()
                if (!result.ok) throw new Error(`getState failed: ${result.error}`)
                return result.data
            }),
        files: () =>
            page.evaluate(async () => {
                const result = await window.studio.listFiles()
                if (!result.ok) throw new Error(`listFiles failed: ${result.error}`)
                return result.data
            }),
        cameraErrors: () =>
            page.evaluate(() =>
                (window.e2eLog ?? []).filter(entry => entry.source === 'camera' && entry.level === 'error')
            ),
    }
}

/**
 * A Studio that never sees a camera, for `bun run e2e:dry-run`. It proves the walk compiles and runs,
 * and that it fails at the first camera step with a message saying why, without launching Studio.
 */
export function fakeProbe(): StudioProbe {
    const disconnected: CameraState = {
        connected: false,
        phase: 'idle',
        vendor: null,
        model: null,
        battery: null,
        card: null,
        lens: null,
        clock: null,
        controls: null,
        osdOverlay: null,
        clickToFocus: false,
        liveView: false,
        recording: false,
        recordingState: 'unknown',
        settings: { iso: null, shutterSpeed: null, aperture: null },
        downloadDir: '',
        platform: '',
    }
    return {
        description: 'fake Studio (DARKGRADE_E2E_FAKE=1, no camera by design)',
        state: async () => disconnected,
        files: async () => [],
        cameraErrors: async () => [],
    }
}
