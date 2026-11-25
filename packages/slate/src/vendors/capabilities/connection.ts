import type { CameraInfo, ConnectionCapability } from '@camera/driver/connection'
import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'
import { GetDeviceInfo } from '@ptp/definitions/operation-definitions'
import { OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { TransportType } from '@transport/interfaces/transport-types'
import { reportingRefusals } from '@vendors/media/ptp-object-index'

/** The make people use for each USB vendor; another vendor keeps the name its DeviceInfo gives. */
const MAKES: Record<number, string> = {
    [VendorIDs.SONY]: 'Sony',
    [VendorIDs.CANON]: 'Canon',
    [VendorIDs.NIKON]: 'Nikon',
    [VendorIDs.FUJIFILM]: 'Fujifilm',
    [VendorIDs.PANASONIC]: 'Panasonic',
    [VendorIDs.OLYMPUS]: 'Olympus',
    [VendorIDs.OM_DIGITAL]: 'OM System',
    [VendorIDs.LEICA]: 'Leica',
    [VendorIDs.SIGMA]: 'Sigma',
}

/**
 * The lens mount for model families whose mount follows from the name: Sony ILCE/ILME bodies are
 * E-mount and ILCA bodies A-mount, Nikon Z bodies Z-mount and Nikon D bodies F-mount, Canon EOS R
 * bodies RF-mount. Any other model reports no mount rather than a guess.
 */
export function lensMountForModel(vendorId: number | null, model: string): string | undefined {
    const name = model.trim()
    if (vendorId === VendorIDs.SONY) {
        if (/^IL(CE|ME)-/i.test(name)) return 'E'
        if (/^ILCA-/i.test(name)) return 'A'
    }
    if (vendorId === VendorIDs.NIKON) {
        if (/^Z\s?[0-9fc]/i.test(name)) return 'Z'
        if (/^D\d/i.test(name)) return 'F'
    }
    if (vendorId === VendorIDs.CANON && /\bEOS R(\d|P\b|\b)/i.test(name)) return 'RF'
    return undefined
}

/** Make, model and firmware from standard DeviceInfo, read once per session. */
export function connectionCapability(driver: CameraDriverInstance, _owner: Camera): ConnectionCapability {
    let cached: { sessionId: number | null; info: CameraInfo } | undefined
    return {
        getInfo: () =>
            reportingRefusals('getInfo', async () => {
                if (cached && cached.sessionId === driver.sessionId) return { ...cached.info }
                const response = await driver.send(GetDeviceInfo, {})
                if (response.code !== OK.code || !response.data)
                    throw new CameraRefusedError('getInfo', `The camera refused its device information (0x${response.code.toString(16)})`)
                const { manufacturer, model, deviceVersion } = response.data
                const lensMount = lensMountForModel(driver.vendorId, model)
                const info: CameraInfo = {
                    manufacturer: (driver.vendorId !== null && MAKES[driver.vendorId]) || manufacturer.trim(),
                    model: model.trim(),
                    firmware: deviceVersion.trim(),
                    ...(lensMount && { lensMount }),
                    connection: driver.transport.getType() === TransportType.USB ? 'usb' : 'ip',
                }
                cached = { sessionId: driver.sessionId, info }
                return { ...info }
            }),
    }
}
