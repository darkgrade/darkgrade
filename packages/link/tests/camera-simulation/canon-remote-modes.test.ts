import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import { createCanonRegistry } from '@ptp/registry'
import { loadCameraProfile } from '@transport/simulated/camera-profile'
import { SimulatedTransport } from '@transport/simulated/simulated-transport'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const registry = createCanonRegistry(true)
const operation = registry.operations.CanonSetRemoteMode
const codec = operation.operationParameters[0].codec(registry)
const profileDirectory = path.resolve(__dirname, '../../camera-profiles')

describe('explicit Canon remote mode aliases', () => {
    it('retains ENABLE/DISABLE and encodes caller-selected modes without accepting arbitrary numbers', () => {
        expect(codec.encode('ENABLE')).toEqual(Uint8Array.of(1, 0, 0, 0))
        expect(codec.encode('DISABLE')).toEqual(Uint8Array.of(0, 0, 0, 0))
        expect(codec.encode('ENABLE_MODE_5')).toEqual(Uint8Array.of(5, 0, 0, 0))
        expect(codec.encode('ENABLE_MODE_0X15')).toEqual(Uint8Array.of(0x15, 0, 0, 0))
        // The runtime boundary must reject unknown numeric values even from untyped callers.
        expect(() => Reflect.apply(codec.encode.bind(codec), codec, [0x1234])).toThrow('Invalid enum value')
    })

    it.each([
        ['canon/eos-r/canon-eos-r6-mark-iii.json', 'ENABLE_MODE_5', '0x5', 'captured'],
        ['canon/eos-m/canon-eos-m-documented.json', 'ENABLE_MODE_0X15', '0x15', 'documented'],
    ] as const)(
        'matches the cited %s exchange through the public typed operation',
        async (file, mode, parameter, fidelity) => {
            const profile = loadCameraProfile(readFileSync(path.join(profileDirectory, file), 'utf8'), file)
            const exchange = profile.exchanges.find(
                exchange => exchange.operation === '0x9114' && exchange.parameters?.[0] === parameter
            )
            expect(profile.provenance.fidelity).toBe(fidelity)
            expect(exchange?.response.code).toBe('0x2001')
            if (!exchange) throw new Error(`Missing cited mode ${parameter}`)
            expect(profile.provenance.sources[exchange.source].location).toBeTruthy()
            const transport = new SimulatedTransport(profile)
            const camera = new GenericCamera(transport, new Logger({ renderInTerminal: false, captureConsole: false }))
            try {
                await transport.connect()
                const response = await camera.send(operation, { RemoteMode: mode })
                expect(response.code).toBe(0x2001)
                expect(transport.missingData).toEqual([])
            } finally {
                await transport.disconnect()
            }
        }
    )
})
