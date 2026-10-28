import { labMatrix, loadRegistry, validateRegistry, type CameraRegistry } from '@scripts/camera-lab/camera-registry'
import { describe, expect, it } from 'vitest'

const registry = loadRegistry()

describe('camera-lab/cameras.lab.json', () => {
    it('is valid and matches its captured profiles', () => {
        expect(validateRegistry(registry)).toEqual([])
    })

    it('schedules each enabled camera on its host runner with a bench:probe identity', () => {
        const entries = labMatrix(registry)
        expect(entries.map(entry => entry.camera)).toEqual(
            registry.cameras
                .filter(camera => camera.enabled)
                .map(camera => camera.id)
                .sort((left, right) => {
                    const host = (id: string) => registry.cameras.find(camera => camera.id === id)!.host!
                    return host(left).localeCompare(host(right)) || left.localeCompare(right)
                })
        )
        for (const entry of entries) {
            expect(entry.usb).toMatch(/^[0-9a-f]{4}:[0-9a-f]{4}$/)
            expect(registry.hosts.map(host => host.runnerLabel)).toContain(entry.runner)
        }
    })

    it('rejects unknown hosts, missing profiles and enabled cameras without a bench label', () => {
        const broken: CameraRegistry = structuredClone(registry)
        broken.cameras[0] = { ...broken.cameras[0], host: 'nowhere', benchLabel: null, profile: 'missing.json' }
        const problems = validateRegistry(broken)
        expect(problems.some(problem => problem.includes('unknown host nowhere'))).toBe(true)
        expect(problems.some(problem => problem.includes('needs a host and a bench label'))).toBe(true)
        expect(problems.some(problem => problem.includes('missing.json does not exist'))).toBe(true)
    })

    it('rejects a USB identity that is not in the camera profile', () => {
        const broken: CameraRegistry = structuredClone(registry)
        broken.cameras[0] = { ...broken.cameras[0], usb: { ...broken.cameras[0].usb!, productId: '0xffff' } }
        expect(validateRegistry(broken).some(problem => problem.includes('0xffff is not in profile'))).toBe(true)
    })
})
