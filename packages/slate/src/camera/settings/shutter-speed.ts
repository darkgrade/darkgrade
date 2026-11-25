import { CameraUnsupportedError } from '@camera/errors'
import type { ExposureTime } from '@camera/exposure-time'

/**
 * A shutter speed in Slate's one spelling, whatever the vendor calls it: `'1/250'`, `'30"'`,
 * `'0.3"'`, `'180°'`, `'Bulb'`. Each vendor codec's label (Sony `BULB`, Canon `30`, a standard
 * ExposureTime tick count) is read through `parseExposureTime` and written back in this form.
 */
export type ShutterSpeed =
    | `${number}/${number}`
    | `${number}"`
    | `${number}°`
    | 'Bulb'
    | 'Time'
    | 'Flash sync'
    | 'Auto'

const relativeTolerance = 1e-9

function close(left: number, right: number): boolean {
    return Math.abs(left - right) <= relativeTolerance * Math.max(Math.abs(left), Math.abs(right))
}

function formatDuration(seconds: number, observedLabel?: string): ShutterSpeed {
    const reciprocal = Math.round(1 / seconds)
    if (seconds < 1 && reciprocal >= 1 && close(1 / reciprocal, seconds)) return `1/${reciprocal}`
    const tenths = Math.round(seconds * 10) / 10
    if (close(tenths, seconds)) return `${tenths}"`
    // A fraction that is neither 1/n nor whole tenths keeps the camera's own ratio, if it gave one.
    const ratio = observedLabel && /^(\d+)\/(\d+)$/.exec(observedLabel.trim())
    if (ratio && close(Number(ratio[1]) / Number(ratio[2]), seconds)) return `${Number(ratio[1])}/${Number(ratio[2])}`
    return `${seconds}"`
}

/** The canonical spelling of an observed exposure; the camera's label is used only to keep a ratio. */
export function formatShutterSpeed(exposure: ExposureTime | undefined, observedLabel?: string): ShutterSpeed {
    // Only the parsed observation counts: a label Slate could not read is never given units here.
    const parsed = exposure
    if (!parsed)
        throw new CameraUnsupportedError(
            'shutterSpeed',
            `Shutter speed: the camera reports a value Slate cannot read${observedLabel ? ` (${observedLabel})` : ''}`
        )
    switch (parsed.kind) {
        case 'duration':
            return formatDuration(parsed.seconds, observedLabel)
        case 'angle':
            return `${parsed.degrees}°`
        case 'bulb':
            return 'Bulb'
        case 'time':
            return 'Time'
        case 'flash-sync':
            return 'Flash sync'
        case 'auto':
            return 'Auto'
    }
}
