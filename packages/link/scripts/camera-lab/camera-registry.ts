/** Types, validation and CI matrix generation for camera-lab/cameras.lab.json. */
import { loadCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const registryPath = path.join(packageDirectory, 'camera-lab/cameras.lab.json')
export const profileDirectory = path.join(packageDirectory, 'camera-profiles')

export const LAB_CONNECTIONS = ['usb', 'ptpip', 'sony-remote'] as const
export type LabConnection = (typeof LAB_CONNECTIONS)[number]

export interface RegistrySource {
    /** "darkgrade/test-bench@<commit>:<path>" or a URL. */
    location: string
    /** Verbatim text from the source; `lab:registry -- --verify-sources <checkout>` checks it is still there. */
    excerpt: string
}

export interface LabHost {
    id: string
    /** Self-hosted runner label; the lab job runs on [self-hosted, darkgrade-testbench, <runnerLabel>]. */
    runnerLabel: string
    sources: RegistrySource[]
}

export interface LabCamera {
    id: string
    enabled: boolean
    disabledReason?: string
    manufacturer: string
    line: string
    model: string
    firmware: string | null
    /** The transport the lab tier tests. */
    connection: LabConnection
    /** Other transports verified on this body, recorded for reference. */
    otherConnections: LabConnection[]
    usb: { vendorId: string; productId: string; alternateProductIds: string[]; serial: string | null } | null
    host: string | null
    /** The camera's label in the bench's testbench.conf, used by the bench CLI for capture and recovery. */
    benchLabel: string | null
    /** Captured profile path relative to camera-profiles/. */
    profile: string
    note?: string
    sources: RegistrySource[]
}

export interface CameraRegistry {
    schemaVersion: 1
    about: string
    hosts: LabHost[]
    cameras: LabCamera[]
}

/** One lab job: everything the workflow and the hardware suite need for one camera. */
export interface LabMatrixEntry {
    camera: string
    model: string
    host: string
    runner: string
    connection: LabConnection
    /** "vvvv:pppp" as bench:probe takes it. */
    usb: string
    benchLabel: string
    profile: string
    firmware: string
}

const HEX_ID = /^0x[0-9a-f]{4}$/

export function loadRegistry(file = registryPath): CameraRegistry {
    return JSON.parse(readFileSync(file, 'utf8')) as CameraRegistry
}

export function usbPair(vendorId: string, productId: string): string {
    return `${vendorId.slice(2)}:${productId.slice(2)}`
}

export function loadRegistryProfile(camera: LabCamera, directory = profileDirectory): CameraProfile {
    return loadCameraProfile(readFileSync(path.join(directory, camera.profile), 'utf8'), camera.profile)
}

function validateSources(where: string, sources: RegistrySource[] | undefined, problems: string[]): void {
    if (!Array.isArray(sources) || sources.length === 0)
        problems.push(`${where}: sources must cite at least one source`)
    for (const [index, source] of (sources ?? []).entries()) {
        if (!source.location || !source.excerpt) problems.push(`${where}: sources[${index}] needs location and excerpt`)
    }
}

function validateUsb(camera: LabCamera, profile: CameraProfile | undefined, problems: string[]): void {
    const where = `cameras.${camera.id}`
    if (camera.connection === 'usb' && !camera.usb) problems.push(`${where}: a usb camera needs usb identity`)
    if (!camera.usb) return
    const codes = [camera.usb.vendorId, camera.usb.productId, ...camera.usb.alternateProductIds]
    for (const code of codes) if (!HEX_ID.test(code)) problems.push(`${where}: invalid USB id ${code}`)
    if (!profile?.usb) return
    if (profile.usb.vendorId !== camera.usb.vendorId)
        problems.push(`${where}: vendor ${camera.usb.vendorId} differs from profile ${profile.usb.vendorId}`)
    for (const productId of [camera.usb.productId, ...camera.usb.alternateProductIds]) {
        if (!profile.usb.productIds.includes(productId))
            problems.push(`${where}: product ${productId} is not in profile ${profile.id}`)
    }
}

function validateCamera(camera: LabCamera, hosts: Set<string>, problems: string[], directory: string): void {
    const where = `cameras.${camera.id}`
    if (!/^[a-z0-9-]+$/.test(camera.id)) problems.push(`${where}: id must be lowercase kebab-case`)
    for (const connection of [camera.connection, ...(camera.otherConnections ?? [])]) {
        if (!LAB_CONNECTIONS.includes(connection)) problems.push(`${where}: unknown connection ${connection}`)
    }
    if (camera.host !== null && !hosts.has(camera.host)) problems.push(`${where}: unknown host ${camera.host}`)
    if (camera.enabled && (!camera.host || !camera.benchLabel))
        problems.push(`${where}: an enabled camera needs a host and a bench label`)
    if (!camera.enabled && !camera.disabledReason) problems.push(`${where}: a disabled camera needs disabledReason`)
    validateSources(where, camera.sources, problems)

    let profile: CameraProfile | undefined
    if (!existsSync(path.join(directory, camera.profile))) {
        problems.push(`${where}: profile ${camera.profile} does not exist`)
    } else {
        profile = loadRegistryProfile(camera, directory)
        if (profile.provenance.fidelity !== 'captured')
            problems.push(`${where}: profile ${profile.id} must be a captured profile`)
        if (profile.manufacturer !== camera.manufacturer || profile.line !== camera.line)
            problems.push(`${where}: manufacturer/line differ from profile ${profile.id}`)
    }
    validateUsb(camera, profile, problems)
}

/** Every problem in the registry; an empty list means it is valid. */
export function validateRegistry(registry: CameraRegistry, directory = profileDirectory): string[] {
    const problems: string[] = []
    if (registry.schemaVersion !== 1) problems.push('schemaVersion must be 1')
    const hostIds = new Set<string>()
    for (const host of registry.hosts ?? []) {
        if (hostIds.has(host.id)) problems.push(`hosts.${host.id}: duplicate id`)
        hostIds.add(host.id)
        if (!host.runnerLabel) problems.push(`hosts.${host.id}: runnerLabel is required`)
        validateSources(`hosts.${host.id}`, host.sources, problems)
    }
    const cameraIds = new Set<string>()
    for (const camera of registry.cameras ?? []) {
        if (cameraIds.has(camera.id)) problems.push(`cameras.${camera.id}: duplicate id`)
        cameraIds.add(camera.id)
        validateCamera(camera, hostIds, problems, directory)
    }
    const identities = new Map<string, LabCamera[]>()
    for (const camera of registry.cameras.filter(camera => camera.enabled && camera.usb)) {
        const identity = `${camera.host}:${usbPair(camera.usb!.vendorId, camera.usb!.productId)}`
        identities.set(identity, [...(identities.get(identity) ?? []), camera])
    }
    // VID/PID identifies a model, not a body. Different hosts are independent; one host needs serials.
    for (const [identity, cameras] of identities) {
        if (cameras.length < 2) continue
        const serials = cameras.map(camera => camera.usb!.serial)
        if (serials.some(serial => !serial) || new Set(serials).size !== serials.length)
            problems.push(`${identity}: cameras sharing a host and USB identity need distinct explicit serials`)
    }
    return problems
}

/** GitHub Actions matrix entries for the enabled cameras, ordered by host. */
export function labMatrix(registry: CameraRegistry): LabMatrixEntry[] {
    const runners = new Map(registry.hosts.map(host => [host.id, host.runnerLabel]))
    return registry.cameras
        .filter(camera => camera.enabled && camera.host && camera.benchLabel && camera.usb)
        .map(camera => ({
            camera: camera.id,
            model: `${camera.manufacturer} ${camera.model}`,
            host: camera.host!,
            runner: runners.get(camera.host!)!,
            connection: camera.connection,
            usb: usbPair(camera.usb!.vendorId, camera.usb!.productId),
            benchLabel: camera.benchLabel!,
            profile: camera.profile,
            firmware: camera.firmware ?? '',
        }))
        .sort((left, right) => left.host.localeCompare(right.host) || left.camera.localeCompare(right.camera))
}

/** Excerpts that are no longer present in a darkgrade/test-bench checkout. */
export function staleSources(registry: CameraRegistry, testBenchDirectory: string): string[] {
    const entries = [...registry.hosts, ...registry.cameras]
    return entries.flatMap(entry =>
        entry.sources.flatMap(source => {
            const match = source.location.match(/^darkgrade\/test-bench@[0-9a-f]+:(.+)$/)
            if (!match) return []
            const file = path.join(testBenchDirectory, match[1])
            const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
            return text.includes(source.excerpt) ? [] : [`${entry.id}: "${source.excerpt}" not found in ${match[1]}`]
        })
    )
}
