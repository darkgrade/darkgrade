import { identifyCamera } from '@camera/identification/camera-identification'
/**
 * Every camera profile darkgrade can simulate, by id: committed profiles under camera-profiles/
 * (captured and documented line mocks) and the per-model documented mocks generated from the catalog.
 */
import { loadCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadCatalog, type CameraCatalog, type CatalogModel } from './camera-catalog'
import { packageDirectory } from './compat-progress'
import { catalogModelMocks } from './documented-profile'

export const profileDirectory = path.join(packageDirectory, 'camera-profiles')

export interface IndexedProfile {
    profile: CameraProfile
    /** "camera-profiles/<manufacturer>/<line>/<id>.json", or "catalog:<manufacturer>/<line>/<model>". */
    path: string
    /** The catalog model a per-model mock was generated from. */
    catalogModel?: CatalogModel
}

function profileFiles(directory: string): string[] {
    return readdirSync(directory)
        .sort()
        .flatMap(entry => {
            const full = path.join(directory, entry)
            if (statSync(full).isDirectory()) return profileFiles(full)
            return entry.endsWith('.json') ? [full] : []
        })
}

export function loadProfileIndex(catalog: CameraCatalog = loadCatalog()): Map<string, IndexedProfile> {
    const index = new Map<string, IndexedProfile>()
    for (const file of profileFiles(profileDirectory)) {
        const relativePath = path.relative(profileDirectory, file)
        const profile = loadCameraProfile(readFileSync(file, 'utf8'), relativePath)
        if (index.has(profile.id)) throw new Error(`Duplicate camera profile id ${profile.id}`)
        index.set(profile.id, { profile, path: path.relative(packageDirectory, file) })
    }
    for (const mock of catalogModelMocks(catalog).mocks) {
        if (index.has(mock.profile.id)) continue
        index.set(mock.profile.id, {
            profile: mock.profile,
            path: `catalog:${mock.manufacturer.name}/${mock.line.name}/${mock.model.name}`,
            catalogModel: mock.model,
        })
    }
    return index
}

/** "vvvv:pppp" identities of a profile. */
export function usbIdentities(profile: CameraProfile): string[] {
    if (!profile.usb) return []
    const vendor = profile.usb.vendorId.slice(2).padStart(4, '0')
    return profile.usb.productIds.map(product => `${vendor}:${product.slice(2).padStart(4, '0')}`)
}

/** USB shortcuts require an unambiguous model association; shared IDs need an explicit profile. */
export function findProfileByUsb(index: Map<string, IndexedProfile>, identity: string): IndexedProfile | undefined {
    if (!/^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(identity)) throw new Error('Expected USB identity vvvv:pppp')
    const [vendorId, productId] = identity.split(':').map(value => Number.parseInt(value, 16))
    const identified = identifyCamera({ vendorId, productId })
    if (identified.status === 'ambiguous')
        throw new Error('USB identity matches multiple models; select an explicit --profile')
    if (identified.status !== 'matched') return undefined
    const candidate = identified.candidates[0]
    const matches = [...index.values()].filter(
        ({ profile }) =>
            usbIdentities(profile).includes(identity.toLowerCase()) &&
            (profile.catalog?.manufacturer ?? profile.manufacturer) === candidate.manufacturer &&
            (profile.catalog?.line ?? profile.line) === candidate.line &&
            [profile.catalog?.model, profile.model, profile.deviceInfo?.model].some(
                model => !!model && candidate.models.includes(model)
            )
    )
    const rank = (entry: IndexedProfile) =>
        entry.profile.provenance.fidelity === 'captured' ? 0 : entry.catalogModel ? 1 : 2
    return matches.sort((left, right) => rank(left) - rank(right))[0]
}
