// Software-only recovery for a USB camera that stopped answering, as one bounded process.
// usage: bun run scripts/recover-camera.ts --camera VID:PID [--serial SERIAL] [--wait-ms 20000] [--no-port-reset]
// Prints one line, RECOVERY {json}, with the CameraRecoveryReport. Exit 0 when the camera answers
// again, 3 when only a physical action (power or hub cycling) can help, 2 on bad arguments.
import { Camera } from '@camera/index'
import { parseUsbDeviceId } from '@transport/usb/usb-device-id'

const argument = (name: string) => {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}
const id = parseUsbDeviceId(argument('--camera') || '')
if (!id) {
    process.stderr.write('Expected --camera VID:PID\n')
    process.exit(2)
}
const { vendorId, productId } = id
const serialNumber = argument('--serial')
const waitForDeviceMilliseconds = Number(argument('--wait-ms') || 20_000)
const camera = new Camera({
    vendorId,
    logger: { expanded: false, captureConsole: false, renderInTerminal: false },
    device: { usb: { filters: [{ vendorId, productId, classCode: 0x06, subclassCode: 0x01, ...(serialNumber && { serialNumber }) }] } },
})
// Bounded by the steps' own timeouts; the watchdog only guards against a native call that never returns.
const watchdog = setTimeout(() => {
    process.stdout.write(`RECOVERY ${JSON.stringify({ recovered: false, needsPhysicalAction: true, steps: [], detail: 'recovery process watchdog expired' })}\n`)
    process.exit(3)
}, waitForDeviceMilliseconds * 2 + 60_000)
const report = await camera.recover({
    waitForDeviceMilliseconds,
    allowPortReset: !process.argv.includes('--no-port-reset'),
})
clearTimeout(watchdog)
process.stdout.write(`RECOVERY ${JSON.stringify(report)}\n`)
process.exit(report.recovered ? 0 : 3)
