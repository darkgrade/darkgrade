// bun run --cwd packages/slate check:guards [-- --update]
// (`--initialize` records every current violation; it was run once, when the guards were added.)
//
// Guards that keep the public API from growing back, in allowlist mode: today's violations are
// listed in scripts/guards/*.json and allowed; anything new fails. Slices shrink the lists.
//   1. Vendor names in the main entry's exports and on Camera (including getInstance).
//   2. The escape budget: `any`, `as never` and `as unknown as` per file in src/. A file may never
//      exceed its budget; `--update` lowers budgets to the current counts (never raises them).
//   3. Operation-table parity: every Camera method has a table entry and vice versa.
import { Camera } from '@camera/index'
import { cameraOperationTable, cameraStaticOperationTable, plannedOperationTable } from '@camera/operations/table'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const packageRoot = join(import.meta.dirname, '..')
const guardDirectory = join(import.meta.dirname, 'guards')
const initialize = process.argv.includes('--initialize')
const update = initialize || process.argv.includes('--update')
const failures: string[] = []
const notes: string[] = []

const vendorPattern = /sony|canon|nikon|fujifilm|panasonic|olympus|leica|sigma|ricoh|pentax|hasselblad/i

function readJson<T>(name: string): T {
    return JSON.parse(readFileSync(join(guardDirectory, name), 'utf8')) as T
}

/** One entry per line, so parallel edits to different entries merge cleanly. */
function writeJsonLines(name: string, value: Record<string, unknown>) {
    const entries = Object.entries(value).map(([key, item]) => `    ${JSON.stringify(key)}: ${JSON.stringify(item)}`)
    writeFileSync(join(guardDirectory, name), `{\n${entries.join(',\n')}\n}\n`)
}

const program = ts.createProgram({
    rootNames: [join(packageRoot, 'src/index.ts')],
    options: ts.parseJsonConfigFileContent(
        ts.readConfigFile(join(packageRoot, 'tsconfig.json'), ts.sys.readFile).config,
        ts.sys,
        packageRoot
    ).options,
})
const checker = program.getTypeChecker()

function mainEntryExports(): string[] {
    const source = program.getSourceFile(join(packageRoot, 'src/index.ts'))
    const symbol = source && checker.getSymbolAtLocation(source)
    if (!symbol) throw new Error('Cannot read the main entry exports')
    return checker.getExportsOfModule(symbol).map(exported => exported.getName())
}

function cameraMembers(): string[] {
    return [...Object.getOwnPropertyNames(Camera.prototype), ...Object.getOwnPropertyNames(Camera)].filter(
        name => !['constructor', 'prototype', 'length', 'name'].includes(name)
    )
}

function checkVendorNames() {
    const allowed = readJson<{ exports: string[]; cameraMembers: string[] }>('vendor-names.json')
    const exported = mainEntryExports().filter(name => vendorPattern.test(name))
    const members = cameraMembers().filter(name => vendorPattern.test(name) || name === 'getInstance')
    for (const [kind, found, list] of [
        ['main-entry export', exported, allowed.exports],
        ['Camera member', members, allowed.cameraMembers],
    ] as const) {
        for (const name of found)
            if (!list.includes(name)) failures.push(`New vendor-named ${kind}: ${name}. Use the generic API instead.`)
        const stale = list.filter(name => !found.includes(name))
        if (stale.length) notes.push(`Remove from scripts/guards/vendor-names.json (${kind}s gone): ${stale.join(', ')}`)
    }
    if (!update) return
    // --update only drops names that are gone; --initialize records what exists.
    const keep = (found: readonly string[], list: readonly string[]) =>
        [...found].filter(name => initialize || list.includes(name)).sort()
    const lines = (names: string[]) => names.map(name => `        ${JSON.stringify(name)}`).join(',\n')
    writeFileSync(
        join(guardDirectory, 'vendor-names.json'),
        `{\n    "exports": [\n${lines(keep(exported, allowed.exports))}\n    ],\n` +
            `    "cameraMembers": [\n${lines(keep(members, allowed.cameraMembers))}\n    ]\n}\n`
    )
}

interface EscapeCounts {
    any: number
    asNever: number
    asUnknownAs: number
}

function countEscapes(file: ts.SourceFile): EscapeCounts {
    const counts: EscapeCounts = { any: 0, asNever: 0, asUnknownAs: 0 }
    const visit = (node: ts.Node) => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) counts.any++
        if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.NeverKeyword) counts.asNever++
        if (
            ts.isAsExpression(node) &&
            ts.isAsExpression(node.expression) &&
            node.expression.type.kind === ts.SyntaxKind.UnknownKeyword
        )
            counts.asUnknownAs++
        ts.forEachChild(node, visit)
    }
    visit(file)
    return counts
}

function checkEscapeBudget() {
    const budget = readJson<Record<string, EscapeCounts>>('escape-budget.json')
    const current: Record<string, EscapeCounts> = {}
    const sourceFiles = ts.sys
        .readDirectory(join(packageRoot, 'src'), ['.ts', '.tsx'])
        .filter(path => !path.endsWith('.d.ts'))
    for (const path of sourceFiles) {
        const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
        const counts = countEscapes(file)
        if (counts.any + counts.asNever + counts.asUnknownAs) current[relative(packageRoot, path)] = counts
    }
    let shrinkable = 0
    for (const [path, counts] of Object.entries(current)) {
        const allowed = budget[path] ?? { any: 0, asNever: 0, asUnknownAs: 0 }
        for (const key of ['any', 'asNever', 'asUnknownAs'] as const) {
            if (counts[key] > allowed[key])
                failures.push(`${path}: ${counts[key]} ${key} escapes, budget ${allowed[key]}. Type it instead.`)
            if (counts[key] < allowed[key]) shrinkable++
        }
    }
    for (const path of Object.keys(budget)) if (!current[path]) shrinkable++
    const total = (counts: Record<string, EscapeCounts>) =>
        Object.values(counts).reduce((sum, count) => sum + count.any + count.asNever + count.asUnknownAs, 0)
    notes.push(`Escape budget: ${total(current)} in use of ${total(budget)} allowed`)
    if (shrinkable) notes.push(`The escape budget can shrink in ${shrinkable} places: run check:guards -- --update`)
    if (update) {
        const lowered: Record<string, EscapeCounts> = {}
        for (const [path, counts] of Object.entries(current).sort(([left], [right]) => left.localeCompare(right))) {
            const allowed = budget[path] ?? (initialize ? counts : { any: 0, asNever: 0, asUnknownAs: 0 })
            lowered[path] = {
                any: Math.min(counts.any, allowed.any),
                asNever: Math.min(counts.asNever, allowed.asNever),
                asUnknownAs: Math.min(counts.asUnknownAs, allowed.asUnknownAs),
            }
        }
        writeJsonLines('escape-budget.json', lowered)
    }
}

function checkOperationTable() {
    const methods = Object.getOwnPropertyNames(Camera.prototype).filter(name => name !== 'constructor')
    const missing = methods.filter(name => !(name in cameraOperationTable))
    const extra = Object.keys(cameraOperationTable).filter(name => !methods.includes(name))
    const planned = Object.keys(plannedOperationTable).filter(name => methods.includes(name))
    if (missing.length) failures.push(`Camera methods missing from the operation table: ${missing.join(', ')}`)
    if (extra.length) failures.push(`Operation table entries not on Camera: ${extra.join(', ')}`)
    if (planned.length) failures.push(`Planned operations now on Camera; move them to current: ${planned.join(', ')}`)
    if (!('discover' in cameraStaticOperationTable) || typeof Camera.discover !== 'function')
        failures.push('Camera.discover and its table entry differ')
}

checkVendorNames()
checkEscapeBudget()
checkOperationTable()
for (const note of notes) console.log(note)
if (failures.length) {
    for (const failure of failures) console.error(`✗ ${failure}`)
    process.exit(1)
}
console.log('Guards passed: vendor names, escape budget and operation table')
