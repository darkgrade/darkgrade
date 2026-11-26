import { createPTPRegistry } from '@vendors/registry'
import { expect, it } from 'vitest'

it('decodes an unknown or vendor ExposureProgramMode readably instead of throwing', () => {
    const registry = createPTPRegistry(true)
    const definition = Object.values(registry.properties).find(candidate => candidate.code === 0x500e)!
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    expect(codec.decode(registry.codecs.uint16.encode(0x9999)).value).toBe('Mode 0x9999')
})
