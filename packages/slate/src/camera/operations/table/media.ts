import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The media area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const mediaOperationTable = {
    current: {
        getCardStatus: {
            area: 'media',
            disposition: { kind: 'keep' },
            summary: 'Per card slot: free space, photos left, recording time left',
        },
        listMedia: {
            area: 'media',
            disposition: { kind: 'keep' },
            summary: 'Photos and clips on the card, newest first, with ids that survive a reconnect',
        },
        getMediaPreview: {
            area: 'media',
            disposition: { kind: 'keep' },
            summary: 'A small JPEG of a photo or clip',
            parameters: [
                { name: 'id', type: 'text', required: true, description: 'a media id from list-media' },
                { name: 'size', type: 'choice', choices: ['thumbnail', 'preview'], description: 'thumbnail (the default) or preview' },
            ],
        },
        downloadMedia: {
            area: 'media',
            disposition: { kind: 'keep' },
            summary: 'Copies a file off the card, with progress and cancel',
            parameters: [{ name: 'id', type: 'text', required: true, description: 'a media id from list-media' }],
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
