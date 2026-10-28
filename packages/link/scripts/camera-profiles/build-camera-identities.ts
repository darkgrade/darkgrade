/** Builds the runtime USB lookup from cited catalog entries and model profiles, with no hardware access. */
import type { CameraIdentityCandidate, CameraProfileEvidence } from '@camera/identification/camera-identification'
import { loadCatalog, type CameraCatalog } from '@scripts/camera-profiles/camera-catalog'
import { loadCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import { encodeDeviceInfo } from '@transport/simulated/ptp-dataset-encoding'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.join(packageDirectory, 'src/camera/identification/camera-identities.json')
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

const normalizeModel = (model: string) => model.trim().toLowerCase().replace(/\s+/g, ' ')

/** Profile evidence joins a catalog model only through an exact alias or an explicit catalog reference. */
export function buildCameraIdentityTable(
    catalog: CameraCatalog,
    profiles: CameraProfile[]
): Record<string, CameraIdentityCandidate[]> {
    const table: Record<string, CameraIdentityCandidate[]> = {}
    for (const manufacturer of catalog.manufacturers) {
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
    for (const profile of profiles) {
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
            const line = profile.catalog?.line ?? profile.line
            const reference = profile.catalog?.model
            const matchingModel =
                reference &&
                catalog.manufacturers
                    .find(entry => entry.name === manufacturer)
                    ?.lines.find(entry => entry.name === line)
                    ?.models.find(model => model.name === reference)
            if (reference && !matchingModel) throw new Error(`${profile.id}: unknown catalog model ${reference}`)
            const aliases = [profile.model, profile.deviceInfo?.model].filter((value): value is string => !!value)
            const usbModel = profile.usb.productString
            if (usbModel && profile.deviceInfo?.reportedIdentity?.endsWith(` ${usbModel}`)) aliases.push(usbModel)
            const candidate = candidates.find(
                candidate =>
                    candidate.manufacturer === manufacturer &&
                    candidate.line === line &&
                    (reference
                        ? candidate.models.includes(reference)
                        : candidate.models.some(model =>
                              aliases.some(alias => normalizeModel(alias) === normalizeModel(model))
                          ))
            )
            if (reference) aliases.unshift(reference)
            if (candidate) {
                candidate.models = [...new Set([...candidate.models, ...aliases])]
                candidate.profiles.push(evidence)
            } else
                candidates.push({
                    manufacturer,
                    line,
                    models: aliases,
                    sources: evidence.sources,
                    profiles: [evidence],
                })
        }
    }
    return Object.fromEntries(Object.entries(table).sort(([left], [right]) => left.localeCompare(right)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const profiles = filesIn(path.join(packageDirectory, 'camera-profiles')).map(file =>
        loadCameraProfile(readFileSync(file, 'utf8'), file)
    )
    const table = buildCameraIdentityTable(loadCatalog(), profiles)
    const json = JSON.stringify(table, null, 2) + '\n'
    if (process.argv.includes('--check')) {
        if (readFileSync(output, 'utf8') !== json) throw new Error('Camera identities are stale; run cameras:build')
    } else writeFileSync(output, json)
    console.log(
        `${Object.keys(table).length} USB identities ${process.argv.includes('--check') ? 'checked' : 'generated'}`
    )
}
