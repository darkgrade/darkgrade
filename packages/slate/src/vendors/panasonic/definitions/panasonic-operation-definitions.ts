import { OperationDefinition } from '@ptp/types/operation'
import { uint32Parameter, vendorOperation } from '@vendors/generic/vendor-operation'

/* Cited from https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h */

/** ptp.h#L979; ptp.c ptp_panasonic_getdevicepropertydesc sends (propcode, 0, 0) and reads data */
export const PanasonicListProperty = vendorOperation(0x9108, 'PanasonicListProperty', 'out',
    [
        uint32Parameter('PropertyCode', 'Panasonic property code', true),
        uint32Parameter('Reserved1', '0 (libgphoto2)', false),
        uint32Parameter('Reserved2', '0 (libgphoto2)', false),
    ],
    'Lists the descriptor of a Panasonic property (or all); returned undecoded. Not hardware-verified.')
/** ptp.h#L985; ptp.c ptp_panasonic_getdeviceproperty (PTP_DP_GETDATA) */
export const PanasonicGetProperty = vendorOperation(0x9402, 'PanasonicGetProperty', 'out',
    [uint32Parameter('PropertyCode', 'Panasonic property code', true)],
    'Reads a Panasonic property value block; returned undecoded. Not hardware-verified.')
/** ptp.h#L986; ptp.c ptp_panasonic_setdeviceproperty (PTP_DP_SENDDATA) */
export const PanasonicSetProperty = vendorOperation(0x9403, 'PanasonicSetProperty', 'in',
    [uint32Parameter('PropertyCode', 'Panasonic property code', true)],
    'Writes a Panasonic property value block (code, size, value). Not hardware-verified.')
/** ptp.h#L987 and macro ptp_panasonic_capture (ptp.h#L5459) */
export const PanasonicInitiateCapture = vendorOperation(0x9404, 'PanasonicInitiateCapture', 'none',
    [uint32Parameter('Action', 'Release action (0x03000011 capture)', true)],
    'Rec Ctrl Release; libgphoto2 sends 0x03000011 to capture. Not hardware-verified.')
/** ptp.h#L993; ptp.c ptp_panasonic_setcapturetarget (PTP_DP_SENDDATA) */
export const PanasonicSetCaptureTarget = vendorOperation(0x940b, 'PanasonicSetCaptureTarget', 'in',
    [uint32Parameter('Reserved', '0 (libgphoto2)', false)],
    'Selects card or RAM as capture target (data: 0x08000091, size 2, UINT16 mode). Not hardware-verified.')
/** ptp.h#L994 and macro ptp_panasonic_movierec (ptp.h#L5392) */
export const PanasonicMovieRecControl = vendorOperation(0x940c, 'PanasonicMovieRecControl', 'none',
    [uint32Parameter('Action', '0x07000011 start, 0x07000012 stop', true)],
    'Starts (0x07000011) or stops (0x07000012) movie recording. Not hardware-verified.')
/** ptp.h#L1000 and macro ptp_panasonic_liveview (ptp.h#L5390) */
export const PanasonicLiveview = vendorOperation(0x9412, 'PanasonicLiveview', 'none',
    [uint32Parameter('Action', '0x0D000010 start, 0x0D000011 stop', true)],
    'Starts (0x0D000010) or stops (0x0D000011) live view. Not hardware-verified.')
/** ptp.h#L1002; ptp.c ptp_panasonic_9414_0d800012 / _0d800011 */
export const PanasonicGetLiveViewParameters = vendorOperation(0x9414, 'PanasonicGetLiveViewParameters', 'out',
    [uint32Parameter('Selector', '0x0D800012 all formats, 0x0D800011 current', true)],
    'Reads live-view size parameters (0x0D800012 all, 0x0D800011 current); returned undecoded. Not hardware-verified.')
/** ptp.h#L1003; ptp.c ptp_panasonic_9415 (PTP_DP_SENDDATA) */
export const PanasonicSetLiveViewParameters = vendorOperation(0x9415, 'PanasonicSetLiveViewParameters', 'in',
    [uint32Parameter('Selector', '0x0D800011', true)],
    'Sets the current live-view size (data: 0x0D800011, 8, height, width, x, freq). Not hardware-verified.')
/** ptp.h#L1014; ptp.c ptp_panasonic_liveview_image (PTP_DP_GETDATA) */
export const PanasonicLiveviewImage = vendorOperation(0x9706, 'PanasonicLiveviewImage', 'out', [],
    'Gets one live-view frame; returned undecoded. Not hardware-verified.')

export const panasonicOperationRegistry = {
    PanasonicListProperty,
    PanasonicGetProperty,
    PanasonicSetProperty,
    PanasonicInitiateCapture,
    PanasonicSetCaptureTarget,
    PanasonicMovieRecControl,
    PanasonicLiveview,
    PanasonicGetLiveViewParameters,
    PanasonicSetLiveViewParameters,
    PanasonicLiveviewImage,
} as const satisfies { [key: string]: OperationDefinition }
