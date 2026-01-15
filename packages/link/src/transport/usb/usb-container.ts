export enum USBContainerType {
    COMMAND = 1,
    DATA = 2,
    RESPONSE = 3,
    EVENT = 4,
}

export function toBuffer(data: Uint8Array): Buffer {
    return Buffer.from(data)
}

export function toUint8Array(data: Buffer | ArrayBuffer | ArrayLike<number>): Uint8Array {
    if (data instanceof Uint8Array) {
        return data
    }
    return new Uint8Array(data)
}

export interface USBContainer {
    length: number
    type: USBContainerType
    code: number
    transactionId: number
    payload: Uint8Array
}

export class USBContainerBuilder {
    static buildCommand(operationCode: number, transactionId: number, parameters: Uint8Array[]): Uint8Array {
        const payloadSize = parameters.reduce((sum, param) => sum + param.length, 0)
        const containerSize = 12 + payloadSize
        const buffer = new Uint8Array(containerSize)
        const view = new DataView(buffer.buffer)

        view.setUint32(0, containerSize, true)
        view.setUint16(4, USBContainerType.COMMAND, true)
        view.setUint16(6, operationCode, true)
        view.setUint32(8, transactionId, true)

        let offset = 12
        for (const param of parameters) {
            buffer.set(param, offset)
            offset += param.length
        }

        return buffer
    }

    static buildData(operationCode: number, transactionId: number, data: Uint8Array): Uint8Array {
        const containerSize = 12 + data.length
        const buffer = new Uint8Array(containerSize)
        const view = new DataView(buffer.buffer)

        view.setUint32(0, containerSize, true)
        view.setUint16(4, USBContainerType.DATA, true)
        view.setUint16(6, operationCode, true)
        view.setUint32(8, transactionId, true)

        buffer.set(data, 12)

        return buffer
    }

    static parseContainer(data: Uint8Array, expectedType?: USBContainerType): USBContainer {
        if (data.length < 12) {
            throw new Error(`Invalid container: too short (${data.length} bytes)`)
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

        const length = view.getUint32(0, true)
        const type = view.getUint16(4, true)
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)

        if (expectedType !== undefined && type !== expectedType) {
            const typeName = ['undefined', 'command', 'data', 'response', 'event'][expectedType] || 'unknown'
            throw new Error(`Expected ${typeName} container, got type ${type}`)
        }

        const payload = data.slice(12)

        return {
            length,
            type,
            code,
            transactionId,
            payload,
        }
    }

    static parseResponse(data: Uint8Array): USBContainer {
        return this.parseContainer(data, USBContainerType.RESPONSE)
    }

    static parseData(data: Uint8Array): USBContainer {
        return this.parseContainer(data, USBContainerType.DATA)
    }

    static parseEvent(data: Uint8Array): USBContainer {
        return this.parseContainer(data, USBContainerType.EVENT)
    }
}
