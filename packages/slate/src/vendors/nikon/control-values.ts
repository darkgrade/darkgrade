import { nikonShutterLabel } from '@vendors/nikon/shutter-values'

/** Nikon's photo (0xd061) and movie (0xd1fa) focus-mode codes, as the USB reference lists them. */
export const NIKON_FOCUS_MODE_LABELS = { 0: 'AF-S', 1: 'AF-C', 2: 'AF-F', 4: 'Manual' } as const
export type NikonFocusModeLabel = (typeof NIKON_FOCUS_MODE_LABELS)[keyof typeof NIKON_FOCUS_MODE_LABELS]
const nikonFocusModeLabels: Readonly<Record<number, NikonFocusModeLabel>> = NIKON_FOCUS_MODE_LABELS

/** Decode Nikon's scalar extensions in one place. Standard decoded properties stay untouched. */
export function nikonControlLabel(propertyName: string, value: string | number | bigint): string {
    const numeric = Number(value)
    if (propertyName === 'NikonMovieShutterSpeed' || propertyName === 'NikonPhotoShutterSpeed')
        return nikonShutterLabel(numeric)
    if (propertyName === 'MovieShutterAngle') {
        if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 36000)
            throw new Error('Invalid Nikon shutter angle')
        return `${numeric / 100}°`
    }
    if (propertyName === 'NikonMovieISO') return `ISO ${numeric}`
    if (propertyName === 'NikonMovieFNumber') return `f/${Number((numeric / 100).toFixed(3))}`
    if (propertyName === 'NikonMovieWhiteBalance')
        return (
            (
                {
                    1: 'Manual',
                    2: 'Auto',
                    3: 'One-push auto',
                    4: 'Daylight',
                    5: 'Fluorescent',
                    6: 'Tungsten',
                    7: 'Flash',
                    32784: 'Cloudy',
                    32785: 'Shade',
                    32786: 'Color Temperature',
                    32787: 'Preset',
                    32788: 'Off',
                    32789: 'Flash',
                    32790: 'Natural light auto',
                } as Record<number, string>
            )[numeric] ?? `Unknown white balance (${value})`
        )
    if (propertyName === 'NikonMovieFocusMode' || propertyName === 'NikonStillFocusMode')
        return nikonFocusModeLabels[numeric] ?? `Unknown focus (${value})`
    return String(value)
}
