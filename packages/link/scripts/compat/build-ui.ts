/**
 * Writes the compatibility UI as static pages for hosting: the same routes as `compat:ui`
 * (/, /m/<manufacturer>, /m/<manufacturer>/<line>, /camera/<id>, /gaps, /runs), each as
 * <route>/index.html, plus view.json for client-side filtering. Live progress needs the local server.
 *
 *   bun run compat:ui:build [-- --out test-results/compat-ui --base /compat/]
 */
import { packageDirectory } from '@scripts/camera-profiles/compat-progress'
import { buildClientBundle, stylesheet } from '@scripts/compat-ui/compat-assets'
import { CompatData } from '@scripts/compat-ui/compat-data'
import type { PageContext } from '@scripts/compat-ui/compat-pages'
import { cameraPage, gapsPage, linesOf, manufacturersOf, runsPage, tablePage } from '@scripts/compat-ui/compat-site'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}
const output = path.resolve(valueAfter('--out') ?? path.join(packageDirectory, 'test-results/compat-ui'))
const base = `/${(valueAfter('--base') ?? '/').replace(/^\/|\/$/g, '')}/`.replace('//', '/')
const context: PageContext = { base, live: false }

const data = new CompatData()
const view = data.view()
rmSync(output, { recursive: true, force: true })
const write = (relative: string, content: string) => {
    const file = path.join(output, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
}

write('assets/client.js', await buildClientBundle())
write('assets/compat-ui.css', stylesheet())
write('view.json', JSON.stringify(view))
write('index.html', tablePage(data, view, context, {}, '').html)
let pages = 1
for (const manufacturer of manufacturersOf(view)) {
    write(
        `m/${manufacturer.slug}/index.html`,
        tablePage(data, view, context, { manufacturer: manufacturer.slug }, '').html
    )
    pages += 1
    for (const line of linesOf(view, manufacturer.slug)) {
        const route = { manufacturer: manufacturer.slug, line: line.slug }
        write(`m/${manufacturer.slug}/${line.slug}/index.html`, tablePage(data, view, context, route, '').html)
        pages += 1
    }
}
for (const profile of new Set(view.rows.map(row => row.profile))) {
    write(`camera/${profile}/index.html`, cameraPage(data, view, context, profile).html)
    pages += 1
}
write('gaps/index.html', gapsPage(data, context).html)
write('runs/index.html', runsPage(data, view, context).html)
console.log(
    `Wrote ${pages + 2} pages for ${view.rows.length} rows to ${path.relative(process.cwd(), output)} (base ${base})`
)
