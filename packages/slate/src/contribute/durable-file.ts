import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Writes a new owner-only file, flushes it, renames it over `path`, then flushes the directory entry. */
export async function replaceFileDurably(path: string, data: string | Uint8Array, syncDirectory = true) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
        const file = await open(temporary, 'wx', 0o600)
        try {
            await file.writeFile(data)
            await file.sync()
        } finally {
            await file.close()
        }
        await rename(temporary, path)
        if (!syncDirectory) return
        const directory = await open(dirname(path), 'r')
        try {
            await directory.sync()
        } finally {
            await directory.close()
        }
    } finally {
        await unlink(temporary).catch(() => {})
    }
}
