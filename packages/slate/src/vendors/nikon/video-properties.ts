import {enumProperty,scalarProperty} from '@vendors/nikon/definitions/nikon-shooting-property-definitions'

/** Z6 III command specification 2.00, sections 6.5.4.51 and 6.5.12.3.
 * Query the camera descriptor for current writability and supported angles.
 */
export const MovieShutterMode = enumProperty('MovieShutterMode', 0x0001d074, 'uint8', 'Video shutter control mode', [
    {value: 1, name: 'SHUTTER_SPEED', description: 'Shutter speed'},
    {value: 2, name: 'SHUTTER_ANGLE', description: 'Shutter angle'},
])

export const MovieShutterAngle = scalarProperty(
    'MovieShutterAngle', 0x0001d075, 'int32', 'Video shutter angle in hundredths of a degree (18000 = 180°)'
)

/** Z6 III command specification 2.00, section 6.5.14.1. */
export const ExternalDCIn = enumProperty('ExternalDCIn', 0xd101, 'uint8', 'AC adapter connection reported by the camera', [
    {value: 0, name: 'NOT_CONNECTED', description: 'External DC not connected'},
    {value: 1, name: 'CONNECTED', description: 'External DC connected'},
], 'Get')

export const nikonVideoPropertyRegistry = {MovieShutterMode, MovieShutterAngle, ExternalDCIn} as const
