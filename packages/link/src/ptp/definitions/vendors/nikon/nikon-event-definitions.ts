import { baseCodecs } from '@ptp/types/codec'
import type { EventDefinition } from '@ptp/types/event'

// Codes and parameter positions: gphoto/libgphoto2
// @02d92fea8a269eb94330a4eade204ba799433606:camlibs/ptp2/ptp.h, Nikon extension events.
// MovieRecordComplete's optional StopCode and extended property words are also
// described by the Nikon Z6III USB command reference revision 2, sections 6.4.1.6/6.4.2.5.
const word = <Name extends string>(name: Name, description: string) =>
    ({ name, description, codec: baseCodecs.uint32 }) as const

export const NikonDevicePropChanged = {
    code: 0x4006,
    name: 'DevicePropChanged',
    description: 'A Nikon property changed, including a four-byte vendor property code.',
    parameters: [word('DevicePropCode', 'Changed property code')],
} as const satisfies EventDefinition

export const ObjectAddedInSdram = {
    code: 0xc101,
    name: 'ObjectAddedInSdram',
    description: 'A captured object is available in camera SDRAM.',
    parameters: [word('ObjectHandle', 'Handle of the object available for transfer')],
} as const satisfies EventDefinition

export const CaptureCompleteRecInSdram = {
    code: 0xc102,
    name: 'CaptureCompleteRecInSdram',
    description: 'Transfer of this capture from camera SDRAM has completed.',
    parameters: [],
} as const satisfies EventDefinition

export const MovieRecordInterrupted = {
    code: 0xc105,
    name: 'MovieRecordInterrupted',
    description: 'Movie recording was interrupted; preserve the camera reason and destination.',
    parameters: [word('ErrorCode', 'Interruption reason'), word('RecordKind', 'Recording destination')],
} as const satisfies EventDefinition

export const MovieRecordComplete = {
    code: 0xc108,
    name: 'MovieRecordComplete',
    description: 'Movie recording completed; extended events can include a stop reason.',
    parameters: [word('RecordKind', 'Recording destination'), word('StopCode', 'Optional stop reason')],
} as const satisfies EventDefinition

export const MovieRecordStarted = {
    code: 0xc10a,
    name: 'MovieRecordStarted',
    description: 'Camera-initiated movie recording started.',
    parameters: [word('RecordKind', 'Recording destination')],
} as const satisfies EventDefinition

export const PictureControlAdjustChanged = {
    code: 0xc10b,
    name: 'PictureControlAdjustChanged',
    description: 'A Picture Control adjustment changed.',
    parameters: [word('PictureControlItem', 'Changed Picture Control item'), word('ShootingMode', 'Shooting mode')],
} as const satisfies EventDefinition

export const LiveViewStateChanged = {
    code: 0xc10c,
    name: 'LiveViewStateChanged',
    description: 'The camera live-view state changed.',
    parameters: [word('State', 'Reported live-view state')],
} as const satisfies EventDefinition

export const ManualSettingsLensDataChanged = {
    code: 0xc10e,
    name: 'ManualSettingsLensDataChanged',
    description: 'Manually configured lens data changed.',
    parameters: [word('LensNumber', 'Changed lens record')],
} as const satisfies EventDefinition

export const nikonEventRegistry = {
    DevicePropChanged: NikonDevicePropChanged,
    ObjectAddedInSdram,
    CaptureCompleteRecInSdram,
    MovieRecordInterrupted,
    MovieRecordComplete,
    MovieRecordStarted,
    PictureControlAdjustChanged,
    LiveViewStateChanged,
    ManualSettingsLensDataChanged,
} as const satisfies Record<string, EventDefinition>
