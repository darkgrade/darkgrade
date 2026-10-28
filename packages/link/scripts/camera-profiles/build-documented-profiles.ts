/**
 * Builds one documented profile per camera line in camera-catalog/camera-lines.json.
 *
 *   bun run profiles:documented
 *
 * Documented profiles come from public references (libgphoto2 tables and vendor SDK pages), not
 * from hardware. Each one represents a line with a single model that has a known USB product ID
 * (see documented-profile.ts). Lines without a PTP-capable model that has a USB product ID get no
 * profile. Per-model documented mocks are generated at test time instead of being written here.
 */
import { validateCameraProfile } from '@transport/simulated/camera-profile'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import { loadCatalog, slug } from './camera-catalog'
import { buildDocumentedProfile, DOCUMENTED_SUFFIX, representativeModel } from './documented-profile'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const profileDirectory = path.join(packageDirectory, 'camera-profiles')

function removeDocumentedProfiles(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) removeDocumentedProfiles(full)
        else if (entry.name.endsWith(`${DOCUMENTED_SUFFIX}.json`)) rmSync(full)
    }
    if (directory !== profileDirectory && readdirSync(directory).length === 0) rmSync(directory, { recursive: true })
}

async function main(): Promise<void> {
    const catalog = loadCatalog()
    removeDocumentedProfiles(profileDirectory)
    for (const manufacturer of catalog.manufacturers) {
        for (const line of manufacturer.lines) {
            const model = representativeModel(line)
            if (!model) {
                console.log(`skipped ${manufacturer.name} / ${line.name}: no PTP model with a USB product ID`)
                continue
            }
            const profile = buildDocumentedProfile(manufacturer, line, model)
            const problems = validateCameraProfile(profile)
            if (problems.length) throw new Error(`${profile.id} is invalid:\n  ${problems.join('\n  ')}`)
            const directory = path.join(profileDirectory, slug(profile.manufacturer), slug(profile.line))
            mkdirSync(directory, { recursive: true })
            const file = path.join(directory, `${profile.id}.json`)
            writeFileSync(file, await format(JSON.stringify(profile), { parser: 'json', tabWidth: 4, printWidth: 120 }))
            console.log(`${path.relative(packageDirectory, file)}: ${model.name}, ${profile.quirks.length} quirks`)
        }
    }
}

await main()
