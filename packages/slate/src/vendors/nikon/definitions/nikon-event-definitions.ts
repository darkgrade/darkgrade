import { baseCodecs } from '@ptp/types/codec'
import type { EventDefinition } from '@ptp/types/event'

// Codes and parameter positions: gphoto/libgphoto2
// @02d92fea8a269eb94330a4eade204ba799433606:camlibs/ptp2/ptp.h, Nikon extension events.
// MovieRecordComplete's optional StopCode and extended property words are also
// described by the Nikon Z6III USB command reference revision 2, sections 6.4.1.6/6.4.2.5.
const word = <Name extends string>(name: Name, description: string) =>
    ({ name, description, codec: baseCodecs.uint32 }) as const
const event = <const Code extends number, const Name extends string, const Parameters extends EventDefinition['parameters']>(
    code: Code,
    name: Name,
    description: string,
    parameters: Parameters
) => ({ code, name, description, parameters }) as const satisfies EventDefinition

export const NikonDevicePropChanged = event(0x4006, 'DevicePropChanged', 'A Nikon property changed, including a four-byte vendor property code.', [word('DevicePropCode', 'Changed property code')])
export const ObjectAddedInSdram = event(0xc101, 'ObjectAddedInSdram', 'A captured object is available in camera SDRAM.', [word('ObjectHandle', 'Handle of the object available for transfer')])
export const CaptureCompleteRecInSdram = event(0xc102, 'CaptureCompleteRecInSdram', 'Transfer of this capture from camera SDRAM has completed.', [])
export const MovieRecordInterrupted = event(0xc105, 'MovieRecordInterrupted', 'Movie recording was interrupted; preserve the camera reason and destination.', [word('ErrorCode', 'Interruption reason'), word('RecordKind', 'Recording destination')])
export const MovieRecordComplete = event(0xc108, 'MovieRecordComplete', 'Movie recording completed; extended events can include a stop reason.', [word('RecordKind', 'Recording destination'), word('StopCode', 'Optional stop reason')])
export const MovieRecordStarted = event(0xc10a, 'MovieRecordStarted', 'Camera-initiated movie recording started.', [word('RecordKind', 'Recording destination')])
export const PictureControlAdjustChanged = event(0xc10b, 'PictureControlAdjustChanged', 'A Picture Control adjustment changed.', [word('PictureControlItem', 'Changed Picture Control item'), word('ShootingMode', 'Shooting mode')])
export const LiveViewStateChanged = event(0xc10c, 'LiveViewStateChanged', 'The camera live-view state changed.', [word('State', 'Reported live-view state')])
export const ManualSettingsLensDataChanged = event(0xc10e, 'ManualSettingsLensDataChanged', 'Manually configured lens data changed.', [word('LensNumber', 'Changed lens record')])
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
