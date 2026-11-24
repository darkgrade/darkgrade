import {getDatatypeByName} from '@ptp/definitions/datatype-definitions'
import {EnumCodec} from '@ptp/types/codec'
import type {PropertyDefinition} from '@ptp/types/property'

/** Z6 III command specification 2.00, sections 6.5.4.51 and 6.5.12.3.
 * Query the camera descriptor for current writability and supported angles.
 */
export const MovieShutterMode = {
    code: 0x0001d074,
    name: 'MovieShutterMode',
    description: 'Video shutter control mode',
    datatype: getDatatypeByName('UINT8')!.code,
    access: 'GetSet',
    codec: registry => new EnumCodec(registry, [
        {value: 1, name: 'SHUTTER_SPEED', description: 'Shutter speed'},
        {value: 2, name: 'SHUTTER_ANGLE', description: 'Shutter angle'},
    ] as const, registry.codecs.uint8),
} as const satisfies PropertyDefinition

export const MovieShutterAngle = {
    code: 0x0001d075,
    name: 'MovieShutterAngle',
    description: 'Video shutter angle in hundredths of a degree (18000 = 180°)',
    datatype: getDatatypeByName('INT32')!.code,
    access: 'GetSet',
    codec: registry => registry.codecs.int32,
} as const satisfies PropertyDefinition

/** Z6 III command specification 2.00, section 6.5.14.1. */
export const ExternalDCIn = {
    code: 0xd101,
    name: 'ExternalDCIn',
    description: 'AC adapter connection reported by the camera',
    datatype: getDatatypeByName('UINT8')!.code,
    access: 'Get',
    codec: registry => new EnumCodec(registry, [
        {value: 0, name: 'NOT_CONNECTED', description: 'External DC not connected'},
        {value: 1, name: 'CONNECTED', description: 'External DC connected'},
    ] as const, registry.codecs.uint8),
} as const satisfies PropertyDefinition

export const nikonVideoPropertyRegistry = {MovieShutterMode, MovieShutterAngle, ExternalDCIn} as const
