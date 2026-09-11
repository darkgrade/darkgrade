import { describe, expect, it } from 'vitest'
import { createCanonRegistry } from '../src/ptp/registry'

describe('Canon KeepDeviceOn operation', () => {
    it('registers the parameterless EOS timer-reset command', () => {
        const operation = createCanonRegistry(true).operations.CanonKeepDeviceOn

        expect(operation.code).toBe(0x911d)
        expect(operation.dataDirection).toBe('none')
        expect(operation.operationParameters).toEqual([])
    })
})
