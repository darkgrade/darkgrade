/** The browser bundle and stylesheet of the compatibility UI, built with Vite from TypeScript. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Rollup } from 'vite'
import { iconStylesheet } from './compat-icons'

const directory = path.dirname(fileURLToPath(import.meta.url))

export async function buildClientBundle(): Promise<string> {
    const result = await build({
        configFile: false,
        logLevel: 'silent',
        root: directory,
        resolve: { alias: { '@scripts': path.resolve(directory, '..') } },
        build: {
            write: false,
            minify: true,
            target: 'es2022',
            lib: { entry: path.join(directory, 'compat-client.ts'), formats: ['es'], fileName: () => 'client.js' },
        },
    })
    const output = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
    const chunk = output.output.find(item => item.type === 'chunk')
    if (!chunk || chunk.type !== 'chunk') throw new Error('The compatibility UI client did not build')
    return chunk.code
}

export function stylesheet(): string {
    return `${readFileSync(path.join(directory, 'compat-ui.css'), 'utf8')}\n${iconStylesheet()}\n`
}
