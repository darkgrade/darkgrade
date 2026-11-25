import type { CameraInfo, ConnectionCapability } from '@camera/driver/connection'
import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { cameraContext, type CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import { PTPDecodeError } from '@core/ptp-errors'
import { TransportType } from '@transport/interfaces/transport-types'
import { SonyRemoteSdkTransport } from '@transport/sony-remote/sony-remote-sdk-transport'

const OK = 0x2001

/**
 * Each vendor's connection capability. Every driver opens a PTP session and answers GetDeviceInfo;
 * what differs is what the session prepares. Sony's remote session writes two host preferences
 * (PC Remote position-key priority and the saved image destination) unless observeOnly asks it
 * not to. Canon's remote and event modes and the generic OpenSession change no saved setting, so
 * observeOnly opens them unchanged.
 */
export function connectionCapability(driver: CameraDriverInstance, owner: Camera): ConnectionCapability {
    return {
        async openSession(device, { observeOnly }) {
            if (driver instanceof SonyCamera) return driver.connect(device, { configure: !observeOnly })
            return driver.connect(device)
        },

        async getInfo(): Promise<CameraInfo> {
            const response = await driver.send(driver.registry.operations.GetDeviceInfo, {})
            if (response.code !== OK)
                throw new CameraRefusedError(
                    'getInfo',
                    `The camera refused GetDeviceInfo (0x${response.code.toString(16).padStart(4, '0')})`
                )
            if (!response.data) throw new PTPDecodeError('GetDeviceInfo returned no device dataset')
            const { manufacturer, model, deviceVersion, serialNumber } = response.data
            return {
                manufacturer,
                model,
                firmware: deviceVersion,
                ...(serialNumber && { serialNumber }),
                connection: connectionKind(owner),
            }
        },
    }
}

function connectionKind(owner: Camera): CameraInfo['connection'] {
    const { transport } = cameraContext(owner)
    // Sony's authenticated SDK channel is carried over Wi-Fi IP, but it is not PTP/IP.
    if (transport instanceof SonyRemoteSdkTransport) return 'wifi'
    return transport.getType() === TransportType.USB ? 'usb' : 'ip'
}
