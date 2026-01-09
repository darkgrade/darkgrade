import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import ts from 'typescript'

const PTP_SOURCE_DIR = join(__dirname, '../../packages/fuse/src/ptp')
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
    // Look for createEnumCodec call
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
                                    value = extractPropertyValue(prop.initializer)
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
        }
    }
    
    return undefined
}

function extractParameters(arrayLiteral: ts.ArrayLiteralExpression): ExtractedParameter[] {
    const params: ExtractedParameter[] = []
    
    for (const element of arrayLiteral.elements) {
        if (ts.isObjectLiteralExpression(element)) {
            let name: string | undefined
            let description: string | undefined
            let required = false
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
                    } else if (propName === 'codec') {
                        enumValues = extractEnumValues(prop.initializer)
                    }
                }
            }
            
            if (name && description) {
                params.push({ name, description, required, enumValues })
            }
        }
    }
    
    return params
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
                        
                        // Handle "as const satisfies Type" pattern
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
                        let operationParameters: Array<{ name: string; description: string; required: boolean }> | undefined
                        let responseParameters: Array<{ name: string; description: string; required: boolean }> | undefined
                        
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
                                } else if (propName !== 'codec' && propName !== 'dataCodec') {
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
                                responseParameters
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
description: "PTP ${title} definitions"
---

# ${title}

`

    for (const def of defs) {
        mdx += `## ${def.name}

**Code:** \`${def.code}\`

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

        // Add operation parameters section (show even if empty for operations)
        if (def.properties.has('dataDirection')) {
            mdx += `### Operation Parameters\n\n`
            if (def.operationParameters && def.operationParameters.length > 0) {
                for (const param of def.operationParameters) {
                    mdx += `- **${param.name}**${param.required ? ' (required)' : ' (optional)'}: ${param.description}\n`
                    
                    // Add enum values if they exist
                    if (param.enumValues && param.enumValues.length > 0) {
                        mdx += `  - Possible values:\n`
                        for (const enumValue of param.enumValues) {
                            mdx += `    - \`${enumValue.value}\` (**${enumValue.name}**): ${enumValue.description}\n`
                        }
                    }
                }
            } else {
                mdx += `None\n`
            }
            mdx += '\n'
        }

        // Add response parameters section (show even if empty for operations)
        if (def.properties.has('dataDirection')) {
            mdx += `### Response Parameters\n\n`
            if (def.responseParameters && def.responseParameters.length > 0) {
                for (const param of def.responseParameters) {
                    mdx += `- **${param.name}**${param.required ? ' (required)' : ' (optional)'}: ${param.description}\n`
                    
                    // Add enum values if they exist
                    if (param.enumValues && param.enumValues.length > 0) {
                        mdx += `  - Possible values:\n`
                        for (const enumValue of param.enumValues) {
                            mdx += `    - \`${enumValue.value}\` (**${enumValue.name}**): ${enumValue.description}\n`
                        }
                    }
                }
            } else {
                mdx += `None\n`
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
    let title: string
    
    if (isVendor) {
        // Extract vendor name (e.g., "canon", "sony", "nikon")
        const vendorMatch = relativePath.match(/vendors\/([^\/]+)/)
        if (vendorMatch) {
            // Capitalize vendor name
            title = vendorMatch[1].charAt(0).toUpperCase() + vendorMatch[1].slice(1)
        } else {
            title = 'Unknown'
        }
    } else {
        // Non-vendor files are "Generic"
        title = 'Generic'
    }

    const mdxContent = generatePropertyMDX(defs, title)

    const outputPath = join(outputDir, fileName)
    const outputPathDir = outputPath.substring(0, outputPath.lastIndexOf('/'))

    await mkdir(outputPathDir, { recursive: true })
    await writeFile(outputPath, mdxContent, 'utf-8')

    console.log(`  Generated: ${fileName} (${defs.length} definitions)`)
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

async function main() {
    console.log('Generating PTP documentation...')
    console.log(`Source: ${PTP_SOURCE_DIR}`)
    console.log(`Output: ${DOCS_OUTPUT_DIR}`)

    await mkdir(DOCS_OUTPUT_DIR, { recursive: true })

    const definitionsDir = join(PTP_SOURCE_DIR, 'definitions')
    const definitionFiles = await walkDirectory(definitionsDir, definitionsDir)

    console.log(`\nFound ${definitionFiles.length} definition files\n`)

    for (const relPath of definitionFiles) {
        const fullPath = join(definitionsDir, relPath)
        await processDefinitionFile(fullPath, relPath, DOCS_OUTPUT_DIR)
    }

    console.log('\nDone!')
}

main().catch(console.error)
