/**
 * PTP standard property definitions with type validation
 */

import { DataType, PropertyDefinition, HexCode } from '@constants/types'
import { decodePTPValue, encodePTPValue } from '@core/buffers'

/**
 * PTP standard property definitions with type validation
 */
export const PTPProperties = {
    ISO: {
        name: 'ISO',
        description:
            '(AKA ExposureIndex / Exposure Index) this property allows the emulation of film speed settings on a digital camera. The settings correspond to the ISO designations (ASA/DIN). Typically, a device supports discrete enumerated values but continuous control over a range is possible. A value of 0xFFFF corresponds to the automatic ISO setting.',
        code: 0x500f,
        type: DataType.UINT16,
        unit: 'ISO',
        writable: true,
        encode: (value: string) => {
            return encodePTPValue(value, DataType.UINT32)
        },
        decode: (value: HexCode | Uint8Array) => {
            return decodePTPValue(value as Uint8Array, DataType.UINT32)
        },
    },
    SHUTTER_SPEED: {
        name: 'SHUTTER_SPEED',
        description:
            '(AKA ExposureTime / Exposure Time) this property corresponds to the shutter speed. It has units of seconds scaled by 10 000. When the device is in an automatic exposure program mode, the setting of this property via SetDeviceProp may cause other properties to change. Like all properties that cause other properties to change, the device is required to issue DevicePropChanged events for the other properties that changed as a result of the initial change. This property is typically only used by the device when the ProgramExposureMode is set to manual or shutter priority.',
        code: 0x500d,
        type: DataType.UINT32,
        unit: 'seconds',
        writable: true,
        encode: (value: number) => {
            return encodePTPValue(value * 10000, DataType.UINT32)
        },
        decode: (value: HexCode | Uint8Array) => {
            return decodePTPValue(value as Uint8Array, DataType.UINT32) / 10000
        },
    },
    APERTURE: {
        name: 'APERTURE',
        description:
            '(AKA FNumber / F-Number / F Number / FStop / F-Stop / F Stop) this property corresponds to the aperture of the lens. The units are equal to the F-number scaled by 100. When the device is in an automatic exposure program mode, the setting of this property via the SetDeviceProp operation may cause other properties such as exposure time and exposure index to change. Like all device properties that cause other device properties to change, the device is required to issue DevicePropChanged events for the other device properties that changed as a side effect of the invoked change. The setting of this property is typically only valid when the device has an ExposureProgramMode setting of manual or aperture priority.',
        code: 0x5007,
        type: DataType.UINT16,
        unit: 'f-stop',
        writable: true,
        encode: (value: number) => {
            return encodePTPValue(value * 100, DataType.UINT16)
        },
        decode: (value: HexCode | Uint8Array) => {
            return decodePTPValue(value as Uint8Array, DataType.UINT16) / 100
        },
    },
} as const satisfies PropertyDefinition<any>

export type PTPPropertyDefinitions = typeof PTPProperties
