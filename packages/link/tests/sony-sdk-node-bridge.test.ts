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
it('never echoes SDK error text that could contain credentials', async () => {
    const filename = await executable(`printf '%s\\n' '{"ok":true}'
while IFS= read -r request; do
printf '%s\\n' '{"ok":false,"error":"runtime-secret","code":123}'
done
`)
    const bridge = await createSonySdkBridge({ executable: filename })
    await expect(bridge.request({ cmd: 'connect_wifi', password: 'runtime-secret' })).rejects.toThrow(
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
