import { ProtocolInterface } from '@core/protocol'
import { SonyOperations } from '@constants/vendors/sony/operations'
import { PTPResponses } from '@constants/ptp/responses'
import { createDataView } from '@core/buffers'

/**
 * Interface for Sony authentication
 */
export interface SonyAuthenticatorInterface {
    authenticate(protocol: ProtocolInterface): Promise<void>
}

const SDIO_AUTH_PROTOCOL_VERSION = 0x012c
const SDIO_AUTH_DEVICE_PROPERTY_OPTION = 0x01
const SDIO_AUTH_KEY_CODE_1 = 0x00000000
const SDIO_AUTH_KEY_CODE_2 = 0x00000000
export const SDIO_AUTH_PHASES = {
    PHASE_1: 0x01,
    PHASE_2: 0x02,
    PHASE_3: 0x03,
} as const

export type SDIOPhase = (typeof SDIO_AUTH_PHASES)[keyof typeof SDIO_AUTH_PHASES]

/**
 * Sony camera authenticator
 * Handles the Sony-specific authentication handshake
 */
export class SonyAuthenticator implements SonyAuthenticatorInterface {
    private deviceInfo: any = null

    async authenticate(protocol: ProtocolInterface): Promise<void> {
        // Phase 1: Initial handshake
        console.log('Sony Auth: Starting Phase 1 - Initial handshake')
        await this.sdioConnect(protocol, SDIO_AUTH_PHASES.PHASE_1)
        console.log('Sony Auth: Phase 1 complete')

        // Phase 2: Capability exchange
        console.log('Sony Auth: Starting Phase 2 - Capability exchange')
        await this.sdioConnect(protocol, SDIO_AUTH_PHASES.PHASE_2)
        console.log('Sony Auth: Phase 2 complete')

        // Get extended device info
        console.log('Sony Auth: Getting extended device info')
        await this.getExtDeviceInfo(protocol)
        console.log('Sony Auth: Extended device info retrieved')

        // Phase 3: Final authentication
        console.log('Sony Auth: Starting Phase 3 - Final authentication')
        await this.sdioConnect(protocol, SDIO_AUTH_PHASES.PHASE_3)
        console.log('Sony Auth: Phase 3 complete - Authentication successful!')
    }

    private async sdioConnect(protocol: ProtocolInterface, phase: SDIOPhase): Promise<void> {
        console.log(`Sony Auth: Sending SDIO_CONNECT for phase ${phase}`)
        const response = await protocol.sendOperation({
            ...SonyOperations.SDIO_CONNECT,
            parameters: [phase, SDIO_AUTH_KEY_CODE_1, SDIO_AUTH_KEY_CODE_2],
        })
        console.log(`Sony Auth: SDIO_CONNECT response: 0x${response.code.toString(16)}`)

        if (response.code !== PTPResponses.OK.code) {
            throw new Error(`SDIO Connect Phase ${phase} failed: 0x${response.code.toString(16)}`)
        }
    }

    private async getExtDeviceInfo(protocol: ProtocolInterface): Promise<void> {
        const response = await protocol.sendOperation({
            ...SonyOperations.SDIO_GET_EXT_DEVICE_INFO,
            parameters: [SDIO_AUTH_PROTOCOL_VERSION, SDIO_AUTH_DEVICE_PROPERTY_OPTION],
        })

        if (response.code !== PTPResponses.OK.code) {
            throw new Error(`Get extended device info failed: 0x${response.code.toString(16)}`)
        }

        // Parse device info (simplified)
        if (response.data && response.data.length > 0) {
            const view = createDataView(response.data)
            const version = view.getUint16(0, true)

            // Store for later use
            this.deviceInfo = { version, raw: response.data }
        }
    }

    getDeviceInfo(): any {
        return this.deviceInfo
    }
}
