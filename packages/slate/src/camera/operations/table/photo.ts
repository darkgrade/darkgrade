import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The photo area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const photoOperationTable = {
    current: {
        captureImage: {
            area: 'photo',
            disposition: { kind: 'rename-to', target: 'takePhoto' },
        },
        resumeSonyShooting: {
            area: 'photo',
            disposition: {
                kind: 'private',
                handledBy: 'takePhoto and listMedia (resuming shooting after a card read)',
            },
        },
    },
    planned: {
        takePhoto: {
            area: 'photo',
            disposition: { kind: 'add' },
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
    },
} as const satisfies AreaOperationTable
