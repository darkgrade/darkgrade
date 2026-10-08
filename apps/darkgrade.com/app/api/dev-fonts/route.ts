import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * Dev-only bridge to the fonts installed on this machine, for the font chooser.
 *
 *   GET /api/dev-fonts            -> { fonts: [{ file, label }] }
 *   GET /api/dev-fonts?file=NAME  -> the font file's bytes
 *
 * Only files in ~/Library/Fonts whose name starts with FONT_PREFIX are exposed,
 * and a requested file must exactly match a name found by listing that folder,
 * so nothing outside it can be reached. Outside `next dev` on a loopback host
 * the route answers 404, so it never serves anything from a deployed build.
 */

export const dynamic = 'force-dynamic'

const FONT_DIRECTORY = path.join(homedir(), 'Library', 'Fonts')
const FONT_PREFIX = 'TAY'
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}

const NOT_FOUND = () => new Response('Not found', { status: 404 })

function isDevelopmentOnLoopback(request: Request): boolean {
    if (process.env.NODE_ENV !== 'development') return false
    const hostname = new URL(request.url).hostname
    return LOOPBACK_HOSTNAMES.has(hostname)
}

async function listInstalledFonts(): Promise<string[]> {
    const entries = await readdir(FONT_DIRECTORY).catch(() => [] as string[])
    return entries
        .filter(entry => entry.startsWith(FONT_PREFIX))
        .filter(entry => path.extname(entry).toLowerCase() in MIME_TYPE_BY_EXTENSION)
        .sort((first, second) => first.localeCompare(second, 'en', { numeric: true }))
}

export async function GET(request: Request): Promise<Response> {
    if (!isDevelopmentOnLoopback(request)) return NOT_FOUND()

    const installedFonts = await listInstalledFonts()
    const requestedFile = new URL(request.url).searchParams.get('file')

    if (requestedFile === null) {
        const fonts = installedFonts.map(file => ({ file, label: path.basename(file, path.extname(file)) }))
        return Response.json({ fonts }, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (!installedFonts.includes(requestedFile)) return NOT_FOUND()

    const bytes = await readFile(path.join(FONT_DIRECTORY, requestedFile))
    return new Response(new Uint8Array(bytes), {
        headers: {
            'Content-Type': MIME_TYPE_BY_EXTENSION[path.extname(requestedFile).toLowerCase()],
            'Cache-Control': 'no-store',
        },
    })
}
