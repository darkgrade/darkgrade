import type { CameraControlState } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import { enumeratedSettingReader, type SettingReaders } from '@camera/settings/setting-types'
import {
    digitalZoomValues,
    type AudioRecording,
    type CanonMovieRecord,
    type FrameRate,
    type VideoFormat,
    type VideoQuality,
    type VideoSettingTypes,
} from '@camera/settings/video'
import { videoCodecValueNames } from '@vendors/control-properties/video'

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
    digitalZoom: enumeratedSettingReader('digitalZoom', digitalZoomValues),
}
