import type { DiscoveredCamera } from '@camera/driver'
import type { Camera, CameraOptions } from '@camera/index'
import { getVendorName } from '@ptp/definitions/vendor-ids'
import { formatUsbDeviceId, parseUsbDeviceId } from '@transport/usb/usb-device-id'
import { vendorEntry, vendorTable } from '@vendors/vendors'

/*
 * Choosing and opening the one attached camera a CLI command works on: USB ids, the chooser, the
 * connection help, the stop signal.
 */

export function parseCameraId(text: string): { vendorId: number; productId: number } {
    const id = parseUsbDeviceId(text)
    if (!id) throw new Error(`"${text}" is not a USB id such as 054c:0e78`)
    return id
}

/** A Camera for one discovered USB device, logging nothing to the terminal. */
export async function cameraForDevice(device: DiscoveredCamera, options: CameraOptions = {}): Promise<Camera> {
    const { Camera } = await import('@camera/index')
    const { vendorId, productId, serialNumber } = device
    return new Camera({
        device: { usb: { filters: [{ vendorId, productId, ...(serialNumber && { serialNumber }) }] } },
        ...options,
    })
}

/** Calls `request` on Ctrl-C or a termination signal; the returned function stops listening. */
export function onProcessStopRequest(request: () => void): () => void {
    process.on('SIGINT', request)
    process.on('SIGTERM', request)
    return () => void process.removeListener('SIGINT', request).removeListener('SIGTERM', request)
}

export const usbId = (device: { vendorId: number; productId: number }) => formatUsbDeviceId(device)

export const describeDevice = (device: DiscoveredCamera) =>
    `${device.model ?? getVendorName(device.vendorId)} (${usbId(device)})`

export const connectionHelp = [
    'Connect the camera with a USB data cable, switch it on and set its USB mode for computer control:',
    '  Sony: USB Connection Mode "PC Remote" (or "Remote Shooting"), not Mass Storage.',
    '  Fujifilm: Connection Setting "USB Tether Shooting Auto" (or PC Shoot), not Card Reader / USB RAW Conv.',
    '  Canon and Nikon: no setting is usually needed; close the vendor utility (EOS Utility, NX Tether).',
    'Then run the command again.',
].join('\n')

/** One device is used; several are narrowed to the sole camera-maker device, otherwise the user picks. */
export function selectBenchmarkCamera(
    devices: readonly DiscoveredCamera[],
    otherModes: readonly DiscoveredCamera[] = [],
    command = 'darkgrade telemetry benchmark'
): { device: DiscoveredCamera } | { message: string } {
    if (devices.length === 1) return { device: devices[0] }
    if (!devices.length) {
        const elsewhere = otherModes.map(device => `  ${describeDevice(device)} is attached but not in PTP mode.`)
        return { message: ['No camera found.', ...elsewhere, connectionHelp].join('\n') }
    }
    const cameras = devices.filter(device => vendorEntry(device.vendorId))
    if (cameras.length === 1) return { device: cameras[0] }
    return {
        message: [
            'Several cameras are attached. Choose one with --camera VID:PID:',
            ...devices.map(device => `  ${command} --camera ${usbId(device)}   # ${describeDevice(device)}`),
        ].join('\n'),
    }
}

/** The requested device, else the one `selectBenchmarkCamera` picks; otherwise its message is reported. */
export async function chooseCameraDevice(
    requested: DiscoveredCamera | undefined,
    discover: () => Promise<DiscoveredCamera[]>,
    command: string,
    report: (message: string) => void
): Promise<DiscoveredCamera | undefined> {
    if (requested) return requested
    const selection = selectBenchmarkCamera(await discover(), [], command)
    if ('device' in selection) return selection.device
    report(selection.message)
    return undefined
}

/** What the one-camera commands open the attached camera with. */
export async function cameraCommandDependencies() {
    const { Camera } = await import('@camera/index')
    return {
        discover: () => Camera.discover(),
        createCamera: (device: DiscoveredCamera) => cameraForDevice(device),
        onStopRequest: onProcessStopRequest,
    }
}

/** Known camera makers attached in another USB class (card reader, MTP). Discovery failures count as none. */
export async function camerasInOtherModes(): Promise<DiscoveredCamera[]> {
    try {
        const { Logger } = await import('@core/logger')
        const { USBTransport } = await import('@transport/usb/usb-transport')
        const transport = new USBTransport(new Logger())
        const devices = await transport.discover({ usb: { filters: vendorTable.map(({ vendorId }) => ({ vendorId })) } })
        return devices.filter(device => device.classCode !== 0x06)
    } catch {
        return []
    }
}
