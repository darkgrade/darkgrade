/**
 * Applies a usbmon capture (pcapng or pcap) to a captured camera profile: GetDeviceInfo and
 * GetDevicePropDesc responses become the profile's DeviceInfo and descriptors, and every other
 * complete transaction and event is kept as a recorded exchange. Shared by the test-bench ingest and
 * the standalone `compat:ingest`.
 */
import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { createPTPRegistry } from '@ptp/registry'
import {
    formatBytes,
    formatCode,
    type CameraProfile,
    type ProfileSource,
    type RecordedEvent,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { extractCapture } from './usbmon-capture'

const STANDARD_PROPERTY_OPERATIONS = new Set([0x1014, 0x1015, 0x1016])

/** A profile being built, with deduplicating source and exchange registration. */
export interface CaptureTarget {
    readonly profile: CameraProfile
    addSource(source: ProfileSource): number
    addExchange(exchange: RecordedExchange): void
}

/** The captured dataset plus its decoded lists, which are complete because they came from the camera. */
function capturedDeviceInfo(data: Uint8Array) {
    const decoded = new DeviceInfoCodec(createPTPRegistry(true)).decode(data).value
    const codes = (values: number[]) => values.map(value => formatCode(value))
    return {
        raw: formatBytes(data),
        manufacturer: decoded.manufacturer,
        model: decoded.model,
        deviceVersion: decoded.deviceVersion,
        vendorExtensionId: formatCode(decoded.vendorExtensionID, 8),
        operationsSupported: codes(decoded.operationsSupportedRaw),
        eventsSupported: codes(decoded.eventsSupportedRaw),
        devicePropertiesSupported: codes(decoded.devicePropertiesSupported),
        listsComplete: true,
    }
}

export function applyCapture(builder: CaptureTarget, file: string, address?: { bus: number; address: number }): void {
    const bytes = new Uint8Array(readFileSync(file))
    const digest = createHash('sha256').update(bytes).digest('hex')
    const extraction = extractCapture(bytes, address)
    const source = builder.addSource({ location: `usbmon capture ${path.basename(file)} (sha256 ${digest})` })
    const profile = builder.profile
    const hex = (values: number[]) => values.map(value => formatCode(value, 1))

    for (const transaction of extraction.transactions) {
        const ok = transaction.response.code === 0x2001
        if (transaction.operation === 0x1001 && ok && transaction.response.data) {
            profile.deviceInfo = { ...profile.deviceInfo, ...capturedDeviceInfo(transaction.response.data), source }
            continue
        }
        const propertyCode = transaction.parameters[0]
        if (transaction.operation === 0x1014 && ok && transaction.response.data && propertyCode !== undefined) {
            const code = formatCode(propertyCode)
            const property = profile.properties.find(candidate => candidate.code === code)
            const descriptor = { raw: formatBytes(transaction.response.data) }
            if (property) Object.assign(property, { descriptor, source })
            else profile.properties.push({ code, descriptor, source })
            continue
        }
        if (STANDARD_PROPERTY_OPERATIONS.has(transaction.operation) && ok) continue
        builder.addExchange({
            operation: formatCode(transaction.operation),
            parameters: hex(transaction.parameters),
            ...(transaction.dataFromHost && { dataFromHost: formatBytes(transaction.dataFromHost) }),
            response: {
                code: formatCode(transaction.response.code),
                ...(transaction.response.parameters.length && { parameters: hex(transaction.response.parameters) }),
                ...(transaction.response.data && { data: formatBytes(transaction.response.data) }),
            },
            source,
        })
    }
    for (const event of extraction.events) {
        if (event.afterOperation === undefined) continue
        const recorded: RecordedEvent = {
            code: formatCode(event.code),
            parameters: hex(event.parameters),
            afterOperation: formatCode(event.afterOperation),
            source,
        }
        if (!profile.events.some(existing => JSON.stringify(existing) === JSON.stringify(recorded)))
            profile.events.push(recorded)
    }
    console.log(
        `${profile.id}: ${extraction.transactions.length} complete transactions, ${extraction.events.length} events, ` +
            `${extraction.skippedIncomplete} incomplete skipped from ${path.basename(file)}`
    )
}

/** Fixed key order so regenerated profiles diff cleanly. */
export function canonicalOrder(profile: CameraProfile): CameraProfile {
    const { schemaVersion, id, manufacturer, line, model, usb, firmware, catalog, provenance, deviceInfo } = profile
    return {
        schemaVersion,
        id,
        manufacturer,
        line,
        model,
        ...(usb && { usb }),
        ...(firmware && { firmware }),
        ...(catalog && { catalog }),
        provenance,
        ...(deviceInfo && { deviceInfo }),
        properties: profile.properties,
        exchanges: profile.exchanges,
        events: profile.events,
        quirks: profile.quirks,
    }
}
