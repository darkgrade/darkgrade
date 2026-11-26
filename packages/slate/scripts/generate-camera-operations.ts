import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Generates the public operation list the MCP tools and the CLI serve, from Camera's own
 * TypeScript: every public method (and `Camera.discover`), its summary from the doc comment, and
 * its inputs from the signature. Positional parameters stay positional; an options object's
 * scalar properties become named inputs of that argument. Events (`on`, `off`) are library only.
 * Committed as `src/runtime/camera-operations.ts`, so the source tree builds without running a
 * script (Matrix and the bench CI build `src` alone); `check:guards` fails when it is out of date.
 * Run `bun run --cwd packages/slate generate:operations` after changing a Camera method.
 */

const packageDirectory = join(import.meta.dirname, '..')
export const cameraOperationsPath = join(packageDirectory, 'src/runtime/camera-operations.ts')
interface GeneratedParameter {
    name: string
    type: 'text' | 'number' | 'switch' | 'choice' | 'time'
    choices?: string[]
    required?: true
    description: string
    /** The method argument this input fills, counting from 0. */
    argument: number
    /** Set when the input is a property of an options object in that argument. */
    property?: string
}

interface GeneratedOperation {
    name: string
    static?: true
    summary: string
    parameters: GeneratedParameter[]
}

const libraryOnlyMethods = new Set(['on', 'off', 'constructor'])

function firstSentence(text: string): string {
    const flattened = text.replace(/\s+/g, ' ').trim()
    const match = /^(.+?[.!?])(?:\s|$)/.exec(flattened.replace(/\b(e\.g|i\.e|etc)\./g, '$1․'))
    return (match ? match[1]! : flattened).replace(/․/g, '.').replace(/\.$/, '')
}

function createChecker(): { checker: ts.TypeChecker; camera: ts.ClassDeclaration; controls?: ts.Symbol } {
    const configPath = join(packageDirectory, 'tsconfig.json')
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
    if (!parsed) throw new Error(`Cannot read ${configPath}`)
    const cameraFile = join(packageDirectory, 'src/camera/index.ts')
    const controlsFile = join(packageDirectory, 'src/camera/controls.ts')
    const program = ts.createProgram([cameraFile, controlsFile], { ...parsed.options, noEmit: true })
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(cameraFile)
    const camera = source?.statements.find(
        (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === 'Camera'
    )
    if (!camera) throw new Error('Camera class not found in src/camera/index.ts')
    const controlsSource = program.getSourceFile(controlsFile)
    const controls = controlsSource && checker.getSymbolAtLocation(controlsSource)
    const definitions = controls && checker.getExportsOfModule(controls).find(symbol => symbol.name === 'cameraControlDefinitions')
    return { checker, camera, controls: definitions }
}

function generate(): GeneratedOperation[] {
    const { checker, camera, controls } = createChecker()
    const declarations = camera.name ? checker.getSymbolAtLocation(camera.name) : undefined
    if (!declarations) throw new Error('Camera has no symbol')
    const instanceType = checker.getDeclaredTypeOfSymbol(declarations)
    const staticType = checker.getTypeOfSymbolAtLocation(declarations, camera)

    const settingLabel = (method: string): string | undefined => {
        if (!controls) return undefined
        const id = method.slice(3, 4).toLowerCase() + method.slice(4)
        const definition = checker.getTypeOfSymbol(controls).getProperty(id)
        const label = definition && checker.getTypeOfSymbol(definition).getProperty('label')
        const labelType = label && checker.getTypeOfSymbol(label)
        if (!labelType?.isStringLiteral()) return undefined
        // `Shutter speed` reads `shutter speed` mid-sentence; `ISO` stays `ISO`.
        return /^[A-Z][a-z]/.test(labelType.value) ? labelType.value[0]!.toLowerCase() + labelType.value.slice(1) : labelType.value
    }

    const describe = (symbol: ts.Symbol): string => ts.displayPartsToString(symbol.getDocumentationComment(checker))

    const classify = (type: ts.Type): Pick<GeneratedParameter, 'type' | 'choices'> | undefined => {
        const constrained = type.flags & ts.TypeFlags.Instantiable ? (checker.getBaseConstraintOfType(type) ?? type) : type
        const present = checker.getNonNullableType(constrained)
        const members = present.isUnion() ? present.types : [present]
        if (members.every(member => member.flags & ts.TypeFlags.BooleanLike)) return { type: 'switch' }
        if (members.every(member => member.flags & ts.TypeFlags.NumberLike)) return { type: 'number' }
        if (members.every(member => member.isStringLiteral()))
            return { type: 'choice', choices: members.map(member => (member as ts.StringLiteralType).value) }
        if (members.length === 1 && present.getSymbol()?.name === 'Date') return { type: 'time' }
        // Text reaches what the library also accepts in other forms (a shutter duration object).
        if (members.some(member => member.flags & ts.TypeFlags.StringLike)) return { type: 'text' }
        return undefined
    }

    const isOptionsObject = (type: ts.Type) => {
        const present = checker.getNonNullableType(type)
        return !!(present.flags & ts.TypeFlags.Object) && present.getCallSignatures().length === 0 && present.getSymbol()?.name !== 'Date'
    }

    const parametersOf = (signature: ts.Signature, method: string, location: ts.Node): GeneratedParameter[] => {
        const parameterDocs = new Map(
            signature
                .getJsDocTags()
                .filter(tag => tag.name === 'param' && tag.text)
                .map(tag => {
                    const [name, ...text] = tag.text!
                    return [ts.displayPartsToString([name!]), ts.displayPartsToString(text).replace(/^\s*-?\s*/, '')] as const
                })
        )
        const parameters: GeneratedParameter[] = []
        signature.getParameters().forEach((parameter, argument) => {
            const declaration = parameter.valueDeclaration
            if (declaration && ts.isParameter(declaration) && declaration.dotDotDotToken) return
            const type = checker.getTypeOfSymbolAtLocation(parameter, location)
            const optional = !!(declaration && ts.isParameter(declaration) && (declaration.questionToken || declaration.initializer))
            const scalar = classify(type)
            if (scalar) {
                const label = method.startsWith('set') && parameter.name === 'value' ? settingLabel(method) : undefined
                parameters.push({
                    name: parameter.name,
                    ...scalar,
                    ...(!optional && { required: true as const }),
                    description: parameterDocs.get(parameter.name) ?? (label ? `the new ${label}` : parameter.name),
                    argument,
                })
                return
            }
            if (!isOptionsObject(type)) throw new Error(`${method}: cannot describe parameter ${parameter.name}`)
            for (const property of checker.getPropertiesOfType(checker.getNonNullableType(type))) {
                const propertyScalar = classify(checker.getTypeOfSymbolAtLocation(property, location))
                if (!propertyScalar) continue
                parameters.push({
                    name: property.name,
                    ...propertyScalar,
                    ...(!optional && !(property.flags & ts.SymbolFlags.Optional) && { required: true as const }),
                    description: describe(property).replace(/\s+/g, ' ').trim() || property.name,
                    argument,
                    property: property.name,
                })
            }
        })
        return parameters
    }

    const operationOf = (symbol: ts.Symbol, isStatic: boolean): GeneratedOperation | undefined => {
        const name = symbol.name
        if (libraryOnlyMethods.has(name) || name.startsWith('_') || name === 'prototype') return undefined
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
        if (declaration && ts.getCombinedModifierFlags(declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return undefined
        const signatures = checker.getTypeOfSymbolAtLocation(symbol, camera).getCallSignatures()
        // The last overload is the general one (takePhoto's `destination?: PhotoDestination`).
        const signature = signatures.at(-1)
        if (!signature) return undefined
        const label = /^[gs]et[A-Z]/.test(name) ? settingLabel(name) : undefined
        const documented = firstSentence(describe(symbol))
        const summary =
            documented ||
            (label && name.startsWith('get') ? `The current ${label}` : '') ||
            (label ? `Sets the ${label} and returns the value read back` : name)
        return { name, ...(isStatic && { static: true as const }), summary, parameters: parametersOf(signature, name, camera) }
    }

    return [
        ...checker.getPropertiesOfType(staticType).flatMap(symbol => operationOf(symbol, true) ?? []),
        ...checker.getPropertiesOfType(instanceType).flatMap(symbol => operationOf(symbol, false) ?? []),
    ]
}

/** The module the list is committed as, generated from Camera's current source. */
export function cameraOperationsSource(): string {
    return (
        '// Generated by scripts/generate-camera-operations.ts from Camera\'s signatures and doc comments.\n' +
        '// Do not edit: run `bun run --cwd packages/slate generate:operations`.\n' +
        'import type { CameraOperationDescription } from \'@runtime/operations\'\n\n' +
        `export const cameraOperations: readonly CameraOperationDescription[] = ${JSON.stringify(generate(), null, 4)}\n`
    )
}

/** Writes the list when it changed; returns its path. */
export function writeCameraOperations(): string {
    const content = cameraOperationsSource()
    if (!existsSync(cameraOperationsPath) || readFileSync(cameraOperationsPath, 'utf8') !== content) writeFileSync(cameraOperationsPath, content)
    return cameraOperationsPath
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(writeCameraOperations())
