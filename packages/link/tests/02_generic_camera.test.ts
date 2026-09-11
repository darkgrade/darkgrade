import { Logger } from '@core/logger'
import { formatRegistry } from '@ptp/definitions/format-definitions'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { responseRegistry } from '@ptp/definitions/response-definitions'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { afterAll, describe, expect, it } from 'vitest'
import { GenericCamera } from '../src/camera/generic-camera'

const operationDefinitions = Object.values(genericOperationRegistry)
const propertyDefinitions = Object.values(genericPropertyRegistry)
const responseDefinitions = Object.values(responseRegistry)
const formatDefinitions = Object.values(formatRegistry)
const hardwareOperationTimeoutMilliseconds = 15_000

describe('GenericCamera', () => {
    let transport: TransportInterface
    let camera: GenericCamera
    let logger: Logger

    afterAll(async () => {
        if (camera && transport && transport.isConnected()) {
            try {
                await Promise.race([
                    camera.disconnect(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Disconnect timeout')), hardwareOperationTimeoutMilliseconds)
                    ),
                ])
            } catch (e) {
                // Ignore disconnect errors
            }
        }
    })

    it(
        'should connect to USB transport and camera',
        async () => {
            logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
            transport = new USBTransport(logger)
            camera = new GenericCamera(transport, logger)

            await camera.connect({ usb: { filters: [{ vendorId: VendorIDs.CANON }] } })
            console.log('✅ Camera connected')

            expect(transport.isConnected()).toBe(true)
            expect(camera.sessionId).toBeTruthy()
        },
        hardwareOperationTimeoutMilliseconds
    )

    it(
        'should disconnect and reconnect',
        async () => {
            await camera.disconnect()
            expect(camera.sessionId).toBeNull()
            console.log('✅ Camera disconnected')

            await camera.connect({ usb: { filters: [{ vendorId: VendorIDs.CANON }] } })
            expect(camera.sessionId).toBeTruthy()
            console.log('✅ Camera reconnected')
        },
        hardwareOperationTimeoutMilliseconds
    )

    it(
        'should handle final disconnection',
        async () => {
            await camera.disconnect()
            expect(camera.sessionId).toBeNull()
            console.log('✅ Camera disconnected')

            expect(transport.isConnected()).toBe(false)
            console.log('✅ Transport disconnected')
        },
        hardwareOperationTimeoutMilliseconds
    )
})
