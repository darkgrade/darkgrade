import type { DiscoveredCamera } from '@camera/driver'
import { camerasInOtherModes, connectionHelp, usbId } from '@cli/camera-selection'
import type { Terminal } from '@cli/terminal'
import { getVendorName } from '@ptp/definitions/vendor-ids'

/** 'ready' is attached in PTP mode; 'other-mode' is a camera maker's device in card-reader or MTP mode. */
export interface AttachedCamera extends DiscoveredCamera {
    state: 'ready' | 'other-mode'
}

export interface CameraDiscovery {
    discover(): Promise<DiscoveredCamera[]>
    camerasInOtherModes(): Promise<DiscoveredCamera[]>
}

/** Loads the USB driver on first use; commands that never list cameras never load it. */
export async function defaultCameraDiscovery(): Promise<CameraDiscovery> {
    const { Camera } = await import('@camera/index')
    return { discover: () => Camera.discover(), camerasInOtherModes }
}

/** Enumerates USB only. No session is opened and nothing is read from a camera. */
export async function attachedCameras(discovery: CameraDiscovery): Promise<AttachedCamera[]> {
    const ready = await discovery.discover()
    const known = new Set(ready.map(usbId))
    const elsewhere = (await discovery.camerasInOtherModes()).filter(device => !known.has(usbId(device)))
    return [...ready.map(device => attached(device, 'ready')), ...elsewhere.map(device => attached(device, 'other-mode'))]
}

/** Discovery can return the transport's whole device record; only these fields are reported. */
const attached = (device: DiscoveredCamera, state: AttachedCamera['state']): AttachedCamera => ({
    vendorId: device.vendorId,
    productId: device.productId,
    ...(device.serialNumber && { serialNumber: device.serialNumber }),
    ...(device.model && { model: device.model }),
    state,
})

export const cameraName = (device: DiscoveredCamera) => device.model ?? getVendorName(device.vendorId)

/** `darkgrade cameras`: what is attached, and whether each one can be controlled. */
export async function runCamerasCommand(
    options: { json: boolean },
    terminal: Terminal,
    discovery?: CameraDiscovery
): Promise<number> {
    const progress = terminal.progress()
    if (terminal.animated) progress.update('Looking for cameras…')
    let cameras: AttachedCamera[]
    try {
        cameras = await attachedCameras(discovery ?? (await defaultCameraDiscovery()))
    } finally {
        progress.stop()
    }
    if (options.json) {
        const listed = cameras.map(device => ({ usbId: usbId(device), vendor: getVendorName(device.vendorId), ...device }))
        terminal.print(JSON.stringify({ cameras: listed }))
        return 0
    }
    if (!cameras.length) {
        terminal.report(['No camera found.', connectionHelp].join('\n'))
        return 0
    }
    const nameWidth = Math.max(...cameras.map(device => cameraName(device).length))
    for (const device of cameras) {
        const state = device.state === 'ready' ? terminal.out.green('ready') : terminal.out.yellow('attached, not in PTP mode')
        // Tab-separated when piped, so `cut` and `awk` need no column arithmetic.
        terminal.print(
            terminal.readable
                ? `${terminal.out.bold(cameraName(device).padEnd(nameWidth))}  ${terminal.out.dim(usbId(device))}  ${state}`
                : [cameraName(device), usbId(device), device.state].join('\t')
        )
    }
    if (cameras.some(device => device.state === 'other-mode')) terminal.report('\n' + connectionHelp)
    return 0
}
