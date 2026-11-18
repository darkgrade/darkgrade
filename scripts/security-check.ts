import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { scanSecurityFile, type SecurityFinding } from './security-rules'

const root = resolve(import.meta.dirname, '..')
const files = [...new Set(execFileSync('git', [
    'ls-files', '-z', '--cached', '--others', '--exclude-standard',
], { cwd: root }).toString().split('\0').filter(Boolean))]
const findings: SecurityFinding[] = []
for (const file of files) {
    let content: string
    try { content = await readFile(resolve(root, file), 'utf8') }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
    }
    findings.push(...scanSecurityFile(file, content))
}
if (findings.length) {
    for (const finding of findings)
        console.error(`${finding.file}:${finding.line}: ${finding.rule}`)
    process.exitCode = 1
} else {
    console.log(`Leak check passed: ${files.length} tracked/new files; Test Bench migration and browser capability checks passed`)
}
