import { createEnumCodec, EnumCodec, type EnumValue, type PTPRegistry } from '@ptp/types/codec'

type UnsignedWidth = 'uint8' | 'uint16' | 'uint32'

/** An enum codec over an unsigned integer whose value names stay literal types. */
export const sonyEnum =
    <const Values extends readonly EnumValue<number>[]>(width: UnsignedWidth, values: Values) =>
    (registry: PTPRegistry) =>
        createEnumCodec(registry, values, registry.codecs[width])

/** An enum codec over an unsigned integer that accepts any value name as input. */
export const sonyLooseEnum =
    (width: UnsignedWidth, values: readonly EnumValue<number>[]) =>
    (registry: PTPRegistry) =>
        new EnumCodec(registry, values, registry.codecs[width])
