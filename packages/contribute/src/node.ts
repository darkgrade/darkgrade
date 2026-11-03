import type { ConsentStore } from '#contribute/index'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Local preference only: never stores an upload token, identity or camera data. */
export function fileConsentStore(path: string): ConsentStore {
    return {
        async read() {
            try {
                return JSON.parse(await readFile(path, 'utf8')).enabled === true
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
                return false
            }
        },
        async write(enabled) {
            if (typeof enabled !== 'boolean') throw new Error('Contribution preference must be boolean')
            await mkdir(dirname(path), { recursive: true, mode: 0o700 })
            const temporary = `${path}.${randomUUID()}.tmp`
            try {
                const file = await open(temporary, 'wx', 0o600)
                try {
                    await file.writeFile(JSON.stringify({ enabled }))
                    await file.sync()
                } finally {
                    await file.close()
                }
                await rename(temporary, path)
                if (process.platform !== 'win32') {
                    const directory = await open(dirname(path), 'r')
                    try {
                        await directory.sync()
                    } finally {
                        await directory.close()
                    }
                }
            } finally {
                await rm(temporary, { force: true })
            }
        },
    }
}
