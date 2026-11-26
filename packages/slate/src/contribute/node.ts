import { replaceFileDurably } from '@contribute/durable-file'
import type { ConsentStore } from '@contribute/index'
import { readFile } from 'node:fs/promises'

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
            await replaceFileDurably(path, JSON.stringify({ enabled }), process.platform !== 'win32')
        },
    }
}
