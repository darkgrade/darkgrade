import type { AreaOperationTable } from '@camera/operation-table/operation-entry'

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
            parameters: [
                { name: 'autofocus', type: 'switch', default: true, description: 'focus before the release; off releases without focusing' },
                {
                    name: 'destination',
                    type: 'choice',
                    choices: ['card', 'computer'],
                    description: 'card (the default) keeps the photo on the card; computer also returns its bytes',
                },
            ],
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
