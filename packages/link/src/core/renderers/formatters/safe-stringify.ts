export function safeStringify(
    value: number | bigint | string | boolean | null | undefined | object | Uint8Array
): string {
    if (typeof value === 'bigint') {
        return value.toString()
    }
    if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value, (key, val) => (typeof val === 'bigint' ? val.toString() : val))
    }
    return JSON.stringify(value)
}
