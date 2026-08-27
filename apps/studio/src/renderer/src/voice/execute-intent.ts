import {
    APERTURE_VALUES,
    apertureToNumber,
    ISO_VALUES,
    isoToNumber,
    SHUTTER_VALUES,
    shutterToNumber,
    stepValue,
} from '@renderer/lib/exposure-stops'
import type { CameraSettings, FileEntry, StudioApi } from '@shared/ipc'
import type { ParsedIntent } from '@voice/intent-parser'

export interface IntentExecutorDeps {
    api: StudioApi
    /** Refreshes the file panel and returns the entries (renderer keeps them in state). */
    refreshFiles: () => Promise<FileEntry[]>
}

function unwrapError<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(result.error)
    return result.data
}

/** TTS-friendly: "1/250" reads badly; "f/8" should be "f 8". */
function spokenShutter(value: string): string {
    return value.includes('/') ? value.replace('/', ' over ') : `${value} seconds`
}

function spokenAperture(value: string): string {
    return value.replace(/f\/?/i, 'f ')
}

/**
 * Applies a signed light adjustment ('+3' = one stop brighter) to the first
 * adjustable control in preference order.
 */
async function adjustExposure(lightSteps: number, api: StudioApi, settings: CameraSettings): Promise<string> {
    const nextIso = stepValue(ISO_VALUES, settings.iso, isoToNumber, lightSteps)
    if (settings.iso && nextIso) {
        unwrapError(await api.setIso(nextIso))
        return `ISO ${nextIso}`
    }
    // ISO is auto/unknown — move shutter instead (slower = brighter)
    const nextShutter = stepValue(SHUTTER_VALUES, settings.shutterSpeed, shutterToNumber, -lightSteps)
    if (settings.shutterSpeed && nextShutter) {
        unwrapError(await api.setShutterSpeed(nextShutter))
        return `Shutter ${spokenShutter(nextShutter)}`
    }
    const nextAperture = stepValue(APERTURE_VALUES, settings.aperture, apertureToNumber, -lightSteps)
    if (settings.aperture && nextAperture) {
        unwrapError(await api.setAperture(nextAperture))
        return spokenAperture(nextAperture)
    }
    return 'Nothing to adjust — set ISO, shutter, or aperture first'
}

/** Executes a parsed voice intent against the camera. Returns the spoken/shown reply. */
export async function executeIntent(parsed: ParsedIntent, deps: IntentExecutorDeps): Promise<string> {
    const { api } = deps

    switch (parsed.intent) {
        case 'connect': {
            unwrapError(await api.connect())
            return 'Connected'
        }
        case 'disconnect': {
            unwrapError(await api.disconnect())
            return 'Disconnected'
        }

        // Replies confirm the REQUESTED value — the camera applies changes
        // asynchronously; the exposure panel syncs from camera change events.
        case 'set_iso': {
            unwrapError(await api.setIso(parsed.value ?? ''))
            return `ISO ${parsed.value}`
        }
        case 'set_shutter': {
            unwrapError(await api.setShutterSpeed(parsed.value ?? ''))
            return `Shutter ${spokenShutter(parsed.value ?? '')}`
        }
        case 'set_aperture': {
            unwrapError(await api.setAperture(parsed.value ?? ''))
            return spokenAperture(parsed.value ?? '')
        }

        case 'adjust_iso': {
            const lightSteps = parseInt(parsed.value ?? '0', 10)
            const settings = unwrapError(await api.getSettings())
            const next = stepValue(ISO_VALUES, settings.iso, isoToNumber, lightSteps)
            if (!next) return 'ISO is on auto'
            unwrapError(await api.setIso(next))
            return `ISO ${next}`
        }
        case 'adjust_shutter': {
            const lightSteps = parseInt(parsed.value ?? '0', 10)
            const settings = unwrapError(await api.getSettings())
            // more light = slower = lower index in the slow→fast table
            const next = stepValue(SHUTTER_VALUES, settings.shutterSpeed, shutterToNumber, -lightSteps)
            if (!next) return 'Shutter is on bulb'
            unwrapError(await api.setShutterSpeed(next))
            return `Shutter ${spokenShutter(next)}`
        }
        case 'adjust_aperture': {
            const lightSteps = parseInt(parsed.value ?? '0', 10)
            const settings = unwrapError(await api.getSettings())
            // more light = wider = lower index in the wide→narrow table
            const next = stepValue(APERTURE_VALUES, settings.aperture, apertureToNumber, -lightSteps)
            if (!next) return 'Aperture not available'
            unwrapError(await api.setAperture(next))
            return spokenAperture(next)
        }
        case 'adjust_exposure': {
            const lightSteps = parseInt(parsed.value ?? '0', 10)
            const settings = unwrapError(await api.getSettings())
            return adjustExposure(lightSteps, api, settings)
        }

        case 'focus': {
            unwrapError(await api.focus())
            return 'Focused'
        }
        case 'capture': {
            unwrapError(await api.capture())
            return 'Done'
        }
        case 'liveview_start': {
            unwrapError(await api.liveViewStart())
            return 'Live view on'
        }
        case 'liveview_stop': {
            unwrapError(await api.liveViewStop())
            return 'Live view off'
        }
        case 'record_start': {
            unwrapError(await api.recordStart())
            return 'Recording'
        }
        case 'record_stop': {
            unwrapError(await api.recordStop())
            return 'Stopped'
        }
        case 'files_list': {
            const files = await deps.refreshFiles()
            return files.length === 0 ? 'No files' : `${files.length} file${files.length === 1 ? '' : 's'}`
        }
        case 'download_all': {
            const paths = unwrapError(await api.downloadAll())
            return `Saved ${paths.length} file${paths.length === 1 ? '' : 's'}`
        }
        case 'download_latest': {
            const files = await deps.refreshFiles()
            if (files.length === 0) return 'No files'
            unwrapError(await api.downloadFile(files[files.length - 1]))
            return 'Saved'
        }
        case 'status': {
            const settings = unwrapError(await api.getSettings())
            const parts = [
                settings.iso ? `ISO ${settings.iso}` : null,
                settings.shutterSpeed ? spokenShutter(settings.shutterSpeed) : null,
                settings.aperture ? spokenAperture(settings.aperture) : null,
            ].filter(Boolean)
            return parts.length > 0 ? parts.join(', ') : 'No settings available'
        }
        case 'kill_daemon': {
            unwrapError(await api.killCameraDaemon())
            return 'Done'
        }
        case 'help':
            return 'Try: ISO 800, shutter 1/250, f/2.8, brighter, raise the ISO, take a photo, start recording'
    }
}
