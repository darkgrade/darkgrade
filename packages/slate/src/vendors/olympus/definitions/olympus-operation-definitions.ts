import { OperationDefinition } from '@ptp/types/operation'
import { uint32Parameter, vendorOperation } from '@vendors/generic/vendor-operation'

/* Cited from https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h */

/** ptp.h#L867 and macro ptp_olympus_capture (ptp.h#L5236) */
export const OlympusCapture = vendorOperation(0x9101, 'OlympusCapture', 'none',
    [uint32Parameter('Stage', '3 start, 0 end (libgphoto2)', true)],
    'E-series capture control; libgphoto2 sends 3 to start and 0 to end. Not hardware-verified.')
/** ptp.h#L873 and macro ptp_olympus_setcameracontrolmode (ptp.h#L5234) */
export const OlympusSetCameraControlMode = vendorOperation(0x910b, 'OlympusSetCameraControlMode', 'none',
    [uint32Parameter('Mode', 'Control mode', true)],
    'Selects the E-series camera control mode. Not hardware-verified.')
/** ptp.h#L875; ptp.c ptp_olympus_getdeviceinfo (PTP_DP_GETDATA) */
export const OlympusGetDeviceInfo = vendorOperation(0x9301, 'OlympusGetDeviceInfo', 'out', [],
    'E-series XML-wrapped DeviceInfo; returned undecoded. Not hardware-verified.')
/** ptp.h#L876; ptp.c ptp_olympus_opensession (PTP_DP_GETDATA) */
export const OlympusOpenSession = vendorOperation(0x9302, 'OlympusOpenSession', 'out', [],
    'E-series vendor session open; answers with a data phase, returned undecoded. Not hardware-verified.')
/** ptp.h#L816; ptp.c ptp_olympus_omd_capture */
export const OlympusOmdCapture = vendorOperation(0x9481, 'OlympusOmdCapture', 'none',
    [uint32Parameter('Stage', '3 press, 6 release (libgphoto2)', true)],
    'OM-D capture control; libgphoto2 sends 3 to press and 6 to release. Not hardware-verified.')
/** ptp.h#L819; ptp.c ptp_olympus_liveview_image (PTP_DP_GETDATA) */
export const OlympusGetLiveViewImage = vendorOperation(0x9484, 'OlympusGetLiveViewImage', 'out',
    [uint32Parameter('Parameter', 'Frame request parameter (libgphoto2 passes it through)', true)],
    'Gets one OM-D live-view frame; returned undecoded. Not hardware-verified.')
/** ptp.h#L822 and macro ptp_olympus_omd_move_focus (ptp.h#L5449) */
export const OlympusOmdMfDrive = vendorOperation(0x9487, 'OlympusOmdMfDrive', 'none',
    [uint32Parameter('Direction', 'Focus direction', true), uint32Parameter('StepSize', 'Step size', true)],
    'Drives manual focus by direction and step size. Not hardware-verified.')

export const olympusOperationRegistry = {
    OlympusCapture,
    OlympusSetCameraControlMode,
    OlympusGetDeviceInfo,
    OlympusOpenSession,
    OlympusOmdCapture,
    OlympusGetLiveViewImage,
    OlympusOmdMfDrive,
} as const satisfies { [key: string]: OperationDefinition }
