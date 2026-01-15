import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import ts from 'typescript'

const PTP_SOURCE_DIR = join(__dirname, '../../packages/link/src/ptp')
const DOCS_OUTPUT_DIR = join(__dirname, 'ptp-reference')

interface ParameterEnumValue {
    value: string
    name: string
    description: string
}

interface ExtractedParameter {
    name: string
    description: string
    required: boolean
    defaultValue?: string
    enumValues?: ParameterEnumValue[]
}

interface ExtractedDefinition {
    exportName: string
    code: string
    name: string
    description: string
    properties: Map<string, any>
    operationParameters?: ExtractedParameter[]
    responseParameters?: ExtractedParameter[]
    enumValues?: ParameterEnumValue[]
    codecType?: 'base' | 'enum' | 'custom' | 'array'
    defaultValue?: string
    currentValue?: string
}

interface ExtractedVendorID {
    name: string
    value: string
    vendorName: string
}

interface ExtractedType {
    name: string
    kind: 'interface' | 'type' | 'enum'
    properties?: Array<{ name: string; type: string; optional: boolean }>
    description?: string
}

interface ExtractedDataset {
    name: string
    properties: Array<{ name: string; type: string; optional: boolean }>
    description?: string
}

function extractStringLiteral(node: ts.Node): string | undefined {
    if (ts.isStringLiteral(node)) {
        return node.text
    }
    return undefined
}

function extractNumericLiteral(node: ts.Node): string | undefined {
    if (ts.isNumericLiteral(node)) {
        return node.text
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
        const operand = extractNumericLiteral(node.operand)
        return operand ? `-${operand}` : undefined
    }
    return undefined
}

function extractPropertyValue(node: ts.Expression): any {
    if (ts.isStringLiteral(node)) {
        return node.text
    }
    if (ts.isNumericLiteral(node)) {
        // Check if it's hex
        if (node.text.startsWith('0x')) {
            return node.text
        }
        return node.text
    }
    if (ts.isIdentifier(node)) {
        return node.text
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
        const operand = extractPropertyValue(node.operand)
        return operand ? `-${operand}` : undefined
    }
    return undefined
}

function extractEnumValues(codecExpression: ts.Expression): ParameterEnumValue[] | undefined {
    // Handle arrow function with createEnumCodec call
    if (ts.isArrowFunction(codecExpression) && codecExpression.body) {
        const body = codecExpression.body
        
        // The body should be a CallExpression to createEnumCodec
        if (ts.isCallExpression(body) && body.arguments.length >= 2) {
            let enumArrayArg = body.arguments[1]
            
            // Unwrap AsExpression if present (e.g., [...] as const)
            if (ts.isAsExpression(enumArrayArg)) {
                enumArrayArg = enumArrayArg.expression
            }
            
            if (ts.isArrayLiteralExpression(enumArrayArg)) {
                return extractEnumValuesFromArray(enumArrayArg)
            }
        }
        
        // Handle arrow function with new EnumCodec(...)
        if (ts.isNewExpression(body)) {
            if (ts.isIdentifier(body.expression) && body.expression.text === 'EnumCodec' && body.arguments && body.arguments.length >= 2) {
                let enumArrayArg = body.arguments[1]
                
                // Unwrap AsExpression if present
                if (ts.isAsExpression(enumArrayArg)) {
                    enumArrayArg = enumArrayArg.expression
                }
                
                if (ts.isArrayLiteralExpression(enumArrayArg)) {
                    return extractEnumValuesFromArray(enumArrayArg)
                }
            }
        }
    }
    
    // Handle direct new EnumCodec(...) expression
    if (ts.isNewExpression(codecExpression)) {
        if (ts.isIdentifier(codecExpression.expression) && codecExpression.expression.text === 'EnumCodec' && codecExpression.arguments && codecExpression.arguments.length >= 2) {
            let enumArrayArg = codecExpression.arguments[1]
            
            // Unwrap AsExpression if present
            if (ts.isAsExpression(enumArrayArg)) {
                enumArrayArg = enumArrayArg.expression
            }
            
            if (ts.isArrayLiteralExpression(enumArrayArg)) {
                return extractEnumValuesFromArray(enumArrayArg)
            }
        }
    }
    
    return undefined
}

function extractEnumValuesFromArray(enumArrayArg: ts.ArrayLiteralExpression): ParameterEnumValue[] | undefined {
    const values: ParameterEnumValue[] = []
    
    for (const element of enumArrayArg.elements) {
        if (ts.isObjectLiteralExpression(element)) {
            let value: string | undefined
            let name: string | undefined
            let description: string | undefined
            
            for (const prop of element.properties) {
                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                    const propName = prop.name.text
                    
                    if (propName === 'value') {
                        const val = extractPropertyValue(prop.initializer)
                        if (val !== undefined) {
                            // Format hex values properly
                            if (typeof val === 'string' && val.startsWith('0x')) {
                                value = val
                            } else if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val))) {
                                const num = typeof val === 'number' ? val : parseInt(val, 10)
                                value = `0x${num.toString(16)}`
                            } else {
                                value = String(val)
                            }
                        }
                    } else if (propName === 'name') {
                        name = extractStringLiteral(prop.initializer)
                    } else if (propName === 'description') {
                        description = extractStringLiteral(prop.initializer)
                    }
                }
            }
            
            if (value !== undefined && name && description) {
                values.push({ value, name, description })
            }
        }
    }
    
    return values.length > 0 ? values : undefined
}

function extractParameters(arrayLiteral: ts.ArrayLiteralExpression): ExtractedParameter[] {
    const params: ExtractedParameter[] = []
    
    for (const element of arrayLiteral.elements) {
        if (ts.isObjectLiteralExpression(element)) {
            let name: string | undefined
            let description: string | undefined
            let required = false
            let defaultValue: string | undefined
            let enumValues: ParameterEnumValue[] | undefined
            
            for (const prop of element.properties) {
                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                    const propName = prop.name.text
                    
                    if (propName === 'name') {
                        name = extractStringLiteral(prop.initializer)
                    } else if (propName === 'description') {
                        description = extractStringLiteral(prop.initializer)
                    } else if (propName === 'required') {
                        if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                            required = true
                        }
                    } else if (propName === 'defaultValue') {
                        const value = extractPropertyValue(prop.initializer)
                        if (value !== undefined) {
                            defaultValue = String(value)
                        }
                    } else if (propName === 'codec') {
                        enumValues = extractEnumValues(prop.initializer)
                    }
                }
            }
            
            if (name && description) {
                params.push({ name, description, required, defaultValue, enumValues })
            }
        }
    }
    
    return params
}

function extractDefinitionsFromArray(arrayLiteral: ts.ArrayLiteralExpression): ExtractedDefinition[] {
    const definitions: ExtractedDefinition[] = []
    
    for (const element of arrayLiteral.elements) {
        if (ts.isObjectLiteralExpression(element)) {
            let code: string | undefined
            let name: string | undefined
            let description: string | undefined
            const properties = new Map<string, any>()
            let enumValues: ParameterEnumValue[] | undefined
            let codecType: 'base' | 'enum' | 'custom' | 'array' | undefined
            let defaultValue: string | undefined
            let currentValue: string | undefined
            
            for (const prop of element.properties) {
                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                    const propName = prop.name.text
                    
                    if (propName === 'code') {
                        const value = extractPropertyValue(prop.initializer)
                        if (value) {
                            code = value.startsWith('0x') ? value : `0x${parseInt(value).toString(16)}`
                        }
                    } else if (propName === 'name') {
                        name = extractStringLiteral(prop.initializer)
                    } else if (propName === 'description') {
                        description = extractStringLiteral(prop.initializer)
                    } else if (propName === 'codec') {
                        // Extract enum values from codec
                        enumValues = extractEnumValues(prop.initializer)
                        if (enumValues) {
                            codecType = 'enum'
                        } else {
                            // Check if it's a base codec, custom codec, or array codec
                            codecType = detectCodecType(prop.initializer)
                        }
                    } else if (propName === 'defaultValue') {
                        const value = extractPropertyValue(prop.initializer)
                        if (value !== undefined) {
                            defaultValue = String(value)
                        }
                    } else if (propName === 'currentValue') {
                        const value = extractPropertyValue(prop.initializer)
                        if (value !== undefined) {
                            currentValue = String(value)
                        }
                    } else {
                        // Store other properties
                        const value = extractPropertyValue(prop.initializer)
                        if (value !== undefined) {
                            properties.set(propName, value)
                        }
                    }
                }
            }
            
            if (code && name && description) {
                definitions.push({
                    exportName: name, // Use name as exportName for array elements
                    code,
                    name,
                    description,
                    properties,
                    enumValues,
                    codecType,
                    defaultValue,
                    currentValue
                })
            }
        }
    }
    
    return definitions
}

function detectCodecType(codecExpression: ts.Expression): 'base' | 'enum' | 'custom' | 'array' | undefined {
    // Check for base codec reference (e.g., baseCodecs.uint8)
    if (ts.isPropertyAccessExpression(codecExpression)) {
        return 'base'
    }
    
    // Check for array codec (new ArrayCodec(...))
    if (ts.isNewExpression(codecExpression)) {
        if (ts.isIdentifier(codecExpression.expression) && codecExpression.expression.text === 'ArrayCodec') {
            return 'array'
        }
        // Check for CustomCodec or EnumCodec
        if (ts.isIdentifier(codecExpression.expression)) {
            const className = codecExpression.expression.text
            if (className === 'EnumCodec' || className.includes('Enum')) {
                return 'enum'
            }
            if (className === 'CustomCodec' || className.includes('Codec')) {
                return 'custom'
            }
        }
    }
    
    // Check for arrow function (codec builder)
    if (ts.isArrowFunction(codecExpression)) {
        const body = codecExpression.body
        if (ts.isCallExpression(body)) {
            if (ts.isIdentifier(body.expression)) {
                const funcName = body.expression.text
                if (funcName === 'createEnumCodec') {
                    return 'enum'
                }
                if (funcName.includes('Array')) {
                    return 'array'
                }
            }
        }
        if (ts.isNewExpression(body)) {
            if (ts.isIdentifier(body.expression)) {
                const className = body.expression.text
                if (className === 'ArrayCodec') {
                    return 'array'
                }
                if (className === 'EnumCodec') {
                    return 'enum'
                }
                if (className === 'CustomCodec' || className.includes('Codec')) {
                    return 'custom'
                }
            }
        }
        // Default for arrow functions is likely custom
        return 'custom'
    }
    
    return undefined
}

function escapeMdxType(typeString: string): string {
    // Escape angle brackets in type strings for MDX to prevent JSX parsing errors
    return typeString.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatType(type: ts.TypeNode): string {
    if (ts.isIdentifier(type)) {
        return type.text
    }
    // Handle parenthesized types: (A | B)[]
    if (ts.isParenthesizedTypeNode && ts.isParenthesizedTypeNode(type)) {
        return `(${formatType(type.type)})`
    }
    // Check by node kind as fallback
    if (type.kind === ts.SyntaxKind.ParenthesizedType) {
        const parenthesized = type as any
        if (parenthesized.type) {
            return `(${formatType(parenthesized.type)})`
        }
    }
    if (ts.isUnionTypeNode(type)) {
        return type.types.map(t => formatType(t)).join(' | ')
    }
    if (ts.isArrayTypeNode(type)) {
        const elementType = formatType(type.elementType)
        // Add parentheses if it's a union to make it clear: (A | B)[]
        if (ts.isUnionTypeNode(type.elementType)) {
            return `(${elementType})[]`
        }
        return `${elementType}[]`
    }
    if (ts.isTypeReferenceNode(type)) {
        if (ts.isIdentifier(type.typeName)) {
            const name = type.typeName.text
            if (type.typeArguments && type.typeArguments.length > 0) {
                const args = type.typeArguments.map(t => formatType(t)).join(', ')
                return `${name}<${args}>`
            }
            return name
        }
    }
    if (ts.isLiteralTypeNode(type)) {
        if (ts.isStringLiteral(type.literal)) {
            return `"${type.literal.text}"`
        }
        if (ts.isNumericLiteral(type.literal)) {
            return type.literal.text
        }
        // Check for boolean literals by kind
        if (type.literal.kind === ts.SyntaxKind.TrueKeyword || type.literal.kind === ts.SyntaxKind.FalseKeyword) {
            return type.literal.kind === ts.SyntaxKind.TrueKeyword ? 'true' : 'false'
        }
        // Check for null literal
        if (type.literal.kind === ts.SyntaxKind.NullKeyword) {
            return 'null'
        }
    }
    // Check for keyword types by kind
    switch (type.kind) {
        case ts.SyntaxKind.NumberKeyword:
            return 'number'
        case ts.SyntaxKind.StringKeyword:
            return 'string'
        case ts.SyntaxKind.BooleanKeyword:
            return 'boolean'
        case ts.SyntaxKind.AnyKeyword:
            return 'any'
        case ts.SyntaxKind.UnknownKeyword:
            return 'unknown'
        case ts.SyntaxKind.VoidKeyword:
            return 'void'
        case ts.SyntaxKind.NullKeyword:
            return 'null'
        case ts.SyntaxKind.UndefinedKeyword:
            return 'undefined'
        case ts.SyntaxKind.BigIntKeyword:
            return 'bigint'
        case ts.SyntaxKind.ObjectKeyword:
            return 'object'
    }
    if (ts.isTupleTypeNode(type)) {
        const elements = type.elements.map(t => {
            const formatted = formatType(t)
            // Handle optional tuple elements
            if (ts.isOptionalTypeNode(t)) {
                return `${formatType(t.type)}?`
            }
            return formatted
        })
        return `[${elements.join(', ')}]`
    }
    if (ts.isIntersectionTypeNode(type)) {
        return type.types.map(t => formatType(t)).join(' & ')
    }
    if (ts.isIndexedAccessTypeNode(type)) {
        return `${formatType(type.objectType)}[${formatType(type.indexType)}]`
    }
    if (ts.isTypeLiteralNode(type)) {
        // Handle object type literals like { [key: string]: T }
        const members = type.members
        if (members && members.length > 0) {
            // Check for index signature
            for (const member of members) {
                if (ts.isIndexSignatureDeclaration(member)) {
                    const keyType = member.parameters[0] && member.parameters[0].type 
                        ? formatType(member.parameters[0].type) 
                        : 'string'
                    const valueType = member.type ? formatType(member.type) : 'any'
                    return `Record<${keyType}, ${valueType}>`
                }
            }
            // If no index signature, it's a regular object type
            return 'object'
        }
        return 'object'
    }
    if (ts.isMappedTypeNode(type)) {
        // Try to extract key and value types
        if (type.type) {
            const valueType = formatType(type.type)
            return `Record<string, ${valueType}>`
        }
        return 'Record<string, any>'
    }
    return 'unknown'
}

async function extractVendorIDs(filePath: string): Promise<ExtractedVendorID[]> {
    const content = await readFile(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
    )
    
    const vendorIDs: ExtractedVendorID[] = []
    let vendorNames: Map<string, string> = new Map()
    
    function visit(node: ts.Node) {
        // Extract VendorIDs object
        if (ts.isVariableStatement(node)) {
            const modifiers = node.modifiers
            const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
            
            if (hasExport) {
                for (const declaration of node.declarationList.declarations) {
                    if (ts.isVariableDeclaration(declaration) && 
                        ts.isIdentifier(declaration.name) &&
                        declaration.name.text === 'VendorIDs' &&
                        declaration.initializer) {
                        
                        let objLiteral: ts.ObjectLiteralExpression | undefined
                        if (ts.isObjectLiteralExpression(declaration.initializer)) {
                            objLiteral = declaration.initializer
                        } else if (ts.isAsExpression(declaration.initializer) &&
                                   ts.isObjectLiteralExpression(declaration.initializer.expression)) {
                            objLiteral = declaration.initializer.expression
                        }
                        
                        if (objLiteral) {
                            for (const prop of objLiteral.properties) {
                                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                                    const name = prop.name.text
                                    const value = extractPropertyValue(prop.initializer)
                                    if (value) {
                                        const hexValue = value.startsWith('0x') ? value : `0x${parseInt(value).toString(16)}`
                                        vendorIDs.push({
                                            name,
                                            value: hexValue,
                                            vendorName: '' // Will be filled from VendorNames
                                        })
                                    }
                                }
                            }
                        }
                    }
                    
                    // Extract VendorNames mapping
                    if (ts.isVariableDeclaration(declaration) && 
                        ts.isIdentifier(declaration.name) &&
                        declaration.name.text === 'VendorNames' &&
                        declaration.initializer) {
                        
                        // VendorNames uses computed property names, so we need to match with VendorIDs
                        // For now, we'll extract it from the type annotation or try to parse the object
                        // This is a simplified approach - in practice, we'd need more sophisticated parsing
                    }
                }
            }
        }
        
        ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
    
    // Try to extract vendor names from the source code text
    const vendorNamesMatch = content.match(/VendorNames:\s*Record<VendorID,\s*string>\s*=\s*\{([^}]+)\}/s)
    if (vendorNamesMatch) {
        const namesText = vendorNamesMatch[1]
        for (const vid of vendorIDs) {
            const nameMatch = namesText.match(new RegExp(`\\[VendorIDs\\.${vid.name}\\]:\\s*['"]([^'"]+)['"]`))
            if (nameMatch) {
                vid.vendorName = nameMatch[1]
            }
        }
    }
    
    return vendorIDs
}

async function extractTypesFromFile(filePath: string): Promise<ExtractedType[]> {
    const content = await readFile(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
    )
    
    const types: ExtractedType[] = []
    
    function visit(node: ts.Node) {
        // Extract interfaces
        if (ts.isInterfaceDeclaration(node)) {
            const modifiers = node.modifiers
            const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
            
            if (hasExport) {
                const properties: Array<{ name: string; type: string; optional: boolean }> = []
                
                if (node.members) {
                    for (const member of node.members) {
                        if (ts.isPropertySignature(member)) {
                            const name = ts.isIdentifier(member.name) ? member.name.text : 'unknown'
                            const optional = member.questionToken !== undefined
                            const type = member.type ? formatType(member.type) : 'any'
                            properties.push({ name, type, optional })
                        } else if (ts.isIndexSignatureDeclaration(member)) {
                            // Handle index signatures: { [key: string]: T }
                            const keyType = member.parameters[0] && member.parameters[0].type 
                                ? formatType(member.parameters[0].type) 
                                : 'string'
                            const valueType = member.type ? formatType(member.type) : 'any'
                            properties.push({ 
                                name: `[${keyType}]`, 
                                type: valueType, 
                                optional: member.questionToken !== undefined 
                            })
                        }
                    }
                }
                
                types.push({
                    name: node.name.text,
                    kind: 'interface',
                    properties
                })
            }
        }
        
        // Extract type aliases
        if (ts.isTypeAliasDeclaration(node)) {
            const modifiers = node.modifiers
            const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
            
            if (hasExport) {
                const typeString = node.type ? formatType(node.type) : undefined
                types.push({
                    name: node.name.text,
                    kind: 'type',
                    description: typeString ? `\`${typeString}\`` : undefined
                })
            }
        }
        
        ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
    return types
}

async function extractDatasetsFromFile(filePath: string): Promise<ExtractedDataset[]> {
    const content = await readFile(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
    )
    
    const datasets: ExtractedDataset[] = []
    
    function visit(node: ts.Node) {
        // Extract exported interfaces (these are the dataset structures)
        if (ts.isInterfaceDeclaration(node)) {
            const modifiers = node.modifiers
            const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
            
            if (hasExport) {
                const properties: Array<{ name: string; type: string; optional: boolean }> = []
                
                if (node.members) {
                    for (const member of node.members) {
                        if (ts.isPropertySignature(member)) {
                            const name = ts.isIdentifier(member.name) ? member.name.text : 'unknown'
                            const optional = member.questionToken !== undefined
                            const type = member.type ? formatType(member.type) : 'any'
                            properties.push({ name, type, optional })
                        } else if (ts.isIndexSignatureDeclaration(member)) {
                            // Handle index signatures: { [key: string]: T }
                            const keyType = member.parameters[0] && member.parameters[0].type 
                                ? formatType(member.parameters[0].type) 
                                : 'string'
                            const valueType = member.type ? formatType(member.type) : 'any'
                            properties.push({ 
                                name: `[${keyType}]`, 
                                type: valueType, 
                                optional: member.questionToken !== undefined 
                            })
                        }
                    }
                }
                
                datasets.push({
                    name: node.name.text,
                    properties
                })
            }
        }
        
        ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
    return datasets
}

async function extractDefinitionsFromFile(filePath: string): Promise<ExtractedDefinition[]> {
    const content = await readFile(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
    )
    
    const definitions: ExtractedDefinition[] = []
    
    function visit(node: ts.Node) {
        if (ts.isVariableStatement(node)) {
            const modifiers = node.modifiers
            const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
            
            if (hasExport) {
                for (const declaration of node.declarationList.declarations) {
                    if (ts.isVariableDeclaration(declaration) && 
                        ts.isIdentifier(declaration.name) &&
                        declaration.initializer) {
                        
                        const exportName = declaration.name.text
                        
                        // Check if this is an array export (e.g., datatypeDefinitions)
                        let arrayLiteral: ts.ArrayLiteralExpression | undefined
                        if (ts.isArrayLiteralExpression(declaration.initializer)) {
                            arrayLiteral = declaration.initializer
                        } else if (ts.isAsExpression(declaration.initializer) &&
                                   ts.isArrayLiteralExpression(declaration.initializer.expression)) {
                            arrayLiteral = declaration.initializer.expression
                        } else if (ts.isSatisfiesExpression(declaration.initializer)) {
                            // Handle "[...] as const satisfies Type"
                            if (ts.isAsExpression(declaration.initializer.expression) &&
                                ts.isArrayLiteralExpression(declaration.initializer.expression.expression)) {
                                arrayLiteral = declaration.initializer.expression.expression
                            } else if (ts.isArrayLiteralExpression(declaration.initializer.expression)) {
                                arrayLiteral = declaration.initializer.expression
                            }
                        }
                        
                        if (arrayLiteral) {
                            // Extract definitions from array
                            const arrayDefs = extractDefinitionsFromArray(arrayLiteral)
                            definitions.push(...arrayDefs)
                            continue
                        }
                        
                        // Handle "as const satisfies Type" pattern for object literals
                        let objLiteral: ts.ObjectLiteralExpression | undefined
                        if (ts.isObjectLiteralExpression(declaration.initializer)) {
                            objLiteral = declaration.initializer
                        } else if (ts.isAsExpression(declaration.initializer) && 
                                   ts.isObjectLiteralExpression(declaration.initializer.expression)) {
                            objLiteral = declaration.initializer.expression
                        } else if (ts.isSatisfiesExpression(declaration.initializer)) {
                            // Handle "{ ... } as const satisfies Type"
                            // Structure: SatisfiesExpression -> AsExpression -> ObjectLiteralExpression
                            if (ts.isAsExpression(declaration.initializer.expression) &&
                                ts.isObjectLiteralExpression(declaration.initializer.expression.expression)) {
                                objLiteral = declaration.initializer.expression.expression
                            } else if (ts.isObjectLiteralExpression(declaration.initializer.expression)) {
                                objLiteral = declaration.initializer.expression
                            }
                        }
                        
                        if (!objLiteral) continue
                        
                        let code: string | undefined
                        let name: string | undefined
                        let description: string | undefined
                        const properties = new Map<string, any>()
                        let operationParameters: ExtractedParameter[] | undefined
                        let responseParameters: ExtractedParameter[] | undefined
                        let enumValues: ParameterEnumValue[] | undefined
                        let codecType: 'base' | 'enum' | 'custom' | 'array' | undefined
                        let defaultValue: string | undefined
                        let currentValue: string | undefined
                        
                        for (const prop of objLiteral.properties) {
                            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                                const propName = prop.name.text
                                
                                if (propName === 'code') {
                                    const value = extractPropertyValue(prop.initializer)
                                    if (value) {
                                        code = value.startsWith('0x') ? value : `0x${parseInt(value).toString(16)}`
                                    }
                                } else if (propName === 'name') {
                                    name = extractStringLiteral(prop.initializer)
                                } else if (propName === 'description') {
                                    description = extractStringLiteral(prop.initializer)
                                } else if (propName === 'operationParameters') {
                                    let arrayLiteral: ts.ArrayLiteralExpression | undefined
                                    if (ts.isArrayLiteralExpression(prop.initializer)) {
                                        arrayLiteral = prop.initializer
                                    } else if (ts.isAsExpression(prop.initializer) &&
                                               ts.isArrayLiteralExpression(prop.initializer.expression)) {
                                        arrayLiteral = prop.initializer.expression
                                    }
                                    if (arrayLiteral) {
                                        operationParameters = extractParameters(arrayLiteral)
                                    }
                                } else if (propName === 'responseParameters') {
                                    let arrayLiteral: ts.ArrayLiteralExpression | undefined
                                    if (ts.isArrayLiteralExpression(prop.initializer)) {
                                        arrayLiteral = prop.initializer
                                    } else if (ts.isAsExpression(prop.initializer) &&
                                               ts.isArrayLiteralExpression(prop.initializer.expression)) {
                                        arrayLiteral = prop.initializer.expression
                                    }
                                    if (arrayLiteral) {
                                        responseParameters = extractParameters(arrayLiteral)
                                    }
                                } else if (propName === 'codec' || propName === 'dataCodec') {
                                    // Extract enum values from codec
                                    enumValues = extractEnumValues(prop.initializer)
                                    if (enumValues) {
                                        codecType = 'enum'
                                    } else {
                                        codecType = detectCodecType(prop.initializer)
                                    }
                                } else if (propName === 'defaultValue') {
                                    const value = extractPropertyValue(prop.initializer)
                                    if (value !== undefined) {
                                        defaultValue = String(value)
                                    }
                                } else if (propName === 'currentValue') {
                                    const value = extractPropertyValue(prop.initializer)
                                    if (value !== undefined) {
                                        currentValue = String(value)
                                    }
                                } else {
                                    const value = extractPropertyValue(prop.initializer)
                                    if (value !== undefined) {
                                        properties.set(propName, value)
                                    }
                                }
                            }
                        }
                        
                        if (code && name && description) {
                            definitions.push({
                                exportName,
                                code,
                                name,
                                description,
                                properties,
                                operationParameters,
                                responseParameters,
                                enumValues,
                                codecType,
                                defaultValue,
                                currentValue
                            })
                        }
                    }
                }
            }
        }
        
        ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
    return definitions
}

function generatePropertyMDX(defs: ExtractedDefinition[], title: string): string {
    let mdx = `---
title: "${title}"
---

`

    for (const def of defs) {
        mdx += `## ${def.name} (\`${def.code}\`)

${def.description}

`
        // Output all properties dynamically
        for (const [key, value] of def.properties.entries()) {
            // Format the key nicely: dataDirection -> Data Direction
            const formattedKey = key
                .replace(/([A-Z])/g, ' $1')
                .trim()
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ')
            
            mdx += `**${formattedKey}:** ${value}\n\n`
        }

        // Add default value and current value for properties
        if (def.defaultValue !== undefined) {
            mdx += `**Default Value:** \`${def.defaultValue}\`\n\n`
        }
        if (def.currentValue !== undefined) {
            mdx += `**Current Value:** \`${def.currentValue}\`\n\n`
        }

        // Add codec type information
        if (def.codecType) {
            const codecTypeNames: Record<string, string> = {
                'base': 'Base Codec',
                'enum': 'Enum Codec',
                'custom': 'Custom Codec',
                'array': 'Array Codec'
            }
            mdx += `**Codec Type:** ${codecTypeNames[def.codecType] || def.codecType}\n\n`
        }

        // Add enum values for properties (same as operations)
        if (def.enumValues && def.enumValues.length > 0) {
            mdx += `### Valid Values\n\n`
            mdx += `| Value | Name | Description |\n`
            mdx += `| ----- | ---- | ----------- |\n`
            for (const enumValue of def.enumValues) {
                mdx += `| \`${enumValue.value}\` | ${enumValue.name} | ${enumValue.description} |\n`
            }
            mdx += '\n'
        }

        // Add operation parameters section (show even if empty for operations)
        if (def.properties.has('dataDirection')) {
            mdx += `### Operation Parameters\n\n`
            if (def.operationParameters && def.operationParameters.length > 0) {
                mdx += `| Parameter | Required | Description |\n`
                mdx += `| --------- | -------- | ----------- |\n`
                
                for (const param of def.operationParameters) {
                    const required = param.required ? '✓' : ''
                    const defaultValue = param.defaultValue ? ` (default: \`${param.defaultValue}\`)` : ''
                    mdx += `| **${param.name}** | ${required} | ${param.description}${defaultValue} |\n`
                }
                mdx += '\n'
                
                // Add enum values table if any parameter has them
                for (const param of def.operationParameters) {
                    if (param.enumValues && param.enumValues.length > 0) {
                        mdx += `**${param.name} values:**\n\n`
                        mdx += `| Value | Name | Description |\n`
                        mdx += `| ----- | ---- | ----------- |\n`
                        for (const enumValue of param.enumValues) {
                            mdx += `| \`${enumValue.value}\` | ${enumValue.name} | ${enumValue.description} |\n`
                        }
                        mdx += '\n'
                    }
                }
            } else {
                mdx += `None\n\n`
            }
        }

        // Add response parameters section (show even if empty for operations)
        if (def.properties.has('dataDirection')) {
            mdx += `### Response Parameters\n\n`
            if (def.responseParameters && def.responseParameters.length > 0) {
                mdx += `| Parameter | Required | Description |\n`
                mdx += `| --------- | -------- | ----------- |\n`
                
                for (const param of def.responseParameters) {
                    const required = param.required ? '✓' : ''
                    const defaultValue = param.defaultValue ? ` (default: \`${param.defaultValue}\`)` : ''
                    mdx += `| **${param.name}** | ${required} | ${param.description}${defaultValue} |\n`
                }
                mdx += '\n'
                
                // Add enum values table if any parameter has them
                for (const param of def.responseParameters) {
                    if (param.enumValues && param.enumValues.length > 0) {
                        mdx += `**${param.name} values:**\n\n`
                        mdx += `| Value | Name | Description |\n`
                        mdx += `| ----- | ---- | ----------- |\n`
                        for (const enumValue of param.enumValues) {
                            mdx += `| \`${enumValue.value}\` | ${enumValue.name} | ${enumValue.description} |\n`
                        }
                        mdx += '\n'
                    }
                }
            } else {
                mdx += `None\n\n`
            }
        }
        
        mdx += '---\n\n'
    }

    return mdx
}

function generateVendorIDsMDX(vendorIDs: ExtractedVendorID[]): string {
    let mdx = `---
title: "Vendor IDs"
description: "PTP Vendor ID mappings"
---

# Vendor IDs

This document lists all supported vendor IDs and their corresponding vendor names.

## Vendor ID Mappings

| Vendor ID | Name | Vendor Name |
| --------- | ---- | ----------- |
`

    for (const vid of vendorIDs) {
        mdx += `| \`${vid.value}\` | **${vid.name}** | ${vid.vendorName} |\n`
    }

    mdx += `
## Helper Functions

- \`getVendorName(vendorId: number): string\` - Returns the vendor name for a given vendor ID
- \`isSupportedVendor(vendorId: number): boolean\` - Checks if a vendor ID is supported

`

    return mdx
}

function generateTypesMDX(types: ExtractedType[], title: string): string {
    let mdx = `---
title: "${title}"
description: "PTP ${title} type definitions"
---

# ${title}

`

    for (const type of types) {
        mdx += `## ${type.name}

`
        
        if (type.kind === 'interface' && type.properties && type.properties.length > 0) {
            mdx += `### Properties\n\n`
            mdx += `| Property | Type | Required |\n`
            mdx += `| -------- | ---- | -------- |\n`
            
            for (const prop of type.properties) {
                const required = prop.optional ? '' : '✓'
                mdx += `| **${prop.name}** | \`${escapeMdxType(prop.type)}\` | ${required} |\n`
            }
            mdx += '\n'
        } else if (type.kind === 'type') {
            if (type.description) {
                mdx += `**Type:** ${escapeMdxType(type.description)}\n\n`
            } else {
                mdx += `**Type:** \`${escapeMdxType(type.name)}\`\n\n`
            }
        }
        
        mdx += '---\n\n'
    }

    return mdx
}

function generateDatasetsMDX(datasets: ExtractedDataset[], title: string): string {
    let mdx = `---
title: "${title}"
description: "PTP ${title} dataset structures"
---

# ${title}

Dataset structures define the format of complex data returned by PTP operations.

`

    for (const dataset of datasets) {
        mdx += `## ${dataset.name}

`
        
        if (dataset.description) {
            mdx += `${dataset.description}\n\n`
        }
        
        if (dataset.properties.length > 0) {
            mdx += `### Properties\n\n`
            mdx += `| Property | Type | Required |\n`
            mdx += `| -------- | ---- | -------- |\n`
            
            for (const prop of dataset.properties) {
                const required = prop.optional ? '' : '✓'
                mdx += `| **${prop.name}** | \`${escapeMdxType(prop.type)}\` | ${required} |\n`
            }
            mdx += '\n'
        }
        
        mdx += '---\n\n'
    }

    return mdx
}

async function processDefinitionFile(
    filePath: string,
    relativePath: string,
    outputDir: string
) {
    console.log(`Processing: ${relativePath}`)

    const defs = await extractDefinitionsFromFile(filePath)

    if (defs.length === 0) {
        console.log(`  No definitions found in ${relativePath}`)
        return
    }

    const fileName = relativePath.replace(/\.ts$/, '.mdx')
    
    // Check if this is a vendor-specific file
    const isVendor = relativePath.includes('vendors/')
    
    // Determine the definition type from the file path
    let definitionType = 'Definitions'
    if (relativePath.includes('property-definitions')) {
        definitionType = 'Properties'
    } else if (relativePath.includes('operation-definitions')) {
        definitionType = 'Operations'
    } else if (relativePath.includes('event-definitions')) {
        definitionType = 'Events'
    } else if (relativePath.includes('format-definitions')) {
        definitionType = 'Formats'
    } else if (relativePath.includes('response-definitions')) {
        definitionType = 'Responses'
    } else if (relativePath.includes('datatype-definitions')) {
        definitionType = 'Datatypes'
    }
    
    let title: string
    
    if (isVendor) {
        // Extract vendor name (e.g., "canon", "sony", "nikon")
        const vendorMatch = relativePath.match(/vendors\/([^\/]+)/)
        if (vendorMatch) {
            // Capitalize vendor name and append definition type
            const vendorName = vendorMatch[1].charAt(0).toUpperCase() + vendorMatch[1].slice(1)
            title = `${vendorName} ${definitionType}`
        } else {
            title = `Unknown ${definitionType}`
        }
    } else {
        // Non-vendor files: "Generic" + definition type
        if (relativePath.includes('datatype-definitions')) {
            title = 'Datatypes'
        } else {
            title = `Generic ${definitionType}`
        }
    }

    const mdxContent = generatePropertyMDX(defs, title)

    const outputPath = join(outputDir, fileName)
    const outputPathDir = outputPath.substring(0, outputPath.lastIndexOf('/'))

    await mkdir(outputPathDir, { recursive: true })
    await writeFile(outputPath, mdxContent, 'utf-8')

    console.log(`  Generated: ${fileName} (${defs.length} definitions)`)
}

async function processVendorIDsFile(
    filePath: string,
    outputDir: string
) {
    console.log(`Processing: vendor-ids.ts`)

    const vendorIDs = await extractVendorIDs(filePath)

    if (vendorIDs.length === 0) {
        console.log(`  No vendor IDs found`)
        return
    }

    const mdxContent = generateVendorIDsMDX(vendorIDs)
    const outputPath = join(outputDir, 'vendor-ids.mdx')

    await writeFile(outputPath, mdxContent, 'utf-8')

    console.log(`  Generated: vendor-ids.mdx (${vendorIDs.length} vendor IDs)`)
}

async function processTypesFile(
    filePath: string,
    relativePath: string,
    outputDir: string
) {
    console.log(`Processing: ${relativePath}`)

    const types = await extractTypesFromFile(filePath)

    if (types.length === 0) {
        console.log(`  No types found in ${relativePath}`)
        return
    }

    const fileName = relativePath.replace(/\.ts$/, '.mdx')
    const title = fileName.replace(/\.mdx$/, '').split('/').pop()?.replace(/-/g, ' ') || 'Types'
    const formattedTitle = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

    const mdxContent = generateTypesMDX(types, formattedTitle)

    const outputPath = join(outputDir, 'types', fileName)
    const outputPathDir = outputPath.substring(0, outputPath.lastIndexOf('/'))

    await mkdir(outputPathDir, { recursive: true })
    await writeFile(outputPath, mdxContent, 'utf-8')

    console.log(`  Generated: types/${fileName} (${types.length} types)`)
}

async function processDatasetFile(
    filePath: string,
    relativePath: string,
    outputDir: string
) {
    console.log(`Processing: ${relativePath}`)

    const datasets = await extractDatasetsFromFile(filePath)

    if (datasets.length === 0) {
        console.log(`  No datasets found in ${relativePath}`)
        return
    }

    // Determine title based on file name
    let title = relativePath.replace(/\.ts$/, '').split('/').pop() || 'Dataset'
    title = title.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    
    // Check if this is a vendor-specific file
    const isVendor = relativePath.includes('vendors/')
    let fileName: string
    let outputPath: string
    
    if (isVendor) {
        // Extract vendor name and dataset name
        const vendorMatch = relativePath.match(/vendors\/([^\/]+)\/(.+)$/)
        if (vendorMatch) {
            const vendorName = vendorMatch[1].charAt(0).toUpperCase() + vendorMatch[1].slice(1)
            const datasetName = vendorMatch[2].replace(/\.ts$/, '.mdx')
            fileName = `vendors/${vendorMatch[1]}/${datasetName}`
            title = `${vendorName} ${title}`
        } else {
            fileName = relativePath.replace(/\.ts$/, '.mdx')
        }
        outputPath = join(outputDir, 'datasets', fileName)
    } else {
        fileName = relativePath.replace(/\.ts$/, '.mdx')
        outputPath = join(outputDir, 'datasets', fileName)
    }

    const mdxContent = generateDatasetsMDX(datasets, title)

    const outputPathDir = outputPath.substring(0, outputPath.lastIndexOf('/'))

    await mkdir(outputPathDir, { recursive: true })
    await writeFile(outputPath, mdxContent, 'utf-8')

    console.log(`  Generated: datasets/${fileName} (${datasets.length} datasets)`)
}

async function walkDirectory(dir: string, baseDir: string): Promise<string[]> {
    const files: string[] = []
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            const subFiles = await walkDirectory(fullPath, baseDir)
            files.push(...subFiles)
        } else if (entry.name.endsWith('-definitions.ts')) {
            const relativePath = fullPath.substring(baseDir.length + 1)
            files.push(relativePath)
        }
    }

    return files
}

async function walkDirectoryForTypes(dir: string, baseDir: string): Promise<string[]> {
    const files: string[] = []
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            const subFiles = await walkDirectoryForTypes(fullPath, baseDir)
            files.push(...subFiles)
        } else if (entry.name.endsWith('.ts')) {
            const relativePath = fullPath.substring(baseDir.length + 1)
            files.push(relativePath)
        }
    }

    return files
}

async function walkDirectoryForDatasets(dir: string, baseDir: string): Promise<string[]> {
    const files: string[] = []
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            const subFiles = await walkDirectoryForDatasets(fullPath, baseDir)
            files.push(...subFiles)
        } else if (entry.name.endsWith('-dataset.ts') || entry.name.endsWith('-codec.ts')) {
            const relativePath = fullPath.substring(baseDir.length + 1)
            files.push(relativePath)
        }
    }

    return files
}

async function main() {
    console.log('Generating PTP documentation...')
    console.log(`Source: ${PTP_SOURCE_DIR}`)
    console.log(`Output: ${DOCS_OUTPUT_DIR}`)

    await mkdir(DOCS_OUTPUT_DIR, { recursive: true })

    // Process definition files
    const definitionsDir = join(PTP_SOURCE_DIR, 'definitions')
    const definitionFiles = await walkDirectory(definitionsDir, definitionsDir)

    console.log(`\nFound ${definitionFiles.length} definition files\n`)

    for (const relPath of definitionFiles) {
        const fullPath = join(definitionsDir, relPath)
        await processDefinitionFile(fullPath, relPath, DOCS_OUTPUT_DIR)
    }

    // Process vendor-ids.ts
    const vendorIdsPath = join(definitionsDir, 'vendor-ids.ts')
    try {
        await processVendorIDsFile(vendorIdsPath, DOCS_OUTPUT_DIR)
    } catch (error) {
        console.log(`  Skipping vendor-ids.ts: ${error}`)
    }

    // Process type files
    const typesDir = join(PTP_SOURCE_DIR, 'types')
    const typeFiles = await walkDirectoryForTypes(typesDir, typesDir)

    console.log(`\nFound ${typeFiles.length} type files\n`)

    for (const relPath of typeFiles) {
        const fullPath = join(typesDir, relPath)
        await processTypesFile(fullPath, relPath, DOCS_OUTPUT_DIR)
    }

    // Process dataset files
    const datasetsDir = join(PTP_SOURCE_DIR, 'datasets')
    const datasetFiles = await walkDirectoryForDatasets(datasetsDir, datasetsDir)

    console.log(`\nFound ${datasetFiles.length} dataset files\n`)

    for (const relPath of datasetFiles) {
        const fullPath = join(datasetsDir, relPath)
        await processDatasetFile(fullPath, relPath, DOCS_OUTPUT_DIR)
    }

    console.log('\nDone!')
}

main().catch(console.error)
