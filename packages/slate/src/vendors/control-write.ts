import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import { PTPResponseError } from '@core/ptp-errors'
import { OK } from '@ptp/definitions/response-definitions'
import { isTypedFailure, messageOf, withCause, type TypedFailure } from '@vendors/generic/typed-failure'

/**
 * The transactions that carry a requested setting change: property writes in each vendor's
 * operation, Sony's stepped control and Canon's movie select switch. Reads, DeviceReady polls and
 * live-view or camera-mode housekeeping are not listed.
 */
const writeOperations = new Set([
    'SetDevicePropValue',
    'SetDevicePropValueEx',
    'CanonSetPropValue',
    'SDIO_SetExtDevicePropValue',
    'SDIO_ControlDevice',
    'CanonMovieSelectSwitchOn',
    'CanonMovieSelectSwitchOff',
])

/** The same failure, named for the setting the caller asked for rather than the driver property. */
function forSetting(error: TypedFailure, id: string): TypedFailure {
    if (error.operation === id) return error
    const Kind =
        error instanceof CameraOutcomeUnknownError
            ? CameraOutcomeUnknownError
            : error instanceof CameraRefusedError
              ? CameraRefusedError
              : CameraUnsupportedError
    return withCause(new Kind(id, error.message), error)
}

/**
 * Runs one setting write and names its failure by what the camera answered:
 * - nothing acknowledged and the camera answered with a PTP refusal: CameraRefusedError, nothing changed;
 * - a write acknowledged before a later step failed (DeviceReady, a readback, a restoration):
 *   CameraOutcomeUnknownError, because the change may have taken effect and must not be repeated.
 * Errors already typed by the driver keep their type, named for this setting.
 */
export async function sendControlWrite(driver: GenericCamera, id: string, write: () => Promise<void>): Promise<void> {
    let acknowledged = false
    try {
        await driver.observeResponses((operationName, responseCode) => {
            if (responseCode === OK.code && writeOperations.has(operationName)) acknowledged = true
        }, write)
    } catch (error) {
        if (isTypedFailure(error)) throw forSetting(error, id)
        const message = messageOf(error)
        if (acknowledged)
            throw withCause(
                new CameraOutcomeUnknownError(
                    id,
                    `The camera acknowledged ${id} but a later step failed (${message}). Read the camera again before retrying.`
                ),
                error
            )
        if (error instanceof PTPResponseError)
            throw withCause(new CameraRefusedError(id, `The camera refused ${id}: ${message}`), error)
        throw error
    }
}
