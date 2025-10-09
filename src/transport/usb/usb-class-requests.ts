export enum USBClassRequest {
    CANCEL_REQUEST = 0x64,
    GET_EXTENDED_EVENT_DATA = 0x65,
    DEVICE_RESET = 0x66,
    GET_DEVICE_STATUS = 0x67,
}

export enum USBRequestType {
    CLASS_INTERFACE = 0x21,
    CLASS_INTERFACE_IN = 0xa1,
}

export interface DeviceStatus {
    code: number
    parameters: number[]
}

export interface ExtendedEventData {
    eventCode: number
    transactionId: number
    parameters: Array<{ size: number; value: Uint8Array }>
}

export class USBClassRequestHandler {
    constructor(private device: any, private interfaceNumber: number) {}

    async cancelRequest(transactionId: number): Promise<void> {
        const setup = {
            requestType: USBRequestType.CLASS_INTERFACE,
            request: USBClassRequest.CANCEL_REQUEST,
            value: 0,
            index: this.interfaceNumber,
        }

        const data = new Uint8Array(6)
        const view = new DataView(data.buffer)
        view.setUint16(0, 0x4001, true)
        view.setUint32(2, transactionId, true)

        await this.device.controlTransferOut(setup, data)
    }

    async deviceReset(): Promise<void> {
        const setup = {
            requestType: USBRequestType.CLASS_INTERFACE,
            request: USBClassRequest.DEVICE_RESET,
            value: 0,
            index: this.interfaceNumber,
        }

        await this.device.controlTransferOut(setup)
    }

    async getDeviceStatus(): Promise<DeviceStatus> {
        const setup = {
            requestType: USBRequestType.CLASS_INTERFACE_IN,
            request: USBClassRequest.GET_DEVICE_STATUS,
            value: 0,
            index: this.interfaceNumber,
        }

        const result = await this.device.controlTransferIn(setup, 20)

        if (!result || result.status !== 'ok') {
            throw new Error(`Control transfer failed: ${result?.status || 'no result'}`)
        }

        if (!result.data || result.data.byteLength === 0) {
            throw new Error('No data received from device')
        }

        const data = new Uint8Array(result.data.buffer)
        const view = new DataView(data.buffer)

        const length = view.getUint16(0, true)
        const code = view.getUint16(2, true)

        const parameters: number[] = []
        let offset = 4
        while (offset + 4 <= length && offset < data.length) {
            parameters.push(view.getUint32(offset, true))
            offset += 4
        }

        return {
            code,
            parameters,
        }
    }

    async getExtendedEventData(bufferSize: number = 512): Promise<ExtendedEventData> {
        const setup = {
            requestType: USBRequestType.CLASS_INTERFACE_IN,
            request: USBClassRequest.GET_EXTENDED_EVENT_DATA,
            value: 0,
            index: this.interfaceNumber,
        }

        const result = await this.device.controlTransferIn(setup, bufferSize)

        if (!result || result.status !== 'ok') {
            throw new Error('Failed to get extended event data')
        }

        const data = new Uint8Array(result.data.buffer)
        const view = new DataView(data.buffer)

        const eventCode = view.getUint16(0, true)
        const transactionId = view.getUint32(2, true)
        const numParameters = view.getUint16(6, true)

        const parameters: Array<{ size: number; value: Uint8Array }> = []
        let offset = 8

        for (let i = 0; i < numParameters && offset + 2 <= data.length; i++) {
            const paramSize = view.getUint16(offset, true)
            offset += 2

            if (offset + paramSize <= data.length) {
                const paramValue = data.slice(offset, offset + paramSize)
                parameters.push({ size: paramSize, value: paramValue })
                offset += paramSize
            }
        }

        return {
            eventCode,
            transactionId,
            parameters,
        }
    }
}
