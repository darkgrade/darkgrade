import { surfaceOperation } from '@runtime/operations'
import { cameraOperationsPath, cameraOperationsSource } from '@scripts/generate-camera-operations'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('the source tree', () => {
    // Matrix and the bench CI build a candidate's `src` alone and never run its scripts.
    it('builds from src alone: every aliased import resolves inside src', () => {
        const root = join(import.meta.dirname, '..')
        const tsconfig: { compilerOptions: { paths: Record<string, string[]> } } = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
        const paths = Object.entries(tsconfig.compilerOptions.paths).map(([alias, [target]]) => [
            alias.replace(/\*$/, ''),
            target!.replace(/\*$/, ''),
        ])
        const outside: string[] = []
        for (const file of readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' }).filter(name => /\.tsx?$/.test(name))) {
            for (const [, specifier] of readFileSync(join(root, 'src', file), 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](@[^'"]+)['"]/g)) {
                const mapping = paths.find(([alias]) => specifier!.startsWith(alias!))
                if (mapping && !mapping[1]!.startsWith('src/')) outside.push(`${file}: ${specifier}`)
            }
        }
        expect(outside).toEqual([])
    })

    it('carries the operation list the generator writes from Camera today', { timeout: 60_000 }, () => {
        expect(readFileSync(cameraOperationsPath, 'utf8')).toBe(cameraOperationsSource())
    })
})
