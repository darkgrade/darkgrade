import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The media area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const mediaOperationTable = {
    current: {
        listObjects: {
            area: 'media',
            disposition: { kind: 'replaced-by', target: 'listMedia' },
        },
        getObject: {
            area: 'media',
            disposition: { kind: 'replaced-by', target: 'downloadMedia' },
        },
        listSonyContents: {
            area: 'media',
            disposition: { kind: 'replaced-by', target: 'listMedia' },
        },
        getSonyContentPreview: {
            area: 'media',
            disposition: { kind: 'replaced-by', target: 'getMediaPreview' },
        },
    },
    planned: {
        getCardStatus: {
            area: 'media',
            disposition: { kind: 'add' },
            summary: 'Per card slot: free space, photos left, recording time left',
        },
        listMedia: {
            area: 'media',
            disposition: { kind: 'add' },
            summary: 'Photos and clips on the card, newest first, with ids that survive a reconnect',
        },
        getMediaPreview: {
            area: 'media',
            disposition: { kind: 'add' },
            summary: 'A small JPEG of a photo or clip',
            surfaces: {
                cli: {
                    arguments: [{ name: 'id', description: 'a media id from list-media' }],
                    flags: [{ name: '--size', value: 'thumbnail|preview', description: 'preview size' }],
                },
            },
        },
        downloadMedia: {
            area: 'media',
            disposition: { kind: 'add' },
            summary: 'Copies a file off the card, with progress and cancel',
            surfaces: {
                cli: {
                    arguments: [{ name: 'id', description: 'a media id from list-media' }],
                },
            },
        },
    },
} as const satisfies AreaOperationTable
