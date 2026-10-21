import { createSonySdkBridge } from '@vendors/sony/sdk-node-bridge'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
const directories: string[] = []
afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function executable(body: string) {
    const directory = await mkdtemp(join(tmpdir(), 'sony-sdk-contract-'))
    directories.push(directory)
    const filename = join(directory, 'bridge')
    await writeFile(filename, '#!/bin/sh\n' + body, { mode: 0o700 })
    return filename
}
it('serializes stdio requests and preserves large SDK integers', async () => {
    const filename = await executable(`printf '%s\\n' '{"ok":true}'
while IFS= read -r request; do
printf '%s\\n' '{"event":"connected"}' '{"ok":true,"properties":[{"value":9007199254740993}]}'
done
`)
    const bridge = await createSonySdkBridge({ executable: filename })
    const responses = await Promise.all([bridge.request({ cmd: 'properties' }), bridge.request({ cmd: 'properties' })])
    expect((responses[0]!.properties as Array<{ value: string }>)[0]!.value).toBe('9007199254740993')
    await bridge.close()
    await expect(bridge.request({ cmd: 'properties' })).rejects.toThrow('closed')
})
it.each(['connect_wifi', 'download_content'])('never echoes SDK error text for %s that could contain credentials', async cmd => {
    const filename = await executable(`printf '%s\\n' '{"ok":true}'
while IFS= read -r request; do
printf '%s\\n' '{"ok":false,"error":"runtime-secret","code":123}'
done
`)
    const bridge = await createSonySdkBridge({ executable: filename })
    await expect(bridge.request({ cmd, password: 'runtime-secret' })).rejects.toThrow(
        'Sony SDK command failed (SDK code 123)'
    )
    await bridge.close()
})
it('bounds a stuck native helper and rejects queued work', async () => {
    const filename = await executable("printf '%s\\n' '{\"ok\":true}'\nwhile IFS= read -r request; do :; done\n")
    const bridge = await createSonySdkBridge({ executable: filename, timeoutMilliseconds: 100 })
    await expect(bridge.request({ cmd: 'properties' })).rejects.toThrow('timed out')
    await expect(bridge.request({ cmd: 'properties' })).rejects.toThrow('closed')
})

it('allows longer content downloads without extending ordinary command deadlines', async () => {
    const filename = await executable(`printf '%s\\n' '{"ok":true}'
while IFS= read -r request; do
sleep 0.15
printf '%s\\n' '{"ok":true,"downloaded":true}'
done
`)
    const bridge = await createSonySdkBridge({ executable: filename, timeoutMilliseconds: 100 })
    try {
        await expect(bridge.request({ cmd: 'download_content', handle: '1', path: '/tmp/content' }))
            .resolves.toMatchObject({ ok: true, downloaded: true })
        await expect(bridge.request({ cmd: 'properties' })).rejects.toThrow('timed out')
        await expect(bridge.request({ cmd: 'properties' })).rejects.toThrow('closed')
    } finally {
        await bridge.close()
    }
})

it.each([
    { transferPercent: 37, transferStatus: 3, suffix: ' (transfer 37%, status 3)' },
    { transferPercent: 101, transferStatus: 'runtime-secret', suffix: '' },
    { transferPercent: -1, transferStatus: 0x1_0000_0000, suffix: '' },
])('exposes only bounded numeric transfer diagnostics: $suffix', async ({ transferPercent, transferStatus, suffix }) => {
    const reply = JSON.stringify({ ok: false, error: 'runtime-secret', code: 123, transferPercent, transferStatus })
    const filename = await executable(`printf '%s\\n' '{"ok":true}'
while IFS= read -r request; do
printf '%s\\n' '${reply}'
done
`)
    const bridge = await createSonySdkBridge({ executable: filename })
    try {
        await expect(bridge.request({ cmd: 'download_content' })).rejects.toMatchObject({
            message: `Sony SDK command failed (SDK code 123)${suffix}`,
        })
    } finally {
        await bridge.close()
    }
})
