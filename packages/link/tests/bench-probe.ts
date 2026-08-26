import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import { GetDeviceInfo, OpenSession } from '@ptp/definitions/operation-definitions'
import { OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { USBTransport } from '@transport/usb/usb-transport'

type ProbeOutput = {
    responsive: boolean
    detail: string
    device?: {
        manufacturer?: string
        model?: string
        serialNumber?: string
        vendorId: number
        productId: number
    }
}

function cameraIdentifier(): string {
    const argumentIndex = process.argv.indexOf('--camera')
    return process.argv[argumentIndex + 1] || process.env.DARKGRADE_CAMERA_MATCH || ''
}

function parseIdentifier(identifier: string): { vendorId: number; productId: number } {
    const match = identifier.match(/^([0-9a-f]{4}):([0-9a-f]{4})$/i)
    if (!match?.[1] || !match[2]) throw new Error(`Expected --camera VID:PID, received ${identifier || '(empty)'}`)
    return { vendorId: Number.parseInt(match[1], 16), productId: Number.parseInt(match[2], 16) }
}

function writeResult(result: ProbeOutput): void {
    process.stdout.write(`${JSON.stringify(result)}\n`)
}

const identifier = parseIdentifier(cameraIdentifier())
const logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
const transport = new USBTransport(logger)
const camera = new GenericCamera(transport, logger)
const watchdog = setTimeout(() => {
    writeResult({ responsive: false, detail: 'Darkgrade PTP probe timed out before GetDeviceInfo completed' })
    process.exit(124)
}, 12_000)

let result: ProbeOutput
try {
    await transport.connect({ usb: { filters: [{ ...identifier, classCode: 0x06, subclassCode: 0x01 }] } })
    camera.sessionId = 1
    let openSession = await camera.send(OpenSession, { SessionID: 1 })
    if (openSession.code === SessionAlreadyOpen.code) {
        await camera.send(camera.registry.operations.CloseSession, {})
        camera.sessionId = 1
        openSession = await camera.send(OpenSession, { SessionID: 1 })
    }
    if (openSession.code !== OK.code) throw new Error(`OpenSession returned 0x${openSession.code.toString(16)}`)

    const response = await camera.send(GetDeviceInfo, {})
    if (response.code !== OK.code || !response.data) {
        throw new Error(`GetDeviceInfo returned 0x${response.code.toString(16)} without a device dataset`)
    }
    result = {
        responsive: true,
        detail: `PTP GetDeviceInfo completed for ${response.data.manufacturer} ${response.data.model}`,
        device: {
            manufacturer: response.data.manufacturer,
            model: response.data.model,
            serialNumber: response.data.serialNumber,
            ...identifier,
        },
    }
} catch (error) {
    result = { responsive: false, detail: error instanceof Error ? error.message : String(error) }
} finally {
    clearTimeout(watchdog)
    if (transport.isConnected()) {
        await Promise.race([
            camera.disconnect().catch(() => transport.disconnect()),
            new Promise<void>(resolve => setTimeout(resolve, 2_000)),
        ])
    }
}

writeResult(result)
process.exitCode = result.responsive ? 0 : 1
