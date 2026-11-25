import type { Camera } from '@camera/index'
import { protocolAccess } from '@camera/operations/protocol'
import { isValidatedModel } from '@camera/validated-models'
import { runBenchmark } from '@workflows/telemetry-benchmark'

export interface FirstContactDependencies {
    /** Effective sharing (opt-out, DO_NOT_TRACK and pending deletion all disable it). */
    sharingEnabled(): Promise<boolean>
    /** True the first time this installation sees this exact body identity. */
    firstSighting(identity: string): Promise<boolean>
    saveProfile(profile: Awaited<ReturnType<typeof runBenchmark>>['profile']): Promise<unknown>
    flush(): Promise<unknown>
}

/** Node installations remember sightings beside their settings; elsewhere nothing runs. */
async function nodeDependencies(): Promise<FirstContactDependencies | undefined> {
    if (typeof process === 'undefined' || !process.versions?.node || process.env.NODE_ENV === 'test') return
    const settings = await import('@contribute/settings')
    // Kept forever, so each model+firmware is inventoried once per installation.
    const sightings = settings.reportedFacts(settings.settingsDirectory(), Number.POSITIVE_INFINITY)
    return {
        sharingEnabled: async () => (await settings.nodeDiagnostics()).enabled(),
        firstSighting: async identity => {
            const fresh = sightings.fresh('first-contact', identity, 'seen')
            sightings.save()
            return fresh
        },
        saveProfile: async profile => settings.saveDiagnosticProfile(profile),
        flush: async () => (await settings.nodeDiagnostics()).flush(),
    }
}

/**
 * Bodies outside the validated list get one bounded, read-only inventory (identity, every advertised
 * property descriptor, storage IDs) recorded as a `first-contact` profile. Never writes, captures or
 * throws; returns whether an inventory ran.
 */
export async function recordFirstContact(
    camera: Camera,
    dependencies?: FirstContactDependencies
): Promise<boolean> {
    try {
        const instance = protocolAccess(camera).driver
        const evidence = (instance.transport as typeof instance.transport & { telemetryEvidence?: string })
            .telemetryEvidence
        const resolved = dependencies ?? (evidence === 'hardware' ? await nodeDependencies() : undefined)
        if (!resolved || !(await resolved.sharingEnabled())) return false
        const information = await camera.getInfo()
        if (!information.model || isValidatedModel(information.model)) return false
        const identity = JSON.stringify([information.manufacturer, information.model, information.firmware])
        if (!(await resolved.firstSighting(identity))) return false
        const result = await runBenchmark(camera, {
            purpose: 'first-contact',
            timeoutMilliseconds: 30_000,
            maximumProperties: 512,
            flushEvidence: () => resolved.flush(),
        })
        await resolved.saveProfile(result.profile)
        await resolved.flush()
        return true
    } catch {
        return false
    }
}
