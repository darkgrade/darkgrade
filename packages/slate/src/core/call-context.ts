/**
 * Which public Camera call is running, so telemetry can link the protocol work under it to the
 * call. No imports: the browser runtime carries it. Node and Bun follow a call through its own
 * async context (AsyncLocalStorage, reached without a static `node:` import); a host without one
 * links work to a call only while that call is the only one running.
 */

export interface CallScope {
    readonly id: string
    /** False once the call has returned: a timer or poll it started is not part of it afterwards. */
    active: boolean
    /** The last response code other than OK the camera answered within the call. */
    response?: number
}
interface ContextStorage {
    run<Result>(scope: CallScope, work: () => Result): Result
    getStore(): CallScope | undefined
}
export type CallSurface = 'library' | 'mcp' | 'cli' | 'studio'

const storage = ((): ContextStorage | undefined => {
    try {
        const host = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
        const hooks = host?.getBuiltinModule?.('node:async_hooks') as
            { AsyncLocalStorage?: new () => ContextStorage } | undefined
        return hooks?.AsyncLocalStorage ? new hooks.AsyncLocalStorage() : undefined
    } catch {
        return undefined
    }
})()
const running = new Set<CallScope>()
/** Without async context: the call whose synchronous part is executing (a typed setter calling setControl). */
let synchronous: CallScope | undefined

export const callAttribution = storage ? 'async-context' : 'only-active-call'

/** The call this code runs inside, if any: a public call made here is part of it, not a call of its own. */
export function enclosingCall(): CallScope | undefined {
    const scope = storage ? storage.getStore() : synchronous
    return scope?.active ? scope : undefined
}

/** The call protocol work right now belongs to, if one can be told. */
export function attributedCallId(): string | undefined {
    const scope = enclosingCall() ?? (!storage && running.size === 1 ? running.values().next().value : undefined)
    return scope?.id
}

/** Runs `work` as call `scope`; `finished` must be called when the call settles. */
export function runInCall<Result>(scope: CallScope, work: () => Result): Result {
    running.add(scope)
    const previous = synchronous
    synchronous = scope
    try {
        return storage ? storage.run(scope, work) : work()
    } finally {
        synchronous = previous
    }
}

/** A protocol session reports each non-OK response; the call it belongs to keeps the last one. */
export function noteCallResponse(code: number): void {
    const scope = enclosingCall()
    if (scope) scope.response = code
}

export function callFinished(scope: CallScope): void {
    scope.active = false
    running.delete(scope)
}

/** The surface of a call no surface named: the library's, or Studio's under Electron. */
export function defaultCallSurface(): CallSurface {
    const versions = (globalThis as { process?: { versions?: Record<string, string | undefined> } }).process?.versions
    return versions?.electron ? 'studio' : 'library'
}

/** Where an instrumented Camera method keeps its entry for a call that names its surface. */
export const surfaceCall = Symbol('surfaceCall')

/** Calls a public Camera method as the named surface (MCP, CLI) made the call. */
export function callFromSurface(method: unknown, camera: object, values: unknown[], surface: CallSurface | undefined): unknown {
    if (typeof method !== 'function') throw new TypeError('Not a Camera operation')
    const named: unknown = surface && Reflect.get(method, surfaceCall)
    return typeof named === 'function' ? named(camera, values, surface) : Reflect.apply(method, camera, values)
}
