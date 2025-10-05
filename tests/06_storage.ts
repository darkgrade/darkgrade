import { SonyCamera } from "@camera/sony-camera";
import { Logger } from "@core/logger";
import { USBTransport } from "@transport/usb/usb-transport";
import { sonyOperationDefinitions } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import { operationDefinitions as standardOperationDefinitions } from '@ptp/definitions/operation-definitions'

const mergedOperationDefinitions = [...standardOperationDefinitions, ...sonyOperationDefinitions] as const

const logger = new Logger<typeof mergedOperationDefinitions>()
const transport = new USBTransport(logger)
const camera = new SonyCamera(transport, logger)

async function main() {
    await camera.connect()

    await camera.disconnect()
}

main().catch(console.error)
