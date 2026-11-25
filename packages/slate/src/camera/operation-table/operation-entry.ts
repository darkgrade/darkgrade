/**
 * The operation table: every public Camera method, with what happens to it under the public API
 * plan (packages/slate/docs/public-api-plan.html), and the target operations not yet on Camera.
 * Plain data: no driver imports, so the library, MCP tools and CLI can all read it.
 */

export type OperationArea =
    | 'connection'
    | 'settings'
    | 'focus'
    | 'zoom'
    | 'photo'
    | 'live-view'
    | 'video'
    | 'media'
    | 'body'
    | 'events'
    | 'protocol'

export type Disposition =
    /** Stays public under the same name. */
    | { kind: 'keep' }
    /** Stays public under a new name. */
    | { kind: 'rename-to'; target: string }
    /** Leaves the public API; `target` is the public operation that covers it. */
    | { kind: 'replaced-by'; target: string; note?: string }
    /** Moves behind `@darkgrade/slate/protocol` (`protocolSession(camera)`), unsupported, for bench diagnostics. */
    | { kind: 'protocol' }
    /** Leaves the public API; Slate does it inside the operation named in `handledBy`. */
    | { kind: 'private'; handledBy: string }
    /** Removed with no replacement. */
    | { kind: 'delete'; reason: string }
    /** In the target API, not on Camera yet. Move the entry to the area's `current` table when it lands. */
    | { kind: 'add' }

/**
 * One input of an operation, the same on every surface: a named MCP argument, and on the CLI a
 * positional argument when required, otherwise a flag (`--no-<name>` for a switch that is on by
 * default, `--<name>` for one that is off, `--<name> <value>` for the rest).
 */
export interface OperationParameter {
    /** The library's own name for it (`focalLengthMillimetres`); kebab-case on the CLI. */
    name: string
    /** `time` is ISO 8601 text, given to the library as a Date. */
    type: 'text' | 'number' | 'switch' | 'choice' | 'time'
    choices?: readonly string[]
    required?: boolean
    /** A switch's value when it is not given. */
    default?: boolean
    description: string
}

/** A CLI-only flag, for behaviour the command adds around the operation (`--duration`). */
export interface CommandLineFlag {
    name: `--${string}`
    value?: string
    description: string
}

/** How an operation appears on a surface other than the library. */
export interface OperationSurfaces {
    /** MCP tool: `camera_` + snake_case unless overridden; `omitted` says why it is not offered. */
    mcp?: { name?: string } | { omitted: string }
    /**
     * CLI command: `darkgrade camera ` + kebab-case unless overridden; `omitted` says why.
     * `topLevelCommand` replaces `darkgrade camera <command>` with `darkgrade <topLevelCommand>`.
     */
    cli?:
        | {
              command?: string
              topLevelCommand?: string
              flags?: readonly CommandLineFlag[]
          }
        | { omitted: string }
}

export interface OperationEntry {
    area: OperationArea
    disposition: Disposition
    /** What it does, in the plan's words. Required for operations that stay or become public. */
    summary?: string
    /** The operation's inputs, in the library's argument order. */
    parameters?: readonly OperationParameter[]
    surfaces?: OperationSurfaces
}

/** One area's table: methods on Camera today, and target operations still to land. */
export interface AreaOperationTable {
    current: Readonly<Record<string, OperationEntry>>
    planned: Readonly<Record<string, OperationEntry>>
}
