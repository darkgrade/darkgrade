import type { SettingTypes } from '@camera/settings/setting-types'
import type { CanonMovieFormat } from '@ptp/datasets/vendors/canon/canon-movie-format-dataset'
import type { CodecValue } from '@vendors/control-properties'

/**
 * Video settings. Canonical ids, labels and search aliases (a vendor's own word is only an alias).
 * This module is vocabulary and types only, so `@darkgrade/slate/controls` stays free of vendor
 * codecs; the readers that need the codecs' value names are in `@camera/settings/video-readers`.
 */
export const videoControlDefinitions = {
    videoFormat: {
        label: 'Video format',
        aliases: ['codec', 'movie format', 'movieFormat', 'recording format', 'file format'],
    },
    videoQuality: {
        label: 'Video quality',
        aliases: ['resolution', 'bit rate', 'bitrate', 'record setting', 'movie setting', 'movieSetting', 'movie quality'],
    },
    frameRate: { label: 'Frame rate', aliases: ['fps', 'movie frame rate', 'movieFrameRate'] },
    audioRecording: { label: 'Audio recording', aliases: ['sound', 'movie audio', 'movie sound', 'sound recording'] },
    zoomMode: { label: 'Zoom mode', aliases: ['zoom mode', 'zoomSetting'] },
} as const

/**
 * Canon's movie record names resolution, frame rate, container and compression in one value,
 * spelled by its codec as `4K 23.98 fps · MP4 · IPB (Standard)`.
 */
export type CanonMovieRecord = `${string} fps · ${CanonMovieFormat['container']} · ${CanonMovieFormat['compression']}`

/** A video format: Sony's codec names (`XAVC S 4K`) or Canon's complete movie record. */
export type VideoFormat = Exclude<CodecValue<'videoFormat'>, CanonMovieFormat> | CanonMovieRecord
/** A video quality (bit rate, sampling and depth), as the vendor codecs name it: `150M 4:2:0 10-bit`. */
export type VideoQuality = CodecValue<'videoQuality'>
/** A frame rate: `24p`, `23.98p`, `60p`, `50i`. */
export type FrameRate = CodecValue<'frameRate'>
/** Movie sound, Canon only for now: `On`, `Off` or `On (manual level)`. */
export type AudioRecording = Exclude<CodecValue<'audioRecording'>, 'camera-specific-0'>

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
export interface VideoSettingTypes {
    videoFormat: SettingTypes<VideoFormat>
    videoQuality: SettingTypes<VideoQuality>
    frameRate: SettingTypes<FrameRate>
    audioRecording: SettingTypes<AudioRecording>
}
