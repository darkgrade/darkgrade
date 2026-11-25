import type { Camera } from '@camera/index'

/** What an area's smoke check reports: each line is one confirmed camera result or a skip. */
export interface SmokeReport {
    /** A result the camera confirmed (a read, or a write read back). */
    confirmed(step: string, detail: unknown): void
    /** A step this camera cannot do right now, with the reason it gave. Not a failure. */
    skipped(step: string, reason: string): void
}

/**
 * One area's smoke check against the attached camera through the public Camera API. It must leave
 * the camera as it found it (restore any setting it changes) and never format, delete or
 * overwrite anything on the card; taking a photo or a short clip is fine.
 */
export interface SmokeArea {
    readonly name: string
    readonly description: string
    run(camera: Camera, report: SmokeReport): Promise<void>
}

/** For areas whose operations have not landed yet; the slice that owns the area replaces it. */
export function pendingArea(name: string, operations: string): SmokeArea {
    return {
        name,
        description: `${operations} (not yet exercised)`,
        async run(_camera, report) {
            report.skipped(name, `no smoke steps yet for ${operations}; the ${name} slice adds them`)
        },
    }
}
