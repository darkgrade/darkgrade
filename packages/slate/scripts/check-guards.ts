// bun run --cwd packages/slate check:guards [-- --update]
//
// Strict guards that keep the public API from growing back:
//   1. No vendor name in the main entry's exports or on Camera, and no getInstance. Vendor drivers
//      and raw access are in @darkgrade/slate/protocol.
//   2. The escape budget: `any`, `as never` and `as unknown as` per file in src/. A file may never
//      exceed its budget, and a budget above the current count fails too, so the count only goes
//      down: `--update` lowers budgets to the current counts (never raises them).
//   3. Surface parity: the committed operation list (src/runtime/camera-operations.ts, written by
//      scripts/generate-camera-operations.ts) is what Camera generates today, and has every Camera
//      method but the events, each with a summary from its doc comment.
import { Camera } from '@camera/index'
import { cameraOperationsPath, cameraOperationsSource } from '@scripts/generate-camera-operations'
import { surfaceOperations } from '@runtime/operations'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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

function checkSurfaces() {
    if (readFileSync(cameraOperationsPath, 'utf8') !== cameraOperationsSource())
        failures.push(
            `${relative(packageRoot, cameraOperationsPath)} is not what Camera generates today: run bun run --cwd packages/slate generate:operations`
        )
    const generated = new Map(surfaceOperations().map(operation => [operation.name, operation]))
    const methods = [...Object.getOwnPropertyNames(Camera.prototype), 'discover'].filter(
        name => !['constructor', 'on', 'off'].includes(name)
    )
    const missing = methods.filter(name => !generated.has(name))
    if (missing.length) failures.push(`Camera methods missing from the generated MCP and CLI operations: ${missing.join(', ')}`)
    const undocumented = [...generated.values()].filter(operation => operation.summary === operation.name).map(operation => operation.name)
    if (undocumented.length) failures.push(`Camera methods without a doc comment for their MCP tool and command: ${undocumented.join(', ')}`)
}

/** Tracked paths that look like a vendor SDK's files: native libraries, SDK names, Nikon modules. */
const sdkArtifactPatterns = [
    /\.(dylib|dll|so(\.\d+)*|a|lib|md3)$/i,
    /\.(framework|bundle)(\/|$)/i,
    /(^|\/)(EDSDK|EdsImage|DPPLib)[^/]*$/i,
    /(^|\/)(CrSDK|Cr_Core|Cr_PTP|CrAdapter|libCr_|ICrCamera)[^/]*$/i,
    /(^|\/)(I?Cr[A-Z]\w*|IDeviceCallback)\.(h|hpp)$/,
    /(^|\/)[^/]*(CameraRemote|Camera_Remote)[^/]*$/i,
    /(^|\/)(Maid3|NkdPTP|NkRoyalmile|Type0\d{3})[^/]*$/i,
    /(^|\/)(XSDK|XAPI|FTLPTP|OlympusCameraKit|OMCapture|LMX_func)[^/]*$/i,
]
/** Tracked files that match a pattern but are not vendor SDK files, each with why. */
const sdkArtifactAllowlist: Record<string, string> = {}

function checkVendorSdkFiles() {
    const repositoryRoot = join(packageRoot, '../..')
    let tracked: string[]
    try {
        tracked = execFileSync('git', ['ls-files', '-z'], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            maxBuffer: 64 << 20,
        })
            .split('\0')
            .filter(Boolean)
    } catch {
        failures.push('Cannot list tracked files with git ls-files: run check:guards in a git checkout')
        return
    }
    const matching = tracked.filter(path => sdkArtifactPatterns.some(pattern => pattern.test(path)))
    for (const path of matching.filter(path => !(path in sdkArtifactAllowlist)))
        failures.push(
            `${path} looks like a vendor SDK file. SDKs stay outside the repository (AGENTS.md, Vendor SDKs).`
        )
    for (const path of Object.keys(sdkArtifactAllowlist).filter(path => !matching.includes(path)))
        failures.push(`SDK file allowlist entry ${path} no longer matches a tracked file: remove it`)
}

/** Native PTP code: USB and PTP/IP transports, PTP itself and every vendor driver but the SDK backend. */
const nativeDirectories = ['src/transport/usb', 'src/transport/ip', 'src/ptp', 'src/vendors']
const sdkModule = (path: string) =>
    /^src\/vendors\/sony\/sdk-[^/]*$/.test(path) || path.startsWith('src/transport/sony-remote/')
/** Native modules allowed one SDK import, as `file -> module`, each with why. */
const sdkImportAllowlist: Record<string, string> = {}

function importedModules(file: ts.SourceFile): string[] {
    const specifiers: string[] = []
    const visit = (node: ts.Node) => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        )
            specifiers.push(node.moduleSpecifier.text)
        if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            const callee = node.expression
            if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require'))
                specifiers.push(node.arguments[0].text)
        }
        ts.forEachChild(node, visit)
    }
    visit(file)
    return specifiers
}

function resolvedModule(fromPath: string, specifier: string): string {
    const alias = /^@(contribute|workflows|camera|core|transport|ptp|vendors|runtime|cli)\/(.*)$/.exec(specifier)
    if (alias) return `src/${alias[1]}/${alias[2]}`.replace(/\.(ts|tsx|js|mjs)$/, '')
    if (!specifier.startsWith('.')) return specifier
    return relative(packageRoot, resolve(dirname(join(packageRoot, fromPath)), specifier)).replace(
        /\.(ts|tsx|js|mjs)$/,
        ''
    )
}

function checkNativeSdkImports() {
    const used = new Set<string>()
    for (const directory of nativeDirectories)
        for (const absolute of ts.sys.readDirectory(join(packageRoot, directory), ['.ts', '.tsx'])) {
            const path = relative(packageRoot, absolute)
            if (sdkModule(path)) continue
            const file = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true)
            for (const specifier of importedModules(file)) {
                const target = resolvedModule(path, specifier)
                if (!sdkModule(target)) continue
                const entry = `${path} -> ${target}`
                if (entry in sdkImportAllowlist) used.add(entry)
                else
                    failures.push(
                        `${path} imports the SDK backend ${specifier}. USB and native PTP never use a vendor SDK (AGENTS.md, Vendor SDKs).`
                    )
            }
        }
    for (const entry of Object.keys(sdkImportAllowlist).filter(entry => !used.has(entry)))
        failures.push(`SDK import allowlist entry ${entry} no longer matches an import: remove it`)
}

checkVendorNames()
checkEscapeBudget()
checkSurfaces()
checkVendorSdkFiles()
checkNativeSdkImports()
for (const note of notes) console.log(note)
if (failures.length) {
    for (const failure of failures) console.error(`✗ ${failure}`)
    process.exit(1)
}
console.log('Guards passed: vendor names, escape budget, operation table and vendor SDKs')
