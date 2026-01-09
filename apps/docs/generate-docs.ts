import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

const PTP_SOURCE_DIR = join(__dirname, '../../packages/fuse/src/ptp')
const DOCS_OUTPUT_DIR = join(__dirname, 'ptp-reference')

interface PropertyDef {
    code: number
    name: string
    description: string
    datatype?: number
    access?: string
}

interface OperationDef {
    code: number
    name: string
    description: string
    dataDirection?: string
    operationParameters?: any[]
    responseParameters?: any[]
}

function findMatchingBrace(str: string, startIndex: number): number {
    let depth = 1
    let i = startIndex
    while (i < str.length && depth > 0) {
        if (str[i] === '{') depth++
        if (str[i] === '}') depth--
        i++
    }
    return i - 1
}

async function extractDefinitionsFromFile(filePath: string): Promise<any[]> {
    const content = await readFile(filePath, 'utf-8')
    const definitions: any[] = []

    // Find all export const declarations
    const exportPattern = /export const (\w+) = \{/g
    let match

    while ((match = exportPattern.exec(content)) !== null) {
        const name = match[1]
        const startIndex = match.index + match[0].length - 1
        const endIndex = findMatchingBrace(content, startIndex + 1)
        const body = content.substring(startIndex + 1, endIndex)

        // Extract basic properties
        const codeMat = /code:\s*0x([0-9a-fA-F]+)/.exec(body)
        const nameMat = /name:\s*['"]([^'"]+)['"]/.exec(body)
        const descMatch = /description:\s*['"]([^'"]+)['"]/s.exec(body)

        if (codeMat && nameMat && descMatch) {
            const def: any = {
                exportName: name,
                code: `0x${codeMat[1]}`,
                name: nameMat[1],
                description: descMatch[1],
            }

            // Extract all simple string properties dynamically
            const stringPropRegex = /(\w+):\s*['"]([^'"]+)['"]/g
            let propMatch
            while ((propMatch = stringPropRegex.exec(body)) !== null) {
                const propName = propMatch[1]
                const propValue = propMatch[2]
                
                // Skip the ones we already extracted
                if (propName !== 'name' && propName !== 'description') {
                    def[propName] = propValue
                }
            }

            // Extract numeric properties (like datatype)
            const numericPropRegex = /(\w+):\s*((?:UINT|INT|STRING|UNDEF)\d*|0x[0-9a-fA-F]+|\d+)(?:\s|,|})/g
            let numMatch
            while ((numMatch = numericPropRegex.exec(body)) !== null) {
                const propName = numMatch[1]
                const propValue = numMatch[2]
                
                // Skip code since we already handled it specially
                if (propName !== 'code' && !def[propName]) {
                    def[propName] = propValue
                }
            }

            // Extract operation/response parameters
            const opParamsMatch = /operationParameters:\s*\[([\s\S]*?)\]\s*as const/s.exec(body)
            if (opParamsMatch) {
                const paramsBody = opParamsMatch[1]
                const params: any[] = []
                
                // Find parameter objects
                const paramObjRegex = /\{[\s\S]*?name:\s*['"]([^'"]+)['"][\s\S]*?description:\s*['"]([^'"]+)['"][\s\S]*?required:\s*(true|false)/g
                let paramMatch
                while ((paramMatch = paramObjRegex.exec(paramsBody)) !== null) {
                    params.push({
                        name: paramMatch[1],
                        description: paramMatch[2],
                        required: paramMatch[3] === 'true'
                    })
                }
                
                if (params.length > 0) {
                    def.operationParameters = params
                }
            }

            const respParamsMatch = /responseParameters:\s*\[([\s\S]*?)\]\s*as const/s.exec(body)
            if (respParamsMatch) {
                const paramsBody = respParamsMatch[1]
                const params: any[] = []
                
                // Find parameter objects
                const paramObjRegex = /\{[\s\S]*?name:\s*['"]([^'"]+)['"][\s\S]*?description:\s*['"]([^'"]+)['"][\s\S]*?required:\s*(true|false)/g
                let paramMatch
                while ((paramMatch = paramObjRegex.exec(paramsBody)) !== null) {
                    params.push({
                        name: paramMatch[1],
                        description: paramMatch[2],
                        required: paramMatch[3] === 'true'
                    })
                }
                
                if (params.length > 0) {
                    def.responseParameters = params
                }
            }

            definitions.push(def)
        }
    }

    return definitions
}

function generatePropertyMDX(defs: any[], title: string): string {
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
        // Output all properties dynamically, excluding internal ones
        const excludeProps = ['code', 'name', 'description', 'exportName', 'codec', 'dataCodec', 'operationParameters', 'responseParameters']
        
        for (const [key, value] of Object.entries(def)) {
            if (!excludeProps.includes(key) && value !== undefined) {
                // Format the key nicely: dataDirection -> Data Direction
                const formattedKey = key
                    .replace(/([A-Z])/g, ' $1')
                    .trim()
                    .split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ')
                
                mdx += `**${formattedKey}:** ${value}\n\n`
            }
        }

        // Add operation parameters section (show even if empty for operations)
        if (def.dataDirection !== undefined) {
            mdx += `### Operation Parameters\n\n`
            if (def.operationParameters && def.operationParameters.length > 0) {
                for (const param of def.operationParameters) {
                    mdx += `- **${param.name}**${param.required ? ' (required)' : ' (optional)'}: ${param.description}\n`
                }
            } else {
                mdx += `None\n`
            }
            mdx += '\n'
        }

        // Add response parameters section (show even if empty for operations)
        if (def.dataDirection !== undefined) {
            mdx += `### Response Parameters\n\n`
            if (def.responseParameters && def.responseParameters.length > 0) {
                for (const param of def.responseParameters) {
                    mdx += `- **${param.name}**${param.required ? ' (required)' : ' (optional)'}: ${param.description}\n`
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
