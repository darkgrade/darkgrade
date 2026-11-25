import type { CameraControlState } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import type { SettingReaders, SettingTypes } from '@camera/settings/setting-types'
import type { CanonMovieFormat } from '@ptp/datasets/vendors/canon/canon-movie-format-dataset'
import type { CodecValue } from '@vendors/control-properties'
import { videoCodecValueNames } from '@vendors/control-properties/video'

/** Video settings. Canonical ids, labels and search aliases (a vendor's own word is only an alias). */
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
/** Movie sound: `On` or `Off`; Canon also offers `On (manual level)`. */
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

const canonMovieRecordPattern = /^.+ fps · (MOV|MP4|unknown) · (ALL-I|IPB \(Standard\)|IPB \(Light\)|unknown)$/

function isCanonMovieRecord(value: string): value is CanonMovieRecord {
    return canonMovieRecordPattern.test(value)
}

function unnamed(state: CameraControlState): CameraUnsupportedError {
    return new CameraUnsupportedError(
        state.id,
        `${state.label}: the camera reports a value Slate has no name for (${state.unrecognized?.value ?? state.value})`
    )
}

function namedValue<Value extends string>(guard: (value: string) => value is Value) {
    return (state: CameraControlState): Value => {
        if (state.unrecognized?.value !== undefined || !guard(state.value)) throw unnamed(state)
        return state.value
    }
}

function isVideoFormatValue(value: string): value is VideoFormat {
    return videoCodecValueNames('videoFormat').has(value) || isCanonMovieRecord(value)
}
function isVideoQuality(value: string): value is VideoQuality {
    return videoCodecValueNames('videoQuality').has(value)
}
function isFrameRate(value: string): value is FrameRate {
    return videoCodecValueNames('frameRate').has(value)
}
function isAudioRecording(value: string): value is AudioRecording {
    return value !== 'camera-specific-0' && videoCodecValueNames('audioRecording').has(value)
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const videoSettingReaders: SettingReaders<VideoSettingTypes> = {
    videoFormat: namedValue(isVideoFormatValue),
    videoQuality: namedValue(isVideoQuality),
    frameRate: namedValue(isFrameRate),
    audioRecording: namedValue(isAudioRecording),
}
