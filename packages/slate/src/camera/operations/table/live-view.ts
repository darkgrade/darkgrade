import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The live-view area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const liveViewOperationTable = {
    current: {
        getLiveViewFrame: {
            area: 'live-view',
            disposition: { kind: 'keep' },
            summary: 'The current picture as JPEG, with focus frames and, with overlay, the camera\'s on-screen info',
            surfaces: {
                cli: {
                    flags: [{ name: '--overlay', description: 'include the camera\'s on-screen info' }],
                },
            },
        },
        captureLiveView: {
            area: 'live-view',
            disposition: {
                kind: 'replaced-by',
                target: 'getLiveViewFrame',
                note: 'returns { jpeg, focusFrames, overlay? } instead of vendor fields',
            },
        },
        millisecondsUntilNextLiveViewFrame: {
            area: 'live-view',
            disposition: { kind: 'private', handledBy: 'getLiveViewFrame (live-view pacing)' },
        },
        takeLiveViewStatistics: {
            area: 'live-view',
            disposition: { kind: 'private', handledBy: 'getLiveViewFrame (live-view pacing)' },
        },
        captureCanonViewfinderFrame: {
            area: 'live-view',
            disposition: { kind: 'replaced-by', target: 'getLiveViewFrame' },
        },
        stopCanonLiveView: {
            area: 'live-view',
            disposition: { kind: 'private', handledBy: 'getLiveViewFrame and disconnect (live-view output)' },
        },
        setSonyOsdImageMode: {
            area: 'live-view',
            disposition: {
                kind: 'private',
                handledBy: 'getLiveViewFrame({ overlay }) (the camera\'s overlay output)',
            },
        },
        captureSonyOsdImage: {
            area: 'live-view',
            disposition: {
                kind: 'replaced-by',
                target: 'getLiveViewFrame',
                note: 'getLiveViewFrame({ overlay: true })',
            },
        },
        getCanonHdmiLiveViewMode: {
            area: 'live-view',
            disposition: { kind: 'private', handledBy: 'getLiveViewFrame (Canon live-view output)' },
        },
        setCanonHdmiLiveViewMode: {
            area: 'live-view',
            disposition: { kind: 'private', handledBy: 'getLiveViewFrame (Canon live-view output)' },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
