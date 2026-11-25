import { hardwareTestsEnabled } from '@tests/setup/hardware'
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { USBTransport } from '@transport/usb/usb-transport'
import { afterAll, describe, expect, it } from 'vitest'
import { GenericCamera } from '@vendors/generic/generic-camera'
import { WebUSB } from 'usb'

const hardwareOperationTimeoutMilliseconds = 15_000
const canon = { usb: { filters: [{ vendorId: VendorIDs.CANON }] } }

const canonConnected =
    hardwareTestsEnabled &&
    (await new WebUSB({ allowAllDevices: true }).getDevices()).some(device => device.vendorId === VendorIDs.CANON)
describe.skipIf(!canonConnected)('GenericCamera', () => {
    let transport: USBTransport | undefined
    let camera: GenericCamera | undefined

    afterAll(async () => {
        if (!camera || !transport?.isConnected()) return
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Disconnect timeout')), hardwareOperationTimeoutMilliseconds)
        )
        await Promise.race([camera.disconnect(), timeout]).catch(() => undefined)
    })

    it(
        'connects, disconnects and reconnects on the same driver, then releases the transport',
        async () => {
            const logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
            transport = new USBTransport(logger)
            camera = new GenericCamera(transport, logger)
            await camera.connect(canon)
            expect(transport.isConnected()).toBe(true)
            expect(camera.sessionId).toBeTruthy()
            await camera.disconnect()
            expect(camera.sessionId).toBeNull()
            await camera.connect(canon)
            expect(camera.sessionId).toBeTruthy()
            await camera.disconnect()
            expect(camera.sessionId).toBeNull()
            expect(transport.isConnected()).toBe(false)
        },
        hardwareOperationTimeoutMilliseconds * 3
    )
})
