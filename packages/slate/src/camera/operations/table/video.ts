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
            disposition: {
                kind: 'replaced-by',
                target: 'startRecording',
                note: 'startRecording prepares video mode, card and audio; stopRecording restores them after a confirmed idle',
            },
        },
        enterMovieMode: {
            area: 'video',
            disposition: { kind: 'replaced-by', target: 'startRecording', note: 'video mode is selected inside startRecording' },
        },
        leaveMovieMode: {
            area: 'video',
            disposition: { kind: 'replaced-by', target: 'stopRecording', note: 'the previous mode is restored after a confirmed idle' },
        },
        prepareCanonRecordingDestination: {
            area: 'video',
            disposition: { kind: 'replaced-by', target: 'startRecording', note: 'the card destination is prepared inside startRecording' },
        },
        ensureCanonMovieSoundRecording: {
            area: 'video',
            disposition: {
                kind: 'replaced-by',
                target: 'startRecording',
                note: 'startRecording turns movie sound on when it is off; setAudioRecording chooses it explicitly',
            },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
