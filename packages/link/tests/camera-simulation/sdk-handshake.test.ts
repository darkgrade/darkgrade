import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import { catalogModelMocks } from '@scripts/camera-profiles/documented-profile'
import { validateCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import { QuirkBehaviours } from '@transport/simulated/quirk-behaviours'
import { ProfileDataMissingError, SimulatedTransport } from '@transport/simulated/simulated-transport'
import { describe, expect, it } from 'vitest'

const sequence = [1, 2, 3].map(phase => ({ operation: '0x9201', parameters: [`0x${phase}`, '0x0', '0x0'] }))
const behaviour = {
    kind: 'requires-sequence' as const,
    sequence,
    gated: { from: '0x9200', to: '0x92ff', except: ['0x9201', '0x9202'] },
}
const request = (phase: number) => ({ operation: 0x9201, parameters: [phase, 0, 0], transactionId: phase })

describe('SDK initialization prerequisites', () => {
    it('counts exact ordered successful requests and resets session prerequisites', () => {
        const quirks = new QuirkBehaviours([behaviour])
        expect(quirks.hasUnknownSequenceResponse(request(3))).toBe(true)
        quirks.afterReply(request(1), 0x2019)
        expect(quirks.hasUnknownSequenceResponse(request(2))).toBe(true)
        quirks.afterReply({ ...request(1), parameters: [1, 7, 0] }, 0x2001)
        expect(quirks.hasUnknownSequenceResponse(request(2))).toBe(true)
        quirks.afterReply(request(1), 0x2001)
        expect(quirks.hasUnknownSequenceResponse(request(2))).toBe(false)
        expect(quirks.hasUnknownSequenceResponse(request(3))).toBe(true)
        quirks.afterReply({ operation: 0x1001, parameters: [], transactionId: 4 }, 0x2001)
        quirks.afterReply(request(2), 0x2001)
        quirks.afterReply(request(3), 0x2001)
        const control = { operation: 0x9207, parameters: [], transactionId: 5 }
        expect(quirks.hasUnknownSequenceResponse(control)).toBe(false)
        quirks.afterReply({ operation: 0x1003, parameters: [], transactionId: 6 }, 0x2001)
        expect(quirks.hasUnknownSequenceResponse(control)).toBe(true)
        quirks.afterReply(request(1), 0x2001)
        quirks.reset()
        expect(quirks.hasUnknownSequenceResponse(request(2))).toBe(true)
    })

    it('reports missing evidence instead of inventing a camera rejection code', async () => {
        const profile: CameraProfile = {
            schemaVersion: 1,
            id: 'sdk-mechanics',
            manufacturer: 'Fixture',
            line: 'Test',
            model: 'Fixture',
            provenance: {
                fidelity: 'documented',
                sources: [{ location: 'tests/camera-simulation/sdk-handshake.test.ts' }],
            },
            properties: [],
            events: [],
            exchanges: [{ operation: '0x9207', response: { code: '0x2001' }, source: 0 }],
            quirks: [{ id: 'sequence', description: 'mechanics fixture', source: 0, behaviour }],
        }
        const transport = new SimulatedTransport(profile)
        await transport.connect()
        const bytes = new Uint8Array(12)
        const view = new DataView(bytes.buffer)
        view.setUint32(0, 12, true)
        view.setUint16(4, 1, true)
        view.setUint16(6, 0x9207, true)
        await transport.send(bytes, 1, 1)
        await expect(transport.receive(512, 1, 1)).rejects.toBeInstanceOf(ProfileDataMissingError)
        expect(transport.responseCodes).toEqual([])
        expect(transport.missingData).toHaveLength(1)
        const invalid = structuredClone(profile)
        invalid.quirks[0].behaviour = { ...behaviour, sequence: [] }
        expect(validateCameraProfile(invalid)).toContain(
            'quirks[0].behaviour.sequence must contain at least one request'
        )
    })

    it('applies parameter-sensitive phases only to the reviewed Sony models', () => {
        const profiles = catalogModelMocks(loadCatalog()).mocks.map(entry => entry.profile)
        const reviewed = profiles.filter(
            profile => profile.manufacturer === 'Sony' && /\b(?:A6700|ILCE-6700|FX2|ILME-FX2)\b/i.test(profile.model)
        )
        expect(reviewed.length).toBeGreaterThanOrEqual(2)
        for (const profile of reviewed) {
            expect(validateCameraProfile(profile)).toEqual([])
            expect(profile.quirks.find(quirk => quirk.id === 'sony-sdio-connect-handshake')?.behaviour.kind).toBe(
                'requires-sequence'
            )
            expect(
                profile.exchanges
                    .filter(exchange => exchange.operation === '0x9201')
                    .map(exchange => exchange.parameters)
            ).toEqual(sequence.map(step => step.parameters))
        }
        const other = profiles.find(profile => profile.manufacturer === 'Sony' && profile.model.includes('ILCE-7RM5'))
        expect(other?.quirks.some(quirk => quirk.behaviour.kind === 'requires-sequence')).toBe(false)
    })
})
