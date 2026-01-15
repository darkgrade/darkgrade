import { CustomCodec, Int32Codec, type PTPRegistry, Uint16Codec, Uint32Codec, Uint8Codec } from '@ptp/types/codec'

/**
 * Nikon LiveViewObject DataSet (with version)
 * Based on Nikon PTP Reference Section 9.7.1
 *
 * IMPORTANT: This dataset uses BIG-ENDIAN byte order for all multi-byte values,
 * regardless of transport endianness. This is not explicitly documented in the
 * Nikon PTP spec (section 9.7 lacks the usual "little endian format" statement),
 * but was determined empirically through testing.
 *
 * The codec creates big-endian instances directly, so it works correctly on both:
 * - USB transport (little-endian) - big-endian codecs read dataset correctly
 * - IP transport (big-endian) - big-endian codecs still read correctly
 */
export interface NikonLiveViewDataset {
    // Version info
    majorVersion: number
    minorVersion: number

    // Size information
    displayInfoSize: number
    liveViewImageSize: number

    // Dimensions
    wholeSize: { horizontal: number; vertical: number }
    displayAreaSize: { horizontal: number; vertical: number }
    displayCenterCoords: { horizontal: number; vertical: number }
    liveViewImageImageSize: { horizontal: number; vertical: number }

    // Display information
    liveViewImageQuality: number

    // AF information
    afDrivingEnabled: number // 0: disabled, 1: enabled
    focusDrivingStatus: number // 0: not driving, 1: driving
    focusingJudgementResult: number // 0: no info, 1: not focused, 2: focused
    afModeState: number // 0: other, 1: subject detection AF, 2: auto-area AF
    afAreaNumber: number
    selectedSubjectIndex: number
    trackingState: number // 0: waiting, 2: tracking

    afFrameSize: { horizontal: number; vertical: number }
    afFrameCenterCoords: { horizontal: number; vertical: number }

    // Video recording information
    remainingVideoTime: number // milliseconds
    elapsedVideoTime: number // milliseconds

    // Sound indicators
    soundIndicatorPeakL: number
    soundIndicatorPeakR: number
    soundIndicatorCurrentL: number
    soundIndicatorCurrentR: number

    videoRecordingInfo: number // 0: LV execution, 1: video recording
    syncRecordingState: number // 0: cannot perform, 1: standby, 2: performing

    // Timecode
    timecodeStatus: number // 0: off, 1: on
    timecodeHour: number
    timecodeMinute: number
    timecodeSecond: number
    timecodeFrame: number

    countdownTime: number
    spotWbCondition: number // 0: off, 1: on standby (not acquired), 2: during acquisition, 3: success, 4: failure
    rotation: number // 0: off, 1: counterclockwise, 2: clockwise, 3: upside down

    // Level angle information
    levelAngleRolling: number
    levelAnglePitching: number
    levelAngleYawing: number

    usingWhiteBalanceForPhotoLv: number
    imagingTemperatureStatus: number // 0: normal, 1: medium (low), 2: medium (high), 3: high, 4: countdown

    // Raw reserved and AF frame data
    reserved: Uint8Array
    afFrameData: Uint8Array // AF frame data for up to 96 areas (offset 56-815)
    autoCaptureSubjectDetection: Uint8Array // 52 bytes at offset 854
    reservedEnd: Uint8Array // 118 bytes at offset 906

    // Live view image (JPEG)
    liveViewImage: Uint8Array
}

export class NikonLiveViewDatasetCodec extends CustomCodec<NikonLiveViewDataset> {
    encode(value: NikonLiveViewDataset): Uint8Array {
        throw new Error('Encoding NikonLiveViewDataset is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: NikonLiveViewDataset; bytesRead: number } {
        // Nikon LiveViewObject is always BIG-ENDIAN regardless of transport
        // Create big-endian codecs for this dataset
        const u8 = new Uint8Codec()
        const u16 = new Uint16Codec(false) // false = big-endian
        const u32 = new Uint32Codec(false) // false = big-endian
        const i32 = new Int32Codec(false) // false = big-endian

        let currentOffset = offset

        // Version (4 bytes)
        const majorVersion = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const minorVersion = u16.decode(buffer, currentOffset).value
        currentOffset += 2

        // Reserved (4 bytes)
        currentOffset += 4

        // Size information (8 bytes)
        const displayInfoSize = u32.decode(buffer, currentOffset).value
        currentOffset += 4
        const liveViewImageSize = u32.decode(buffer, currentOffset).value
        currentOffset += 4

        // Whole size (4 bytes)
        const wholeSizeH = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const wholeSizeV = u16.decode(buffer, currentOffset).value
        currentOffset += 2

        // Display area size (4 bytes)
        const displayAreaSizeH = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const displayAreaSizeV = u16.decode(buffer, currentOffset).value
        currentOffset += 2

        // Display center coordinates (4 bytes)
        const displayCenterH = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const displayCenterV = u16.decode(buffer, currentOffset).value
        currentOffset += 2

        // Live view image size (4 bytes)
        const liveViewImageImageSizeH = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const liveViewImageImageSizeV = u16.decode(buffer, currentOffset).value
        currentOffset += 2

        // Live view image quality (1 byte)
        const liveViewImageQuality = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Reserved (7 bytes)
        currentOffset += 7

        // AF information (offset 40-46)
        const afDrivingEnabled = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const focusDrivingStatus = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const focusingJudgementResult = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const afModeState = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const afAreaNumber = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const selectedSubjectIndex = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const trackingState = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Reserved (1 byte)
        currentOffset += 1

        // AF frame size and center coordinates (8 bytes)
        const afFrameSizeH = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const afFrameSizeV = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const afFrameCenterH = u16.decode(buffer, currentOffset).value
        currentOffset += 2
        const afFrameCenterV = u16.decode(buffer, currentOffset).value
        currentOffset += 2

        // AF frame data for 96 areas (offset 56 to 815 = 760 bytes)
        // NOTE: Contains multi-byte values (96 areas × 8 bytes: horizontal size, vertical size,
        // horizontal pos, vertical pos - all 2-byte values). If parsed in the future, these
        // 2-byte values would need to be read as BIG-ENDIAN. Currently stored as raw bytes.
        const afFrameData = buffer.slice(currentOffset, currentOffset + 760)
        currentOffset += 760

        // Video recording information (offset 816-827)
        const remainingVideoTime = u32.decode(buffer, currentOffset).value
        currentOffset += 4
        const elapsedVideoTime = u32.decode(buffer, currentOffset).value
        currentOffset += 4
        const soundIndicatorPeakL = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const soundIndicatorPeakR = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const soundIndicatorCurrentL = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const soundIndicatorCurrentR = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Video recording info and sync state (offset 828-829)
        const videoRecordingInfo = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const syncRecordingState = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Reserved (1 byte at offset 830)
        currentOffset += 1

        // Timecode (offset 831-835)
        const timecodeStatus = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const timecodeHour = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const timecodeMinute = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const timecodeSecond = u8.decode(buffer, currentOffset).value
        currentOffset += 1
        const timecodeFrame = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Countdown time (offset 836-837)
        const countdownTime = u16.decode(buffer, currentOffset).value
        currentOffset += 2

        // Spot WB condition (offset 838)
        const spotWbCondition = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Rotation (offset 839)
        const rotation = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Level angle information (offset 840-851)
        const levelAngleRolling = i32.decode(buffer, currentOffset).value
        currentOffset += 4
        const levelAnglePitching = i32.decode(buffer, currentOffset).value
        currentOffset += 4
        const levelAngleYawing = i32.decode(buffer, currentOffset).value
        currentOffset += 4

        // White balance for photo LV (offset 852)
        const usingWhiteBalanceForPhotoLv = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Imaging temperature status (offset 853)
        const imagingTemperatureStatus = u8.decode(buffer, currentOffset).value
        currentOffset += 1

        // Auto capture subject detection (offset 854-905, 52 bytes)
        // NOTE: CaptureAreaDataSet format - likely contains multi-byte values that would need
        // BIG-ENDIAN parsing if decoded in the future. Currently stored as raw bytes.
        const autoCaptureSubjectDetection = buffer.slice(currentOffset, currentOffset + 52)
        currentOffset += 52

        // Reserved (offset 906-1023, 118 bytes)
        // NOTE: Reserved/padding bytes - endianness irrelevant
        const reservedEnd = buffer.slice(currentOffset, currentOffset + 118)
        currentOffset += 118

        // Live view image starts at offset 1024
        // NOTE: JPEG image data - JPEG format is inherently big-endian
        // No endianness conversion needed.
        let liveViewImage: Uint8Array = new Uint8Array()
        const imageStartOffset = offset + 1024
        const expectedEndOffset = imageStartOffset + liveViewImageSize

        if (liveViewImageSize > 0 && buffer.length >= expectedEndOffset) {
            liveViewImage = buffer.slice(imageStartOffset, expectedEndOffset)
        }

        const bytesRead = Math.max(1024 + liveViewImageSize, buffer.length - offset)

        return {
            value: {
                majorVersion,
                minorVersion,
                displayInfoSize,
                liveViewImageSize,
                wholeSize: { horizontal: wholeSizeH, vertical: wholeSizeV },
                displayAreaSize: { horizontal: displayAreaSizeH, vertical: displayAreaSizeV },
                displayCenterCoords: { horizontal: displayCenterH, vertical: displayCenterV },
                liveViewImageImageSize: { horizontal: liveViewImageImageSizeH, vertical: liveViewImageImageSizeV },
                liveViewImageQuality,
                afDrivingEnabled,
                focusDrivingStatus,
                focusingJudgementResult,
                afModeState,
                afAreaNumber,
                selectedSubjectIndex,
                trackingState,
                afFrameSize: { horizontal: afFrameSizeH, vertical: afFrameSizeV },
                afFrameCenterCoords: { horizontal: afFrameCenterH, vertical: afFrameCenterV },
                remainingVideoTime,
                elapsedVideoTime,
                soundIndicatorPeakL,
                soundIndicatorPeakR,
                soundIndicatorCurrentL,
                soundIndicatorCurrentR,
                videoRecordingInfo,
                syncRecordingState,
                timecodeStatus,
                timecodeHour,
                timecodeMinute,
                timecodeSecond,
                timecodeFrame,
                countdownTime,
                spotWbCondition,
                rotation,
                levelAngleRolling,
                levelAnglePitching,
                levelAngleYawing,
                usingWhiteBalanceForPhotoLv,
                imagingTemperatureStatus,
                reserved: new Uint8Array(),
                afFrameData,
                autoCaptureSubjectDetection,
                reservedEnd,
                liveViewImage,
            },
            bytesRead,
        }
    }
}

export function parseNikonLiveViewDataset(data: Uint8Array, registry: PTPRegistry): NikonLiveViewDataset {
    const codec = new NikonLiveViewDatasetCodec(registry)
    return codec.decode(data).value
}
