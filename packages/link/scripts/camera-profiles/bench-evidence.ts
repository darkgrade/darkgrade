import {
    validateCameraProfile,
    type CameraProfile,
    type ProfileProperty,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'

interface BenchObservation {
    profile: string
    usb: string
    ptpResponsive: true
    summary: string
    reportedIdentity: string
    firmware: string
    operationsSupported: string[]
    usbDescriptor?: { manufacturerString: string; productString: string }
    exchanges: Array<Omit<RecordedExchange, 'source'>>
    properties: Array<Pick<ProfileProperty, 'code' | 'name' | 'observedValue'>>
}

const setupOperations = new Set(['0x1002', '0x1003', '0x9114', '0x9115'])

function exactParameters(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.length <= 5 &&
        value.every(word => typeof word === 'string' && /^0x[0-9a-f]{1,8}$/.test(word))
    )
}

function observationIn(document: unknown): BenchObservation[] {
    const record = document as { schemaVersion?: unknown; cameras?: unknown }
    if (record?.schemaVersion !== 1 || !Array.isArray(record.cameras))
        throw new Error('Expected sanitized bench evidence schemaVersion 1 and cameras array')
    return record.cameras.map(value => {
        if (!value || typeof value !== 'object') throw new Error('Invalid bench observation')
        for (const field of ['profile', 'usb', 'summary', 'reportedIdentity', 'firmware'])
            if (typeof value[field] !== 'string' || !value[field]) throw new Error(`Bench evidence is missing ${field}`)
        if (
            value.ptpResponsive !== true ||
            !Array.isArray(value.operationsSupported) ||
            !Array.isArray(value.exchanges) ||
            !Array.isArray(value.properties)
        )
            throw new Error('Bench evidence requires a responsive PTP probe, operations, exchanges and properties')
        for (const exchange of value.exchanges) {
            if (
                !exchange ||
                typeof exchange !== 'object' ||
                !exactParameters(exchange.parameters) ||
                !exactParameters(exchange.response?.parameters) ||
                typeof exchange.response?.code !== 'string' ||
                !/^0x[0-9a-f]{4}$/.test(exchange.response.code)
            )
                throw new Error(
                    'Sanitized bench exchanges require exact request/response parameter arrays and response codes'
                )
            if (
                !setupOperations.has(exchange.operation) ||
                exchange.dataFromHost !== undefined ||
                exchange.response?.data !== undefined ||
                exchange.responseData !== undefined
            )
                throw new Error('Sanitized bench evidence accepts only setup exchanges without data payloads')
        }
        return value as BenchObservation
    })
}

/** Applies sanitized read-only probe facts and exact no-data setup exchanges without importing identity-bearing raw datasets. */
export function applyBenchEvidence(profiles: CameraProfile[], document: unknown, location: string): void {
    for (const observed of observationIn(document)) {
        const profile = profiles.find(candidate => candidate.id === observed.profile)
        if (!profile) throw new Error(`Unknown bench evidence profile ${observed.profile}`)
        const identities = profile.usb?.productIds.map(
            product => `${profile.usb!.vendorId.slice(2)}:${product.slice(2)}`
        )
        if (!identities?.includes(observed.usb))
            throw new Error(`Bench evidence USB identity does not match ${profile.id}`)
        const hasCompleteDataset = profile.deviceInfo?.raw !== undefined || profile.deviceInfo?.listsComplete === true
        if (hasCompleteDataset && (profile.firmware ?? profile.deviceInfo?.deviceVersion) !== observed.firmware)
            throw new Error(`Cannot combine different firmware datasets for ${profile.id}`)
        const source = { location: `${location}#${profile.id}`, excerpt: observed.summary }
        let sourceIndex = profile.provenance.sources.findIndex(
            candidate => candidate.location === source.location && candidate.excerpt === source.excerpt
        )
        if (sourceIndex < 0) sourceIndex = profile.provenance.sources.push(source) - 1
        profile.firmware = observed.firmware
        if (observed.usbDescriptor && profile.usb) {
            const { manufacturerString, productString } = observed.usbDescriptor
            if (typeof manufacturerString !== 'string' || typeof productString !== 'string')
                throw new Error('Invalid USB descriptor strings')
            Object.assign(profile.usb, { manufacturerString, productString, source: sourceIndex })
        }
        if (!hasCompleteDataset)
            profile.deviceInfo = {
                reportedIdentity: observed.reportedIdentity,
                deviceVersion: observed.firmware,
                operationsSupported: observed.operationsSupported,
                listsComplete: false,
                source: sourceIndex,
            }
        for (const property of observed.properties) {
            const safe = {
                code: property.code,
                name: property.name,
                observedValue: property.observedValue,
                source: sourceIndex,
            }
            const existing = profile.properties.find(candidate => candidate.code === safe.code)
            if (existing) Object.assign(existing, safe)
            else profile.properties.push(safe)
        }
        for (const exchange of observed.exchanges) {
            const safe: RecordedExchange = {
                operation: exchange.operation,
                parameters: exchange.parameters,
                response: { code: exchange.response.code, parameters: exchange.response.parameters },
                note: 'Exact captured request/response; no missing data phase inferred.',
                source: sourceIndex,
            }
            if (!profile.exchanges.some(candidate => JSON.stringify(candidate) === JSON.stringify(safe)))
                profile.exchanges.push(safe)
        }
        const problems = validateCameraProfile(profile)
        if (problems.length) throw new Error(`${profile.id}: invalid bench evidence: ${problems.join('; ')}`)
    }
}
