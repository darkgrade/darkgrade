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
        setFocusPoint: {
            area: 'focus',
            disposition: { kind: 'keep' },
            summary: 'Focuses on a point in the picture; 0–1 from the top-left',
            parameters: [
                { name: 'x', type: 'number', required: true, description: '0–1 from the left' },
                { name: 'y', type: 'number', required: true, description: '0–1 from the top' },
                { name: 'autofocus', type: 'switch', default: true, description: 'focus there; off only moves the focus point' },
            ],
        },
        resetFocusPoint: {
            area: 'focus',
            disposition: { kind: 'keep' },
            summary: 'Back to the centre and the previous focus area',
        },
        nudgeFocus: {
            area: 'focus',
            disposition: { kind: 'keep' },
            summary: 'Moves manual focus a little, like the < << <<< buttons in vendor remote apps',
            parameters: [
                { name: 'direction', type: 'choice', choices: ['near', 'far'], required: true, description: 'near or far' },
                { name: 'size', type: 'choice', choices: ['small', 'medium', 'large'], required: true, description: 'small, medium or large' },
            ],
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
