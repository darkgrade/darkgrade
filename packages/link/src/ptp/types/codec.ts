// Forward declaration to avoid circular dependency
export type PTPRegistry = {
    codecs: BaseCodecRegistry
    operations: Record<string, any>
    properties: Record<string, any>
    events: Record<string, any>
    formats: Record<string, any>
    responses: Record<string, any>
}

export type BaseCodecType = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'int64' | 'uint64' | 'string'
export type CustomCodecType = 'enum' | 'range' | 'array' | 'custom'

export interface CodecInstance<T> {
    encode(value: T): Uint8Array
    decode(buffer: Uint8Array, offset?: number): { value: T; bytesRead: number }
}

export interface BaseCodecRegistry {
    readonly int8: CodecInstance<number>
    readonly uint8: CodecInstance<number>
    readonly int16: CodecInstance<number>
    readonly uint16: CodecInstance<number>
    readonly int32: CodecInstance<number>
    readonly uint32: CodecInstance<number>
    readonly int64: CodecInstance<bigint>
    readonly uint64: CodecInstance<bigint>
    readonly string: CodecInstance<string>
}

export type CodecBuilder<T> = (registry: PTPRegistry) => CodecInstance<T>

// Codec definition can be either a builder function or an instance (for backward compatibility)
export type CodecDefinition<T> = CodecBuilder<T> | CodecInstance<T>

export type EnumValue<T> = {
    value: T
    name: string
    description: string
}

export abstract class CustomCodec<T> implements CodecInstance<T> {
    constructor(public readonly registry: PTPRegistry) {}

    public get codecs() {
        return this.registry.codecs
    }
    // For backward compatibility
    public get baseCodecs() {
        return this.registry.codecs
    }

    abstract encode(value: T): Uint8Array
    abstract decode(buffer: Uint8Array, offset?: number): { value: T; bytesRead: number }
}

export class EnumCodec<T, Names extends string = string> extends CustomCodec<Names> {
    private readonly valueToName = new Map<T, EnumValue<T>>()
    private readonly nameToValue = new Map<string, EnumValue<T>>()
    private readonly baseCodec: CodecInstance<T>

    constructor(registry: PTPRegistry, values: readonly EnumValue<T>[], baseCodec: CodecInstance<T>) {
        super(registry)
        this.baseCodec = baseCodec
        for (const enumValue of values) {
            this.valueToName.set(enumValue.value, enumValue)
            this.nameToValue.set(enumValue.name, enumValue)
        }
    }

    encode(value: Names): Uint8Array {
        if (typeof value === 'string') {
            const enumValue = this.nameToValue.get(value)
            if (!enumValue) {
                throw new Error(`Invalid enum name: ${value}`)
            }
            return this.baseCodec.encode(enumValue.value)
        }
        if (!this.valueToName.has(value)) {
            throw new Error(`Invalid enum value: ${value}`)
        }
        return this.baseCodec.encode(value)
    }

    decode(buffer: Uint8Array, offset = 0): { value: Names; bytesRead: number } {
        const result = this.baseCodec.decode(buffer, offset)
        const enumValue = this.valueToName.get(result.value)
        if (!enumValue) {
            throw new Error(`Invalid enum value: ${result.value}`)
        }
        return { value: enumValue.name as Names, bytesRead: result.bytesRead }
    }

    getEnumValue(value: T): EnumValue<T> | undefined {
        return this.valueToName.get(value)
    }

    getEnumByName(name: string): EnumValue<T> | undefined {
        return this.nameToValue.get(name)
    }

    getAllValues(): EnumValue<T>[] {
        return Array.from(this.valueToName.values())
    }
}

// Helper function to create a typed EnumCodec with inferred enum names
export function createEnumCodec<T, const Values extends readonly EnumValue<T>[]>(
    registry: PTPRegistry,
    values: Values,
    baseCodec: CodecInstance<T>
): EnumCodec<T, Values[number]['name']> {
    return new EnumCodec<T, Values[number]['name']>(registry, values, baseCodec)
}

export interface RangeSpec<T> {
    minimum: T
    maximum: T
    step: T
}

export class RangeCodec<T extends number> extends CustomCodec<T> {
    private readonly range: RangeSpec<T>
    private readonly baseCodec: CodecInstance<T>

    constructor(registry: PTPRegistry, range: RangeSpec<T>, baseCodec: CodecInstance<T>) {
        super(registry)
        this.range = range
        this.baseCodec = baseCodec
    }

    encode(value: T): Uint8Array {
        if (value < this.range.minimum || value > this.range.maximum) {
            throw new Error(`Value ${value} out of range [${this.range.minimum}, ${this.range.maximum}]`)
        }

        const adjustedValue = value - this.range.minimum
        if (this.range.step !== 0 && adjustedValue % this.range.step !== 0) {
            throw new Error(`Value ${value} not aligned to step ${this.range.step}`)
        }

        return this.baseCodec.encode(value)
    }

    decode(buffer: Uint8Array, offset = 0): { value: T; bytesRead: number } {
        const result = this.baseCodec.decode(buffer, offset)

        if (result.value < this.range.minimum || result.value > this.range.maximum) {
            throw new Error(`Decoded value ${result.value} out of range [${this.range.minimum}, ${this.range.maximum}]`)
        }

        return result
    }

    getRange(): RangeSpec<T> {
        return { ...this.range }
    }
}

export class Uint8Codec {
    readonly type = 'uint8' as const

    encode(value: number): Uint8Array {
        const buffer = new Uint8Array(1)
        buffer[0] = value & 0xff
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: number; bytesRead: number } {
        if (buffer.length - offset < 1) {
            throw new Error('Insufficient buffer size for UINT8')
        }
        return { value: buffer[offset], bytesRead: 1 }
    }
}

export class Uint16Codec {
    readonly type = 'uint16' as const
    private readonly littleEndian: boolean

    constructor(littleEndian = false) {
        this.littleEndian = littleEndian
    }

    encode(value: number): Uint8Array {
        const buffer = new Uint8Array(2)
        const view = new DataView(buffer.buffer)
        view.setUint16(0, value, this.littleEndian)
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: number; bytesRead: number } {
        if (buffer.length - offset < 2) {
            throw new Error('Insufficient buffer size for UINT16')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        return { value: view.getUint16(0, this.littleEndian), bytesRead: 2 }
    }
}

export class Uint32Codec {
    readonly type = 'uint32' as const
    private readonly littleEndian: boolean

    constructor(littleEndian = false) {
        this.littleEndian = littleEndian
    }

    encode(value: number): Uint8Array {
        const buffer = new Uint8Array(4)
        const view = new DataView(buffer.buffer)
        view.setUint32(0, value, this.littleEndian)
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: number; bytesRead: number } {
        if (buffer.length - offset < 4) {
            throw new Error('Insufficient buffer size for UINT32')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        return { value: view.getUint32(0, this.littleEndian), bytesRead: 4 }
    }
}

export class Uint64Codec {
    readonly type = 'uint64' as const
    private readonly littleEndian: boolean

    constructor(littleEndian = false) {
        this.littleEndian = littleEndian
    }

    encode(value: bigint): Uint8Array {
        const buffer = new Uint8Array(8)
        const view = new DataView(buffer.buffer)
        view.setBigUint64(0, value, this.littleEndian)
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: bigint; bytesRead: number } {
        if (buffer.length - offset < 8) {
            throw new Error('Insufficient buffer size for UINT64')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        return { value: view.getBigUint64(0, this.littleEndian), bytesRead: 8 }
    }
}

export class Int8Codec {
    readonly type = 'int8' as const

    encode(value: number): Uint8Array {
        const buffer = new Uint8Array(1)
        const view = new DataView(buffer.buffer)
        view.setInt8(0, value)
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: number; bytesRead: number } {
        if (buffer.length - offset < 1) {
            throw new Error('Insufficient buffer size for INT8')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        return { value: view.getInt8(0), bytesRead: 1 }
    }
}

export class Int16Codec {
    readonly type = 'int16' as const
    private readonly littleEndian: boolean

    constructor(littleEndian = false) {
        this.littleEndian = littleEndian
    }

    encode(value: number): Uint8Array {
        const buffer = new Uint8Array(2)
        const view = new DataView(buffer.buffer)
        view.setInt16(0, value, this.littleEndian)
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: number; bytesRead: number } {
        if (buffer.length - offset < 2) {
            throw new Error('Insufficient buffer size for INT16')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        return { value: view.getInt16(0, this.littleEndian), bytesRead: 2 }
    }
}

export class Int32Codec {
    readonly type = 'int32' as const
    private readonly littleEndian: boolean

    constructor(littleEndian = false) {
        this.littleEndian = littleEndian
    }

    encode(value: number): Uint8Array {
        const buffer = new Uint8Array(4)
        const view = new DataView(buffer.buffer)
        view.setInt32(0, value, this.littleEndian)
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: number; bytesRead: number } {
        if (buffer.length - offset < 4) {
            throw new Error('Insufficient buffer size for INT32')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        return { value: view.getInt32(0, this.littleEndian), bytesRead: 4 }
    }
}

export class Int64Codec {
    readonly type = 'int64' as const
    private readonly littleEndian: boolean

    constructor(littleEndian = false) {
        this.littleEndian = littleEndian
    }

    encode(value: bigint): Uint8Array {
        const buffer = new Uint8Array(8)
        const view = new DataView(buffer.buffer)
        view.setBigInt64(0, value, this.littleEndian)
        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: bigint; bytesRead: number } {
        if (buffer.length - offset < 8) {
            throw new Error('Insufficient buffer size for INT64')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        return { value: view.getBigInt64(0, this.littleEndian), bytesRead: 8 }
    }
}

export class StringCodec {
    readonly type = 'string' as const
    private readonly littleEndian: boolean

    constructor(littleEndian = false) {
        this.littleEndian = littleEndian
    }

    encode(value: string): Uint8Array {
        const numChars = value.length + 1
        const buffer = new Uint8Array(1 + numChars * 2)
        const view = new DataView(buffer.buffer)

        buffer[0] = numChars

        for (let i = 0; i < value.length; i++) {
            const charCode = value.charCodeAt(i)
            view.setUint16(1 + i * 2, charCode, this.littleEndian)
        }

        view.setUint16(buffer.length - 2, 0, this.littleEndian)

        return buffer
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        if (buffer.length - offset < 1) {
            throw new Error('Insufficient buffer size for string length')
        }

        const numChars = buffer[offset]

        if (numChars === 0) {
            return { value: '', bytesRead: 1 }
        }

        const totalBytes = 1 + numChars * 2
        if (buffer.length - offset < totalBytes) {
            throw new Error('Insufficient buffer size for string')
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
        const chars: number[] = []
        for (let i = 0; i < numChars - 1; i++) {
            const charCode = view.getUint16(1 + i * 2, this.littleEndian)
            chars.push(charCode)
        }

        return {
            value: String.fromCharCode(...chars),
            bytesRead: totalBytes,
        }
    }
}

export type BitfieldFlag = {
    bit: number
    name: string
    description: string
}

export class BitfieldCodec extends CustomCodec<string> {
    private readonly flags: readonly BitfieldFlag[]
    private readonly baseCodec: CodecInstance<number>

    constructor(registry: PTPRegistry, flags: readonly BitfieldFlag[], baseCodec: CodecInstance<number>) {
        super(registry)
        this.flags = flags
        this.baseCodec = baseCodec
    }

    encode(value: string): Uint8Array {
        if (value === '' || value === 'none') {
            return this.baseCodec.encode(0)
        }
        // Parse as comma-separated flag names
        const flagNames = value.split(',').map(s => s.trim())
        let bits = 0
        for (const flagName of flagNames) {
            const flag = this.flags.find(f => f.name === flagName)
            if (flag) {
                bits |= 1 << flag.bit
            }
        }
        return this.baseCodec.encode(bits)
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        const result = this.baseCodec.decode(buffer, offset)
        const bits = result.value

        if (bits === 0) {
            return { value: 'none', bytesRead: result.bytesRead }
        }

        const activeFlags = this.flags
            .filter(flag => !!(bits & (1 << flag.bit)))
            .map(flag => `${flag.name} (${flag.description})`)

        return { value: activeFlags.join(', '), bytesRead: result.bytesRead }
    }

    getFlags(): readonly BitfieldFlag[] {
        return this.flags
    }

    getRawValue(value: string): number {
        if (value === '' || value === 'none') {
            return 0
        }
        const flagNames = value
            .split(',')
            .map(s => s.trim())
            .map(s => s.split(' ')[0])
        let bits = 0
        for (const flagName of flagNames) {
            const flag = this.flags.find(f => f.name === flagName)
            if (flag) {
                bits |= 1 << flag.bit
            }
        }
        return bits
    }
}

export class ArrayCodec<T> extends CustomCodec<T[]> {
    private readonly elementCodec: CodecInstance<T>

    constructor(registry: PTPRegistry, elementCodec: CodecInstance<T>) {
        super(registry)
        this.elementCodec = elementCodec
    }

    encode(values: T[]): Uint8Array {
        const buffers: Uint8Array[] = []

        buffers.push(this.baseCodecs.uint32.encode(values.length))

        for (const value of values) {
            buffers.push(this.elementCodec.encode(value))
        }

        const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const buffer of buffers) {
            result.set(buffer, offset)
            offset += buffer.length
        }

        return result
    }

    decode(buffer: Uint8Array, offset = 0): { value: T[]; bytesRead: number } {
        if (buffer.length - offset < 4) {
            throw new Error('Insufficient buffer size for array length')
        }

        const lengthResult = this.baseCodecs.uint32.decode(buffer, offset)
        const length = lengthResult.value

        const values: T[] = []
        let currentOffset = offset + lengthResult.bytesRead

        for (let i = 0; i < length; i++) {
            const result = this.elementCodec.decode(buffer, currentOffset)
            values.push(result.value)
            currentOffset += result.bytesRead
        }

        return {
            value: values,
            bytesRead: currentOffset - offset,
        }
    }
}

export const baseCodecs = {
    int8: (registry: PTPRegistry) => registry.codecs.int8,
    uint8: (registry: PTPRegistry) => registry.codecs.uint8,
    int16: (registry: PTPRegistry) => registry.codecs.int16,
    uint16: (registry: PTPRegistry) => registry.codecs.uint16,
    int32: (registry: PTPRegistry) => registry.codecs.int32,
    uint32: (registry: PTPRegistry) => registry.codecs.uint32,
    int64: (registry: PTPRegistry) => registry.codecs.int64,
    uint64: (registry: PTPRegistry) => registry.codecs.uint64,
    string: (registry: PTPRegistry) => registry.codecs.string,
} as const

export function createBaseCodecs(littleEndian: boolean): BaseCodecRegistry {
    return {
        int8: new Int8Codec(),
        uint8: new Uint8Codec(),
        int16: new Int16Codec(littleEndian),
        uint16: new Uint16Codec(littleEndian),
        int32: new Int32Codec(littleEndian),
        uint32: new Uint32Codec(littleEndian),
        int64: new Int64Codec(littleEndian),
        uint64: new Uint64Codec(littleEndian),
        string: new StringCodec(littleEndian),
    }
}

export type CodecType<T> =
    T extends CodecBuilder<infer U>
        ? U extends EnumCodec<infer _BaseType, infer Names>
            ? Names
            : U extends CodecInstance<infer V>
              ? V
              : U
        : T extends CodecInstance<infer U>
          ? U
          : T extends Uint8Codec
            ? number
            : T extends Uint16Codec
              ? number
              : T extends Uint32Codec
                ? number
                : T extends Uint64Codec
                  ? bigint
                  : T extends Int8Codec
                    ? number
                    : T extends Int16Codec
                      ? number
                      : T extends Int32Codec
                        ? number
                        : T extends Int64Codec
                          ? bigint
                          : T extends StringCodec
                            ? string
                            : T extends ArrayCodec<infer E>
                              ? E[]
                              : T extends EnumCodec<infer _BaseType, infer Names>
                                ? Names
                                : T extends RangeCodec<infer N>
                                  ? N
                                  : T extends CustomCodec<infer C>
                                    ? C
                                    : never
