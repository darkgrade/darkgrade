import { ArrayCodec, baseCodecs } from '@ptp/types/codec'
import { DatatypeDefinition } from '@ptp/types/datatype'

export const datatypeDefinitions = [
    {
        code: 0x0000,
        name: 'UNDEF',
        description: 'Undefined',
        codec: baseCodecs.uint8,
    },
    {
        code: 0x0001,
        name: 'INT8',
        description: 'Signed 8-bit integer',
        codec: baseCodecs.int8,
    },
    {
        code: 0x0002,
        name: 'UINT8',
        description: 'Unsigned 8-bit integer',
        codec: baseCodecs.uint8,
    },
    {
        code: 0x0003,
        name: 'INT16',
        description: 'Signed 16-bit integer',
        codec: baseCodecs.int16,
    },
    {
        code: 0x0004,
        name: 'UINT16',
        description: 'Unsigned 16-bit integer',
        codec: baseCodecs.uint16,
    },
    {
        code: 0x0005,
        name: 'INT32',
        description: 'Signed 32-bit integer',
        codec: baseCodecs.int32,
    },
    {
        code: 0x0006,
        name: 'UINT32',
        description: 'Unsigned 32-bit integer',
        codec: baseCodecs.uint32,
    },
    {
        code: 0x0007,
        name: 'INT64',
        description: 'Signed 64-bit integer',
        codec: baseCodecs.int64,
    },
    {
        code: 0x0008,
        name: 'UINT64',
        description: 'Unsigned 64-bit integer',
        codec: baseCodecs.uint64,
    },
    {
        code: 0x0009,
        name: 'INT128',
        description: 'Signed 128-bit integer',
        codec: baseCodecs.uint8,
    },
    {
        code: 0x000a,
        name: 'UINT128',
        description: 'Unsigned 128-bit integer',
        codec: baseCodecs.uint8,
    },
    {
        code: 0x4001,
        name: 'AINT8',
        description: 'Array of signed 8-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.int8),
    },
    {
        code: 0x4002,
        name: 'AUINT8',
        description: 'Array of unsigned 8-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.uint8),
    },
    {
        code: 0x4003,
        name: 'AINT16',
        description: 'Array of signed 16-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.int16),
    },
    {
        code: 0x4004,
        name: 'AUINT16',
        description: 'Array of unsigned 16-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.uint16),
    },
    {
        code: 0x4005,
        name: 'AINT32',
        description: 'Array of signed 32-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.int32),
    },
    {
        code: 0x4006,
        name: 'AUINT32',
        description: 'Array of unsigned 32-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.uint32),
    },
    {
        code: 0x4007,
        name: 'AINT64',
        description: 'Array of signed 64-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.int64),
    },
    {
        code: 0x4008,
        name: 'AUINT64',
        description: 'Array of unsigned 64-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.uint64),
    },
    {
        code: 0x4009,
        name: 'AINT128',
        description: 'Array of signed 128-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.uint8),
    },
    {
        code: 0x400a,
        name: 'AUINT128',
        description: 'Array of unsigned 128-bit integers',
        codec: registry => new ArrayCodec(registry, registry.codecs.uint8),
    },
    {
        code: 0xffff,
        name: 'STR',
        description: 'Variable-length unicode string',
        codec: baseCodecs.string,
    },
] as const satisfies readonly DatatypeDefinition[]

export const datatypesByCode: Map<number, DatatypeDefinition> = new Map(datatypeDefinitions.map(dt => [dt.code, dt]))

export const datatypesByName: Map<string, DatatypeDefinition> = new Map(datatypeDefinitions.map(dt => [dt.name, dt]))

export function getDatatypeByCode(code: number): DatatypeDefinition | undefined {
    return datatypesByCode.get(code)
}

export function getDatatypeByName(name: string): DatatypeDefinition | undefined {
    return datatypesByName.get(name)
}
