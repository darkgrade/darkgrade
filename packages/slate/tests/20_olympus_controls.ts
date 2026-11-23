import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { USBTransport } from '@transport/usb/usb-transport'

function option(name: string): string | undefined {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}

function cameraFilter(): { vendorId: number; productId?: number } {
    const requested = option('--camera')
    if (!requested) return { vendorId: VendorIDs.OLYMPUS }
    const match = requested.match(/^([0-9a-f]{4}):([0-9a-f]{4})$/i)
    if (!match?.[1] || !match[2]) throw new Error(`Expected --camera VID:PID, received ${requested}`)
    return { vendorId: Number.parseInt(match[1], 16), productId: Number.parseInt(match[2], 16) }
}

function jsonValue(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Uint8Array) return [...value]
    if (Array.isArray(value)) return value.map(jsonValue)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, jsonValue(nested)]))
    }
    return value
}

const logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
const transport = new USBTransport(logger)
const camera = new GenericCamera(transport, logger)
const watchdog = setTimeout(() => {
    process.stderr.write('Olympus control probe exceeded 45 seconds\n')
    process.exit(124)
}, 45_000)

try {
    await camera.connect({ usb: { filters: [{ ...cameraFilter(), classCode: 0x06, subclassCode: 0x01 }] } })
    const deviceInfo = await camera.send(camera.registry.operations.GetDeviceInfo, {})
    if (!deviceInfo.data) throw new Error('Olympus GetDeviceInfo returned no dataset')

    const properties = []
    for (const code of deviceInfo.data.devicePropertiesSupported) {
        try {
            const response = await camera.send(camera.registry.operations.GetDevicePropDesc, {
                DevicePropCode: code,
            })
            properties.push(response.data ?? { devicePropertyCode: code, error: 'No property descriptor returned' })
        } catch (error) {
            properties.push({
                devicePropertyCode: code,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    process.stdout.write(
        `${JSON.stringify(
            jsonValue({
                camera: {
                    manufacturer: deviceInfo.data.manufacturer,
                    model: deviceInfo.data.model,
                    version: deviceInfo.data.deviceVersion,
                    serialNumber: deviceInfo.data.serialNumber,
                },
                operations: deviceInfo.data.operationsSupportedDecoded,
                properties,
            }),
            null,
            2
        )}\n`
    )
} finally {
    clearTimeout(watchdog)
    await camera.disconnect().catch(() => transport.disconnect().catch(() => undefined))
}
