import { identifyCamera } from '@camera/identification/camera-identification'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'
/**
 * Applies a usbmon capture (pcapng or pcap) to a captured camera profile: GetDeviceInfo and
 * GetDevicePropDesc responses become the profile's DeviceInfo and descriptors, and every other
 * complete transaction and event is kept as a recorded exchange. Shared by the test-bench ingest and
 * the standalone `compat:ingest`.
 */
import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { createPTPRegistry } from '@ptp/registry'
import { extractCapture, type CapturedTransaction } from '@scripts/camera-profiles/usbmon-capture'
import {
    formatBytes,
    formatCode,
    parseCode,
    type CameraProfile,
    type ProfileSource,
    type RecordedEvent,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const STANDARD_PROPERTY_OPERATIONS = new Set([0x1014, 0x1015, 0x1016])
const STANDARD_CONTROL_PROPERTIES = new Set([
    0x5001, 0x5002, 0x5004, 0x5005, 0x5007, 0x5008, 0x5009, 0x500a, 0x500b, 0x500c, 0x500d, 0x500e, 0x500f, 0x5010,
    0x5012, 0x5013, 0x5014, 0x5015, 0x5016, 0x5017, 0x5018, 0x5019, 0x501a, 0x501b, 0x501c, 0x501d,
])
const registry = createPTPRegistry(true)

/** Scan original byte boundaries so serial redaction does not re-encode other captured fields. */
function withoutDeviceSerial(data: Uint8Array): Uint8Array {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const stringEnd = (offset: number) => {
        if (offset >= data.length) throw new Error('Truncated DeviceInfo string')
        const end = offset + 1 + data[offset] * 2
        if (end > data.length) throw new Error('Truncated DeviceInfo string')
        return end
    }
    let offset = stringEnd(8) + 2
    for (let array = 0; array < 5; array += 1) {
        if (offset + 4 > data.length) throw new Error('Truncated DeviceInfo array')
        const count = view.getUint32(offset, true)
        offset += 4 + count * 2
        if (offset > data.length) throw new Error('Truncated DeviceInfo array')
    }
    for (let field = 0; field < 3; field += 1) offset = stringEnd(offset)
    if (stringEnd(offset) !== data.length) throw new Error('Unexpected bytes after DeviceInfo serial')
    const sanitized = new Uint8Array(offset + 1)
    sanitized.set(data.subarray(0, offset))
    return sanitized
}

function modelKey(value: string, manufacturer: string): string {
    const name = value.trim().toLowerCase()
    const brand = manufacturer.trim().toLowerCase()
    return (name.startsWith(`${brand} `) ? name.slice(brand.length + 1) : name).replace(/[^a-z0-9]/g, '')
}

function assertCaptureIdentity(profile: CameraProfile, model: string, firmware: string): void {
    const names = [profile.model, profile.deviceInfo?.model, profile.catalog?.model].filter(
        (value): value is string => !!value
    )
    const exact = names.some(name => modelKey(name, profile.manufacturer) === modelKey(model, profile.manufacturer))
    const associated = profile.usb?.productIds.some(product => {
        const identity = identifyCamera({
            vendorId: parseCode(profile.usb!.vendorId),
            productId: parseCode(product),
            ptpModel: model,
        })
        return identity.status === 'matched' && identity.candidates[0].models.some(alias => names.includes(alias))
    })
    if (!exact && !associated) throw new Error(`Capture model ${model} does not match selected profile ${profile.id}`)
    const existingFirmware = profile.firmware ?? profile.deviceInfo?.deviceVersion
    if (existingFirmware && firmware && existingFirmware !== firmware)
        throw new Error(
            `Capture firmware ${firmware} differs from ${profile.id} firmware ${existingFirmware}; use a separate profile`
        )
}

/** Opaque vendor/media/authentication payloads stay in the private capture, not a shareable profile. */
function shareableExchange(transaction: CapturedTransaction, profile: CameraProfile): boolean {
    if (transaction.dataFromHost === undefined && transaction.response.data === undefined) return true
    if (
        transaction.operation === 0x941c &&
        profile.usb?.vendorId === '0x04b0' &&
        !transaction.dataFromHost &&
        transaction.response.data
    ) {
        new NikonEventDataCodec(registry).decode(transaction.response.data)
        return true
    }
    const property = transaction.parameters[0]
    return (
        STANDARD_PROPERTY_OPERATIONS.has(transaction.operation) &&
        STANDARD_CONTROL_PROPERTIES.has(property) &&
        (transaction.dataFromHost?.length ?? transaction.response.data?.length ?? 0) <= 16
    )
}

/** A profile and source registry. Capture exchanges are appended without deduplicating repeated replies. */
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
        raw: formatBytes(withoutDeviceSerial(data)),
        serialNumber: '',
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
    if (!extraction.transactions.length) throw new Error('Capture has no complete PTP transactions to ingest')
    const profile = builder.profile
    const information = extraction.transactions.filter(
        transaction =>
            transaction.operation === 0x1001 && transaction.response.code === 0x2001 && transaction.response.data
    )
    const decodedInformation = information.map(transaction => capturedDeviceInfo(transaction.response.data!))
    for (const info of decodedInformation) assertCaptureIdentity(profile, info.model, info.deviceVersion)
    if (new Set(decodedInformation.map(info => `${info.model}|${info.deviceVersion}`)).size > 1)
        throw new Error('Capture spans multiple model/firmware identities; split it into separate profiles')
    const location = `usbmon capture ${path.basename(file)} (sha256 ${digest})`
    if (profile.provenance.sources.some(source => source.location === location)) return
    const source = builder.addSource({
        location,
        excerpt:
            'DeviceInfo serial redacted; media and opaque vendor/authentication payloads excluded. Repeated exchanges retain captured order.',
    })
    let excludedPayloads = 0
    const hex = (values: number[]) => values.map(value => formatCode(value, 1))

    for (const transaction of extraction.transactions) {
        const ok = transaction.response.code === 0x2001
        if (transaction.operation === 0x1001 && ok && transaction.response.data) {
            const info = capturedDeviceInfo(transaction.response.data)
            profile.deviceInfo = { ...profile.deviceInfo, ...info, source }
            if (info.deviceVersion) profile.firmware = info.deviceVersion
            continue
        }
        const propertyCode = transaction.parameters[0]
        if (transaction.operation === 0x1014 && ok && transaction.response.data && propertyCode !== undefined) {
            const parsed = new DevicePropDescCodec(registry).decode(transaction.response.data)
            if (parsed.value.devicePropertyCode !== propertyCode)
                throw new Error('Captured descriptor property differs from request')
            if (
                !STANDARD_CONTROL_PROPERTIES.has(propertyCode) ||
                parsed.value.dataType < 1 ||
                parsed.value.dataType > 10 ||
                parsed.bytesRead !== transaction.response.data.length
            ) {
                excludedPayloads += 1
                continue
            }
            const code = formatCode(propertyCode)
            const property = profile.properties.find(candidate => candidate.code === code)
            const descriptor = { raw: formatBytes(transaction.response.data) }
            if (property) Object.assign(property, { descriptor, source })
            else profile.properties.push({ code, descriptor, source })
            continue
        }
        if (!shareableExchange(transaction, profile)) {
            excludedPayloads += 1
            continue
        }
        // A scalar Get/Set exchange without a descriptor is useful partial evidence. Keep its exact bytes.
        profile.exchanges.push({
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
            `${extraction.skippedIncomplete} incomplete and ${excludedPayloads} opaque/private payload exchanges skipped from ${path.basename(file)}`
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
