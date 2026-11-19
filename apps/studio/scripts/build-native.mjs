// Builds Studio's Metal JPEG decoder (macOS only): Swift, with a C file for Node-API's stable headers, so there is no
// node-gyp and the result loads in any Electron. A machine that can't build it (no Xcode tools, not macOS) skips it:
// Studio then decodes live frames in the page, as always.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'metal-jpeg')
const out = join(root, 'native', 'build')

// The packager copies this folder's add-ons into the app, so it exists even where nothing is built into it.
mkdirSync(out, { recursive: true })
if (process.platform !== 'darwin') process.exit(0)

const headers = [
    join(dirname(process.execPath), '..', 'include', 'node'),
    '/opt/homebrew/include/node',
    '/usr/local/include/node',
].find(directory => existsSync(join(directory, 'node_api.h')))
if (!headers) {
    console.warn('[native] Node-API headers not found; the Metal live-view decoder is unavailable')
    process.exit(0)
}

try {
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64'
    const glue = join(out, 'metal-jpeg-addon.o')
    const swiftSources = readdirSync(source)
        .filter(file => file.endsWith('.swift'))
        .map(file => join(source, file))
    execFileSync(
        'xcrun',
        [
            'clang',
            '-O2',
            '-arch',
            architecture,
            '-mmacosx-version-min=12.0',
            '-DNODE_GYP_MODULE_NAME=metal_jpeg',
            `-I${headers}`,
            '-c',
            join(source, 'addon.c'),
            '-o',
            glue,
        ],
        { stdio: 'inherit' }
    )
    execFileSync(
        'xcrun',
        [
            'swiftc',
            '-O',
            '-parse-as-library',
            '-emit-library',
            '-module-name',
            'MetalJpeg',
            '-target',
            `${architecture}-apple-macos12`,
            ...swiftSources,
            glue,
            '-Xlinker',
            '-undefined',
            '-Xlinker',
            'dynamic_lookup',
            '-framework',
            'Metal',
            '-framework',
            'CoreVideo',
            '-framework',
            'IOSurface',
            '-o',
            join(out, 'metal-jpeg.node'),
        ],
        { stdio: 'inherit' }
    )
} catch {
    console.warn('[native] build failed; the Metal live-view decoder is unavailable')
}
