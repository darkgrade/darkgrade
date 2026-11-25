import type { SonySdkProperty, SonyWifiCamera } from '@vendors/sony/sdk-camera'
import { SONY_SDK_SETTING_LABELS } from '@vendors/sony/sdk-setting-labels'
import { sonyIsoLabel } from '@vendors/sony/iso-value'
import {
    cameraControlDefinitions,
    resolveCameraControl,
    unrecognizedValueLabel,
    type CameraCapabilities,
    type CameraControlId,
    type UnrecognizedValues,
} from '@camera/controls'
import { parseExposureTime } from '@camera/exposure-time'
import { canonicalControlValues, hasCanonicalControlValues } from '@vendors/control-properties'

const controls: Record<string, { code: number; label: string; values?: Record<string, string> }> = {
    aperture: { code: 256, label: 'Aperture' },
    shutterSpeed: { code: 259, label: 'Shutter speed' },
    iso: { code: 260, label: 'ISO' },
    focusMode: {
        code: 265,
        label: 'Focus mode',
        values: { '1': 'MF', '2': 'AF-S', '3': 'AF-C', '4': 'AF-A', '6': 'DMF' },
    },
    whiteBalance: {
        code: 264,
        label: 'White balance',
        values: {
            // CrWhiteBalanceSetting, in the canonical names of the PTP WhiteBalance codec.
            '0': 'Auto',
            '17': 'Daylight',
            '18': 'Shade',
            '19': 'Cloudy',
            '20': 'Tungsten',
            '32': 'Fluorescent',
            '33': 'Fluorescent Warm White',
            '34': 'Fluorescent Cool White',
            '35': 'Fluorescent Day White',
            '36': 'Fluorescent Daylight',
            '48': 'Flash',
            '1': 'Underwater Auto',
            '256': 'Color Temperature',
            '257': 'Custom 1',
            '258': 'Custom 2',
            '259': 'Custom 3',
            '260': 'Custom',
        },
    },
    pictureStyle: { code: 453, label: 'Look' },
    pictureProfile: { code: 426, label: 'Picture profile' },
    driveMode: { code: 270, label: 'Drive mode' },
    imageFormat: { code: 262, label: 'Image format' },
    jpegQuality: { code: 301, label: 'JPEG quality' },
    imageSize: { code: 272, label: 'Image size', values: { '1': 'Large', '2': 'Medium', '3': 'Small' } },
    aspectRatio: { code: 273, label: 'Aspect ratio', values: { '1': '3:2', '2': '16:9', '3': '4:3', '4': '1:1' } },
    movieFormat: { code: 295, label: 'Movie format' },
    movieSetting: { code: 296, label: 'Movie recording profile' },
    movieFrameRate: { code: 297, label: 'Movie frame rate', values: {'1':'120p','2':'100p','3':'60p','4':'50p','5':'30p','6':'25p','7':'24p','8':'23.98p','9':'29.97p','10':'59.94p','22':'24p','23':'119.88p'} },
    zoomSetting: {
        code: 293,
        label: 'Zoom range',
        // Canonical digitalZoom names (Optical Zoom Only is Off); Smart Zoom has no PTP codec value yet.
        values: { '1': 'Off', '2': 'Smart Zoom', '3': 'Clear Image Zoom', '4': 'Digital Zoom' },
    },
    exposureProgram: { code: 261, label: 'Exposure program' },
    apertureMode: { code: 310, label: 'Aperture auto/manual' },
    shutterMode: { code: 311, label: 'Shutter auto/manual' },
    isoMode: { code: 312, label: 'ISO auto/manual' },
    exposureComp: { code: 257, label: 'Exposure compensation' },
    colorTemperature: { code: 277, label: 'Color temperature' },
    // SDK CrFlashMode, aligned with PTP 0x500c on the bench (SDK 3 Fill, 5 Slow sync, 6 Rear sync).
    flashMode: {
        code: 267,
        label: 'Flash mode',
        values: { '1': 'Auto', '2': 'Off', '3': 'Fill', '4': 'External sync', '5': 'Slow sync', '6': 'Rear sync' },
    },
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
    if (key === 'iso') return sonyIsoLabel(Number(value)).replace(/^ISO /, '').replace(/^AUTO$/, 'Auto')
    if (key === 'shutterSpeed') {
        if (property.code === 378) return `${Number(value) / 1000}°`
        if (value === '0') return 'BULB'
        const packed = Number(value)
        return `${packed >>> 16}/${packed & 65535}`
    }
    return controls[key]?.values?.[value] || SONY_SDK_SETTING_LABELS[property.code]?.[value] || value
}
/** Controls whose values are numbers or are spelled from the number itself, so every value has a name. */
const computedLabels = new Set(['aperture', 'shutterSpeed', 'iso', 'zoomPosition', 'exposureComp', 'colorTemperature'])
/** A documented name for an enumerated SDK value, or undefined when Slate has none. */
function documentedLabel(property: SonySdkProperty, key: string, value: string): string | undefined {
    if (computedLabels.has(key)) return label(property, key, value)
    return controls[key]?.values?.[value] || SONY_SDK_SETTING_LABELS[property.code]?.[value]
}
/** Hexadecimal, as PTP spells an unrecognized raw value; text stays verbatim. */
function unrecognizedSdkValue(value: string): string {
    return /^-?\d+$/.test(value) ? unrecognizedValueLabel(BigInt(value)) : value
}
function findProperty(properties: SonySdkProperty[], key: string): SonySdkProperty | undefined {
    if (key === 'shutterSpeed') {
        const speed = properties.find(property => property.code === 259)
        const angle = properties.find(property => property.code === 378)
        if (angle && (!speed || speed.value === '4294967295' || angle.writable && !speed.writable)) return angle
        return speed
    }
    if (key === 'jpegQuality')
        return properties.find(property => property.code === 263) || properties.find(property => property.code === 301)
    return properties.find(property => property.code === controls[key]?.code)
}
export function sonySdkControls(properties: SonySdkProperty[]) {
    const entries = Object.entries(controls).flatMap(([key, definition]) => {
        const property = findProperty(properties, key)
        if (!property) return []
        const state = {
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
        }
        return [[key, state] as const]
    })
    return Object.fromEntries(entries)
}

/** The canonical control one SDK setting carries, if any. */
function sdkControlIds(name: string): CameraControlId[] {
    const id = resolveCameraControl(name)
    return id ? [id] : []
}

/** Reuse the SDK's existing raw/label mapping; SDK ids are never mistaken for PTP ids. */
export function sonySdkCapabilities(properties: SonySdkProperty[]): CameraCapabilities {
    const result: CameraCapabilities['controls'] = {}
    for (const [name, state] of Object.entries(sonySdkControls(properties))) for (const id of sdkControlIds(name)) {
        if (id === 'shutterSpeed' && state.code === 259 && state.rawValue === '4294967295') continue
        const definition = cameraControlDefinitions[id]
        const property = properties.find(candidate => candidate.code === state.code)!
        // An enumerated value with no documented name is reported, never offered or written. A setting
        // with canonical names reports its unnamed values through that vocabulary instead.
        const enumerated = state.valueForm === 'enum' && !hasCanonicalControlValues('sonySdk', id)
        const currentUnnamed = enumerated && documentedLabel(property, name, state.rawValue) === undefined
        const unnamedChoices = enumerated
            ? (property.allowedValues ?? []).filter(raw => documentedLabel(property, name, raw) === undefined)
            : []
        const namedChoices = state.valueForm !== 'enum'
            ? undefined
            : (property.allowedValues ?? [])
                  .filter(raw => !unnamedChoices.includes(raw))
                  .map(raw => label(property, name, raw))
        const canonical = currentUnnamed ? undefined : canonicalControlValues('sonySdk', id, state.value, namedChoices)
        const unrecognizedChoices = [...unnamedChoices.map(unrecognizedSdkValue), ...canonical?.unrecognized?.choices ?? []]
        const unrecognized: UnrecognizedValues = {
            ...(currentUnnamed && { value: unrecognizedSdkValue(state.rawValue) }),
            ...(canonical?.unrecognized?.value !== undefined && { value: canonical.unrecognized.value }),
            ...(unrecognizedChoices.length > 0 && { choices: unrecognizedChoices }),
        }
        const choices = canonical ? canonical.allowedValues : namedChoices
        const unique = choices !== undefined && choices.length > 0 && new Set(choices).size === choices.length
        let exposureTime: ReturnType<typeof parseExposureTime> | undefined
        if (id === 'shutterSpeed') {
            try { exposureTime = parseExposureTime(state.value) } catch { /* Unknown wire values stay unknown. */ }
        }
        result[id] = {
            id, label: definition.label, aliases: definition.aliases,
            value: unrecognized.value !== undefined
                ? `Unrecognized (${unrecognized.value})`
                : id === 'shutterSpeed' && !exposureTime ? `Unknown exposure (${state.value})` : canonical?.value ?? state.value,
            source: { code: state.code, name: state.name, protocol: 'sony-sdk' },
            allowedValues: choices, enabled: state.enabled,
            writable: state.writable && unique && unrecognized.value === undefined &&
                (id !== 'shutterSpeed' || Boolean(exposureTime)),
            ...(exposureTime ? { exposureTime } : {}),
            ...(Object.keys(unrecognized).length > 0 && { unrecognized }),
        }
    }
    // The SDK does not supply a standard PTP DeviceInfo operation inventory.
    return { observedAt: Date.now(), controls: result, advertisedOperations: null }
}

export function sonySdkControlWireValue(
    properties: SonySdkProperty[], id: CameraControlId, label: string
): { code: number; value: bigint } {
    for (const [name, state] of Object.entries(sonySdkControls(properties))) {
        if (!sdkControlIds(name).includes(id) || state.valueForm !== 'enum') continue
        const canonical = canonicalControlValues('sonySdk', id, state.value, state.allowedValues)
        const index = canonical ? canonical.vendorIndex.get(label) ?? -1 : state.allowedValues?.indexOf(label) ?? -1
        const raw = properties.find(property => property.code === state.code)?.allowedValues?.[index]
        if (index >= 0 && raw !== undefined) return { code: state.code, value: BigInt(raw) }
    }
    throw new Error('Requested SDK control value is not advertised')
}
function settingValue(property: SonySdkProperty, key: string, value: string | number): bigint {
    const text = String(value).trim()
    const normalized = text.toLowerCase()
    if (key === 'aperture') {
        const aperture = Number(text.replace(/^f\/?/i, '')) * 100
        if (!Number.isSafeInteger(aperture)) throw new Error('Use an aperture such as f/5.6')
        return BigInt(aperture)
    }
    if (key === 'iso') {
        const wanted = normalized.replace(/^iso\s+/, '')
        const choice = property.allowedValues?.find(candidate => label(property, key, candidate).toLowerCase() === wanted)
        if (choice !== undefined) return BigInt(choice)
        return wanted === 'auto' ? 16777215n : BigInt(text)
    }
    if (key === 'shutterSpeed') {
        if (property.code === 378) {
            const degrees = /^\d+(?:\.\d+)?°?$/.test(text) ? Number(text.replace('°', '')) : NaN
            if (!(degrees > 0 && degrees <= 360)) throw new Error('This camera uses shutter angle; choose an advertised angle such as 180°')
            return BigInt(Math.round(degrees * 1000))
        }
        if (normalized === 'bulb') return 0n
        const match = text.match(/^(\d+)(?:\/(\d+))?$/)
        if (!match || Number(match[1]) > 65535 || Number(match[2] || 1) > 65535 || Number(match[2] || 1) === 0)
            throw new Error('Use a shutter speed such as 1/125 or BULB')
        return (BigInt(match[1]!) << 16n) | BigInt(match[2] || 1)
    }
    const choice = property.allowedValues?.find(candidate => label(property, key, candidate).toLowerCase() === normalized)
    if (choice !== undefined) return BigInt(choice)
    if (/^-?\d+$/.test(text)) return BigInt(text)
    throw new Error('Choose a value advertised by camera_get_capabilities for this setting')
}
/** The same named camera controls used by USB, translated to documented SDK values. */
export async function performSonySdkControl(camera: SonyWifiCamera, action: string, value?: string | number) {
    let result: Record<string, unknown> = {}
    if (action === 'set-exposure-mode') {
        if (value !== 'manual') throw new Error('Only advertised Manual exposure is supported')
        const changes = []
        let properties = await camera.getSonyPropertyStates()
        const program = properties.find(property => property.code === 261)
        const programLabel = program && label(program, 'exposureProgram', program.value)
        // Flexible Exposure uses separate auto/manual switches. Keep its movie mode.
        if (programLabel && /Movie.* F$/.test(programLabel)) {
            for (const code of [310, 311, 312]) {
                const property = properties.find(property => property.code === code)
                if (!property || property.value === '2') continue
                if (!property.writable || !property.allowedValues?.includes('2'))
                    throw new Error(`${property.name || code} cannot be switched to Manual remotely`)
                changes.push(await camera.setSonySetting(code, 2n))
            }
        } else if (program) {
            const target = /SQMotion/.test(programLabel || '') ? '32860'
                : /HiFrameRate/.test(programLabel || '') ? '32899'
                : /Movie/.test(programLabel || '') ? '32851' : '1'
            if (program.value !== target) {
                if (!program.writable || !program.allowedValues?.includes(target))
                    throw new Error('This camera does not advertise a remote Manual exposure mode in its current shooting mode')
                changes.push(await camera.setSonySetting(261, BigInt(target)))
            }
        } else throw new Error('The camera does not publish its exposure program')
        properties = await camera.getSonyPropertyStates()
        const exposure = sonySdkControls(properties)
        if (!exposure.iso?.writable || !exposure.shutterSpeed?.writable)
            throw new Error('Manual mode was requested, but ISO or shutter remains unavailable; check the camera exposure controls')
        result = { changes, exposureModeVerified: true }
    } else if (settingActions[action]) {
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
        const buttons = String(value || '').split(',').map(button => button.trim()).filter(Boolean)
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
