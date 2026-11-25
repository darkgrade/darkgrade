export type SecurityFinding = { file: string; line: number; rule: string }

const credentials = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
    ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
    ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
] as const
// Product code belongs in Slate, Studio or CLI; these existing ancillary workspaces may stay.
const workspaceManifests = new Set([
    'packages/slate/package.json', 'packages/cli/package.json',
    'apps/studio/package.json', 'apps/docs/package.json',
    'apps/darkgrade.com/package.json', 'apps/darkgrade.com/drkgrd.co/package.json',
])

/** Findings expose locations and categories, never the credential. */
export function scanSecurityFile(file: string, text: string): SecurityFinding[] {
    const findings: SecurityFinding[] = []
    if (/^(?:packages|apps)\/[^/]+(?:\/[^/]+)?\/package\.json$/.test(file) && !workspaceManifests.has(file))
        findings.push({ file, line: 1, rule: 'unapproved-workspace-package' })
    for (const [rule, expression] of credentials) {
        const pattern = new RegExp(expression.source, expression.flags)
        for (const match of text.matchAll(pattern))
            findings.push({ file, rule, line: text.slice(0, match.index).split('\n').length })
    }
    if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example'))
        findings.push({ file, line: 1, rule: 'tracked-environment-file' })
    return findings
}
