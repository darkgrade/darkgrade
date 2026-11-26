export enum USBContainerType {
    COMMAND = 1,
    DATA = 2,
    RESPONSE = 3,
    EVENT = 4,
}

export interface USBContainer {
    length: number
    type: USBContainerType
    code: number
    transactionId: number
    payload: Uint8Array
}

export class USBContainerBuilder {
    /** A complete little-endian USB still-image container: 12-byte header followed by the payload parts. */
    static build(type: USBContainerType, code: number, transactionId: number, ...payload: Uint8Array[]): Uint8Array {
        const buffer = new Uint8Array(12 + payload.reduce((sum, part) => sum + part.length, 0))
        const view = new DataView(buffer.buffer)
        view.setUint32(0, buffer.length, true)
        view.setUint16(4, type, true)
        view.setUint16(6, code, true)
        view.setUint32(8, transactionId, true)
        let offset = 12
        for (const part of payload) {
            buffer.set(part, offset)
            offset += part.length
        }
        return buffer
    }

    static buildCommand(operationCode: number, transactionId: number, parameters: Uint8Array[]): Uint8Array {
        return this.build(USBContainerType.COMMAND, operationCode, transactionId, ...parameters)
    }

    static buildData(operationCode: number, transactionId: number, data: Uint8Array): Uint8Array {
        return this.build(USBContainerType.DATA, operationCode, transactionId, data)
    }

    static parseContainer(data: Uint8Array, expectedType?: USBContainerType): USBContainer {
        if (data.length < 12) throw new Error(`Invalid container: too short (${data.length} bytes)`)
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const type = view.getUint16(4, true)
        if (expectedType !== undefined && type !== expectedType) {
            const typeName = ['undefined', 'command', 'data', 'response', 'event'][expectedType] || 'unknown'
            throw new Error(`Expected ${typeName} container, got type ${type}`)
        }
        return {
            length: view.getUint32(0, true),
            type,
            code: view.getUint16(6, true),
            transactionId: view.getUint32(8, true),
            payload: data.slice(12),
        }
    }

    static parseEvent(data: Uint8Array): USBContainer {
        return this.parseContainer(data, USBContainerType.EVENT)
    }
}
