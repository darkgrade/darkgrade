import type { ConsentStore } from '#contribute/index'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Local preference only: never stores an upload token, identity or camera data. */
export function fileConsentStore(path: string): ConsentStore {
    return {
        async read() {
            try {
                return JSON.parse(await readFile(path, 'utf8')).enabled === true
            } catch {
                return false
            }
        },
        async write(enabled) {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 })
            const temporary = `${path}.${randomUUID()}.tmp`
            try {
                await writeFile(temporary, JSON.stringify({ enabled }), { flag: 'wx', mode: 0o600 })
                await rename(temporary, path)
            } finally {
                await rm(temporary, { force: true })
            }
        },
    }
}
