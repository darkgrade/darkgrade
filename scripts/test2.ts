#!/usr/bin/env bun

import { PTPOperations } from '@constants/ptp/operations'
import { SonyOperations } from '@constants/vendors/sony/operations'
import { USBTransport } from '@transport/usb/usb-transport'
import { PTPProtocol } from '@core/protocol'
import { PTPMessageBuilder } from '@core/messages'
import { SonyAuthenticator } from '@camera/vendors/sony/authenticator'
import { SonyCamera } from '@camera/vendors/sony/camera'
import { DeviceDescriptor } from 'src/exports'
import { Logger } from '@core/logger'

// Initialize transport and protocol
const deviceFinder = new (await import('@transport/usb/usb-device-finder')).USBDeviceFinder()
const endpointManager = new (await import('@transport/usb/usb-endpoint-manager')).USBEndpointManager()

const logger = new Logger()
const transport = new USBTransport(deviceFinder, endpointManager, logger)
const messageBuilder = new PTPMessageBuilder()
const protocol = new PTPProtocol(transport, messageBuilder, logger)
const authenticator = new SonyAuthenticator()

const cameras = await deviceFinder.findDevices({ class: 6 })
await transport.connect(cameras[0].device as DeviceDescriptor)
const camera = new SonyCamera(protocol, authenticator)

console.log('Open session')





    // async connect(): Promise<void> {
    //     // Call parent connect to open session first
    //     // Sony requires us to open a session in a special way in order to support control and transfer
    //     // await super.connect()

    //     // 0x00000001 is the session id
    //     // 0x00000000 is the function mode for Remote Control Mode
    //     // 0x00000001 is the function mode for Content Transfer Mode
    //     // 0x00000002 is the function mode for Remote Control with Transfer Mode

    //     // Try Remote Control Mode (0) for storage access
    //     // This might be required for standard PTP operations like GET_STORAGE_IDS
    //     await this.protocol.sendOperation({
    //         ...SonyOperations.SDIO_OPEN_SESSION,
    //         parameters: [1, 2],
    //     })
    //     this.protocol.setSessionOpen(true)

    //     // Perform authentication after session is open
    //     await this.authenticator.authenticate(this.protocol)

    //     // Set the host as the priority for settings
    //     const response = await this.protocol.sendOperation({
    //         ...SonyOperations.SDIO_SET_EXT_DEVICE_PROP_VALUE,
    //         parameters: [SonyProperties.POSITION_KEY_SETTING.code],
    //         data: encodePTPValue(
    //             SonyProperties.POSITION_KEY_SETTING.enum.HOST_PRIORITY,
    //             SonyProperties.POSITION_KEY_SETTING.type
    //         ),
    //     })

    //     if (response.code !== PTPResponses.OK.code) {
    //         console.warn('Failed to set Sony control mode, some features may not work')
    //     }

    //     await this.setDeviceProperty('STILL_IMAGE_SAVE_DESTINATION', 'CAMERA_DEVICE')

    //     return
    // }














// 0x00000000 Remote Control Mode
// 0x00000001 Content Transfer Mode
// 0x00000002 Remote Control with Transfer Mode
await protocol?.sendOperation({
    ...SonyOperations.SDIO_OPEN_SESSION,
    parameters: [
        1, // Session ID
        0x00000001, // Function Mode
    ],
})
protocol?.setSessionOpen(true)

await new Promise(resolve => setTimeout(resolve, 2000))

// SDIO_ContentTransferMode
const setContentTransferMode = await protocol?.sendOperation({
    code: SonyOperations.SDIO_SET_CONTENTS_TRANSFER_MODE.code,
    parameters: [
        // Contents Select Type
        // The Initiator should send this command with one of the following values:
        // 0x00000000: Invalid
        // 0x00000001: Select on the camera
        // 0x00000002: Select on the device
        0x00000001,
        // Transfer Mode
        // The Initiator should send this command with one of the following values:
        // 0x00000000: Off
        // 0x00000001: On
        0x00000001,
        // Additional Info
        // The Initiator should send this command with one of the following values:
        // 0x00000000: None
        // 0x00000001: Executed Cancel
        0x00000000,
    ],
    // there is no data phase
})

await new Promise(resolve => setTimeout(resolve, 2000))

const getContentTransferMode = await camera.getDeviceProperty('CONTENT_TRANSFER_ENABLE')
console.log('CONTENT_TRANSFER_ENABLE', getContentTransferMode)

const storageIdsResponse = await protocol?.sendOperation({
    ...PTPOperations.GET_STORAGE_IDS,
    respondsWithData: true,
})

camera.disconnect()

process.exit(0)
