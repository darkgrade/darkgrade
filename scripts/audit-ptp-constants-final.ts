#!/usr/bin/env bun
import fs from 'fs/promises'
import path from 'path'
import { glob } from 'glob'

// Types for our audit data structures
interface ExtractedConstant {
  sourceFile: string
  hexCode: string
  constantName: string
  category: 'property' | 'operation' | 'event' | 'response' | 'control' | 'format' | 'storage' | 'error' | 'datatype'
  vendor: 'iso' | 'sony'
  lineNumber?: number
  context?: string
}

interface MissingConstant {
  hexCode: string
  constantName: string
  category: string
  sourceFile: string
  searchAttempts: string[]
}

interface CategorySummary {
  vendor: 'iso' | 'sony'
  category: string
  total: number
  found: number
  missing: number
  percentage: number
  missingConstants: MissingConstant[]
}

// Configuration
const CONFIG = {
  constantsPath: 'src/constants',
  isoDocsPath: 'docs/iso/ptp_iso_15740_reference/ptp_iso_15740_reference.md',
  sonyDocsPath: 'docs/manufacturers/sony/ptp_sony_reference/ptp_sony_reference.md',
  outputPath: 'docs/audit',
  excludeFiles: [
    'vendor-ids.ts' // USB vendor IDs, not PTP constants
  ]
}

// Extract hex codes from TypeScript source files
async function extractConstants(): Promise<ExtractedConstant[]> {
  const constants: ExtractedConstant[] = []
  const files = await glob(`${CONFIG.constantsPath}/**/*.ts`)
  
  for (const file of files) {
    // Skip excluded files
    if (CONFIG.excludeFiles.some(excluded => file.includes(excluded))) {
      console.log(`   Skipping ${file.replace(process.cwd() + '/', '')} (excluded)`)
      continue
    }
    
    const content = await fs.readFile(file, 'utf-8')
    const lines = content.split('\n')
    
    // Determine vendor and category from file path
    const vendor = file.includes('/vendors/sony/') ? 'sony' : 'iso'
    const category = determineCategory(file)
    
    // Extract constants with context
    lines.forEach((line, lineIndex) => {
      // Look for object property definitions with hex codes
      const propertyMatch = line.match(/^\s*(\w+):\s*{/)
      if (propertyMatch) {
        // Look ahead for the code property
        for (let i = 1; i <= 10 && lineIndex + i < lines.length; i++) {
          const codeLine = lines[lineIndex + i]
          const codeMatch = codeLine.match(/code:\s*(0x[0-9A-Fa-f]{2,4})/)
          if (codeMatch) {
            constants.push({
              sourceFile: file.replace(process.cwd() + '/', ''),
              hexCode: codeMatch[1],
              constantName: propertyMatch[1],
              category,
              vendor,
              lineNumber: lineIndex + 1,
              context: lines.slice(Math.max(0, lineIndex - 2), Math.min(lines.length, lineIndex + 10)).join('\n')
            })
            break
          }
          if (codeLine.includes('}')) break
        }
      }
      
      // Direct hex assignments
      const directMatch = line.match(/(?:const|let|var)?\s*(\w+)(?:\s*[:=]\s*|\s+)(?:HexCode\s*=\s*)?(0x[0-9A-Fa-f]{2,4})/)
      if (directMatch) {
        constants.push({
          sourceFile: file.replace(process.cwd() + '/', ''),
          hexCode: directMatch[2],
          constantName: directMatch[1],
          category,
          vendor,
          lineNumber: lineIndex + 1,
          context: lines.slice(Math.max(0, lineIndex - 2), Math.min(lines.length, lineIndex + 5)).join('\n')
        })
      }
      
      // Enum values
      const enumMatch = line.match(/'(\w+)':\s*(0x[0-9A-Fa-f]{2,4})/)
      if (enumMatch) {
        constants.push({
          sourceFile: file.replace(process.cwd() + '/', ''),
          hexCode: enumMatch[2],
          constantName: enumMatch[1],
          category,
          vendor,
          lineNumber: lineIndex + 1,
          context: line
        })
      }
    })
  }
  
  // Deduplicate by hexCode + vendor combination
  const seen = new Set<string>()
  return constants.filter(c => {
    const key = `${c.vendor}:${c.hexCode}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function determineCategory(filePath: string): ExtractedConstant['category'] {
  // Check for types.ts which contains data types
  if (filePath.includes('/types.ts')) return 'datatype'
  if (filePath.includes('/properties')) return 'property'
  if (filePath.includes('/operations')) return 'operation'
  if (filePath.includes('/events')) return 'event'
  if (filePath.includes('/responses')) return 'response'
  if (filePath.includes('/controls')) return 'control'
  if (filePath.includes('/formats')) return 'format'
  if (filePath.includes('/storage')) return 'storage'
  if (filePath.includes('/errors')) return 'error'
  return 'property' // default
}

// Special check for data types in the ISO documentation
async function checkDataTypeInISO(constant: ExtractedConstant): Promise<boolean> {
  if (constant.category !== 'datatype' || constant.vendor !== 'iso') {
    return false
  }
  
  const docContent = await fs.readFile(CONFIG.isoDocsPath, 'utf-8')
  const lines = docContent.split('\n')
  
  // Find the data types table section
  let inDataTypeTable = false
  let tableStart = -1
  let tableEnd = -1
  
  for (let i = 0; i < lines.length; i++) {
    // Look for the start of the data types section
    if (lines[i].includes('5.3 Simple types') || lines[i].includes('Table 3')) {
      inDataTypeTable = true
      tableStart = i
    }
    
    // If we're in the table, look for our hex code
    if (inDataTypeTable) {
      // Check for end of table (next major section or table)
      if (i > tableStart + 5 && (
        lines[i].match(/^#{1,2}\s+\d+\.\d+/) || // Next section number
        lines[i].includes('Table 4') || // Next table
        lines[i].includes('5.4') // Next subsection
      )) {
        tableEnd = i
        break
      }
    }
  }
  
  if (tableStart === -1) return false
  if (tableEnd === -1) tableEnd = Math.min(tableStart + 100, lines.length)
  
  // Search for the hex code in the data types table section
  const tableContent = lines.slice(tableStart, tableEnd).join('\n')
  
  // Format the hex code to match table format (0x000A vs 0x000a)
  const hexVariations = [
    constant.hexCode.toLowerCase(),
    constant.hexCode.toUpperCase(),
    // Pad with zeros if needed (0x1 -> 0x0001)
    '0x' + constant.hexCode.substring(2).padStart(4, '0').toLowerCase(),
    '0x' + constant.hexCode.substring(2).padStart(4, '0').toUpperCase()
  ]
  
  for (const hex of hexVariations) {
    if (tableContent.includes(hex)) {
      return true
    }
  }
  
  return false
}

// Check if a constant exists in documentation
async function checkDocumentation(constant: ExtractedConstant): Promise<{ found: boolean; searchAttempts: string[] }> {
  // Special handling for ISO data types
  if (constant.category === 'datatype' && constant.vendor === 'iso') {
    const found = await checkDataTypeInISO(constant)
    return { 
      found, 
      searchAttempts: ['Checked in Table 3 — Datatype codes'] 
    }
  }
  
  const docPath = constant.vendor === 'iso' ? CONFIG.isoDocsPath : CONFIG.sonyDocsPath
  const docContent = await fs.readFile(docPath, 'utf-8')
  
  // Try multiple variations of the hex code
  const searchAttempts = [
    constant.hexCode,
    constant.hexCode.toLowerCase(),
    constant.hexCode.toUpperCase(),
    constant.hexCode.replace('0x', '0X')
  ]
  
  for (const searchTerm of searchAttempts) {
    if (docContent.includes(searchTerm)) {
      return { found: true, searchAttempts }
    }
  }
  
  return { found: false, searchAttempts }
}

// Analyze missing constants by category
async function analyzeMissingConstants(): Promise<Map<string, CategorySummary>> {
  console.log('🔍 PTP Constants Documentation Audit - Final Version')
  console.log('====================================================\n')
  console.log('Special handling:')
  console.log('- ISO Data Types (Table 3 — Datatype codes)')
  console.log('- Case-insensitive hex code matching')
  console.log('- Excluding USB vendor IDs (not PTP constants)\n')
  
  // Extract all constants
  console.log('📋 Extracting constants from source files...')
  const constants = await extractConstants()
  console.log(`   Found ${constants.length} unique PTP constants\n`)
  
  // Group by vendor-category
  const grouped = new Map<string, ExtractedConstant[]>()
  constants.forEach(c => {
    const key = `${c.vendor}-${c.category}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(c)
  })
  
  // Analyze each group
  console.log('🔎 Checking documentation...')
  const summaries = new Map<string, CategorySummary>()
  
  // Sort keys for consistent output
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    const [vendorA] = a.split('-')
    const [vendorB] = b.split('-')
    if (vendorA !== vendorB) {
      return vendorA === 'iso' ? -1 : 1
    }
    return a.localeCompare(b)
  })
  
  let processedCount = 0
  const totalConstants = constants.length
  
  for (const key of sortedKeys) {
    const groupConstants = grouped.get(key)!
    const [vendor, category] = key.split('-') as [ExtractedConstant['vendor'], string]
    
    console.log(`\n   ${vendor.toUpperCase()} ${category}:`)
    
    const missingConstants: MissingConstant[] = []
    let found = 0
    
    // Sort constants by hex code for consistent output
    const sortedConstants = groupConstants.sort((a, b) => 
      parseInt(a.hexCode.substring(2), 16) - parseInt(b.hexCode.substring(2), 16)
    )
    
    for (const constant of sortedConstants) {
      processedCount++
      const progressPercent = Math.round((processedCount / totalConstants) * 100)
      process.stdout.write(`   [${processedCount}/${totalConstants}] ${constant.hexCode} (${constant.constantName})... `)
      
      const result = await checkDocumentation(constant)
      if (result.found) {
        found++
        process.stdout.write('✅\n')
      } else {
        missingConstants.push({
          hexCode: constant.hexCode,
          constantName: constant.constantName,
          category: constant.category,
          sourceFile: constant.sourceFile,
          searchAttempts: result.searchAttempts
        })
        process.stdout.write('❌\n')
      }
    }
    
    const total = groupConstants.length
    const missing = total - found
    const percentage = total > 0 ? (found / total) * 100 : 0
    
    summaries.set(key, {
      vendor: vendor as 'iso' | 'sony',
      category,
      total,
      found,
      missing,
      percentage,
      missingConstants
    })
    
    console.log(`   Summary: ${found}/${total} found (${percentage.toFixed(1)}%)`)
  }
  
  return summaries
}

// Generate comprehensive report
async function generateReport(summaries: Map<string, CategorySummary>): Promise<void> {
  let report = `# PTP Constants Documentation Coverage Report - Final
Generated: ${new Date().toISOString()}

This report provides a comprehensive analysis of PTP constants documentation coverage.
USB vendor IDs have been excluded as they are not PTP protocol constants.
Special handling has been implemented for ISO Data Types (Table 3) and case variations.

## Summary

`

  // Separate by vendor
  const isoSummaries = Array.from(summaries.values()).filter(s => s.vendor === 'iso')
  const sonySummaries = Array.from(summaries.values()).filter(s => s.vendor === 'sony')
  
  // ISO Summary
  let isoTotal = 0, isoFound = 0, isoMissing = 0
  report += `### ISO Constants (PTP Standard)\n\n`
  report += `| Category | Total | Found | Missing | Coverage |\n`
  report += `|----------|-------|-------|---------|----------|\n`
  
  // Sort categories for consistent display
  const categoryOrder = ['datatype', 'property', 'operation', 'event', 'response', 'format', 'storage', 'error']
  const sortedIsoSummaries = isoSummaries.sort((a, b) => {
    const indexA = categoryOrder.indexOf(a.category)
    const indexB = categoryOrder.indexOf(b.category)
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })
  
  for (const summary of sortedIsoSummaries) {
    isoTotal += summary.total
    isoFound += summary.found
    isoMissing += summary.missing
    const icon = summary.percentage === 100 ? '✅' : summary.percentage >= 80 ? '🟡' : '❌'
    report += `| ${summary.category} | ${summary.total} | ${summary.found} | ${summary.missing} | ${summary.percentage.toFixed(1)}% ${icon} |\n`
  }
  
  const isoPercentage = isoTotal > 0 ? (isoFound / isoTotal) * 100 : 0
  report += `| **TOTAL** | **${isoTotal}** | **${isoFound}** | **${isoMissing}** | **${isoPercentage.toFixed(1)}%** |\n\n`
  
  // Sony Summary
  let sonyTotal = 0, sonyFound = 0, sonyMissing = 0
  report += `### Sony Constants (Vendor Extensions)\n\n`
  report += `| Category | Total | Found | Missing | Coverage |\n`
  report += `|----------|-------|-------|---------|----------|\n`
  
  const sortedSonySummaries = sonySummaries.sort((a, b) => {
    const indexA = categoryOrder.indexOf(a.category)
    const indexB = categoryOrder.indexOf(b.category)
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })
  
  for (const summary of sortedSonySummaries) {
    sonyTotal += summary.total
    sonyFound += summary.found
    sonyMissing += summary.missing
    const icon = summary.percentage === 100 ? '✅' : summary.percentage >= 80 ? '🟡' : '❌'
    report += `| ${summary.category} | ${summary.total} | ${summary.found} | ${summary.missing} | ${summary.percentage.toFixed(1)}% ${icon} |\n`
  }
  
  const sonyPercentage = sonyTotal > 0 ? (sonyFound / sonyTotal) * 100 : 0
  report += `| **TOTAL** | **${sonyTotal}** | **${sonyFound}** | **${sonyMissing}** | **${sonyPercentage.toFixed(1)}%** |\n\n`
  
  // Overall Summary
  const overallTotal = isoTotal + sonyTotal
  const overallFound = isoFound + sonyFound
  const overallMissing = isoMissing + sonyMissing
  const overallPercentage = overallTotal > 0 ? (overallFound / overallTotal) * 100 : 0
  
  report += `### Overall Statistics\n\n`
  report += `- **Total PTP Constants**: ${overallTotal}\n`
  report += `- **Documented**: ${overallFound}\n`
  report += `- **Missing**: ${overallMissing}\n`
  report += `- **Coverage**: ${overallPercentage.toFixed(1)}%\n`
  report += `- **Target**: 80%\n`
  report += `- **Status**: ${overallPercentage >= 80 ? '✅ PASSING' : '❌ NEEDS IMPROVEMENT'}\n\n`
  
  // Detailed missing constants
  if (overallMissing > 0) {
    report += `## Missing Constants Details\n\n`
    report += `The following PTP constants are defined in the codebase but could not be found in the documentation.\n\n`
    
    // ISO Missing
    if (isoMissing > 0) {
      report += `### ISO Standard Missing Constants\n\n`
      for (const summary of sortedIsoSummaries) {
        if (summary.missingConstants.length > 0) {
          report += `#### ${summary.category.toUpperCase()}\n\n`
          if (summary.category === 'datatype') {
            report += `*Note: Data types should be in Table 3 — Datatype codes (Section 5.3 Simple types)*\n\n`
          }
          report += `| Hex Code | Constant Name | Source File |\n`
          report += `|----------|---------------|-------------|\n`
          for (const missing of summary.missingConstants) {
            report += `| \`${missing.hexCode}\` | ${missing.constantName} | \`${missing.sourceFile}\` |\n`
          }
          report += `\n`
        }
      }
    }
    
    // Sony Missing
    if (sonyMissing > 0) {
      report += `### Sony Vendor Extension Missing Constants\n\n`
      for (const summary of sortedSonySummaries) {
        if (summary.missingConstants.length > 0) {
          report += `#### ${summary.category.toUpperCase()}\n\n`
          report += `| Hex Code | Constant Name | Source File |\n`
          report += `|----------|---------------|-------------|\n`
          for (const missing of summary.missingConstants) {
            report += `| \`${missing.hexCode}\` | ${missing.constantName} | \`${missing.sourceFile}\` |\n`
          }
          report += `\n`
        }
      }
    }
  }
  
  // Analysis section
  report += `## Analysis\n\n`
  
  report += `### Coverage by Category\n\n`
  
  // Find best and worst coverage
  const allSummaries = Array.from(summaries.values())
  const perfectCoverage = allSummaries.filter(s => s.percentage === 100)
  const goodCoverage = allSummaries.filter(s => s.percentage >= 80 && s.percentage < 100)
  const poorCoverage = allSummaries.filter(s => s.percentage < 80)
  
  if (perfectCoverage.length > 0) {
    report += `#### ✅ Perfect Coverage (100%)\n\n`
    for (const summary of perfectCoverage) {
      report += `- **${summary.vendor.toUpperCase()} ${summary.category}**: All ${summary.total} constants documented\n`
    }
    report += `\n`
  }
  
  if (goodCoverage.length > 0) {
    report += `#### 🟡 Good Coverage (80-99%)\n\n`
    for (const summary of goodCoverage) {
      report += `- **${summary.vendor.toUpperCase()} ${summary.category}**: ${summary.percentage.toFixed(1)}% (${summary.missing} missing)\n`
    }
    report += `\n`
  }
  
  if (poorCoverage.length > 0) {
    report += `#### ❌ Needs Attention (<80%)\n\n`
    for (const summary of poorCoverage) {
      report += `- **${summary.vendor.toUpperCase()} ${summary.category}**: ${summary.percentage.toFixed(1)}% (${summary.missing} missing)\n`
    }
    report += `\n`
  }
  
  report += `### Key Findings\n\n`
  
  // Data type specific findings
  const datatypeSummary = summaries.get('iso-datatype')
  if (datatypeSummary && datatypeSummary.missingConstants.length > 0) {
    report += `#### Data Types\n`
    report += `- ${datatypeSummary.found} of ${datatypeSummary.total} ISO data types found in Table 3\n`
    if (datatypeSummary.missingConstants.some(c => c.constantName.includes('128'))) {
      report += `- 128-bit integer types may not be supported in all PTP implementations\n`
    }
    report += `\n`
  }
  
  // Vendor-specific findings
  if (sonyMissing > 0) {
    report += `#### Vendor Extensions\n`
    report += `- Sony extensions have ${sonyPercentage.toFixed(1)}% coverage\n`
    const sonyEvents = summaries.get('sony-event')
    const sonyResponses = summaries.get('sony-response')
    if (sonyEvents && sonyEvents.percentage === 0) {
      report += `- Sony events appear to be custom implementations not in public docs\n`
    }
    if (sonyResponses && sonyResponses.percentage === 0) {
      report += `- Sony response codes are vendor-specific error conditions\n`
    }
    report += `\n`
  }
  
  report += `### Notes\n\n`
  report += `- **Excluded Files**: USB vendor IDs (vendor-ids.ts) are not PTP constants\n`
  report += `- **Data Types**: Checked against Table 3 in Section 5.3 of ISO 15740\n`
  report += `- **Case Sensitivity**: Hex codes are matched case-insensitively\n\n`
  
  if (overallPercentage < 80) {
    report += `### Recommendations\n\n`
    report += `1. **Priority Areas**: Focus on categories with <80% coverage\n`
    report += `2. **Data Types**: Verify Table 3 contains all required type definitions\n`
    report += `3. **Vendor Docs**: Check for updated Sony documentation or SDK references\n`
    report += `4. **Code Review**: Verify constants are correctly categorized in source files\n`
    report += `5. **Documentation**: Consider marking internal-only constants in code comments\n`
  } else {
    report += `### Success! 🎉\n\n`
    report += `Documentation coverage exceeds the 80% threshold.\n`
    report += `- ISO Standard: ${isoPercentage.toFixed(1)}% coverage\n`
    report += `- Sony Extensions: ${sonyPercentage.toFixed(1)}% coverage\n`
    report += `- Overall: ${overallPercentage.toFixed(1)}% coverage\n`
  }
  
  // Write report
  await fs.mkdir(CONFIG.outputPath, { recursive: true })
  const reportPath = path.join(CONFIG.outputPath, 'ptp-constants-coverage-final.md')
  await fs.writeFile(reportPath, report)
  console.log(`\n📄 Report saved to: ${reportPath}`)
  
  // Also save as JSON for programmatic access
  const jsonData = {
    generated: new Date().toISOString(),
    excludedFiles: CONFIG.excludeFiles,
    summary: {
      total: overallTotal,
      documented: overallFound,
      missing: overallMissing,
      coverage: overallPercentage,
      passing: overallPercentage >= 80
    },
    iso: {
      total: isoTotal,
      documented: isoFound,
      missing: isoMissing,
      coverage: isoPercentage,
      categories: sortedIsoSummaries.map(s => ({
        category: s.category,
        total: s.total,
        documented: s.found,
        missing: s.missing,
        coverage: s.percentage,
        missingConstants: s.missingConstants
      }))
    },
    sony: {
      total: sonyTotal,
      documented: sonyFound,
      missing: sonyMissing,
      coverage: sonyPercentage,
      categories: sortedSonySummaries.map(s => ({
        category: s.category,
        total: s.total,
        documented: s.found,
        missing: s.missing,
        coverage: s.percentage,
        missingConstants: s.missingConstants
      }))
    }
  }
  
  const jsonPath = path.join(CONFIG.outputPath, 'ptp-constants-coverage-final.json')
  await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2))
  console.log(`📊 JSON data saved to: ${jsonPath}`)
}

// Main function
async function main() {
  try {
    const summaries = await analyzeMissingConstants()
    console.log()
    await generateReport(summaries)
    
    // Print final summary
    console.log('\n' + '='.repeat(60))
    
    let totalConstants = 0
    let totalFound = 0
    summaries.forEach(s => {
      totalConstants += s.total
      totalFound += s.found
    })
    
    const coverage = totalConstants > 0 ? (totalFound / totalConstants) * 100 : 0
    console.log(`\n📈 Final Coverage: ${coverage.toFixed(1)}%`)
    console.log(`📊 Status: ${coverage >= 80 ? '✅ PASSING' : '❌ NEEDS IMPROVEMENT'}`)
    
    if (coverage >= 80) {
      console.log('\n🎉 Congratulations! Documentation coverage meets requirements.')
    } else {
      console.log('\n⚠️  Coverage is below 80% threshold.')
      console.log('Review the detailed report for missing constants.')
    }
    
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()