import { nikonWhiteBalanceValues } from '@ptp/definitions/vendors/nikon/nikon-shooting-property-definitions'
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
    if (propertyName === 'NikonMovieWhiteBalance' || propertyName === 'WhiteBalance') {
        // Descriptors decode to canonical names already; raw numbers come from shot-control reads.
        if (typeof value === 'string') return value
        return nikonWhiteBalanceValues.find(entry => entry.value === numeric)?.name ?? `Unknown white balance (${value})`
    }
    if (propertyName === 'LiveViewSelector') return value === 'VIDEO' || numeric === 1 ? 'video' : value === 'PHOTO' || numeric === 0 ? 'photo' : String(value)
    if (propertyName === 'NikonMovieFocusMode' || propertyName === 'NikonStillFocusMode')
        return nikonFocusModeLabels[numeric] ?? `Unknown focus (${value})`
    return String(value)
}
