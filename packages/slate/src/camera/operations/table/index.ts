import type { Camera } from '@camera/index'
import { bodyOperationTable } from '@camera/operations/table/body'
import { connectionOperationTable, connectionStaticOperationTable } from '@camera/operations/table/connection'
import { eventsOperationTable } from '@camera/operations/table/events'
import { focusOperationTable } from '@camera/operations/table/focus'
import { liveViewOperationTable } from '@camera/operations/table/live-view'
import { mediaOperationTable } from '@camera/operations/table/media'
import type { OperationEntry } from '@camera/operations/table/operation-entry'
import { photoOperationTable } from '@camera/operations/table/photo'
import { protocolOperationTable } from '@camera/operations/table/protocol'
import { settingsOperationTable } from '@camera/operations/table/settings'
import { videoOperationTable } from '@camera/operations/table/video'
import { zoomOperationTable } from '@camera/operations/table/zoom'

export type * from '@camera/operations/table/operation-entry'

/**
 * The operation table: one entry per public Camera method, from one file per area. The library,
 * the MCP tools and the CLI derive their names from it (see `mcpToolName`, `cliCommand`).
 */
export const cameraOperationTable = {
    ...connectionOperationTable.current,
    ...protocolOperationTable.current,
    ...settingsOperationTable.current,
    ...focusOperationTable.current,
    ...zoomOperationTable.current,
    ...photoOperationTable.current,
    ...liveViewOperationTable.current,
    ...videoOperationTable.current,
    ...mediaOperationTable.current,
    ...bodyOperationTable.current,
    ...eventsOperationTable.current,
} satisfies Record<CameraMethodName, OperationEntry>

/** Target operations not on Camera yet; each moves to its area's `current` table when it lands. */
export const plannedOperationTable = {
    ...connectionOperationTable.planned,
    ...protocolOperationTable.planned,
    ...settingsOperationTable.planned,
    ...focusOperationTable.planned,
    ...zoomOperationTable.planned,
    ...photoOperationTable.planned,
    ...liveViewOperationTable.planned,
    ...videoOperationTable.planned,
    ...mediaOperationTable.planned,
    ...bodyOperationTable.planned,
    ...eventsOperationTable.planned,
} satisfies Record<string, OperationEntry>

/** Static methods (`Camera.discover`). */
export const cameraStaticOperationTable = connectionStaticOperationTable satisfies Record<
    CameraStaticMethodName,
    OperationEntry
>

export type CameraMethodName = Extract<keyof Camera, string>
export type CameraStaticMethodName = Exclude<Extract<keyof typeof Camera, string>, 'prototype'>

// The compiler fails when a Camera method and the table disagree, in either direction.
type MissingFromTable = Exclude<CameraMethodName, keyof typeof cameraOperationTable>
type NotOnCamera = Exclude<keyof typeof cameraOperationTable, CameraMethodName>
type PlannedButOnCamera = Extract<keyof typeof plannedOperationTable, CameraMethodName>
type StaticMismatch =
    | Exclude<CameraStaticMethodName, keyof typeof cameraStaticOperationTable>
    | Exclude<keyof typeof cameraStaticOperationTable, CameraStaticMethodName>
export type OperationTableMismatch = MissingFromTable | NotOnCamera | PlannedButOnCamera | StaticMismatch
const operationTableMatchesCamera: [OperationTableMismatch] extends [never] ? true : OperationTableMismatch = true
void operationTableMatchesCamera

export type OperationName =
    | keyof typeof cameraOperationTable
    | keyof typeof plannedOperationTable
    | keyof typeof cameraStaticOperationTable

/** Every entry, current, static and planned, by method name. */
export function allOperations(): [string, OperationEntry][] {
    return [
        ...Object.entries(cameraOperationTable),
        ...Object.entries(cameraStaticOperationTable),
        ...Object.entries(plannedOperationTable),
    ]
}

/** The name an entry has in the target public API, or undefined when it leaves the public API. */
export function publicOperationName(name: string, entry: OperationEntry): string | undefined {
    switch (entry.disposition.kind) {
        case 'keep':
        case 'add':
            return name
        case 'rename-to':
            return entry.disposition.target
        default:
            return undefined
    }
}

const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ')
export const snakeCase = (name: string) => words(name).join('_')
export const kebabCase = (name: string) => words(name).join('-')

/** The MCP tool for a public operation (`camera_take_photo`), or undefined when it is not offered. */
export function mcpToolName(name: string, entry: OperationEntry = entryFor(name)): string | undefined {
    const surface = entry.surfaces?.mcp
    if (surface && 'omitted' in surface) return undefined
    return surface?.name ?? `camera_${snakeCase(name)}`
}

/** The CLI command line for a public operation (`darkgrade camera take-photo`), or undefined. */
export function cliCommand(name: string, entry: OperationEntry = entryFor(name)): string | undefined {
    const surface = entry.surfaces?.cli
    if (surface && 'omitted' in surface) return undefined
    if (surface?.topLevelCommand) return `darkgrade ${surface.topLevelCommand}`
    return `darkgrade camera ${surface?.command ?? kebabCase(name)}`
}

function entryFor(name: string): OperationEntry {
    const entry = allOperations().find(([candidate]) => candidate === name)?.[1]
    if (!entry) throw new Error(`No operation table entry for ${name}`)
    return entry
}

export interface PublicOperation {
    name: string
    entry: OperationEntry
    mcpTool?: string
    cliCommand?: string
    /** True when Camera has the method today; false while it is still planned. */
    implemented: boolean
}

/** The target public API with each surface's name, derived mechanically from the table. */
export function publicOperations(): PublicOperation[] {
    const implemented = new Set([...Object.keys(cameraOperationTable), ...Object.keys(cameraStaticOperationTable)])
    const operations = new Map<string, PublicOperation>()
    for (const [name, entry] of allOperations()) {
        const publicName = publicOperationName(name, entry)
        if (!publicName) continue
        const target = publicName === name ? entry : (plannedOperationTable as Record<string, OperationEntry>)[publicName]
        if (!target) throw new Error(`${name} is renamed to ${publicName}, which has no planned entry`)
        operations.set(publicName, {
            name: publicName,
            entry: target,
            mcpTool: mcpToolName(publicName, target),
            cliCommand: cliCommand(publicName, target),
            implemented: implemented.has(publicName),
        })
    }
    return [...operations.values()]
}
