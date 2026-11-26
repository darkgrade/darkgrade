import { CustomCodec, Int32Codec, Uint16Codec, Uint32Codec, Uint8Codec } from '@ptp/types/codec'

/**
 * Nikon LiveViewObject DataSet (with version), Nikon PTP Reference §9.7.1.
 * All multi-byte values are big-endian on every transport; the specification does not say so,
 * but it was determined empirically.
 */
export interface NikonLiveViewDataset {
    majorVersion: number
    minorVersion: number
    displayInfoSize: number
    liveViewImageSize: number
    wholeSize: { horizontal: number; vertical: number }
    displayAreaSize: { horizontal: number; vertical: number }
    displayCenterCoords: { horizontal: number; vertical: number }
    liveViewImageImageSize: { horizontal: number; vertical: number }
    liveViewImageQuality: number
    afDrivingEnabled: number // 0: disabled, 1: enabled
    focusDrivingStatus: number // 0: not driving, 1: driving
    focusingJudgementResult: number // 0: no info, 1: not focused, 2: focused
    afModeState: number // 0: other, 1: subject detection AF, 2: auto-area AF
    afAreaNumber: number
    selectedSubjectIndex: number
    trackingState: number // 0: waiting, 2: tracking
    afFrameSize: { horizontal: number; vertical: number }
    afFrameCenterCoords: { horizontal: number; vertical: number }
    remainingVideoTime?: number // milliseconds
    elapsedVideoTime?: number // milliseconds
    soundIndicatorPeakL?: number
    soundIndicatorPeakR?: number
    soundIndicatorCurrentL?: number
    soundIndicatorCurrentR?: number
    videoRecordingInfo?: number // 0: LV execution, 1: video recording
    syncRecordingState?: number // 0: cannot perform, 1: standby, 2: performing
    timecodeStatus?: number // 0: off, 1: on
    timecodeHour?: number
    timecodeMinute?: number
    timecodeSecond?: number
    timecodeFrame?: number
    countdownTime?: number
    spotWbCondition?: number // 0: off, 1: on standby (not acquired), 2: during acquisition, 3: success, 4: failure
    rotation?: number // 0: off, 1: counterclockwise, 2: clockwise, 3: upside down
    levelAngleRolling?: number
    levelAnglePitching?: number
    levelAngleYawing?: number
    usingWhiteBalanceForPhotoLv?: number
    imagingTemperatureStatus?: number // 0: normal, 1: medium (low), 2: medium (high), 3: high, 4: countdown
    reserved: Uint8Array
    afFrameData: Uint8Array // AF frame data for up to 96 areas (offset 56-815)
    autoCaptureSubjectDetection: Uint8Array // 52 bytes at offset 854
    reservedEnd: Uint8Array // 118 bytes at offset 906
    liveViewImage: Uint8Array
}

export class NikonLiveViewDatasetCodec extends CustomCodec<NikonLiveViewDataset> {
    encode(_value: NikonLiveViewDataset): Uint8Array {
        throw new Error('Encoding NikonLiveViewDataset is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: NikonLiveViewDataset; bytesRead: number } {
        if (!Number.isSafeInteger(offset) || offset < 0 || buffer.length - offset < 16)
            throw new Error('Nikon live-view dataset has an incomplete header')
        const u8 = new Uint8Codec()
        const u16 = new Uint16Codec(false)
        const u32 = new Uint32Codec(false)
        const i32 = new Int32Codec(false)
        type FieldCodec = Uint8Codec | Uint16Codec | Uint32Codec | Int32Codec
        let cursor = offset
        const skip = (bytes: number) => void (cursor += bytes)
        const read = (codec: FieldCodec, bytes: number, skipBefore = 0) => {
            skip(skipBefore)
            const value = codec.decode(buffer, cursor).value
            cursor += bytes
            return value
        }
        const size = (skipBefore = 0) => ({ horizontal: read(u16, 2, skipBefore), vertical: read(u16, 2) })

        const majorVersion = read(u16, 2)
        const minorVersion = read(u16, 2)
        skip(4)
        const displayInfoSize = read(u32, 4)
        const liveViewImageSize = read(u32, 4)
        const headerEnd = offset + displayInfoSize
        const imageEnd = headerEnd + liveViewImageSize
        if (displayInfoSize < 56 || headerEnd > buffer.length || imageEnd > buffer.length)
            throw new Error('Nikon live-view dataset is shorter than its declared header or image')
        // Older headers end before the modern movie/temperature fields. JPEG bytes
        // must never become telemetry, nor may an absent recording flag mean idle.
        const optional = (codec: FieldCodec, bytes: number, skipBefore = 0) => {
            skip(skipBefore)
            const value = cursor + bytes <= headerEnd ? codec.decode(buffer, cursor).value : undefined
            cursor += bytes
            return value
        }
        // Raw blocks; any multi-byte values inside them are big-endian like the rest of the dataset.
        const headerSlice = (bytes: number) => {
            const slice = buffer.slice(Math.min(cursor, headerEnd), Math.min(cursor + bytes, headerEnd))
            cursor += bytes
            return slice
        }

        const value: NikonLiveViewDataset = {
            majorVersion,
            minorVersion,
            displayInfoSize,
            liveViewImageSize,
            wholeSize: size(),
            displayAreaSize: size(),
            displayCenterCoords: size(),
            liveViewImageImageSize: size(),
            liveViewImageQuality: read(u8, 1),
            afDrivingEnabled: read(u8, 1, 7),
            focusDrivingStatus: read(u8, 1),
            focusingJudgementResult: read(u8, 1),
            afModeState: read(u8, 1),
            afAreaNumber: read(u8, 1),
            selectedSubjectIndex: read(u8, 1),
            trackingState: read(u8, 1),
            afFrameSize: size(1),
            afFrameCenterCoords: size(),
            afFrameData: headerSlice(760),
            remainingVideoTime: optional(u32, 4),
            elapsedVideoTime: optional(u32, 4),
            soundIndicatorPeakL: optional(u8, 1),
            soundIndicatorPeakR: optional(u8, 1),
            soundIndicatorCurrentL: optional(u8, 1),
            soundIndicatorCurrentR: optional(u8, 1),
            videoRecordingInfo: optional(u8, 1),
            syncRecordingState: optional(u8, 1),
            timecodeStatus: optional(u8, 1, 1),
            timecodeHour: optional(u8, 1),
            timecodeMinute: optional(u8, 1),
            timecodeSecond: optional(u8, 1),
            timecodeFrame: optional(u8, 1),
            countdownTime: optional(u16, 2),
            spotWbCondition: optional(u8, 1),
            rotation: optional(u8, 1),
            levelAngleRolling: optional(i32, 4),
            levelAnglePitching: optional(i32, 4),
            levelAngleYawing: optional(i32, 4),
            usingWhiteBalanceForPhotoLv: optional(u8, 1),
            imagingTemperatureStatus: optional(u8, 1),
            reserved: new Uint8Array(),
            autoCaptureSubjectDetection: headerSlice(52),
            reservedEnd: headerSlice(118),
            // The image follows the camera-declared display-info block: 1024 bytes on newer bodies, 512 on the Z 7.
            liveViewImage: buffer.slice(headerEnd, imageEnd),
        }
        return { value, bytesRead: imageEnd - offset }
    }
}
