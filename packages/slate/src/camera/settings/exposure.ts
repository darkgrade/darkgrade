import type { ExposureContext, ExposureTime } from '@camera/exposure-time'
import type { SettingReaders, SettingTypes } from '@camera/settings/setting-types'
import { formatShutterSpeed, type ShutterSpeed } from '@camera/settings/shutter-speed'

/** Exposure settings: canonical ids, labels and search aliases. */
export const exposureControlDefinitions = {
    shutterSpeed: {
        label: 'Shutter speed',
        aliases: ['shutter speed', 'shutter angle', 'shutterAngle', 'exposureTime', 'exposure time'],
    },
    iso: { label: 'ISO', aliases: ['sensitivity', 'exposure index'] },
    aperture: { label: 'Aperture', aliases: ['f number', 'f-stop'] },
    exposureProgram: { label: 'Shooting mode', aliases: ['exposure program', 'shooting mode'] },
} as const

/**
 * Value types of this group's typed settings. Each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera and on every CameraControlSession (see `@camera/settings/typed-settings`).
 * Shutter speed has a canonical spelling of its own; an enumerated setting uses its codec values
 * (`CodecValue<'whiteBalance'>`), mapped to canonical names.
 */
export interface ExposureSettingTypes {
    shutterSpeed: SettingTypes<ShutterSpeed, ShutterSpeed | ExposureTime, [context?: ExposureContext]>
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const exposureSettingReaders: SettingReaders<ExposureSettingTypes> = {
    shutterSpeed: state => formatShutterSpeed(state.exposureTime, state.value),
}
