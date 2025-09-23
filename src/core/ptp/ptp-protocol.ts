/**
 * PTP Protocol Implementation
 * Handles PTP protocol operations with injected transport
 */

import { ProtocolInterface, Operation, Response, Event } from '@core/interfaces/protocol.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { MessageBuilderInterface } from '@core/interfaces/message-builder.interface'
import { PTPOperations, PTPResponses, PTPError } from '@constants/ptp'
import { SonyOperations } from '@constants/vendors/sony'

export class PTPProtocol implements ProtocolInterface {
    private sessionId: number | null = null
    private isOpen = false

    constructor(
        private readonly transport: TransportInterface,
        private readonly messageBuilder: MessageBuilderInterface
    ) {}

    /**
     * Open a new PTP session
     */
    async openSession(sessionId: number): Promise<void> {
        console.log(`PTP Protocol: Opening session with ID ${sessionId}`)
        if (this.isOpen) {
            console.log('PTP Protocol: Session already marked as open locally')
            return // Don't throw, just return
        }

        // Build and send OpenSession command
        const command = this.messageBuilder.buildCommand(PTPOperations.OPEN_SESSION.code, [sessionId])
        console.log(`PTP Protocol: Sending OpenSession command...`)

        await this.transport.send(command)
        console.log(`PTP Protocol: OpenSession command sent, waiting for response...`)

        // Receive response
        const responseData = await this.transport.receive(512)
        const response = this.messageBuilder.parseResponse(responseData)
        console.log(`PTP Protocol: OpenSession response received: 0x${response.code.toString(16)}`)

        // Check response code
        if (response.code === PTPResponses.SESSION_ALREADY_OPEN.code) {
            console.log('PTP Protocol: Camera says session already open, continuing...')
            this.sessionId = sessionId
            this.isOpen = true
            return
        }

        if (response.code !== PTPResponses.OK.code) {
            throw new PTPError(
                response.code,
                `Failed to open session: 0x${response.code.toString(16).padStart(4, '0')}`,
                'OpenSession'
            )
        }

        this.sessionId = sessionId
        this.isOpen = true
    }

    /**
     * Close the current PTP session
     */
    async closeSession(): Promise<void> {
        if (!this.isOpen) {
            return // Already closed
        }

        try {
            // Build and send CloseSession command
            const command = this.messageBuilder.buildCommand(PTPOperations.CLOSE_SESSION.code)

            await this.transport.send(command)

            // Receive response
            const responseData = await this.transport.receive(512)
            const response = this.messageBuilder.parseResponse(responseData)

            // Check response code (be lenient on close)
            if (response.code !== PTPResponses.OK.code && response.code !== PTPResponses.SESSION_NOT_OPEN.code) {
                console.warn(`CloseSession returned: 0x${response.code.toString(16).padStart(4, '0')}`)
            }
        } finally {
            this.sessionId = null
            this.isOpen = false
        }
    }

    /**
     * Send a PTP operation
     */
    async sendOperation(operation: Operation): Promise<Response> {
        if (!this.isOpen && operation.code !== PTPOperations.GET_DEVICE_INFO.code) {
            throw new PTPError(PTPResponses.SESSION_NOT_OPEN.code, 'Session not open', 'SendOperation')
        }

        const transactionId = this.messageBuilder.getNextTransactionId()

        // Determine if this operation expects data if not explicitly set
        const hasDataPhase =
            operation.hasDataPhase !== undefined
                ? operation.hasDataPhase
                : PTPProtocol.expectsDataIn(operation.code) || operation.data !== undefined

        // Send command phase
        const command = this.messageBuilder.buildCommand(operation.code, operation.parameters || [])
        await this.transport.send(command)

        // Handle data phase if present
        let receivedData: Uint8Array | undefined

        if (hasDataPhase && operation.data) {
            // Send data (data-out operation)
            const dataMessage = this.messageBuilder.buildData(operation.code, operation.data)
            await this.transport.send(dataMessage)
        } else if (hasDataPhase) {
            // Receive data (data-in operation)
            // Use maxDataLength if specified, otherwise use a reasonable default
            const maxLength = operation.maxDataLength || 65536 // Default to 64KB
            const dataResponse = await this.transport.receive(maxLength)
            const parsedData = this.messageBuilder.parseData(dataResponse)
            receivedData = parsedData.payload
        }

        // Receive response phase
        const responseData = await this.transport.receive(512)
        const parsedResponse = this.messageBuilder.parseResponse(responseData)

        // Build response object
        const response: Response = {
            code: parsedResponse.code,
            sessionId: this.sessionId || 0,
            transactionId,
            parameters: parsedResponse.parameters,
            data: receivedData,
        }

        return response
    }

    /**
     * Receive a PTP event
     */
    async receiveEvent(): Promise<Event> {
        // Events would typically come from an interrupt endpoint
        // For now, this is a placeholder implementation
        // Real implementation would need to handle async event polling
        const eventData = await this.transport.receive(512)
        const parsedEvent = this.messageBuilder.parseEvent(eventData)

        return {
            code: parsedEvent.code,
            sessionId: this.sessionId || 0,
            transactionId: parsedEvent.transactionId,
            parameters: parsedEvent.parameters,
        }
    }

    /**
     * Get current session ID
     */
    getSessionId(): number | null {
        return this.sessionId
    }

    /**
     * Check if session is open
     */
    isSessionOpen(): boolean {
        return this.isOpen
    }

    /**
     * Reset the protocol state
     */
    async reset(): Promise<void> {
        if (this.isOpen) {
            await this.closeSession()
        }
        this.messageBuilder.resetTransactionId()
        this.sessionId = null
        this.isOpen = false
    }

    /**
     * Get device info (doesn't require open session)
     */
    async getDeviceInfo(): Promise<Response> {
        return this.sendOperation({
            code: PTPOperations.GET_DEVICE_INFO.code,
            hasDataPhase: true,
        })
    }

    /**
     * Helper to send simple commands without data phase
     */
    async sendCommand(code: number, parameters?: number[]): Promise<Response> {
        return this.sendOperation({
            code,
            parameters,
            hasDataPhase: false,
        })
    }

    /**
     * Helper to send commands that receive data
     */
    async sendCommandReceiveData(code: number, parameters?: number[]): Promise<Response> {
        return this.sendOperation({
            code,
            parameters,
            hasDataPhase: true,
        })
    }

    /**
     * Helper to send commands that send data
     */
    async sendCommandWithData(code: number, parameters: number[], data: Uint8Array): Promise<Response> {
        return this.sendOperation({
            code,
            parameters,
            data,
            hasDataPhase: true,
        })
    }

    /**
     * Check if an operation expects to receive data
     */
    static expectsDataIn(operationCode: number): boolean {
        // Operations that receive data from device
        const dataInOps: number[] = [
            PTPOperations.GET_DEVICE_INFO.code,
            PTPOperations.GET_STORAGE_IDS.code,
            PTPOperations.GET_STORAGE_INFO.code,
            PTPOperations.GET_NUM_OBJECTS.code,
            PTPOperations.GET_OBJECT_HANDLES.code,
            PTPOperations.GET_OBJECT_INFO.code,
            PTPOperations.GET_OBJECT.code,
            PTPOperations.GET_DEVICE_PROP_DESC.code,
            PTPOperations.GET_DEVICE_PROP_VALUE.code,
            SonyOperations.SDIO_GET_EXT_DEVICE_INFO.code,
            SonyOperations.GET_ALL_EXT_DEVICE_PROP_INFO.code,
            SonyOperations.SDIO_GET_OSD_IMAGE.code,
        ]
        return dataInOps.includes(operationCode)
    }
}
