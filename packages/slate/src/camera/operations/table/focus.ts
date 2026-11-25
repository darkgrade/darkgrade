import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The focus area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const focusOperationTable = {
    current: {
        autofocus: {
            area: 'focus',
            disposition: { kind: 'keep' },
            summary: 'Focuses once, and says whether the camera confirmed focus',
        },
        nikonAutofocus: {
            area: 'focus',
            disposition: { kind: 'replaced-by', target: 'autofocus' },
        },
        nikonTouchFocus: {
            area: 'focus',
            disposition: { kind: 'replaced-by', target: 'setFocusPoint' },
        },
        nikonDriveFocus: {
            area: 'focus',
            disposition: { kind: 'replaced-by', target: 'nudgeFocus' },
        },
        sonyTouchFocus: {
            area: 'focus',
            disposition: { kind: 'replaced-by', target: 'setFocusPoint' },
        },
        setSonyAfAreaPosition: {
            area: 'focus',
            disposition: { kind: 'replaced-by', target: 'setFocusPoint' },
        },
        setCanonLiveViewFramePoint: {
            area: 'focus',
            disposition: { kind: 'replaced-by', target: 'setFocusPoint' },
        },
    },
    planned: {
        setFocusPoint: {
            area: 'focus',
            disposition: { kind: 'add' },
            summary: 'Focuses on a point in the picture; 0–1 from the top-left',
            surfaces: {
                cli: {
                    arguments: [{ name: 'x', description: '0–1 from the left' }, { name: 'y', description: '0–1 from the top' }],
                    flags: [{
                        name: '--no-autofocus',
                        description: 'move the focus point without focusing',
                    }],
                },
            },
        },
        resetFocusPoint: {
            area: 'focus',
            disposition: { kind: 'add' },
            summary: 'Back to the centre and the previous focus area',
        },
        nudgeFocus: {
            area: 'focus',
            disposition: { kind: 'add' },
            summary: 'Moves manual focus a little, like the < << <<< buttons in vendor remote apps',
            surfaces: {
                cli: {
                    arguments: [{ name: 'direction', description: 'near or far' }, { name: 'size', description: 'small, medium or large' }],
                },
            },
        },
    },
} as const satisfies AreaOperationTable
