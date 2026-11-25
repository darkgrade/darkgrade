import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The photo area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const photoOperationTable = {
    current: {
        takePhoto: {
            area: 'photo',
            disposition: { kind: 'keep' },
            summary: 'Takes a photo and returns only once a new file is confirmed. Returns its media id, name, size and, for computer, the bytes',
            surfaces: {
                cli: {
                    flags: [{ name: '--no-autofocus', description: 'release without focusing' }, {
                        name: '--destination',
                        value: 'card|computer',
                        description: 'where the photo is saved',
                    }],
                },
            },
        },
        captureImage: {
            area: 'photo',
            disposition: {
                kind: 'replaced-by',
                target: 'takePhoto',
                note: "'computer' saves to the card and returns the bytes; host-only and SDRAM delivery ('memory') is not offered. Nikon lossless RAW is setRawCompression('Lossless') before the photo",
            },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
