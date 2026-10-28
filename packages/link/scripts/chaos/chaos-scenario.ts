/**
 * Runs @darkgrade/link against a SimulatedTransport in chaos mode and classifies how the library
 * copes: hangs, crashes (TypeError/RangeError), untyped errors, silently accepted corrupt replies,
 * transaction-ID drift, listener leaks, and whether the same Camera recovers once the faults stop.
 */
import { Camera } from '@camera/index'
import type { TransactionPolicy } from '@camera/transaction-channel'
import { parseCode, type CameraProfile } from '@transport/simulated/camera-profile'
import { CHAOS_FAULTS, ChaosDisconnectError, type ChaosFault } from '@transport/simulated/chaos-faults'
import { ProfileDataMissingError, SimulatedTransport } from '@transport/simulated/simulated-transport'

export type FindingKind =
    | 'hang'
    | 'crash'
    | 'untyped-error'
    | 'silent-acceptance'
    | 'transaction-id-drift'
    | 'event-handler-crash'
    | 'listener-leak'
    | 'unhandled-rejection'
    | 'not-recoverable'

export interface ChaosFinding {
    kind: FindingKind
    step: string
    detail: string
}

export type StepOutcome = 'ok' | 'error' | 'hang'

export interface ChaosStepResult {
    step: string
    outcome: StepOutcome
    error?: string
    faults: string[]
}

export interface ChaosScenarioResult {
    profile: string
    fault: ChaosFault
    seed: number
    injected: number
    steps: ChaosStepResult[]
    findings: ChaosFinding[]
    recovered: boolean
}

export interface ChaosScenarioOptions {
    /** A step that has not settled after this long is reported as a hang (default 1500 ms). */
    stepTimeoutMilliseconds?: number
    /** darkgrade's own per-transaction timeout, passed to Camera (default 300 ms). */
    transactionTimeoutMilliseconds?: number
    probability?: number
    /** False when the profile cannot connect even without faults, so recovery is not judged. */
    expectRecovery?: boolean
}

class StepHung extends Error {}

/** Errors that are expected outcomes rather than defects: typed protocol errors and missing profile data. */
function isTypedFailure(error: unknown): boolean {
    if (error instanceof ProfileDataMissingError || error instanceof ChaosDisconnectError) return true
    if (!(error instanceof Error)) return false
    // @darkgrade/link's typed failures (PTPTimeoutError, PTPProtocolError, PTPResponseError, ...).
    if (/^PTP\w*Error$/.test(error.name)) return true
    return /only available|not supported|not implemented|not readable|not writable|does not advertise/i.test(
        error.message
    )
}

const CRASH_NAMES = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'])

function describe(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return String(error)
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const hung = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepHung(`no result after ${milliseconds} ms`)), milliseconds)
    })
    return Promise.race([promise, hung]).finally(() => clearTimeout(timer))
}

/** Profile properties darkgrade defines and the profile can describe. */
function describedProperty(camera: Camera, profile: CameraProfile): number | undefined {
    const registry = camera.getInstance().registry
    const defined = new Set(Object.values(registry.properties).map(property => (property as { code: number }).code))
    return profile.properties
        .filter(property => property.descriptor)
        .map(property => parseCode(property.code))
        .find(code => defined.has(code))
}

/** Faults that a single transaction step must reject rather than return as success. */
const MUST_DETECT: ReadonlySet<string> = new Set([
    'truncated-container',
    'wrong-transaction-id',
    'wrong-container-type',
])

export async function runChaosScenario(
    profile: CameraProfile,
    fault: ChaosFault,
    seed: number,
    options: ChaosScenarioOptions = {}
): Promise<ChaosScenarioResult> {
    const stepTimeout = options.stepTimeoutMilliseconds ?? 1_500
    const transport = new SimulatedTransport(profile, {
        chaos: { seed, faults: [fault], probability: options.probability ?? 0.35 },
    })
    const chaos = transport.chaos!
    const camera = new Camera({
        transport,
        vendorId: profile.usb ? parseCode(profile.usb.vendorId) : undefined,
        logger: { renderInTerminal: false, captureConsole: false, expanded: false },
    })
    // Library versions with transaction timeouts get short ones, so a stall or busy storm costs milliseconds.
    const tunable = camera.getInstance() as {
        configureTransactions?: (policy: Partial<TransactionPolicy>) => void
    }
    tunable.configureTransactions?.({
        timeoutMilliseconds: options.transactionTimeoutMilliseconds ?? 300,
        deviceBusyBackoffMilliseconds: 1,
        // Explicit authorization is safe here because this transport is an in-process fixture only.
        recoverTransport: () => transport.classRequestReset(),
    })
    const registry = camera.getInstance().registry
    const findings: ChaosFinding[] = []
    const steps: ChaosStepResult[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
        const step = async (name: string, action: () => Promise<unknown>, singleTransaction = false) => {
            const faultsBefore = chaos.injected.length
            const handlerErrorsBefore = transport.eventHandlerErrors.length
            let outcome: StepOutcome = 'ok'
            let error: unknown
            let value: unknown
            try {
                value = await withTimeout(action(), stepTimeout)
            } catch (caught) {
                error = caught
                outcome = caught instanceof StepHung ? 'hang' : 'error'
            }
            const faults = chaos.injected
                .slice(faultsBefore)
                .map(entry => `${entry.fault} ${entry.operation}: ${entry.detail}`)
            steps.push({ step: name, outcome, ...(error !== undefined && { error: describe(error) }), faults })
            if (outcome === 'hang') findings.push({ kind: 'hang', step: name, detail: faults.join('; ') || 'no fault' })
            if (outcome === 'error' && error instanceof Error && CRASH_NAMES.has(error.name)) {
                findings.push({ kind: 'crash', step: name, detail: `${describe(error)} after ${faults.join('; ')}` })
            } else if (outcome === 'error' && !isTypedFailure(error)) {
                findings.push({
                    kind: 'untyped-error',
                    step: name,
                    detail: `${describe(error)} after ${faults.join('; ')}`,
                })
            }
            const accepted = (value as { code?: number } | undefined)?.code === 0x2001
            const mustDetect = chaos.injected.slice(faultsBefore).find(entry => MUST_DETECT.has(entry.fault))
            if (singleTransaction && outcome === 'ok' && accepted && mustDetect) {
                findings.push({
                    kind: 'silent-acceptance',
                    step: name,
                    detail: `${mustDetect.fault} ${mustDetect.operation} (${mustDetect.detail}) returned as OK`,
                })
            }
            for (const handlerError of transport.eventHandlerErrors.slice(handlerErrorsBefore)) {
                findings.push({ kind: 'event-handler-crash', step: name, detail: describe(handlerError) })
            }
        }

        const propertyCode = describedProperty(camera, profile)
        await step('connect', () => camera.connect())
        await step('device-info', () => camera.send(registry.operations.GetDeviceInfo, {}), true)
        if (propertyCode !== undefined) {
            await step(
                'property-desc',
                () => camera.send(registry.operations.GetDevicePropDesc, { DevicePropCode: propertyCode }),
                true
            )
        }
        await step('list-properties', () => camera.getStandardPropertyStates())
        await step('capture', () => camera.captureImage({ includeInfo: false, includeData: false }))
        await step('disconnect', () => camera.disconnect())

        chaos.enabled = false
        let recovered = false
        try {
            await withTimeout(
                camera.disconnect().catch(() => undefined),
                stepTimeout
            )
            await withTimeout(camera.connect(), stepTimeout)
            const response = await withTimeout(camera.send(registry.operations.GetDeviceInfo, {}), stepTimeout)
            recovered = response.code === 0x2001
            await withTimeout(camera.disconnect(), stepTimeout)
        } catch (error) {
            if (options.expectRecovery !== false) {
                findings.push({ kind: 'not-recoverable', step: 'recover', detail: describe(error) })
            }
        }
        if (
            !recovered &&
            options.expectRecovery !== false &&
            !findings.some(finding => finding.kind === 'not-recoverable')
        ) {
            findings.push({ kind: 'not-recoverable', step: 'recover', detail: 'GetDeviceInfo did not return OK' })
        }

        // Scenario timeouts can outlive high-level disconnect; explicitly settle synthetic I/O before inspection.
        await transport.disconnect()
        findings.push(...transactionIdDrift(transport.commandTransactionIds))
        if (transport.eventHandlerCount > 1) {
            findings.push({
                kind: 'listener-leak',
                step: 'teardown',
                detail: `${transport.eventHandlerCount} transport event handlers registered by one Camera`,
            })
        }
        await new Promise(resolve => setTimeout(resolve, 5))
        for (const reason of unhandled)
            findings.push({ kind: 'unhandled-rejection', step: 'any', detail: describe(reason) })

        return { profile: profile.id, fault, seed, injected: chaos.injected.length, steps, findings, recovered }
    } finally {
        chaos.enabled = false
        await transport.disconnect()
        process.off('unhandledRejection', onUnhandled)
    }
}

/** Command transaction IDs must rise by one per transaction; a skipped or repeated ID desynchronizes strict cameras. */
/** Whether the profile connects and answers GetDeviceInfo with no faults injected. */
export async function recoversWithoutFaults(profile: CameraProfile): Promise<boolean> {
    const result = await runChaosScenario(profile, 'stall', 0, { probability: 0 })
    return result.recovered
}

export function transactionIdDrift(transactionIds: readonly number[]): ChaosFinding[] {
    const findings: ChaosFinding[] = []
    for (let index = 1; index < transactionIds.length; index++) {
        const previous = transactionIds[index - 1]
        const current = transactionIds[index]
        if (current === ((previous + 1) >>> 0 || 1)) continue
        findings.push({
            kind: 'transaction-id-drift',
            step: 'any',
            detail: `transaction ${current} followed ${previous}`,
        })
    }
    return findings
}

export { CHAOS_FAULTS }
