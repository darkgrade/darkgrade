import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import { DateTime } from '@ptp/definitions/property-definitions'
import { GetDeviceInfo, GetDevicePropDesc, SetDevicePropValue } from '@ptp/definitions/operation-definitions'
import { OK } from '@ptp/definitions/response-definitions'
import { ptpDateTimeFields, ptpDateTimeString } from '@ptp/datasets/codecs/date-time'

/** How far the clock read back may differ from the time written, beyond the time the write took. */
const CLOCK_TOLERANCE_MILLISECONDS = 2_000

type ClockDriver = Pick<GenericCamera, 'send' | 'registry'>

/** The local wall time a PTP DateTime names, or undefined when it is not one. */
export function parsePtpDateTime(value: unknown): Date | undefined {
    const fields = ptpDateTimeFields(value)
    if (!fields) return undefined
    const [year, month, day, hour, minute, second] = fields.map(Number) as [number, number, number, number, number, number]
    const moment = new Date(year, month - 1, day, hour, minute, second)
    return Number.isNaN(moment.getTime()) ? undefined : moment
}

/** Why the standard clock cannot be set on this body, or undefined when it can be tried. */
export async function standardClockUnavailable(driver: ClockDriver): Promise<string | undefined> {
    const information = await driver.send(GetDeviceInfo, {})
    if (information.code !== OK.code || !information.data) throw refusal('its device information', information.code)
    return information.data.devicePropertiesSupported.includes(DateTime.code)
        ? undefined
        : 'This camera does not offer its clock over USB'
}

const refusal = (action: string, code: number) =>
    new CameraRefusedError('setClock', `The camera refused ${action} (0x${code.toString(16)})`)

/**
 * Sets the standard DateTime property (0x5011) on a body that advertises it as writable, then
 * reads it back. The write is sent once; a readback that does not show the new time is reported as
 * an unknown outcome, never written again.
 */
export async function setStandardClock(driver: ClockDriver, moment: Date): Promise<void> {
    const unavailable = await standardClockUnavailable(driver)
    if (unavailable) throw new CameraUnsupportedError('setClock', unavailable)
    const descriptor = await driver.send(GetDevicePropDesc, { DevicePropCode: DateTime.code })
    if (descriptor.code !== OK.code || !descriptor.data) throw refusal('to describe its clock', descriptor.code)
    if (descriptor.data.getSet !== 'GET_SET')
        throw new CameraUnsupportedError('setClock', 'This camera reports its clock as read-only')
    const startedAt = Date.now()
    const written = await driver.send(SetDevicePropValue, { DevicePropCode: DateTime.code }, driver.registry.codecs.string.encode(ptpDateTimeString(moment)))
    if (written.code !== OK.code) throw refusal('the new date and time', written.code)
    const elapsedMilliseconds = Date.now() - startedAt
    const readback = await driver.send(GetDevicePropDesc, { DevicePropCode: DateTime.code })
    const shown = readback.code === OK.code ? parsePtpDateTime(readback.data?.currentValueDecoded) : undefined
    if (!shown)
        throw new CameraOutcomeUnknownError('setClock', 'The camera accepted the date and time but its clock could not be read back')
    // The camera keeps seconds only; allow for that and for the time the write and read took.
    const differenceMilliseconds = Math.abs(shown.getTime() - moment.getTime())
    if (differenceMilliseconds > CLOCK_TOLERANCE_MILLISECONDS + elapsedMilliseconds + (Date.now() - startedAt))
        throw new CameraOutcomeUnknownError(
            'setClock',
            `The camera accepted the date and time but shows ${String(readback.data?.currentValueDecoded)}`
        )
}
