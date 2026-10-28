/** Builds the runtime USB lookup from cited catalog entries and model profiles, with no hardware access. */
import type { CameraIdentityCandidate, CameraProfileEvidence } from '@camera/identification/camera-identification'
import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import { loadCameraProfile } from '@transport/simulated/camera-profile'
import { encodeDeviceInfo } from '@transport/simulated/ptp-dataset-encoding'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(packageDirectory, 'src/camera/identification/camera-identities.json')
const table: Record<string, CameraIdentityCandidate[]> = {}
const keyOf = (vendor: string, product: string) =>
    [vendor, product].map(value => Number(value).toString(16).padStart(4, '0')).join(':')
const filesIn = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap(entry =>
            entry.isDirectory()
                ? filesIn(path.join(directory, entry.name))
                : entry.name.endsWith('.json')
                  ? [path.join(directory, entry.name)]
                  : []
        )

for (const manufacturer of loadCatalog().manufacturers) {
    for (const line of manufacturer.lines) {
        for (const model of line.models) {
            if (!model.usbVendorId || !model.usbProductId) continue
            const key = keyOf(model.usbVendorId, model.usbProductId)
            const candidate: CameraIdentityCandidate = {
                manufacturer: manufacturer.name,
                line: line.name,
                models: [model.name],
                sources: [model.source],
                profiles: [],
            }
            ;(table[key] ??= []).push(candidate)
        }
    }
}
for (const file of filesIn(path.join(packageDirectory, 'camera-profiles'))) {
    const profile = loadCameraProfile(readFileSync(file, 'utf8'), file)
    if (!profile.usb || profile.id.endsWith('-documented')) continue
    const evidence: CameraProfileEvidence = {
        profileId: profile.id,
        fidelity: profile.provenance.fidelity,
        ...(profile.firmware && { firmware: profile.firmware }),
        deviceInfo:
            profile.deviceInfo?.raw !== undefined
                ? 'raw'
                : profile.deviceInfo && encodeDeviceInfo(profile.deviceInfo)
                  ? 'parsed'
                  : profile.deviceInfo
                    ? 'partial'
                    : 'absent',
        advertisedOperationCount: profile.deviceInfo?.operationsSupported?.length ?? 0,
        exchangeCount: profile.exchanges.length,
        descriptorCount: profile.properties.filter(property => !!property.descriptor).length,
        simulatedQuirkCount: profile.quirks.filter(quirk => quirk.behaviour.kind !== 'none' && !quirk.unverified)
            .length,
        sources: profile.provenance.sources.map(source => source.location),
    }
    for (const product of profile.usb.productIds) {
        const candidates = (table[keyOf(profile.usb.vendorId, product)] ??= [])
        const manufacturer = profile.catalog?.manufacturer ?? profile.manufacturer
        const sameLine = candidates.filter(
            candidate => candidate.manufacturer === manufacturer && candidate.line === profile.catalog?.line
        )
        const candidate = sameLine.length === 1 ? sameLine[0] : undefined
        const aliases = [profile.model, profile.deviceInfo?.model, profile.usb.productString].filter(
            (value): value is string => !!value
        )
        if (candidate) {
            candidate.models = [...new Set([...candidate.models, ...aliases])]
            candidate.profiles.push(evidence)
        } else
            candidates.push({
                manufacturer,
                line: profile.catalog?.line ?? profile.line,
                models: aliases,
                sources: evidence.sources,
                profiles: [evidence],
            })
    }
}
const json =
    JSON.stringify(
        Object.fromEntries(Object.entries(table).sort(([left], [right]) => left.localeCompare(right))),
        null,
        2
    ) + '\n'
if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== json) throw new Error('Camera identities are stale; run cameras:build')
} else writeFileSync(output, json)
console.log(`${Object.keys(table).length} USB identities ${process.argv.includes('--check') ? 'checked' : 'generated'}`)
