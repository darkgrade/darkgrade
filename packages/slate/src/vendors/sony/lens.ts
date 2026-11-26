import type { CameraLens } from '@camera/controls'

/** The Sony property inventory fields the lens readout uses (a subset of SonyPropertyState). */
export interface SonyLensProperty {
    code: number
    value: number | bigint | string
    rawValue: number | bigint | string
    enabled: boolean
}

/** Camera Remote SDK LensModelName: the attached lens's name, as text. */
const LENS_MODEL_NAME = 0xd07b
/** Camera Remote SDK ZoomDistance: the current focal length in thousandths of a millimetre. */
const ZOOM_DISTANCE = 0xd00b
/**
 * Camera Remote SDK ZoomDistanceUnitSetting. Slate has no decoding for its values, so a body that
 * advertises it may be reporting ZoomDistance in another unit: its focal length stays unknown.
 */
const ZOOM_DISTANCE_UNIT_SETTING = 0xd029

/**
 * The focal length in millimetres, or null when the body does not report a valid one. Sony marks
 * the property disabled when its value does not apply: the a7 V with a manual-zoom FE 24-70mm
 * F2.8 GM II reports ZoomDistance 24000 with the enabled flag off (bench, 2026-11-24).
 */
export function sonyFocalLengthMillimetres(properties: readonly SonyLensProperty[]): number | null {
    if (properties.some(property => property.code === ZOOM_DISTANCE_UNIT_SETTING)) return null
    const distance = properties.find(property => property.code === ZOOM_DISTANCE)
    if (!distance?.enabled) return null
    const thousandths = Number(distance.rawValue)
    return Number.isFinite(thousandths) && thousandths > 0 ? thousandths / 1000 : null
}

/** The lens from one Sony property inventory; undefined when the body reports neither field. */
export function sonyLens(properties: readonly SonyLensProperty[]): CameraLens | undefined {
    const nameValue = properties.find(property => property.code === LENS_MODEL_NAME)?.value
    const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : null
    const focalLengthMillimetres = sonyFocalLengthMillimetres(properties)
    if (name === null && focalLengthMillimetres === null) return undefined
    return { name, focalLengthMillimetres }
}
