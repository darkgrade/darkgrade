import type { SonySdkProperty } from '@vendors/sony/sdk-camera'

const resolutions = [
    undefined,
    [480, 270],
    [640, 336],
    [640, 360],
    [1024, 544],
    [1024, 576],
    [1280, 720],
    [1920, 1080],
    [640, 480],
    [1024, 768],
    [320, 240],
    [320, 216],
    [320, 184],
    [320, 168],
] as const
const frameRates = [undefined, 7.5, 23.98, 24, 25, 29.97, 30] as const
const codecs = [undefined, 'jpeg', 'h264', 'h265'] as const

export interface SonyMonitoringFormat {
    value: string
    qualityLevel: number
    codec: 'jpeg' | 'h264' | 'h265'
    width: number
    height: number
    framesPerSecond: number
    megabitsPerSecond: number
    variableResolution: boolean
}

/** Decode the public SDK's packed CrMonitoringFormat without losing uint64 bits. */
export function decodeSonyMonitoringFormat(value: string): SonyMonitoringFormat | undefined {
    if (!/^\d+$/.test(value)) return undefined
    const packed = BigInt(value)
    if (packed > 0xffffffffffffffffn) return undefined
    const qualityLevel = Number(packed & 0xffn)
    const codec = codecs[Number((packed >> 8n) & 0xffn)]
    const resolution = resolutions[Number((packed >> 16n) & 0xffn)]
    const framesPerSecond = frameRates[Number((packed >> 24n) & 0xffn)]
    if (qualityLevel < 1 || qualityLevel > 5 || !codec || !resolution || !framesPerSecond) return undefined
    return {
        value: packed.toString(),
        qualityLevel,
        codec,
        width: resolution[0],
        height: resolution[1],
        framesPerSecond,
        megabitsPerSecond: Number((packed >> 32n) & 0x7fffn) / 100,
        variableResolution: Boolean((packed >> 47n) & 1n),
    }
}

export function sonyPreviewCapabilities(properties: SonySdkProperty[]) {
    const property = (code: number) => properties.find(item => item.code === code)
    const decode = (item: SonySdkProperty | undefined): SonyMonitoringFormat[] => {
        if (!item || item.valueForm === 'range') return []
        return [...new Set([...(item.allowedValues ?? []), item.value])]
            .map(decodeSonyMonitoringFormat)
            .filter((format): format is SonyMonitoringFormat => Boolean(format))
    }
    const availableFormats = decode(property(1955))
    const formats = [
        ...new Map([...availableFormats, ...decode(property(1956))].map(format => [format.value, format])).values(),
    ]
    const jpegFormats = availableFormats
        .filter(format => format.codec === 'jpeg')
        .sort(
            (left, right) =>
                right.width * right.height - left.width * left.height || right.framesPerSecond - left.framesPerSecond
        )
    const delivering = property(1927)?.value
    return {
        monitoring: property(1928) ? ('advertised' as const) : ('not-advertised' as const),
        delivering: delivering === '0' ? false : delivering === '1' ? true : null,
        formats,
        availableFormats,
        preferredJpegFormat: jpegFormats[0] ?? null,
        supportedTransportValues: property(1954)?.allowedValues ?? [],
        detail: property(1928)
            ? 'Formats are camera-advertised capabilities; a received frame is required to verify delivery.'
            : 'This session does not advertise SDK monitoring. Classic live view uses a separate capability path.',
    }
}
