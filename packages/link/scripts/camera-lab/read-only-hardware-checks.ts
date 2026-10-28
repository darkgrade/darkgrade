import { CAPABILITIES, type SimulatedCamera } from '@scripts/camera-profiles/camera-capabilities'
import type { CapabilityResult } from '@scripts/camera-profiles/support-matrix'
import { formatCode } from '@transport/simulated/camera-profile'

interface HardwareCheck {
    id: string
    run: (camera: SimulatedCamera) => Promise<string>
}
const checks = CAPABILITIES.filter(capability => ['session', 'device-info'].includes(capability.id))

/** Await every operation and disconnect fully. The owning parent enforces the process deadline. */
export async function runReadOnlyHardwareChecks(
    target: SimulatedCamera,
    stopping: () => boolean,
    selected: readonly HardwareCheck[] = checks
): Promise<Record<string, CapabilityResult>> {
    const results: Record<string, CapabilityResult> = Object.fromEntries(
        CAPABILITIES.map(({ id }) => [
            id,
            {
                status: 'no-data',
                detail: 'guarded lab currently runs read-only identity/session checks only',
            },
        ])
    )
    let failed = false
    try {
        for (const check of selected) {
            if (failed || stopping()) {
                results[check.id] = { status: 'no-data', detail: 'hardware run stopped before this operation' }
                continue
            }
            const responsesBefore = target.transport.responseCodes.length
            try {
                results[check.id] = { status: 'pass', detail: await check.run(target) }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                const refusal = target.transport.responseCodes
                    .slice(responsesBefore)
                    .find(code => code === 0x2005 || code === 0x200a)
                results[check.id] =
                    refusal === undefined
                        ? { status: 'fail', detail: message }
                        : { status: 'unsupported', detail: `camera answered ${formatCode(refusal)}: ${message}` }
                failed = true
            }
        }
    } finally {
        await target.camera.disconnect()
    }
    return results
}
