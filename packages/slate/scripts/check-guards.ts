// bun run --cwd packages/slate check:guards [-- --update]
//
// Strict guards that keep the public API from growing back:
//   1. No vendor name in the main entry's exports or on Camera, and no getInstance. Vendor drivers
//      and raw access are in @darkgrade/slate/protocol.
//   2. The escape budget: `any`, `as never` and `as unknown as` per file in src/. A file may never
//      exceed its budget, and a budget above the current count fails too, so the count only goes
//      down: `--update` lowers budgets to the current counts (never raises them).
//   3. Surface parity: the generated operation list (scripts/generate-camera-operations.ts) has
//      every Camera method but the events, each with a summary from its doc comment.
import { Camera } from '@camera/index'
import { writeCameraOperations } from '@scripts/generate-camera-operations'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const packageRoot = join(import.meta.dirname, '..')
const guardDirectory = join(import.meta.dirname, 'guards')
const update = process.argv.includes('--update')
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
    const exported = mainEntryExports().filter(name => vendorPattern.test(name))
    const members = cameraMembers().filter(name => vendorPattern.test(name) || name === 'getInstance')
    for (const name of exported)
        failures.push(`Vendor-named main-entry export: ${name}. Export it from @darkgrade/slate/protocol, or name it generically.`)
    for (const name of members)
        failures.push(`Vendor-named Camera member: ${name}. Use the generic API, or protocolSession(camera) for raw access.`)
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
    if (shrinkable && !update)
        failures.push(`The escape budget is above the current count in ${shrinkable} places: run check:guards -- --update`)
    const total = (counts: Record<string, EscapeCounts>) =>
        Object.values(counts).reduce((sum, count) => sum + count.any + count.asNever + count.asUnknownAs, 0)
    notes.push(`Escape budget: ${total(current)} in use of ${total(budget)} allowed`)
    if (update) {
        const lowered: Record<string, EscapeCounts> = {}
        for (const [path, counts] of Object.entries(current).sort(([left], [right]) => left.localeCompare(right))) {
            const allowed = budget[path] ?? { any: 0, asNever: 0, asUnknownAs: 0 }
            lowered[path] = {
                any: Math.min(counts.any, allowed.any),
                asNever: Math.min(counts.asNever, allowed.asNever),
                asUnknownAs: Math.min(counts.asUnknownAs, allowed.asUnknownAs),
            }
        }
        writeJsonLines('escape-budget.json', lowered)
    }
}

async function checkSurfaces() {
    writeCameraOperations()
    // Loaded after writing, since the operations module imports the generated list.
    const { surfaceOperations } = await import('@runtime/operations')
    const generated = new Map(surfaceOperations().map(operation => [operation.name, operation]))
    const methods = [...Object.getOwnPropertyNames(Camera.prototype), 'discover'].filter(
        name => !['constructor', 'on', 'off'].includes(name)
    )
    const missing = methods.filter(name => !generated.has(name))
    if (missing.length) failures.push(`Camera methods missing from the generated MCP and CLI operations: ${missing.join(', ')}`)
    const undocumented = [...generated.values()].filter(operation => operation.summary === operation.name).map(operation => operation.name)
    if (undocumented.length) failures.push(`Camera methods without a doc comment for their MCP tool and command: ${undocumented.join(', ')}`)
}

checkVendorNames()
checkEscapeBudget()
await checkSurfaces()
for (const note of notes) console.log(note)
if (failures.length) {
    for (const failure of failures) console.error(`✗ ${failure}`)
    process.exit(1)
}
console.log('Guards passed: vendor names, escape budget and operation table')
