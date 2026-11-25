import type { AreaOperationTable } from '@camera/operation-table/operation-entry'

/**
 * The video area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const videoOperationTable = {
    current: {
        getRecordingState: {
            area: 'video',
            disposition: { kind: 'keep' },
            summary: 'What the camera reports now. Unknown never counts as idle',
        },
        startRecording: {
            area: 'video',
            disposition: { kind: 'keep' },
            summary: 'Gets the camera ready (video mode, card), starts, and returns once the camera reports recording. Audio stays as set',
            surfaces: {
                cli: {
                    flags: [{
                        name: '--duration',
                        value: 'duration',
                        description: 'stop after this long, for example 10s; otherwise stops on Ctrl-C',
                    }],
                },
            },
        },
        stopRecording: {
            area: 'video',
            disposition: { kind: 'keep' },
            summary: 'Stops, waits until a finished clip is on the card, puts the camera back, and returns the clip. Always allowed',
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
