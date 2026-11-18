import { isIP } from 'node:net'

export type SecurityFinding = { file: string; line: number; rule: string }

const credentials = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
    ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
    ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
] as const
const migration = [
    ['email-address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
    ['network-address', /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[\w.-]+\.(?:ts|tailscale)\.net\b/g],
    ['private-home-path', /\/(?:Users|home)\/[^/\s"'`]+/g],
    ['private-controller', /\bdarkgrade0\d\b|\bks-studio\b/g],
] as const
const browserCapabilities = /\bfetch\s*\(|new\s+(?:WebSocket|EventSource|XMLHttpRequest)\s*\(|navigator\.(?:usb|bluetooth|mediaDevices)|\bfrom\s*['"](?!\.)|\bimport\s*['"](?!\.)|\bimport\s*\(/g
const demoRoot = 'apps/testbench/'
const allowedDemoExtensions = new Set(['ts', 'css', 'html', 'json', 'md', 'svg'])

/** Findings expose locations and categories, never the credential or personal data. */
export function scanSecurityFile(file: string, text: string): SecurityFinding[] {
    const findings: SecurityFinding[] = []
    const find = (rule: string, expression: RegExp) => {
        const pattern = new RegExp(expression.source, expression.flags)
        for (const match of text.matchAll(pattern))
            findings.push({ file, rule, line: text.slice(0, match.index).split('\n').length })
    }
    for (const [rule, expression] of credentials) find(rule, expression)
    if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example'))
        findings.push({ file, line: 1, rule: 'tracked-environment-file' })
    if (!file.startsWith(demoRoot)) return findings
    const extension = file.split('.').at(-1)?.toLowerCase() ?? ''
    if ((!allowedDemoExtensions.has(extension) && file !== demoRoot + '.gitignore') ||
        /\.pdf$/i.test(file) || text.includes('\0') || text.startsWith('%PDF'))
        findings.push({ file, line: 1, rule: 'non-ui-migration-material' })
    for (const [rule, expression] of migration) find(rule, expression)
    for (const match of text.matchAll(/(?<![\w:])(?:[0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F:]{0,39}(?![\w:])/g)) {
        if (isIP(match[0]) === 6)
            findings.push({ file, line: text.slice(0, match.index).split('\n').length, rule: 'network-address' })
    }
    if (file.startsWith(demoRoot + 'src/')) find('browser-hardware-or-network-capability', browserCapabilities)
    return findings
}
