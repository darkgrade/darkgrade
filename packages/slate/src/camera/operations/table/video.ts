import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

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
            summary: 'Gets the camera ready (video mode, card, audio), starts, and returns once the camera reports recording',
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
        prepareRecordingMode: {
            area: 'video',
            disposition: { kind: 'private', handledBy: 'startRecording / stopRecording' },
        },
        enterMovieMode: {
            area: 'video',
            disposition: {
                kind: 'replaced-by',
                target: 'setPhotoVideoMode',
                note: "setPhotoVideoMode('video'); startRecording also selects video mode itself",
            },
        },
        leaveMovieMode: {
            area: 'video',
            disposition: {
                kind: 'replaced-by',
                target: 'setPhotoVideoMode',
                note: "setPhotoVideoMode('photo'); stopRecording restores the previous mode itself",
            },
        },
        prepareCanonRecordingDestination: {
            area: 'video',
            disposition: { kind: 'private', handledBy: 'startRecording (card destination)' },
        },
        ensureCanonMovieSoundRecording: {
            area: 'video',
            disposition: { kind: 'private', handledBy: 'startRecording (audio)' },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
