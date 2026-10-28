/**
 * Regenerates packages/link/GAPS.md from the camera catalog and the latest matrices in test-results/
 * (run `bun run test:simulation` first).
 *
 *   bun run compat:gaps [-- --output GAPS.md]
 */
import { packageDirectory } from '@scripts/camera-profiles/compat-progress'
import { CompatData } from '@scripts/compat-ui/compat-data'
import { renderGapsMarkdown } from '@scripts/compat-ui/compat-gaps'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { format } from 'prettier'

const index = process.argv.indexOf('--output')
const output = path.resolve(index >= 0 ? process.argv[index + 1] : path.join(packageDirectory, 'GAPS.md'))
const report = new CompatData().gapReport()
if (!report.matrixGeneratedAt) {
    console.error('No simulation matrix in test-results/; run `bun run test:simulation` first.')
    process.exit(1)
}
writeFileSync(output, await format(renderGapsMarkdown(report), { parser: 'markdown', proseWrap: 'preserve' }))
console.log(`Wrote ${path.relative(process.cwd(), output)}`)
