import type { videoControlDefinitions } from '@camera/settings/video'
import * as canon from '@vendors/canon/definitions/canon-property-definitions'
import * as sony from '@vendors/sony/definitions/sony-property-definitions'
import { createPTPRegistry } from '@vendors/registry'
import { EnumCodec } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

/**
 * The video group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 *
 * Canon carries resolution, frame rate, container and compression in one movie record, offered
 * as the video format. Nikon's movie format, size and frame rate have no decoded properties yet.
 *
 * Sony's AudioRecording (0xd0d2) is not mapped: its value meanings are undocumented, and on the
 * a7 V (2026-11-24) a take recorded with raw 0 still carried a sound track, like one with raw 1.
 * Until the meaning is measured from the audio samples or documented, audioRecording is
 * unsupported on Sony rather than a confirmed "Off" that may still record sound.
 */
export const videoControlProperties = {
    sony: {
        videoFormat: [sony.MovieFileFormat],
        videoQuality: [sony.MovieRecordingSetting],
        frameRate: [sony.MovieRecordingFrameRate],
        digitalZoom: [sony.ZoomSetting],
    },
    canon: {
        videoFormat: [canon.CanonMovieFormat],
        audioRecording: [canon.CanonMovieSoundRecording],
    },
    standard: {},
    nikonPhoto: {},
    nikonMovie: {},
} as const satisfies VendorControlProperties<keyof typeof videoControlDefinitions>

type VideoSettingId = 'videoFormat' | 'videoQuality' | 'frameRate' | 'audioRecording'

const valueNames = new Map<VideoSettingId, ReadonlySet<string>>()

/**
 * The names a setting's enumerated vendor codecs decode, across every vendor: the runtime
 * counterpart of `CodecValue<id>`, so a reader can tell a named value from a label it never knew.
 */
export function videoCodecValueNames(id: VideoSettingId): ReadonlySet<string> {
    const known = valueNames.get(id)
    if (known) return known
    const registry = createPTPRegistry(true)
    const names = new Set<string>()
    const inventories: readonly { readonly [Id in VideoSettingId]?: readonly PropertyDefinition[] }[] =
        Object.values(videoControlProperties)
    for (const inventory of inventories)
        for (const property of inventory[id] ?? []) {
            const codec = typeof property.codec === 'function' ? property.codec(registry) : property.codec
            if (codec instanceof EnumCodec) for (const value of codec.getAllValues()) names.add(String(value.name))
        }
    valueNames.set(id, names)
    return names
}
