import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { CustomCodec, type PTPRegistry } from '@ptp/types/codec'
import { DatatypeCode } from '@ptp/types/datatype'

export interface VariableValue {
    value: number | bigint | string
    rawBytes: Uint8Array
}

/**
 * Codec for variable-sized values based on their datatype
 * Used by device property descriptors to encode/decode values of different types
 */
export class VariableValueCodec extends CustomCodec<VariableValue> {
    constructor(
        registry: PTPRegistry,
        private dataType: DatatypeCode
    ) {
        super(registry)
    }

    encode(value: VariableValue | number | bigint | string): Uint8Array {
        if (value && typeof value === 'object' && 'rawBytes' in value) {
            return value.rawBytes
        }

        const datatypeDefinition = getDatatypeByCode(this.dataType)
        if (!datatypeDefinition) {
            throw new Error(`Unknown datatype: 0x${this.dataType.toString(16)}`)
        }
        if (!datatypeDefinition.codec) {
            throw new Error(`Datatype ${this.dataType} has no codec`)
        }

        const codec =
            typeof datatypeDefinition.codec === 'function'
                ? datatypeDefinition.codec(this.registry)
                : datatypeDefinition.codec

        if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') {
            throw new Error(`Invalid value type for VariableValueCodec: ${typeof value}`)
        }

        return codec.encode(value)
    }

    decode(buffer: Uint8Array, offset = 0): { value: VariableValue; bytesRead: number } {
        const datatypeDefinition = getDatatypeByCode(this.dataType)
        if (!datatypeDefinition) {
            throw new Error(`Unknown datatype: 0x${this.dataType.toString(16)}`)
        }
        if (!datatypeDefinition.codec) {
            throw new Error(`Datatype ${this.dataType} has no codec`)
        }

        const codec =
            typeof datatypeDefinition.codec === 'function'
                ? datatypeDefinition.codec(this.registry)
                : datatypeDefinition.codec

        const result = codec.decode(buffer, offset)
        const rawBytes = buffer.slice(offset, offset + result.bytesRead)

        if (typeof result.value !== 'number' && typeof result.value !== 'bigint' && typeof result.value !== 'string') {
            throw new Error(`Invalid decoded value type: ${typeof result.value}`)
        }

        return {
            value: {
                value: result.value,
                rawBytes,
            },
            bytesRead: result.bytesRead,
        }
    }
}
