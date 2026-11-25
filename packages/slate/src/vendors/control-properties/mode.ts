import type { modeControlDefinitions } from '@camera/settings/mode'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

/**
 * The mode group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const modeControlProperties = {
    sony: {},
    canon: {},
    standard: {},
    nikonPhoto: {},
    nikonMovie: {},
} as const satisfies VendorControlProperties<keyof typeof modeControlDefinitions>
