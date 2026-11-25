import type { CameraInfo, ConnectionCapability } from '@camera/driver/connection'
import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { cameraContext, type CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import { PTPDecodeError } from '@core/ptp-errors'
import { GetDeviceInfo } from '@ptp/definitions/operation-definitions'
import { OK } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { TransportType } from '@transport/interfaces/transport-types'
import { SonyRemoteSdkTransport } from '@transport/sony-remote/sony-remote-sdk-transport'
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

/**
 * Each vendor's connection capability. Every driver opens a PTP session and answers GetDeviceInfo;
 * what differs is what the session prepares. Sony's remote session writes two host preferences
 * (PC Remote position-key priority and the saved image destination) unless observeOnly asks it
 * not to. Canon's remote and event modes and the generic OpenSession change no saved setting, so
 * observeOnly opens them unchanged. Make, model and firmware are read once per session.
 */
export function connectionCapability(driver: CameraDriverInstance, owner: Camera): ConnectionCapability {
    let cached: { sessionId: number | null; info: CameraInfo } | undefined
    return {
        async openSession(device, { observeOnly }) {
            if (driver instanceof SonyCamera) return driver.connect(device, { configure: !observeOnly })
            return driver.connect(device)
        },

        getInfo: () =>
            reportingRefusals('getInfo', async () => {
                if (cached && cached.sessionId === driver.sessionId) return { ...cached.info }
                const response = await driver.send(GetDeviceInfo, {})
                if (response.code !== OK.code)
                    throw new CameraRefusedError(
                        'getInfo',
                        `The camera refused GetDeviceInfo (0x${response.code.toString(16).padStart(4, '0')})`
                    )
                if (!response.data) throw new PTPDecodeError('GetDeviceInfo returned no device dataset')
                const { manufacturer, model, deviceVersion, serialNumber } = response.data
                const lensMount = lensMountForModel(driver.vendorId, model)
                const info: CameraInfo = {
                    manufacturer: (driver.vendorId !== null && MAKES[driver.vendorId]) || manufacturer.trim(),
                    model: model.trim(),
                    firmware: deviceVersion.trim(),
                    ...(serialNumber && { serialNumber }),
                    ...(lensMount && { lensMount }),
                    connection: connectionKind(owner),
                }
                cached = { sessionId: driver.sessionId, info }
                return { ...info }
            }),
    }
}

function connectionKind(owner: Camera): CameraInfo['connection'] {
    const { transport } = cameraContext(owner)
    // Sony's authenticated SDK channel is carried over Wi-Fi IP, but it is not PTP/IP.
    if (transport instanceof SonyRemoteSdkTransport) return 'wifi'
    return transport.getType() === TransportType.USB ? 'usb' : 'ip'
}
