import { CanonCamera } from '@camera/canon-camera'
import { GenericCamera } from '@camera/generic-camera'
import { Logger } from '@core/logger'
import { GetDeviceInfo, GetDevicePropDesc } from '@ptp/definitions/operation-definitions'
import { createCanonRegistry } from '@ptp/registry'
import { applyBenchEvidence } from '@scripts/camera-profiles/bench-evidence'
import { evaluateCapabilities, simulateCamera } from '@scripts/camera-profiles/camera-capabilities'
import { loadCameraProfile, type RecordedExchange } from '@transport/simulated/camera-profile'
import { ProfileDataMissingError, SimulatedTransport } from '@transport/simulated/simulated-transport'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const packageDirectory = path.resolve(__dirname, '../..')
const evidence = JSON.parse(
    readFileSync(path.join(packageDirectory, 'docs/evidence/darkgrade01-2026-10-28.json'), 'utf8')
)
const workflowEvidence: { capturedScalarWriteExchanges: (Omit<RecordedExchange, 'source'> & { value: number })[] } =
    JSON.parse(readFileSync(path.join(packageDirectory, 'docs/evidence/darkgrade01-workflows-2026-10-28.json'), 'utf8'))
const profileFiles = [
    'canon/eos-dslr-eos-protocol-era/canon-eos-80d.json',
    'sony/alpha-aps-c-e-mount/sony-ilce-6700.json',
]

function capturedProfile(file: string) {
    return loadCameraProfile(readFileSync(path.join(packageDirectory, 'camera-profiles', file), 'utf8'))
}

function simulatedSession(file: string) {
    const profile = capturedProfile(file)
    const transport = new SimulatedTransport(profile)
    const camera = new GenericCamera(transport, new Logger({ captureConsole: false, renderInTerminal: false }))
    return { profile, transport, camera }
}

describe('fresh darkgrade01 evidence', () => {
    it.each(workflowEvidence.capturedScalarWriteExchanges)(
        'encodes observed Canon Kelvin $value bytes but refuses to invent missing cache readback',
        async exchange => {
            const profile = capturedProfile(profileFiles[0])
            const source = profile.provenance.sources.length
            profile.provenance.sources.push({
                location: 'docs/evidence/darkgrade01-workflows-2026-10-28.json',
            })
            profile.exchanges.push({
                operation: exchange.operation,
                parameters: exchange.parameters,
                dataFromHost: exchange.dataFromHost,
                response: exchange.response,
                source,
            })
            const transport = new SimulatedTransport(profile)
            const camera = new CanonCamera(transport, new Logger({ captureConsole: false, renderInTerminal: false }))
            // Isolate the production setter/encoder. Full Canon initialization is deliberately not
            // represented: this capture lacks DeviceInfo and the initial property-cache datasets.
            await GenericCamera.prototype.connect.call(camera)
            try {
                await expect(
                    camera.set(camera.registry.properties.CanonColorTemperature, exchange.value)
                ).rejects.toMatchObject({ operation: 0x9116 })
                expect(transport.missingData).toHaveLength(1)
                expect(transport.missingData[0].operation).toBe(0x9116)
                expect(transport.responseCodes.at(-1)).toBe(0x2001)
            } finally {
                await GenericCamera.prototype.disconnect.call(camera)
            }
            expect(transport.isConnected()).toBe(false)
        }
    )

    const establishedCapabilities = [
        {
            file: 'om-system-olympus/pen-compacts-tg/olympus-e-pl5.json',
            capability: 'session',
            evidence: 'docs/camera-compatibility.md',
            fact: 'Olympus OpenSession through GenericCamera on the physical MTP body',
        },
        {
            file: profileFiles[0],
            capability: 'recorded-exchanges',
            evidence: 'darkgrade01-2026-10-28.json',
            fact: 'EOS80D captured session and typed remote/event-mode setup requests',
        },
        {
            file: profileFiles[1],
            capability: 'recorded-exchanges',
            evidence: 'darkgrade01-2026-10-28.json',
            fact: 'alpha6700 captured generic OpenSession/CloseSession requests; no Sony full-connect claim',
        },
    ]
    it.each(establishedCapabilities)(
        'retains source-backed support: $fact',
        async ({ file, capability, evidence: citation, fact }) => {
            const profile = capturedProfile(file)
            expect(
                profile.provenance.sources.some(source => source.location.includes(citation)),
                fact
            ).toBe(true)
            const target = simulateCamera(profile)
            try {
                const results = await evaluateCapabilities(target)
                expect(results[capability], `${fact}; source: ${citation}`).toMatchObject({ status: 'pass' })
            } finally {
                await target.camera.disconnect().catch(() => undefined)
            }
        }
    )

    it('reconstructs both fresh profiles from the sanitized record and retains historical provenance', () => {
        const expected = profileFiles.map(capturedProfile)
        const profiles = structuredClone(expected)
        for (const profile of profiles) {
            const source = profile.provenance.sources.length - 1
            profile.provenance.sources.pop()
            profile.properties = profile.properties.filter(property => property.source !== source)
            profile.exchanges = profile.exchanges.filter(exchange => exchange.source !== source)
            delete profile.firmware
            delete profile.deviceInfo
            if (profile.usb) {
                delete profile.usb.manufacturerString
                delete profile.usb.productString
                profile.usb.source = 0
            }
        }
        const location = 'darkgrade/darkgrade:packages/link/docs/evidence/darkgrade01-2026-10-28.json'
        applyBenchEvidence(profiles, evidence, location)
        expect(profiles).toEqual(expected)
        applyBenchEvidence(profiles, evidence, location)
        expect(profiles).toEqual(expected)
    })

    it('rejects mismatched USB identities and data-bearing exchanges', () => {
        const mismatched = structuredClone(evidence)
        mismatched.cameras[0].usb = '04a9:ffff'
        expect(() => applyBenchEvidence(profileFiles.map(capturedProfile), mismatched, 'test')).toThrow('USB identity')
        const payload = structuredClone(evidence)
        payload.cameras[0].exchanges[0].response.data = '01'
        expect(() => applyBenchEvidence(profileFiles.map(capturedProfile), payload, 'test')).toThrow(
            'without data payloads'
        )
    })

    it.each(['request-parameters', 'response-parameters', 'response-code', 'invalid-code'])(
        'rejects incomplete exchange evidence: %s',
        missing => {
            const document = structuredClone(evidence)
            const exchange = document.cameras[0].exchanges[0]
            if (missing === 'request-parameters') delete exchange.parameters
            if (missing === 'response-parameters') delete exchange.response.parameters
            if (missing === 'response-code') delete exchange.response.code
            if (missing === 'invalid-code') exchange.response.code = '0x10000'
            expect(() => applyBenchEvidence(profileFiles.map(capturedProfile), document, 'test')).toThrow(
                'exact request/response'
            )
        }
    )

    it.each(profileFiles)(
        'replays the observed generic session while keeping unrecorded datasets unknown: %s',
        async file => {
            const { profile, transport, camera } = simulatedSession(file)
            const observed = evidence.cameras.find((item: { profile: string }) => item.profile === profile.id)
            expect(profile.deviceInfo?.operationsSupported).toEqual(observed.operationsSupported)
            expect(profile.firmware).toBe(observed.firmware)
            expect(profile.deviceInfo?.listsComplete).toBe(false)
            expect(profile.deviceInfo?.raw).toBeUndefined()
            expect(profile.deviceInfo?.serialNumber).toBeUndefined()

            try {
                await camera.connect()
                expect(transport.responseCodes.at(-1)).toBe(0x2001)
                await expect(camera.send(GetDeviceInfo, {})).rejects.toBeInstanceOf(ProfileDataMissingError)
                await expect(camera.send(GetDevicePropDesc, { DevicePropCode: 0x5001 })).rejects.toBeInstanceOf(
                    ProfileDataMissingError
                )
            } finally {
                await camera.disconnect()
            }
            expect(transport.responseCodes.at(-1)).toBe(0x2001)
            expect(transport.isConnected()).toBe(false)
        }
    )

    it('uses the captured EOS 80D remote/event mode parameters and leaves unobserved requests unknown', async () => {
        const { camera, transport } = simulatedSession(profileFiles[0])
        const registry = createCanonRegistry(true)
        try {
            await camera.connect()
            const remoteMode = await camera.send(registry.operations.CanonSetRemoteMode, { RemoteMode: 'ENABLE' })
            expect(remoteMode.code).toBe(0x2001)
            const eventMode = await camera.send(registry.operations.CanonSetEventMode, { EventMode: 'ENABLE' })
            expect(eventMode.code).toBe(0x2001)
            await expect(camera.send(registry.operations.CanonGetEventData, {})).rejects.toBeInstanceOf(
                ProfileDataMissingError
            )
            expect(transport.missingData).toHaveLength(1)
        } finally {
            await camera.disconnect()
        }
    })
})
