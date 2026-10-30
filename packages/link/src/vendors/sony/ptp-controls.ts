import type { Camera } from '@camera/index'
import type { SonyPropertyState } from '@camera/sony-camera'

const settings = {
    'set-iso': { key: 'iso', method: 'setIso' },
    'set-aperture': { key: 'aperture', method: 'setAperture' },
    'set-shutter-speed': { key: 'shutterSpeed', method: 'setShutterSpeed' },
    'set-white-balance': { key: 'whiteBalance', method: 'setWhiteBalance' },
    'set-focus-mode': { key: 'focusMode', method: 'setFocusMode' },
    'set-image-format': { key: 'imageFormat', method: 'setSonyImageFormat' },
    'set-movie-format': { key: 'movieFormat', method: 'setSonyMovieFileFormat' },
} as const

type SonyPtpControlCamera = Pick<Camera, 'getSonyPropertyStates' | typeof settings[keyof typeof settings]['method']>

function normalizedValue(key: string, value: string | number | bigint) {
    const text = String(value).trim()
    if (key === 'iso') return text.replace(/^ISO\s+/i, '').toLowerCase()
    if (key === 'aperture') return String(Number(text.replace(/^f\/?/i, '')))
    return text
}

/** Select native PTP only when every requested setting is writable and advertised before any write. */
export function supportsSonyPtpSettings(properties: SonyPropertyState[], requested: Record<string, string | number>) {
    if (!requested || Array.isArray(requested) || !Object.keys(requested).length) return false
    const controls = sonyPtpControls(properties)
    return Object.entries(requested).every(([key, value]) => {
        if (!Object.hasOwn(controls, key) || !['string', 'number'].includes(typeof value)) return false
        const property = controls[key as keyof typeof controls]
        return property?.writable && property.enabled && property.allowedValues?.some(choice => normalizedValue(key, choice) === normalizedValue(key, value))
    })
}

/** Camera-advertised PTP values, preserving their native codes and decoded labels. */
export function sonyPtpControls(properties: SonyPropertyState[]) {
    const property = (...names: string[]) => names.map(name => properties.find(candidate => candidate.name === name)).find(Boolean)
    const iso = property('Iso')
    const isoMode = property('GainControlSetting')
    return {
        aperture: property('FNumber', 'Aperture'),
        shutterSpeed: property('ShutterSpeed'),
        iso: iso && isoMode?.enabled && isoMode.rawValue === 1 ? { ...iso, value: 'ISO AUTO' } : iso,
        whiteBalance: property('WhiteBalance'),
        focusMode: property('FocusMode'),
        imageFormat: property('StillFileFormat', 'CompressionSetting'),
        movieFormat: property('MovieFileFormat'),
    }
}

/** Run a named setting through an already-owned native PTP connection; never opens an SDK session. */
export async function performSonyPtpControl(camera: SonyPtpControlCamera, action: string, value?: string | number) {
    if (action !== 'status') {
        if (!Object.hasOwn(settings, action)) throw new Error('Unsupported native Sony setting')
        if (value === undefined) throw new Error('A camera setting value is required')
        const setting = settings[action as keyof typeof settings]
        const controls = sonyPtpControls(await camera.getSonyPropertyStates())
        const property = controls[setting.key]
        if (!property?.writable || !property.enabled) throw new Error('The native Sony property is currently unavailable or read-only')
        // Resolve only actual advertised choices. Native and SDK numeric property values are not interchangeable.
        const choice = property.allowedValues?.find(candidate => normalizedValue(setting.key, candidate) === normalizedValue(setting.key, value))
        if (choice === undefined) throw new Error('Choose a value advertised by the native camera controls')
        await camera[setting.method](String(choice))
    }
    const properties = await camera.getSonyPropertyStates()
    return {
        vendor: 'sony', action, transport: 'sony-ptp-usb',
        properties, controls: sonyPtpControls(properties), publishedPropertyCount: properties.length,
    }
}
