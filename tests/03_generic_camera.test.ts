import { describe, it, expect } from 'vitest'
import { PTPProtocol } from '@core/ptp/ptp-protocol'
import { PTPMessageBuilder } from '@core/ptp/ptp-message-builder'
import { GenericPTPCamera } from '@camera/generic/generic-ptp-camera'
import { TransportFactory } from '@transport/transport-factory'
import { TransportInterface } from '@transport/interfaces/transport.interface'

describe('GenericPTPCamera', () => {
    let transport: TransportInterface
    let protocol: PTPProtocol
    let camera: GenericPTPCamera

    it('should connect to USB transport', async () => {
        // Create transport using factory
        const transportFactory = new TransportFactory()
        transport = await transportFactory.createUSBTransport()

        // Connect to first available PTP device (0,0 means find any PTP device)
        await transport.connect({
            vendorId: 0,
            productId: 0,
        })
        console.log('✅ USB transport connected')

        // Create protocol and message builder
        const messageBuilder = new PTPMessageBuilder()
        protocol = new PTPProtocol(transport, messageBuilder)

        // Create generic camera
        camera = new GenericPTPCamera(protocol)

        expect(transport.isConnected()).toBe(true)
    })

    it('should open and close a PTP session', async () => {
        // Test connection (opens PTP session)
        await camera.connect()
        expect(camera.isConnected()).toBe(true)
        console.log('✅ PTP session opened')

        // Test disconnection (closes PTP session)
        await camera.disconnect()
        expect(camera.isConnected()).toBe(false)
        console.log('✅ PTP session closed')
    })

    it('should handle reconnection after disconnection', async () => {
        // Test that we can reconnect after disconnection
        await camera.connect()
        expect(camera.isConnected()).toBe(true)
        console.log('✅ Reconnected successfully')

        // Clean up
        await camera.disconnect()
        await transport.disconnect()
        console.log('✅ Cleaned up')
    })
})
