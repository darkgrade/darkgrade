import { FocusIndicationCodec } from '@vendors/sony/definitions/sony-property-definitions'
import { baseCodecs } from '@ptp/types/codec'
import type { EventDefinition } from '@ptp/types/event'

/** One Sony event definition, typed as literally as an `as const` object. */
const sonyEvent = <
    const Code extends number,
    const Name extends string,
    const Description extends string,
    const Parameters extends EventDefinition['parameters'],
>(
    code: Code,
    name: Name,
    description: Description,
    parameters: Parameters
) => ({ code, name, description, parameters }) as const

export const sonyEventRegistry = {
    SDIE_ObjectAdded: sonyEvent(0xc201, 'SDIE_ObjectAdded', 'Notify that a shot file is ready to transfer', [
        { name: 'ObjectHandle', description: 'Handle of the added object', codec: baseCodecs.uint32 },
    ]),
    SDIE_ObjectRemoved: sonyEvent(0xc202, 'SDIE_ObjectRemoved', 'Notify that a shot file is deleted', [
        { name: 'ObjectHandle', description: 'Handle of the removed object', codec: baseCodecs.uint32 },
    ]),
    SDIE_DevicePropChanged: sonyEvent(0xc203, 'SDIE_DevicePropChanged', 'Notify that the DevicePropValue is changed', [
        { name: 'Reserved', description: 'Optional reserved word observed on a6700 and FX2 notifications', codec: baseCodecs.uint32 },
    ]),
    SDIE_DateTimeSettingResult: sonyEvent(0xc205, 'SDIE_DateTimeSettingResult', 'Notify Date/Time Setting result', [
        { name: 'Setting Result', description: 'Date/Time setting result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_CapturedEvent: sonyEvent(0xc206, 'SDIE_CapturedEvent', 'Notify a captured event', []),
    SDIE_CWBCapturedResult: sonyEvent(0xc208, 'SDIE_CWBCapturedResult', 'Notify the result of Custom WB capture', [
        { name: 'Result', description: 'Custom WB capture result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_CameraSettingReadResult: sonyEvent(0xc209, 'SDIE_CameraSettingReadResult', 'Notify the result of camera-setting read', [
        { name: 'Result', description: 'Camera setting read result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_FTPSettingReadResult: sonyEvent(0xc20a, 'SDIE_FTPSettingReadResult', 'Notify the result of FTP-setting read', [
        { name: 'Result', description: 'FTP setting read result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_MediaFormatResult: sonyEvent(0xc20b, 'SDIE_MediaFormatResult', 'Notify the result of media format', [
        { name: 'Result', description: 'Media format result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_ContentsTransferEvent: sonyEvent(0xc20d, 'SDIE_ContentsTransferEvent', 'Notify that the ContentTransferEvent', [
        { name: 'Event ID', description: 'Contents transfer event ID', codec: baseCodecs.uint32 },
    ]),
    SDIE_ZoomandFocusPositionEvent: sonyEvent(0xc20e, 'SDIE_ZoomandFocusPositionEvent', 'Notify the Zoom and Focus Position Event', [
        { name: 'Event ID', description: 'Zoom and focus position event ID', codec: baseCodecs.uint32 },
    ]),
    SDIE_DisplayListChangedEvent: sonyEvent(0xc20f, 'SDIE_DisplayListChangedEvent', 'Notify an update of DisplayStringList', [
        { name: 'Display String List Type', description: 'Display string list type', codec: baseCodecs.uint32 },
    ]),
    SDIE_MediaProfileChanged: sonyEvent(0xc210, 'SDIE_MediaProfileChanged', 'Notify that the media profile is changed', [
        { name: 'Media', description: 'Media identifier', codec: baseCodecs.uint32 },
    ]),
    SDIE_ControlJobListEvent: sonyEvent(0xc211, 'SDIE_ControlJobListEvent', 'Notify the Control Job List Event', [
        { name: 'Result', description: 'Control job list result code', codec: baseCodecs.uint32 },
        { name: 'ControlType', description: 'Control type', codec: baseCodecs.uint32 },
    ]),
    SDIE_ControlUploadDataResultOld: sonyEvent(0xc213, 'SDIE_ControlUploadDataResultOld', 'Notify the result of ControlUpload (older version)', []),
    SDIE_ControlUploadDataResult: sonyEvent(0xc214, 'SDIE_ControlUploadDataResult', 'Notify the result of ControlUpload', [
        { name: 'Result', description: 'Control upload result code', codec: baseCodecs.uint32 },
        { name: 'ControlType', description: 'Control type', codec: baseCodecs.uint32 },
        { name: 'OptionParam', description: 'Optional parameter', codec: baseCodecs.uint32 },
    ]),
    SDIE_ZoomPositionResultOld: sonyEvent(0xc216, 'SDIE_ZoomPositionResultOld', 'Notify the zoom position result (older version)', []),
    SDIE_ZoomPositionResult: sonyEvent(0xc217, 'SDIE_ZoomPositionResult', 'Notify the zoom position result', [
        { name: 'Result', description: 'Zoom position result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_FocusPositionResult: sonyEvent(0xc218, 'SDIE_FocusPositionResult', 'Notify the focus position result', [
        { name: 'Result', description: 'Focus position result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_LensInformationChangedOld: sonyEvent(0xc219, 'SDIE_LensInformationChangedOld', 'Notify that the lens information is changed (older version)', []),
    SDIE_FirmwareUpdateCheckResultOld: sonyEvent(0xc21a, 'SDIE_FirmwareUpdateCheckResultOld', 'Firmware update check result (older version)', []),
    SDIE_LensInformationChanged: sonyEvent(0xc21b, 'SDIE_LensInformationChanged', 'Notify that the lens information is changed', []),
    SDIE_FirmwareUpdateEventOld: sonyEvent(0xc21c, 'SDIE_FirmwareUpdateEventOld', 'Firmware update event (older version)', []),
    SDIE_FirmwareUpdateCheckResult: sonyEvent(0xc21d, 'SDIE_FirmwareUpdateCheckResult', 'Firmware update check result', [
        { name: 'Result', description: 'Firmware update check result code', codec: baseCodecs.uint32 },
    ]),
    SDIE_FirmwareUpdateEvent: sonyEvent(0xc21e, 'SDIE_FirmwareUpdateEvent', 'Firmware update event', [
        { name: 'Event ID', description: 'Firmware update event ID', codec: baseCodecs.uint32 },
        { name: 'Param1', description: 'Event parameter 1', codec: baseCodecs.uint32 },
        { name: 'Param2', description: 'Event parameter 2', codec: baseCodecs.uint32 },
    ]),
    SDIE_StreamStatusEvent: sonyEvent(0xc21f, 'SDIE_StreamStatusEvent', 'Notify the stream status event', [
        { name: 'Stream ID', description: 'Stream identifier', codec: baseCodecs.uint32 },
        { name: 'Status', description: 'Stream status', codec: baseCodecs.uint32 },
    ]),
    SDIE_OperationResultsOld: sonyEvent(0xc220, 'SDIE_OperationResultsOld', 'Notify the operation results (older version)', []),
    SDIE_OperationResults: sonyEvent(0xc222, 'SDIE_OperationResults', 'Notify the operation results', [
        { name: 'ResultCode', description: 'Operation result code', codec: baseCodecs.uint32 },
        { name: 'Result', description: 'Result value', codec: baseCodecs.uint32 },
        { name: 'Reserved', description: 'Reserved parameter', codec: baseCodecs.uint32 },
    ]),
    SDIE_AFStatus: sonyEvent(0xc223, 'SDIE_AFStatus', 'Notify the AF status', [
        {
            name: 'Status',
            description: 'Autofocus status (same as Focus Indication 0xD213)',
            codec: FocusIndicationCodec,
        },
    ]),
    SDIE_MovieRecOperationResults: sonyEvent(0xc224, 'SDIE_MovieRecOperationResults', 'Notify the execution results of Movie Rec Operation', [
        { name: 'Results', description: 'Movie recording operation results', codec: baseCodecs.uint32 },
    ]),
    SDIE_PresetInfoListChangedOld: sonyEvent(0xc225, 'SDIE_PresetInfoListChangedOld', 'Notify that the PresetInfo List is changed (older version)', []),
    SDIE_PresetInfoListChanged: sonyEvent(0xc226, 'SDIE_PresetInfoListChanged', 'Notify that the PresetInfo List is changed', []),
    SDIE_CautionDisplayEventOld: sonyEvent(0xc227, 'SDIE_CautionDisplayEventOld', 'Notify the CautionDisplayEvent (older version)', []),
    SDIE_CautionDisplayEvent: sonyEvent(0xc228, 'SDIE_CautionDisplayEvent', 'Notify the CautionDisplayEvent', [
        { name: 'Reserve', description: 'Reserved parameter 1', codec: baseCodecs.uint32 },
        { name: 'Reserve', description: 'Reserved parameter 2', codec: baseCodecs.uint32 },
        { name: 'Reserve', description: 'Reserved parameter 3', codec: baseCodecs.uint32 },
    ]),
    SDIE_ContentInfoListChangedOld: sonyEvent(0xc229, 'SDIE_ContentInfoListChangedOld', 'Notify that the ContentInfo List is changed (older version)', []),
    SDIE_ContentInfoListChanged: sonyEvent(0xc234, 'SDIE_ContentInfoListChanged', 'Notify that the ContentInfo List is changed', [
        { name: 'Slot Info', description: 'Slot information', codec: baseCodecs.uint32 },
        { name: 'Event Type', description: 'Event type', codec: baseCodecs.uint32 },
    ]),
    SDIE_ControlPTZFResultOld: sonyEvent(0xc235, 'SDIE_ControlPTZFResultOld', 'Notify the ControlPTZF result (older version)', []),
    SDIE_PresetPTZFEventOld: sonyEvent(0xc237, 'SDIE_PresetPTZFEventOld', 'Notify the PresetPTZF Event (older version)', []),
    SDIE_ControlPTZFResult: sonyEvent(0xc238, 'SDIE_ControlPTZFResult', 'Notify the ControlPTZF result', [
        { name: 'Result', description: 'Control PTZF result code', codec: baseCodecs.uint32 },
        { name: 'Control Type', description: 'Control type', codec: baseCodecs.uint32 },
    ]),
    SDIE_PresetPTZFEvent: sonyEvent(0xc239, 'SDIE_PresetPTZFEvent', 'Notify the PresetPTZF Event', [
        { name: 'Event Type', description: 'Event type', codec: baseCodecs.uint32 },
        { name: 'Reserved', description: 'Reserved parameter 1', codec: baseCodecs.uint32 },
        { name: 'Reserved', description: 'Reserved parameter 2', codec: baseCodecs.uint32 },
    ]),
    SDIE_DeleteContentResult: sonyEvent(0xc240, 'SDIE_DeleteContentResult', 'Notify the DeleteContentResult', [
        { name: 'Result', description: 'Delete content result code', codec: baseCodecs.uint32 },
        { name: 'contentID', description: 'Content identifier', codec: baseCodecs.uint32 },
        { name: 'Slot Info', description: 'Slot information', codec: baseCodecs.uint32 },
    ]),
} as const

export type SonyEventDef = (typeof sonyEventRegistry)[keyof typeof sonyEventRegistry]
