import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The zoom area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const zoomOperationTable = {
    current: {
        zoomTo: {
            area: 'zoom',
            disposition: { kind: 'keep' },
            summary: 'Zooms to a focal length ("go to 35") and returns where the lens landed',
            surfaces: {
                cli: {
                    arguments: [{ name: 'focalLength', description: 'millimetres, for example 35' }],
                },
            },
        },
        startZoom: {
            area: 'zoom',
            disposition: { kind: 'keep' },
            summary: 'Zooms until stopZoom, like holding a zoom rocker. Slate stops it by itself after 10 s',
            surfaces: {
                cli: { omitted: 'use zoom-to' },
            },
        },
        stopZoom: {
            area: 'zoom',
            disposition: { kind: 'keep' },
            summary: 'Stops zooming. Always allowed',
            surfaces: {
                cli: { omitted: 'use zoom-to' },
            },
        },
        getSonyZoomPosition: {
            area: 'zoom',
            disposition: {
                kind: 'replaced-by',
                target: 'getCapabilities',
                note: 'the lens focal length is in getCapabilities().lens',
            },
        },
        sonyStartZoom: {
            area: 'zoom',
            disposition: { kind: 'replaced-by', target: 'startZoom' },
        },
        sonyStopZoom: {
            area: 'zoom',
            disposition: { kind: 'replaced-by', target: 'stopZoom' },
        },
        sonyPowerZoom: {
            area: 'zoom',
            disposition: { kind: 'replaced-by', target: 'zoomTo' },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
