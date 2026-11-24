/** Nikon Z6III command reference Rev.2, §6.5.6.10: UINT32 numerator/denominator.
 * Match fresh advertised wire values instead of rounding through standard ExposureTime ticks. */
export function nikonShutterLabel(raw: number): string {
    if (!Number.isInteger(raw) || raw < 0 || raw > 0xffffffff) throw new Error('Invalid Nikon shutter value')
    if (raw === 0xffffffff) return 'BULB'
    if (raw === 0xfffffffd) return 'TIME'
    if (raw === 0xfffffffe) return 'FLASH_SYNC'
    const numerator = raw >>> 16, denominator = raw & 0xffff
    if (!numerator || !denominator) throw new Error('Invalid Nikon shutter fraction')
    return numerator % denominator === 0 ? `${numerator / denominator}"` : `${numerator}/${denominator}`
}

function fraction(value: string): [bigint, bigint] | undefined {
    const text = value.trim().replace(/(?:s|")$/i, '')
    if (!/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(text) || text.length > 100) return undefined
    const decimal = (part: string): [bigint, bigint] => {
        const [integer, digits = ''] = part.split('.')
        return [BigInt(integer + digits), 10n ** BigInt(digits.length)]
    }
    const [left, right = '1'] = text.split('/')
    const [n, nd] = decimal(left), [d, dd] = decimal(right)
    return n > 0 && d > 0 ? [n * dd, nd * d] : undefined
}

export function matchesNikonShutter(raw: number, requested: string): boolean {
    const label = nikonShutterLabel(raw)
    if (label === requested.trim().toUpperCase()) return true
    if (raw >= 0xfffffffd) return false
    const target = fraction(requested)
    return Boolean(target && BigInt(raw >>> 16) * target[1] === BigInt(raw & 0xffff) * target[0])
}
