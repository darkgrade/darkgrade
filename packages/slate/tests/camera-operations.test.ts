import { surfaceOperation } from '@runtime/operations'
import { describe, expect, it } from 'vitest'

describe('generated camera operations', () => {
    it("reads inputs from Camera's signatures and summaries from its doc comments", () => {
        expect(surfaceOperation('setFocusPoint')?.parameters).toEqual([
            expect.objectContaining({ name: 'x', type: 'number', required: true, argument: 0 }),
            expect.objectContaining({ name: 'y', type: 'number', required: true, argument: 1 }),
            expect.objectContaining({ name: 'autofocus', type: 'switch', argument: 2, property: 'autofocus' }),
        ])
        expect(surfaceOperation('takePhoto')?.parameters.find(parameter => parameter.name === 'destination')?.choices).toEqual([
            'card',
            'computer',
        ])
        expect(surfaceOperation('setColorTemperature')?.parameters).toEqual([expect.objectContaining({ type: 'number', required: true })])
        expect(surfaceOperation('stopRecording')?.summary).toMatch(/^Stops, waits until a finished clip is on the card/)
        expect(surfaceOperation('getIso')?.summary).toBe('The current ISO')
    })
})
