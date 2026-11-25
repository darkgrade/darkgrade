import { CameraUnsupportedError } from '@camera/errors'
import { namedSettingReader, type SettingReaders, type SettingTypes } from '@camera/settings/setting-types'
import type { CodecValue } from '@vendors/control-properties'

/** Mode settings: photo/video and drive mode. Canonical ids, labels and search aliases. */
export const modeControlDefinitions = {
    photoVideoMode: {
        label: 'Photo / video',
        aliases: ['photo video', 'photo/video', 'still/movie', 'movie mode', 'video mode', 'stills', 'motion'],
    },
    driveMode: {
        label: 'Drive mode',
        aliases: ['drive', 'release mode', 'burst', 'continuous shooting', 'still capture mode'],
    },
} as const

/**
 * Whether the camera is set up to take photos or record video. One view of each vendor's own
 * switch (see `@vendors/photo-video-mode`): Canon's movie select switch, Nikon's LiveViewSelector,
 * and on Sony the photo and movie halves of the exposure program (Manual and Movie Manual).
 */
export type PhotoVideoMode = 'photo' | 'video'

/** A drive mode in Slate's one spelling (`'Single'`, `'Continuous high'`, `'Self-timer 10 s'`, ...). */
export type DriveMode = CodecValue<'driveMode'>

const photoVideoModes: readonly string[] = ['photo', 'video'] satisfies PhotoVideoMode[]

function isPhotoVideoMode(value: string): value is PhotoVideoMode {
    return photoVideoModes.includes(value)
}

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
export interface ModeSettingTypes {
    photoVideoMode: SettingTypes<PhotoVideoMode>
    driveMode: SettingTypes<DriveMode>
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const modeSettingReaders: SettingReaders<ModeSettingTypes> = {
    photoVideoMode: state => {
        if (isPhotoVideoMode(state.value)) return state.value
        throw new CameraUnsupportedError(
            'photoVideoMode',
            `Photo / video: the camera reports a mode Slate cannot place (${state.value})`
        )
    },
    driveMode: namedSettingReader<DriveMode>('Drive mode'),
}
