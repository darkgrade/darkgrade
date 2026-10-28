import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { createPTPRegistry } from '@ptp/registry'
import { applyCapture, type CaptureTarget } from '@scripts/camera-profiles/capture-ingest'
import { ingestResults } from '@scripts/camera-profiles/standalone-ingest'
import { extractCapture } from '@scripts/camera-profiles/usbmon-capture'
import { parseBytes, type CameraProfile } from '@transport/simulated/camera-profile'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { container, pcapng, urb } from './usbmon-fixture'

const scratch = mkdtempSync(path.join(tmpdir(), 'camera-capture-audit-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const join = (...chunks: Uint8Array[]) => Uint8Array.from(chunks.flatMap(chunk => [...chunk]))
const deviceInfoCodec = new DeviceInfoCodec(createPTPRegistry(true))
function deviceInfo(model = 'EOS R6', firmware = '1.0.0') {
    return deviceInfoCodec.encode({
        standardVersion: 100,
        vendorExtensionID: 0xb,
        vendorExtensionVersion: 100,
        vendorExtensionDesc: 'Canon',
        functionalMode: 0,
        operationsSupportedRaw: [0x1001, 0x1002, 0x1003],
        operationsSupportedDecoded: [],
        eventsSupportedRaw: [],
        eventsSupportedDecoded: [],
        devicePropertiesSupported: [],
        devicePropertiesSupportedDecoded: [],
        captureFormats: [],
        imageFormatsRaw: [],
        imageFormatsDecoded: [],
        manufacturer: 'Canon',
        model,
        deviceVersion: firmware,
        serialNumber: 'SYNTHETIC-PRIVATE-SERIAL',
    })
}
function profile(): CameraProfile {
    return {
        schemaVersion: 1,
        id: 'canon-eos-r6',
        manufacturer: 'Canon',
        line: 'EOS R',
        model: 'EOS R6',
        usb: { vendorId: '0x04a9', productIds: ['0x32f5'] },
        provenance: { fidelity: 'captured', sources: [{ location: 'synthetic capture fixture' }] },
        properties: [],
        exchanges: [],
        events: [],
        quirks: [],
    }
}
function target(value = profile()): CaptureTarget {
    return {
        profile: value,
        addSource(source) {
            return value.provenance.sources.push(source) - 1
        },
        addExchange(exchange) {
            value.exchanges.push(exchange)
        },
    }
}
function trace(file: string, data = deviceInfo(), suffix: Uint8Array[] = []) {
    const location = path.join(scratch, file)
    writeFileSync(
        location,
        pcapng([
            urb('S', 2, container(1, 0x1001, 1)),
            urb('C', 0x81, container(2, 0x1001, 1, [], data)),
            urb('C', 0x81, container(3, 0x2001, 1)),
            ...suffix,
        ])
    )
    return location
}

describe('capture evidence integrity', () => {
    it('redacts the serial in raw DeviceInfo while preserving other captured byte boundaries', () => {
        const value = target()
        applyCapture(value, trace('serial.pcapng'))
        const bytes = parseBytes(value.profile.deviceInfo!.raw!)
        const decoded = deviceInfoCodec.decode(bytes).value
        expect(decoded.serialNumber).toBe('')
        expect(decoded.model).toBe('EOS R6')
        expect(value.profile.firmware).toBe('1.0.0')
        expect(bytes.slice(0, -1)).toEqual(deviceInfo().slice(0, -(1 + ('SYNTHETIC-PRIVATE-SERIAL'.length + 1) * 2)))
        expect(JSON.stringify(value.profile)).not.toContain('SYNTHETIC-PRIVATE-SERIAL')
    })

    it('rejects another model or firmware before adding facts to the selected profile', () => {
        for (const [model, firmware] of [
            ['EOS R5', '1.0.0'],
            ['EOS R6', '2.0.0'],
        ]) {
            const value = target({ ...profile(), firmware: '1.0.0' })
            const before = structuredClone(value.profile)
            expect(() =>
                applyCapture(value, trace(`wrong-${model}-${firmware}.pcapng`, deviceInfo(model, firmware)))
            ).toThrow(/model|firmware/)
            expect(value.profile).toEqual(before)
        }
    })

    it('retains repeated busy responses in trace order, excludes media and is idempotent', () => {
        const suffix = [0x2019, 0x2019, 0x2001].flatMap((code, index) => [
            urb('S', 2, container(1, 0x90c8, index + 2)),
            urb('C', 0x81, container(3, code, index + 2)),
        ])
        suffix.push(
            urb('S', 2, container(1, 0x1009, 5, [42])),
            urb('C', 0x81, container(2, 0x1009, 5, [], Uint8Array.of(1, 2, 3))),
            urb('C', 0x81, container(3, 0x2001, 5))
        )
        const location = trace('busy.pcapng', deviceInfo(), suffix)
        const value = target()
        applyCapture(value, location)
        expect(value.profile.exchanges.map(exchange => exchange.response.code)).toEqual(['0x2019', '0x2019', '0x2001'])
        const before = structuredClone(value.profile)
        applyCapture(value, location)
        expect(value.profile).toEqual(before)
    })

    it('reassembles split headers and coalesced data/response containers', () => {
        const command = container(1, 0x1001, 1)
        const data = Uint8Array.of(4, 5)
        const capture = pcapng([
            urb('S', 2, command.slice(0, 6)),
            urb('S', 2, command.slice(6)),
            urb('C', 0x81, join(container(2, 0x1001, 1, [], data), container(3, 0x2001, 1))),
        ])
        expect(extractCapture(capture, { bus: 2, address: 7 }).transactions[0].response.data).toEqual(data)
    })

    it('does not treat command-shaped payload bytes inside a fragmented data phase as a new request', () => {
        const payload = join(new Uint8Array(4), container(1, 0x1002, 99, [1]))
        const data = container(2, 0x95ff, 1, [], payload)
        const capture = pcapng([
            urb('S', 2, container(1, 0x95ff, 1)),
            urb('S', 2, data.slice(0, 16)),
            urb('S', 2, data.slice(16)),
            urb('C', 0x81, container(3, 0x2001, 1)),
        ])
        const parsed = extractCapture(capture)
        expect(parsed.transactions).toHaveLength(1)
        expect(parsed.transactions[0].operation).toBe(0x95ff)
        expect(parsed.transactions[0].dataFromHost).toEqual(payload)
    })

    it('refuses ambiguous camera selection and wrong data opcodes', () => {
        const records = [urb('S', 2, container(1, 0x1002, 1, [1])), urb('C', 0x81, container(3, 0x2001, 1))]
        const another = records.map(record => {
            const copy = record.slice()
            copy[11] = 8
            return copy
        })
        const capture = pcapng([...records, ...another])
        expect(() => extractCapture(capture)).toThrow('Multiple PTP devices')
        expect(extractCapture(capture, { bus: 2, address: 7 }).transactions).toHaveLength(1)
        const wrong = pcapng([
            urb('S', 2, container(1, 0x1001, 1)),
            urb('C', 0x81, container(2, 0x1009, 1, [], Uint8Array.of(1))),
            urb('C', 0x81, container(3, 0x2001, 1)),
        ])
        expect(extractCapture(wrong).transactions).toEqual([])
    })

    it('rejects malformed packet lengths and discards truncated interrupt events', () => {
        const malformed = pcapng([urb('S', 2, container(1, 0x1002, 1))])
        new DataView(malformed.buffer).setUint32(malformed.length - 4, 0, true)
        expect(() => extractCapture(malformed)).toThrow('trailer')
        const capture = pcapng([
            urb('S', 2, container(1, 0x1002, 1, [1])),
            urb('C', 0x81, container(3, 0x2001, 1)),
            urb('C', 0x83, container(4, 0x4006, 0, [0x5005]).slice(0, 12), { type: 1, length: 16 }),
        ])
        expect(extractCapture(capture).events).toEqual([])
    })
})

const imported = (firmware: string) => ({
    profile: 'canon-eos-r6',
    path: 'camera-profiles/example.json',
    manufacturer: 'Canon',
    line: 'EOS R',
    model: 'EOS R6',
    fidelity: 'hardware',
    firmware,
    quirks: { total: 0, simulated: 0, unverified: 0 },
    results: { session: { status: 'pass', detail: 'synthetic imported hardware fixture' } },
})
describe('hardware result ingestion boundaries', () => {
    it('preserves original dates and all firmware rows across repeat imports', () => {
        const file = path.join(scratch, 'hardware.json')
        const directory = path.join(scratch, 'hardware')
        writeFileSync(
            file,
            JSON.stringify({
                generatedAt: '2020-01-01T00:00:00Z',
                revision: 'original',
                rows: [imported('1.00'), imported('2.00')],
            })
        )
        const first = ingestResults(file, { hardwareDirectory: directory })
        expect(first.written).toHaveLength(1)
        const output = JSON.parse(readFileSync(first.written[0], 'utf8'))
        expect(output.rows).toHaveLength(2)
        expect(output.rows[0].source).toEqual({ generatedAt: '2020-01-01T00:00:00Z', revision: 'original' })
        ingestResults(file, { hardwareDirectory: directory })
        expect(JSON.parse(readFileSync(first.written[0], 'utf8')).rows).toHaveLength(2)
    })

    it('rejects path-shaped profile ids and incomplete progress logs', () => {
        const file = path.join(scratch, 'bad-result.json')
        writeFileSync(
            file,
            JSON.stringify({
                generatedAt: '2020-01-01T00:00:00Z',
                rows: [{ ...imported('1.00'), profile: '../../package' }],
            })
        )
        expect(() => ingestResults(file, { hardwareDirectory: scratch })).toThrow('safe lowercase')
        const partial = path.join(scratch, 'partial.jsonl')
        writeFileSync(
            partial,
            JSON.stringify({
                type: 'run-start',
                version: 1,
                source: 'hardware',
                runId: 'partial',
                pid: 1,
                at: '2020-01-01T00:00:00Z',
                capabilities: [],
                rows: [],
            }) + '\n'
        )
        expect(() => ingestResults(partial, { hardwareDirectory: scratch })).toThrow('no completed rows')
    })
})
