import { ProtocolInterface } from '@core/protocol'
import { SonyOperations } from '@constants/vendors/sony/operations'
import { SonyConstants } from '@constants/vendors/sony/properties'
import { PTPResponses } from '@constants/ptp/responses'
import { createDataView } from '@core/buffers'

/**
 * Interface for Sony authentication
 */
export interface SonyAuthenticatorInterface {
    authenticate(protocol: ProtocolInterface): Promise<void>
}

/**
 * SDIO Authentication Phases
 */
export const SDIOPhases = {
  INITIAL_HANDSHAKE: 1,
  CAPABILITY_EXCHANGE: 2,
  FINAL_AUTHENTICATION: 3,
} as const

export type SDIOPhase = typeof SDIOPhases[keyof typeof SDIOPhases]

/**
 * Sony camera authenticator
 * Handles the Sony-specific authentication handshake
 */
export class SonyAuthenticator implements SonyAuthenticatorInterface {
    private deviceInfo: any = null

    async authenticate(protocol: ProtocolInterface): Promise<void> {
        // Phase 1: Initial handshake
        console.log('Sony Auth: Starting Phase 1 - Initial handshake')
        await this.sdioConnect(protocol, SDIOPhases.INITIAL_HANDSHAKE)
        console.log('Sony Auth: Phase 1 complete')

        // Phase 2: Capability exchange
        console.log('Sony Auth: Starting Phase 2 - Capability exchange')
        await this.sdioConnect(protocol, SDIOPhases.CAPABILITY_EXCHANGE)
        console.log('Sony Auth: Phase 2 complete')

        // Get extended device info
        console.log('Sony Auth: Getting extended device info')
        await this.getExtDeviceInfo(protocol)
        console.log('Sony Auth: Extended device info retrieved')

        // Phase 3: Final authentication
        console.log('Sony Auth: Starting Phase 3 - Final authentication')
        await this.sdioConnect(protocol, SDIOPhases.FINAL_AUTHENTICATION)
        console.log('Sony Auth: Phase 3 complete - Authentication successful!')
    }

    private async sdioConnect(protocol: ProtocolInterface, phase: SDIOPhase): Promise<void> {
        console.log(`Sony Auth: Sending SDIO_CONNECT for phase ${phase}`)
        const response = await protocol.sendOperation({
            code: SonyOperations.SDIO_CONNECT.code,
            parameters: [phase, 0, 0], // Phase, KeyCode1, KeyCode2
            hasDataPhase: true, // Expect data in response
        })
        console.log(`Sony Auth: SDIO_CONNECT response: 0x${response.code.toString(16)}`)

        if (response.code !== PTPResponses.OK.code) {
            throw new Error(`SDIO Connect Phase ${phase} failed: 0x${response.code.toString(16)}`)
        }
    }

    private async getExtDeviceInfo(protocol: ProtocolInterface): Promise<void> {
        const response = await protocol.sendOperation({
            code: SonyOperations.SDIO_GET_EXT_DEVICE_INFO.code,
            parameters: [SonyConstants.PROTOCOL_VERSION, SonyConstants.DEVICE_PROPERTY_OPTION],
            hasDataPhase: true, // Expect device info data
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
