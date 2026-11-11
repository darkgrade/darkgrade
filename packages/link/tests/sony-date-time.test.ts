import { sonyDateTimeString } from '@camera/sony-camera'
import { describe, expect, it } from 'vitest'

describe('Sony date/time string', () => {
    it('writes local wall time, tenths of a second and the UTC offset as Sony expects', () => {
        const moment = new Date(2026, 0, 5, 7, 8, 9, 456)
        const offsetMinutes = -moment.getTimezoneOffset()
        const sign = offsetMinutes >= 0 ? '+' : '-'
        const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
        const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
        expect(sonyDateTimeString(moment)).toBe(`20260105T070809.4${sign}${hours}${minutes}`)
    })

    it('always matches the documented shape', () => {
        expect(sonyDateTimeString(new Date())).toMatch(/^\d{8}T\d{6}\.\d[+-]\d{4}$/)
    })
})
