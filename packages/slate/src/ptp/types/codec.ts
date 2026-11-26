import { concatenateBytes } from '@ptp/datasets/codecs/byte-sequence'

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
            if (!enumValue) throw new Error(`Invalid enum name: ${value}`)
            return this.baseCodec.encode(enumValue.value)
        }
        if (!this.valueToName.has(value)) throw new Error(`Invalid enum value: ${value}`)
        return this.baseCodec.encode(value)
    }

    decode(buffer: Uint8Array, offset = 0): { value: Names; bytesRead: number } {
        const result = this.baseCodec.decode(buffer, offset)
        const enumValue = this.valueToName.get(result.value)
        if (!enumValue) throw new Error(`Invalid enum value: ${result.value}`)
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

/** An EnumCodec whose names are inferred from its values. */
export function createEnumCodec<T, const Values extends readonly EnumValue<T>[]>(
    registry: PTPRegistry,
    values: Values,
    baseCodec: CodecInstance<T>
): EnumCodec<T, Values[number]['name']> {
    return new EnumCodec<T, Values[number]['name']>(registry, values, baseCodec)
}

/**
 * An enumeration whose wire values differ between bodies (a property one specification names and
 * another body uses differently): a value with no name decodes as that raw value instead of
 * failing, so a read keeps what the camera said. Writes take only the names; a typed setting
 * excludes the raw type (`Exclude<…, number>`).
 */
export class OpenEnumCodec<T, Names extends string = string> extends CustomCodec<Names | T> {
    private readonly named: EnumCodec<T, Names>

    constructor(
        registry: PTPRegistry,
        values: readonly EnumValue<T>[],
        private readonly baseCodec: CodecInstance<T>
    ) {
        super(registry)
        this.named = new EnumCodec<T, Names>(registry, values, baseCodec)
    }

    encode(value: Names | T): Uint8Array {
        if (typeof value === 'string') return this.named.encode(value as Names)
        if (!this.named.getEnumValue(value)) throw new Error(`Invalid enum value: ${String(value)}`)
        return this.baseCodec.encode(value)
    }

    decode(buffer: Uint8Array, offset = 0): { value: Names | T; bytesRead: number } {
        const result = this.baseCodec.decode(buffer, offset)
        return { value: this.nameOf(result.value) ?? result.value, bytesRead: result.bytesRead }
    }

    /** The name of a raw value, or undefined when this enumeration has none for it. */
    nameOf(value: T): Names | undefined {
        return this.named.getEnumValue(value)?.name as Names | undefined
    }
}

/** An OpenEnumCodec whose names are inferred from its values. */
export function createOpenEnumCodec<T, const Values extends readonly EnumValue<T>[]>(
    registry: PTPRegistry,
    values: Values,
    baseCodec: CodecInstance<T>
): OpenEnumCodec<T, Values[number]['name']> {
    return new OpenEnumCodec<T, Values[number]['name']>(registry, values, baseCodec)
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
        if (value < this.range.minimum || value > this.range.maximum)
            throw new Error(`Value ${value} out of range [${this.range.minimum}, ${this.range.maximum}]`)
        if (this.range.step !== 0 && (value - this.range.minimum) % this.range.step !== 0)
            throw new Error(`Value ${value} not aligned to step ${this.range.step}`)
        return this.baseCodec.encode(value)
    }

    decode(buffer: Uint8Array, offset = 0): { value: T; bytesRead: number } {
        const result = this.baseCodec.decode(buffer, offset)
        if (result.value < this.range.minimum || result.value > this.range.maximum)
            throw new Error(`Decoded value ${result.value} out of range [${this.range.minimum}, ${this.range.maximum}]`)
        return result
    }

    getRange(): RangeSpec<T> {
        return { ...this.range }
    }
}

/** A view of `size` bytes at `offset`, or an error naming the PTP datatype that did not fit. */
function readView(buffer: Uint8Array, offset: number, size: number, datatype: string): DataView {
    if (!Number.isInteger(offset) || offset < 0 || buffer.length - offset < size)
        throw new Error(`Insufficient buffer size for ${datatype}`)
    return new DataView(buffer.buffer, buffer.byteOffset + offset, buffer.byteLength - offset)
}

function written(size: number, write: (view: DataView) => void): Uint8Array {
    const buffer = new Uint8Array(size)
    write(new DataView(buffer.buffer))
    return buffer
}

/** A fixed-width PTP integer read and written through DataView, in the transport's byte order. */
function integerCodec<const Type extends string, Value extends number | bigint>(
    type: Type,
    size: number,
    read: (view: DataView, littleEndian: boolean) => Value,
    write: (view: DataView, value: Value, littleEndian: boolean) => void
) {
    return class {
        readonly type = type
        constructor(readonly littleEndian = false) {}

        encode(value: Value): Uint8Array {
            return written(size, view => write(view, value, this.littleEndian))
        }

        decode(buffer: Uint8Array, offset = 0): { value: Value; bytesRead: number } {
            return {
                value: read(readView(buffer, offset, size, type.toUpperCase()), this.littleEndian),
                bytesRead: size,
            }
        }
    }
}

export class Uint8Codec extends integerCodec(
    'uint8',
    1,
    view => view.getUint8(0),
    (view, value: number) => view.setUint8(0, value)
) {}
export class Int8Codec extends integerCodec(
    'int8',
    1,
    view => view.getInt8(0),
    (view, value: number) => view.setInt8(0, value)
) {}
export class Uint16Codec extends integerCodec(
    'uint16',
    2,
    (view, little) => view.getUint16(0, little),
    (view, value: number, little) => view.setUint16(0, value, little)
) {}
export class Int16Codec extends integerCodec(
    'int16',
    2,
    (view, little) => view.getInt16(0, little),
    (view, value: number, little) => view.setInt16(0, value, little)
) {}
export class Uint32Codec extends integerCodec(
    'uint32',
    4,
    (view, little) => view.getUint32(0, little),
    (view, value: number, little) => view.setUint32(0, value, little)
) {}
export class Int32Codec extends integerCodec(
    'int32',
    4,
    (view, little) => view.getInt32(0, little),
    (view, value: number, little) => view.setInt32(0, value, little)
) {}
export class Uint64Codec extends integerCodec(
    'uint64',
    8,
    (view, little) => view.getBigUint64(0, little),
    (view, value: bigint, little) => view.setBigUint64(0, value, little)
) {}
export class Int64Codec extends integerCodec(
    'int64',
    8,
    (view, little) => view.getBigInt64(0, little),
    (view, value: bigint, little) => view.setBigInt64(0, value, little)
) {}

export class StringCodec {
    readonly type = 'string' as const
    constructor(private readonly littleEndian = false) {}

    encode(value: string): Uint8Array {
        if (value.length > 254) throw new Error('PTP string exceeds 254 UTF-16 code units')
        const numChars = value.length + 1
        return written(1 + numChars * 2, view => {
            view.setUint8(0, numChars)
            for (let i = 0; i < value.length; i++) view.setUint16(1 + i * 2, value.charCodeAt(i), this.littleEndian)
        })
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        readView(buffer, offset, 1, 'string length')

        const numChars = buffer[offset]
        if (numChars === 0) return { value: '', bytesRead: 1 }
        const totalBytes = 1 + numChars * 2
        const view = readView(buffer, offset, totalBytes, 'string')
        if (view.getUint16(totalBytes - 2, this.littleEndian) !== 0)
            throw new Error('PTP string is missing its terminator')
        const chars: number[] = []
        for (let i = 0; i < numChars - 1; i++) chars.push(view.getUint16(1 + i * 2, this.littleEndian))
        return { value: String.fromCharCode(...chars), bytesRead: totalBytes }
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
        return this.baseCodec.encode(this.bitsOf(value, name => name))
    }

    /** Comma-separated flag names; unknown names are ignored. */
    private bitsOf(value: string, flagName: (item: string) => string): number {
        if (value === '' || value === 'none') return 0
        let bits = 0
        for (const item of value.split(',')) {
            const flag = this.flags.find(candidate => candidate.name === flagName(item.trim()))
            if (flag) bits |= 1 << flag.bit
        }
        return bits
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        const result = this.baseCodec.decode(buffer, offset)
        const bits = result.value
        if (bits === 0) return { value: 'none', bytesRead: result.bytesRead }
        const activeFlags = this.flags
            .filter(flag => !!(bits & (1 << flag.bit)))
            .map(flag => `${flag.name} (${flag.description})`)

        return { value: activeFlags.join(', '), bytesRead: result.bytesRead }
    }

    getFlags(): readonly BitfieldFlag[] {
        return this.flags
    }

    getRawValue(value: string): number {
        return this.bitsOf(value, item => item.split(' ')[0])
    }
}

export class ArrayCodec<T> extends CustomCodec<T[]> {
    private readonly elementCodec: CodecInstance<T>

    constructor(registry: PTPRegistry, elementCodec: CodecInstance<T>) {
        super(registry)
        this.elementCodec = elementCodec
    }

    encode(values: T[]): Uint8Array {
        return concatenateBytes([
            this.baseCodecs.uint32.encode(values.length),
            ...values.map(value => this.elementCodec.encode(value)),
        ])
    }

    decode(buffer: Uint8Array, offset = 0): { value: T[]; bytesRead: number } {
        readView(buffer, offset, 4, 'array length')
        const lengthResult = this.baseCodecs.uint32.decode(buffer, offset)
        const values: T[] = []
        let currentOffset = offset + lengthResult.bytesRead
        for (let i = 0; i < lengthResult.value; i++) {
            const result = this.elementCodec.decode(buffer, currentOffset)
            values.push(result.value)
            currentOffset += result.bytesRead
        }
        return { value: values, bytesRead: currentOffset - offset }
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
    T extends CodecBuilder<infer Value> ? Value : T extends CodecInstance<infer Value> ? Value : never
