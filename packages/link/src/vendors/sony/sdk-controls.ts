import type { SonySdkProperty, SonyWifiCamera } from '@vendors/sony/sdk-camera'
import { SONY_SDK_SETTING_LABELS } from '@vendors/sony/sdk-setting-labels'

const controls: Record<string, { code: number; label: string; values?: Record<string, string> }> = {
    aperture: { code: 256, label: 'Aperture' },
    shutterSpeed: { code: 259, label: 'Shutter speed' },
    iso: { code: 260, label: 'ISO' },
    focusMode: {
        code: 265,
        label: 'Focus mode',
        values: { '1': 'Manual', '2': 'AF-S', '3': 'AF-C', '4': 'AF-A', '6': 'DMF' },
    },
    whiteBalance: {
        code: 264,
        label: 'White balance',
        values: {
            '0': 'Auto',
            '17': 'Daylight',
            '18': 'Shade',
            '19': 'Cloudy',
            '20': 'Tungsten',
            '33': 'Warm White',
            '34': 'Cool White',
            '35': 'Day White',
            '36': 'Daylight fluorescent',
            '48': 'Flash',
            '1': 'Underwater Auto',
            '256': 'Color Temperature',
            '257': 'Custom 1',
            '258': 'Custom 2',
            '259': 'Custom 3',
        },
    },
    imageFormat: { code: 262, label: 'Image format' },
    jpegQuality: { code: 301, label: 'JPEG quality' },
    imageSize: { code: 272, label: 'Image size', values: { '1': 'L', '2': 'M', '3': 'S' } },
    aspectRatio: { code: 273, label: 'Aspect ratio', values: { '1': '3:2', '2': '16:9', '3': '4:3', '4': '1:1' } },
    movieFormat: { code: 295, label: 'Movie format' },
    movieSetting: { code: 296, label: 'Movie recording profile' },
    zoomSetting: {
        code: 293,
        label: 'Zoom range',
        values: { '1': 'Optical Zoom', '2': 'Smart Zoom', '3': 'Clear Image Zoom', '4': 'Digital Zoom' },
    },
    exposureProgram: { code: 261, label: 'Exposure program' },
    exposureComp: { code: 257, label: 'Exposure compensation' },
    colorTemperature: { code: 277, label: 'Color temperature' },
    flashMode: { code: 290, label: 'Flash mode' },
    meteringMode: { code: 266, label: 'Metering' },
    focusArea: { code: 275, label: 'Focus area' },
    zoomPosition: { code: 333, label: 'Focal length' },
    zoomScale: { code: 292, label: 'Zoom scale' },
    movieState: { code: 1797, label: 'Recording state' },
}
const settingActions: Record<string, string> = {
    'set-aperture': 'aperture',
    'set-shutter-speed': 'shutterSpeed',
    'set-iso': 'iso',
    'set-focus-mode': 'focusMode',
    'set-white-balance': 'whiteBalance',
    'set-image-format': 'imageFormat',
    'set-jpeg-quality': 'jpegQuality',
    'set-image-size': 'imageSize',
    'set-aspect-ratio': 'aspectRatio',
    'set-movie-format': 'movieFormat',
    'set-movie-setting': 'movieSetting',
    'set-zoom-setting': 'zoomSetting',
}
function label(property: SonySdkProperty, key: string, value: string): string {
    if (key === 'aperture') return 'f/' + (Number(value) / 100).toFixed(1)
    if (key === 'zoomPosition') return String(Number(value) / 1000)
    if (key === 'exposureComp') return String(Number(value) / 1000)
    if (key === 'iso') return value === '16777215' ? 'Auto' : value
    if (key === 'shutterSpeed') {
        if (value === '0') return 'BULB'
        const packed = Number(value)
        return `${packed >>> 16}/${packed & 65535}`
    }
    return controls[key]?.values?.[value] || SONY_SDK_SETTING_LABELS[property.code]?.[value] || value
}
function findProperty(properties: SonySdkProperty[], key: string): SonySdkProperty | undefined {
    if (key === 'jpegQuality')
        return properties.find(property => property.code === 263) || properties.find(property => property.code === 301)
    return properties.find(property => property.code === controls[key]?.code)
}
export function sonySdkControls(properties: SonySdkProperty[]) {
    return Object.fromEntries(
        Object.entries(controls).flatMap(([key, definition]) => {
            const property = findProperty(properties, key)
            if (!property) return []
            return [
                [
                    key,
                    {
                        ...property,
                        codeHex: '0x' + property.code.toString(16),
                        description: definition.label,
                        rawValue: property.value,
                        value: label(property, key, property.value),
                        allowedValues:
                            property.valueForm === 'enum'
                                ? property.allowedValues?.map(value => label(property, key, value))
                                : property.allowedValues,
                        enabled: property.writable,
                        sonyEnabledFlag: property.writable ? 1 : 0,
                        sonyGetSetFlag: property.writable ? 1 : 0,
                    },
                ],
            ]
        })
    )
}
function settingValue(property: SonySdkProperty, key: string, value: string | number): bigint {
    const text = String(value).trim(),
        normalized = text.toLowerCase()
    if (key === 'aperture') {
        const aperture = Number(text.replace(/^f\/?/i, '')) * 100
        if (!Number.isSafeInteger(aperture)) throw new Error('Use an aperture such as f/5.6')
        return BigInt(aperture)
    }
    if (key === 'iso') return normalized === 'auto' ? 16777215n : BigInt(text)
    if (key === 'shutterSpeed') {
        if (normalized === 'bulb') return 0n
        const match = text.match(/^(\d+)(?:\/(\d+))?$/)
        if (!match || Number(match[1]) > 65535 || Number(match[2] || 1) > 65535 || Number(match[2] || 1) === 0)
            throw new Error('Use a shutter speed such as 1/125 or BULB')
        return (BigInt(match[1]!) << 16n) | BigInt(match[2] || 1)
    }
    const choice = property.allowedValues?.find(
        candidate => label(property, key, candidate).toLowerCase() === normalized
    )
    if (choice !== undefined) return BigInt(choice)
    if (/^-?\d+$/.test(text)) return BigInt(text)
    throw new Error('Choose a value advertised by camera_controls for this setting')
}
/** The same named camera controls used by USB, translated to documented SDK values. */
export async function performSonySdkControl(camera: SonyWifiCamera, action: string, value?: string | number) {
    let result: Record<string, unknown> = {}
    if (settingActions[action]) {
        if (value === undefined) throw new Error('A camera setting value is required')
        const key = settingActions[action]!
        const property = findProperty(await camera.getSonyPropertyStates(), key)
        if (!property) throw new Error('The camera does not advertise this setting in its current mode')
        result = await camera.setSonySetting(property.code, settingValue(property, key, value))
    } else if (action === 'autofocus') await camera.autofocus(1200)
    else if (action === 'touch-focus') {
        const [x, y] = String(value).split(',').map(Number)
        result = await camera.placeSonyFocusPoint(x!, y!)
        await camera.autofocus(800)
        result.autofocusRequested = true
        result.focusAcquired = (await camera.getSonyFocusFrames()).some(frame => frame.state === 2)
    } else if (action === 'camera-buttons') {
        const buttons = String(value || '')
            .split(',')
            .map(button => button.trim())
            .filter(Boolean)
        if (buttons.length > 30) throw new Error('At most 30 buttons per sequence')
        for (const button of buttons) {
            await camera.sonyPressButton(button as any)
            await new Promise(resolve => setTimeout(resolve, 200))
        }
        result = { pressed: buttons, cameraButtons: { pressed: buttons } }
    } else if (action === 'power-zoom-wide' || action === 'power-zoom-tele') {
        const pulses = Number(value || 1)
        if (!Number.isInteger(pulses) || pulses < 1 || pulses > 8) throw new Error('Zoom amount must be 1–8')
        const before = await camera.getSonyProperty('ZoomDistance')
        await camera.zoomSony(action === 'power-zoom-wide' ? 'wide' : 'tele', pulses * 200)
        await new Promise(resolve => setTimeout(resolve, 500))
        const after = await camera.getSonyProperty('ZoomDistance')
        result = { before, after, movementConfirmed: before.value !== after.value }
    } else if (action !== 'status') throw new Error('Unsupported Sony camera control')
    const properties = await camera.getSonyPropertyStates()
    return {
        ...result,
        vendor: 'sony',
        action,
        transport: 'sony-sdk-wifi',
        detail: action === 'status' ? 'Read Sony Wi-Fi camera controls' : 'Sony Wi-Fi control completed: ' + action,
        properties,
        controls: sonySdkControls(properties),
        publishedPropertyCount: properties.length,
    }
}
